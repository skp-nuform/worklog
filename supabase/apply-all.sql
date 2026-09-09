-- =====================================================================
-- Worklog schema — all migrations, applied as ONE transaction.
-- Generated from supabase/migrations/. Edit the migrations, not this file.
-- Atomic: a failure applies nothing.
-- =====================================================================

begin;

-- ############ 0001_schemas_roles_types.sql ############
-- =========================================================================
-- 0001 — Schemas, types, and the privilege baseline.
--
-- Design: docs/data-model.md section 1-2.
--
-- Three schemas, three privilege tiers:
--   app     base tables. NOT exposed. anon and authenticated get nothing.
--   authz   SECURITY DEFINER STABLE helpers used inside RLS policies.
--           NOT exposed: a definer function in an exposed schema is callable
--           with elevated privileges through the Data API.
--   public  the ONLY exposed surface: security_invoker views + definer RPCs.
--
-- The PRD names the exposed schema `api`. PostgREST's exposed-schema list is
-- project configuration, so using `public` (already exposed) avoids a manual
-- dashboard step and a silent misconfiguration mode. What matters is
-- unchanged: base tables are unreachable from the Data API. Recorded as
-- docs/decisions.md D-21.
-- =========================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext   with schema extensions;

-- -------------------------------------------------------------------------
-- Schemas
-- -------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists authz;

comment on schema app   is 'Base tables. Not exposed via PostgREST.';
comment on schema authz is 'RLS helper functions. Not exposed via PostgREST.';

-- Nothing in app or authz is reachable by a client, ever. Policies and the
-- public API surface are the only paths in.
revoke all on schema app   from public;
revoke all on schema authz from public;
revoke all on schema public from public;

grant usage on schema app   to postgres, service_role;
grant usage on schema authz to postgres, service_role, authenticated;
grant usage on schema public to postgres, service_role, authenticated, anon;

-- authenticated needs EXECUTE on the authz helpers because RLS policies that
-- call them are evaluated as the caller. The helpers are definer, so they can
-- read membership rows the caller cannot select directly.
-- Grants on individual functions are issued in 0004 where they are defined.

-- Future tables in app must not silently acquire grants.
alter default privileges in schema app   revoke all on tables    from public;
alter default privileges in schema app   revoke all on sequences from public;
alter default privileges in schema app   revoke all on functions from public;
alter default privileges in schema authz revoke all on functions from public;

-- -------------------------------------------------------------------------
-- Enumerated types
-- -------------------------------------------------------------------------
create type app.workspace_role as enum ('owner', 'admin', 'member', 'guest');

create type app.member_status as enum ('active', 'invited', 'removed');

-- Capabilities are data, not code: adding a role is an INSERT, not a deploy.
create type app.project_capability as enum
  ('read', 'comment', 'submit', 'review', 'manage');

create type app.project_role as enum ('contributor', 'reviewer', 'viewer');

create type app.brand_kind as enum ('brand');

-- Work lifecycle. Ideas share the base record but use idea-specific states,
-- so one enum covers both and an idea can never be 'approved'.
create type app.work_kind as enum ('work', 'idea');

create type app.work_status as enum (
  -- work
  'planned', 'in_progress', 'submitted', 'approved',
  'blocked', 'paused', 'cancelled',
  -- idea
  'captured', 'shelved'
);

create type app.request_source as enum (
  'verbal', 'meeting', 'chat', 'email', 'ticket', 'self', 'other'
);

create type app.priority as enum ('low', 'normal', 'high', 'urgent');

create type app.submission_status as enum ('submitted', 'withdrawn');

-- 'rejected' is deliberately absent: the PRD's only negative decision is
-- "request changes", which returns the item to In progress.
create type app.review_kind as enum ('approved', 'changes_requested');

-- 'internal' never reaches a guest projection. 'client' is scoped to one
-- share grant.
create type app.comment_visibility as enum ('internal', 'client');

create type app.ack_decision as enum ('confirmed', 'disputed');

create type app.artifact_kind as enum ('link', 'file');

create type app.artifact_state as enum
  ('pending', 'uploading', 'processing', 'ready', 'failed', 'cancelled');

create type app.share_mode as enum ('invited', 'unlisted');

-- -------------------------------------------------------------------------
-- Domains
-- -------------------------------------------------------------------------
create domain app.short_text as text
  check (length(value) between 1 and 300);

create domain app.title_text as text
  check (length(btrim(value)) between 3 and 180);

-- -------------------------------------------------------------------------
-- Shared trigger helpers
-- -------------------------------------------------------------------------

-- Append-only guard. Attached to UPDATE and/or DELETE on tables that must
-- never be rewritten. P0410 is this codebase's "immutable row" signal.
create or replace function app.raise_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    '% is append-only (attempted % on %)',
    tg_table_name, tg_op, coalesce(old.id::text, 'unknown')
    using errcode = 'P0410';
end;
$$;

comment on function app.raise_append_only() is
  'Rejects UPDATE/DELETE on append-only tables. Raises P0410.';

-- Stamps trusted creation metadata. Belt and braces: the columns are also
-- absent from every client GRANT, so a client cannot even name them. This
-- covers the definer-RPC paths where column grants do not apply.
create or replace function app.stamp_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- now() is the transaction timestamp, so a state change and its activity
  -- event share one instant. Never clock_timestamp().
  new.created_at := now();
  new.created_by := coalesce(auth.uid(), new.created_by);
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
  end if;
  return new;
end;
$$;

comment on function app.stamp_insert() is
  'Forces created_at/created_by from trusted context, ignoring the payload.';

-- Enforces the expected_version discipline. The CAS predicate in the RPC is
-- the actual concurrency control; this catches any path that forgets to bump
-- or tries to set version arbitrarily. P0409 is this codebase's conflict.
create or replace function app.enforce_version_bump()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.version is distinct from old.version + 1 then
    raise exception
      'version must increment by exactly one (had %, got %)',
      old.version, new.version
      using errcode = 'P0409';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  -- Creation facts are immutable.
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

comment on function app.enforce_version_bump() is
  'Requires version = old.version + 1 and re-stamps updated_*. Raises P0409.';

-- ############ 0002_core_tables.sql ############
-- =========================================================================
-- 0002 — Core hierarchy: profiles, workspaces, brands, projects, work items,
--        brief revisions, acknowledgements, activity events, idempotency.
--
-- Design: docs/data-model.md sections 2-4.
--
-- Two rules applied without exception:
--
--   1. workspace_id is denormalized onto EVERY row, every parent carries
--      UNIQUE (id, workspace_id), and every child FK is composite. A
--      cross-tenant reference therefore fails as 23503 (foreign key
--      violation), not as a policy error, and applies to bulk paths a
--      trigger would miss.
--
--   2. created_at / created_by / updated_at / updated_by / version are never
--      grantable to a client and are stamped from trusted context.
--
-- Delivery tables (artifacts, submissions, review decisions) are 0003.
-- Comments, collections, and shares arrive with M3/M4.
-- =========================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext   with schema extensions;

-- -------------------------------------------------------------------------
-- profiles — one row per auth user
-- -------------------------------------------------------------------------
create table app.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  app.short_text not null,
  email         extensions.citext not null,
  -- IANA zone name. Asia/Kolkata is the PRD's default display timezone.
  timezone      text not null default 'Asia/Kolkata',
  theme         text not null default 'system'
                  check (theme in ('light', 'dark', 'system')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table app.profiles is
  'Application profile for an auth user. Never exposed directly to clients.';

-- -------------------------------------------------------------------------
-- workspaces
-- -------------------------------------------------------------------------
create table app.workspaces (
  id         uuid primary key default extensions.gen_random_uuid(),
  slug       extensions.citext not null unique,
  name       app.short_text not null,
  owner_id   uuid not null references app.profiles(id) on delete restrict,

  -- Transactional counter for human-readable work references (WL-0012).
  -- Not a SEQUENCE: nextval is non-transactional and would burn numbers on
  -- rollback, leaving holes. Excluded from the version guard below.
  next_work_no integer not null default 1 check (next_work_no >= 1),

  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  version    integer not null default 1 check (version >= 1)
);

-- -------------------------------------------------------------------------
-- workspace_members
--
-- Membership is read LIVE from this table by every RLS policy. It is
-- deliberately NOT mirrored into JWT claims: access tokens last an hour and
-- are not proactively destroyed, so a removed member would otherwise keep a
-- valid capability claim. See docs/decisions.md D-06.
--
-- Removal is a status change, not a DELETE. Nothing in the schema relies on
-- deleting a membership row, so historical attribution always survives.
-- -------------------------------------------------------------------------
create table app.workspace_members (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id      uuid not null references app.profiles(id) on delete cascade,
  role         app.workspace_role not null default 'member',
  status       app.member_status  not null default 'active',
  invited_at   timestamptz not null default now(),
  joined_at    timestamptz,
  removed_at   timestamptz,

  primary key (workspace_id, user_id),
  -- Anchor for children that must pin BOTH tenant and user.
  constraint wm_ws_user_uniq unique (workspace_id, user_id),

  constraint wm_status_chk check (
        (status = 'active'  and joined_at is not null and removed_at is null)
     or (status = 'invited' and joined_at is null     and removed_at is null)
     or (status = 'removed' and removed_at is not null)
  )
);

comment on table app.workspace_members is
  'Live source of truth for membership. RLS reads this, never a JWT claim.';

-- -------------------------------------------------------------------------
-- brands
-- -------------------------------------------------------------------------
create table app.brands (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  name         app.short_text not null,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid not null default auth.uid(),
  version      integer not null default 1 check (version >= 1),

  primary key (id),
  -- Tenant-pinning anchor consumed by every child FK.
  constraint brands_id_ws_uniq unique (id, workspace_id),
  constraint brands_name_uniq  unique (workspace_id, name)
);

comment on table app.brands is
  'Editable organisation labels. Company names are never hard-coded in logic.';

-- -------------------------------------------------------------------------
-- projects
-- -------------------------------------------------------------------------
create table app.projects (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  brand_id     uuid,
  name         app.short_text not null,
  brief        text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid not null default auth.uid(),
  version      integer not null default 1 check (version >= 1),

  primary key (id),
  constraint projects_id_ws_uniq unique (id, workspace_id),

  -- A project cannot borrow another workspace's brand.
  constraint projects_brand_fk
    foreign key (brand_id, workspace_id)
    references app.brands(id, workspace_id)
    on update restrict on delete restrict
);

-- -------------------------------------------------------------------------
-- project_role_caps — capabilities as DATA
--
-- Adding or changing a role is an INSERT, not a deploy, and both RLS and the
-- RPC layer read this one source.
-- -------------------------------------------------------------------------
create table app.project_role_caps (
  role       app.project_role not null,
  capability app.project_capability not null,
  primary key (role, capability)
);

insert into app.project_role_caps (role, capability) values
  ('contributor', 'read'),
  ('contributor', 'comment'),
  ('contributor', 'submit'),
  ('reviewer',    'read'),
  ('reviewer',    'comment'),
  ('reviewer',    'review'),
  ('viewer',      'read');

-- Note what is absent: no project role grants 'manage'. Managing a project is
-- a workspace-admin capability, resolved separately in authz.

-- -------------------------------------------------------------------------
-- project_members
--
-- The composite FK to workspace_members is load-bearing: a project member
-- MUST be a workspace member of the SAME workspace.
-- -------------------------------------------------------------------------
create table app.project_members (
  project_id   uuid not null,
  workspace_id uuid not null,
  user_id      uuid not null,
  role         app.project_role not null default 'contributor',
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),

  primary key (project_id, user_id),

  constraint pm_project_fk
    foreign key (project_id, workspace_id)
    references app.projects(id, workspace_id)
    on update restrict on delete cascade,

  constraint pm_member_fk
    foreign key (workspace_id, user_id)
    references app.workspace_members(workspace_id, user_id)
    on update restrict on delete cascade
);

comment on constraint pm_member_fk on app.project_members is
  'A project grant cannot exist without a workspace membership row.';

-- -------------------------------------------------------------------------
-- work_items
--
-- Deliberately NOT stored here: a current_revision_id pointer. The current
-- revision is derived (see the api view in 0004). Caching it would need a
-- trigger that updates this row on every revision insert, and "you cannot
-- enforce that a cache stays correct" -- docs/data-model.md 3.3.
-- -------------------------------------------------------------------------
create table app.work_items (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,

  -- Human-readable reference, unique per workspace: WL-0012
  reference    text not null check (reference ~ '^WL-[0-9]{4,}$'),

  -- NULL project means the item sits in its author's Inbox. Explicitly
  -- allowed by the PRD.
  project_id   uuid,
  brand_id     uuid,

  kind         app.work_kind   not null default 'work',
  status       app.work_status not null default 'planned',
  title        app.title_text  not null,

  -- Transactional counter for submission numbers (see 0003). Excluded from
  -- the version guard.
  next_submission_no integer not null default 1
                       check (next_submission_no >= 1),

  -- Execution
  progress_note text,
  -- Reason is required by the state machine for block/pause/cancel/reopen.
  state_reason  text,
  -- Preserved so Resume can restore the prior execution state.
  prior_status  app.work_status,
  next_action   text,
  reviewer_id   uuid,
  priority      app.priority not null default 'normal',

  -- Date-only and timed deadlines are stored DISTINCTLY so a date-only
  -- deadline cannot shift across timezones. At most one may be set.
  deadline_date date,
  deadline_at   timestamptz,

  archived_at   timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  version    integer not null default 1 check (version >= 1),

  primary key (id),
  constraint work_items_id_ws_uniq unique (id, workspace_id),
  constraint work_items_reference_uniq unique (workspace_id, reference),

  constraint work_items_project_fk
    foreign key (project_id, workspace_id)
    references app.projects(id, workspace_id)
    on update restrict on delete restrict,

  constraint work_items_brand_fk
    foreign key (brand_id, workspace_id)
    references app.brands(id, workspace_id)
    on update restrict on delete restrict,

  -- The reviewer must be a member of THIS workspace. RESTRICT rather than
  -- SET NULL: a cascaded UPDATE would collide with the version guard, and
  -- membership removal is a status change, not a DELETE.
  constraint work_items_reviewer_fk
    foreign key (workspace_id, reviewer_id)
    references app.workspace_members(workspace_id, user_id)
    on update restrict on delete restrict,

  constraint work_items_deadline_chk
    check (deadline_date is null or deadline_at is null),

  -- An idea can never be 'approved'. The kind constrains the lifecycle.
  constraint work_items_kind_status_chk check (
    (kind = 'idea' and status in ('captured', 'shelved'))
    or
    (kind = 'work' and status in ('planned', 'in_progress', 'submitted',
                                  'approved', 'blocked', 'paused', 'cancelled'))
  )
);

comment on column app.work_items.deadline_date is
  'Date-only deadline. Stored separately from deadline_at so it cannot shift.';
comment on constraint work_items_kind_status_chk on app.work_items is
  'Ideas have no submitted/approved lifecycle; work items have no idea states.';

-- Race-safe reference allocation. One statement, row lock on the workspace.
create or replace function app.allocate_work_no(p_workspace uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  update app.workspaces
     set next_work_no = next_work_no + 1
   where id = p_workspace
  returning next_work_no - 1;
$$;

comment on function app.allocate_work_no(uuid) is
  'Transactional counter. A rolled-back insert returns its number (no hole).';

-- -------------------------------------------------------------------------
-- work_item_revisions — append-only brief history
--
-- material_digest covers only the MATERIAL fields. A revision that changes
-- an internal note produces the same digest, so an existing acknowledgement
-- stays current; a revision that changes the brief produces a new digest, so
-- the acknowledgement lapses. The invariant is modelled away rather than
-- guarded. See docs/data-model.md 3.5.
--
-- requester_user_id references profiles, not workspace_members: historical
-- attribution must survive a member being removed. Tenant membership is
-- checked at insert time by wir_check_requester below, so a cross-workspace
-- requester is still impossible.
-- -------------------------------------------------------------------------
create table app.work_item_revisions (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null,
  work_item_id uuid not null,
  revision_no  integer not null check (revision_no >= 1),

  -- Material fields: these determine the digest.
  summary             text not null,
  rationale           text,
  expected_outcome    text,
  acceptance_criteria text,
  requester_label     app.short_text,
  -- NULL means the requester is not a verified account, so the label renders
  -- as unverified and nobody can acknowledge on their behalf.
  requester_user_id   uuid references app.profiles(id) on delete restrict,
  source              app.request_source not null default 'self',
  source_url          text,
  -- User-reported, distinct from created_at. AC-02.
  reported_request_date date,

  -- Non-material: does not affect the digest.
  internal_note text,
  -- Why this revision exists, for a material change.
  change_reason text,

  material_digest bytea not null,

  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),

  primary key (id),
  constraint wir_id_ws_uniq unique (id, workspace_id),
  constraint wir_no_uniq    unique (work_item_id, revision_no),
  -- Anchor consumed by request_acknowledgements: an acknowledgement cannot
  -- claim a digest the revision does not actually have.
  constraint wir_id_digest_uniq unique (id, material_digest),
  -- Anchor consumed by submissions: a submission cannot deliver against a
  -- revision belonging to a different work item.
  constraint wir_id_item_uniq unique (id, work_item_id),

  constraint wir_work_item_fk
    foreign key (work_item_id, workspace_id)
    references app.work_items(id, workspace_id)
    on update restrict on delete cascade,

  constraint wir_source_url_chk
    check (source_url is null or source_url ~* '^https?://')
);

-- Computes the digest over material fields only, and stamps trusted metadata.
create or replace function app.wir_stamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.material_digest := extensions.digest(
    coalesce(new.summary, '')                 || e'\x1f' ||
    coalesce(new.rationale, '')               || e'\x1f' ||
    coalesce(new.expected_outcome, '')        || e'\x1f' ||
    coalesce(new.acceptance_criteria, '')     || e'\x1f' ||
    coalesce(new.requester_label::text, '')   || e'\x1f' ||
    coalesce(new.requester_user_id::text, '') || e'\x1f' ||
    coalesce(new.source::text, '')            || e'\x1f' ||
    coalesce(new.source_url, '')              || e'\x1f' ||
    coalesce(new.reported_request_date::text, ''),
    'sha256'
  );
  new.created_at := now();
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;

create trigger wir_stamp
  before insert on app.work_item_revisions
  for each row execute function app.wir_stamp();

-- Cross-tenant guard for the one reference that cannot be a composite FK.
create or replace function app.wir_check_requester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requester_user_id is not null
     and not exists (
       select 1 from app.workspace_members m
        where m.workspace_id = new.workspace_id
          and m.user_id = new.requester_user_id
     )
  then
    raise exception
      'requester % is not a member of workspace %',
      new.requester_user_id, new.workspace_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger wir_check_requester
  before insert on app.work_item_revisions
  for each row execute function app.wir_check_requester();

-- Append-only: the original request is never overwritten.
create trigger wir_no_update
  before update on app.work_item_revisions
  for each row execute function app.raise_append_only();

create trigger wir_no_delete
  before delete on app.work_item_revisions
  for each row execute function app.raise_append_only();

-- -------------------------------------------------------------------------
-- request_acknowledgements — append-only
--
-- Bound to (revision, digest) by composite FK, so an acknowledgement is a
-- fact about one exact brief. Nobody can acknowledge on another user's
-- behalf: user_id defaults from auth.uid() and is not client-grantable.
-- -------------------------------------------------------------------------
create table app.request_acknowledgements (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null,
  revision_id  uuid not null,
  acknowledged_material_digest bytea not null,
  user_id      uuid not null default auth.uid()
                 references app.profiles(id) on delete restrict,
  decision     app.ack_decision not null default 'confirmed',
  note         text,
  created_at   timestamptz not null default now(),

  primary key (id),

  constraint ack_revision_fk
    foreign key (revision_id, acknowledged_material_digest)
    references app.work_item_revisions(id, material_digest)
    on update restrict on delete cascade,

  constraint ack_ws_fk
    foreign key (revision_id, workspace_id)
    references app.work_item_revisions(id, workspace_id)
    on update restrict on delete cascade,

  -- One decision per user per revision. Changing your mind is a new
  -- revision's problem, not a mutation of this record.
  constraint ack_once_uniq unique (revision_id, user_id)
);

create trigger ack_no_update
  before update on app.request_acknowledgements
  for each row execute function app.raise_append_only();

create trigger ack_no_delete
  before delete on app.request_acknowledgements
  for each row execute function app.raise_append_only();

-- -------------------------------------------------------------------------
-- activity_events — append-only audit history
--
-- app.emit_event (0003) is the ONLY writer. That is what stops a future
-- feature from changing state without recording it.
--
-- Honest scope: this is an application-level audit history. It is not a claim
-- of tamper-proof storage against someone with direct database access.
-- -------------------------------------------------------------------------
create table app.activity_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  actor_id     uuid,
  event_type   text not null check (length(event_type) between 3 and 80),

  -- Loose references on purpose: an event must survive its subject being
  -- archived, and must never be deleted to satisfy a foreign key.
  work_item_id  uuid,
  project_id    uuid,
  submission_id uuid,
  resource_kind text,
  resource_id   uuid,

  -- Safe change payload only. Never confidential field values.
  payload jsonb not null default '{}'::jsonb,

  redacted_at timestamptz,
  created_at  timestamptz not null default now()
);

comment on table app.activity_events is
  'Append-only application audit history. app.emit_event is the only writer.';

create trigger activity_no_update
  before update on app.activity_events
  for each row execute function app.raise_append_only();

create trigger activity_no_delete
  before delete on app.activity_events
  for each row execute function app.raise_append_only();

-- -------------------------------------------------------------------------
-- idempotency_keys
--
-- Primary key does the deduplication. Replaying the same key with the same
-- payload digest returns the original result; the same key with a DIFFERENT
-- digest is a conflict, not a silent overwrite.
-- -------------------------------------------------------------------------
create table app.idempotency_keys (
  actor_id       uuid not null,
  action         text not null,
  request_key    text not null,
  payload_digest bytea not null,
  result         jsonb,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',

  primary key (actor_id, action, request_key)
);

create index idempotency_expiry_idx
  on app.idempotency_keys (expires_at);

-- -------------------------------------------------------------------------
-- Creation-metadata stamping and the version guard
--
-- The version guard must tolerate two legitimate system writes that do not
-- represent a user edit: the transactional counters, and the updated_*
-- re-stamp itself. Anything else changing without a version bump is a bug,
-- and a newly added column is guarded by default -- the safe direction.
-- -------------------------------------------------------------------------
create or replace function app.enforce_version_bump()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ignored text[] := array[
    'version', 'updated_at', 'updated_by',
    'next_work_no', 'next_submission_no'
  ];
begin
  if new.version = old.version then
    -- No bump: permitted only when nothing outside `ignored` changed.
    if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
      raise exception
        'a substantive update must bump version (still %)', old.version
        using errcode = 'P0409';
    end if;
    -- Counter-only write: leave updated_* alone so it reflects real edits.
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  elsif new.version is distinct from old.version + 1 then
    raise exception
      'version must increment by exactly one (had %, got %)',
      old.version, new.version
      using errcode = 'P0409';
  else
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  end if;

  -- Creation facts are immutable on every path.
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

comment on function app.enforce_version_bump() is
  'Requires version+1 for substantive updates; allows counter-only writes. P0409.';

create trigger workspaces_stamp before insert on app.workspaces
  for each row execute function app.stamp_insert();
create trigger brands_stamp before insert on app.brands
  for each row execute function app.stamp_insert();
create trigger projects_stamp before insert on app.projects
  for each row execute function app.stamp_insert();
create trigger work_items_stamp before insert on app.work_items
  for each row execute function app.stamp_insert();

create trigger workspaces_version before update on app.workspaces
  for each row execute function app.enforce_version_bump();
create trigger brands_version before update on app.brands
  for each row execute function app.enforce_version_bump();
create trigger projects_version before update on app.projects
  for each row execute function app.enforce_version_bump();
create trigger work_items_version before update on app.work_items
  for each row execute function app.enforce_version_bump();

-- ############ 0003_delivery_and_invariants.sql ############
-- =========================================================================
-- 0003 — Delivery: artifacts, submissions, review decisions.
--        Plus emit_event and the idempotency helper.
--
-- Design: docs/data-model.md section 3.
--
-- This file carries the invariants the product's integrity depends on:
--
--   * a submitter can NEVER approve their own submission (CHECK, not trigger)
--   * approval never migrates to a newer submission (nothing is cached)
--   * submission numbers are never reused, even after withdrawal
--   * submitted bytes and metadata are never rewritten
--   * a state change and its activity event commit together
-- =========================================================================

-- -------------------------------------------------------------------------
-- artifacts — the logical deliverable (a link, or a file)
-- -------------------------------------------------------------------------
create table app.artifacts (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null,
  work_item_id uuid not null,
  kind         app.artifact_kind not null,
  label        app.short_text not null,
  -- Provider/domain for the icon. Derived server-side from the URL host;
  -- V1 never crawls the URL for metadata, so there is no SSRF surface.
  provider     text,

  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),

  primary key (id),
  constraint artifacts_id_ws_uniq unique (id, workspace_id),
  constraint artifacts_id_item_uniq unique (id, work_item_id),

  constraint artifacts_work_item_fk
    foreign key (work_item_id, workspace_id)
    references app.work_items(id, workspace_id)
    on update restrict on delete cascade
);

-- -------------------------------------------------------------------------
-- artifact_versions — immutable once ready
--
-- A replacement is a NEW version, never an overwritten file. Referenced
-- versions are ON DELETE RESTRICT from submission_artifacts, so a submitted
-- artifact set can never lose its bytes.
-- -------------------------------------------------------------------------
create table app.artifact_versions (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null,
  artifact_id  uuid not null,
  version_no   integer not null check (version_no >= 1),

  -- Exactly one of url / object_path, matching the artifact kind.
  url          text,
  object_path  text,

  -- File metadata, verified server-side at finalize against the ACTUAL
  -- stored object. Possession of an object key is never authorization.
  byte_size    bigint check (byte_size is null or byte_size > 0),
  mime_type    text,
  -- Digest of the stored bytes (files) or of the URL (links). Feeds the
  -- submission content_hash.
  content_digest bytea not null,

  -- Optional upstream version/commit identifier the user supplied.
  external_ref text,

  state app.artifact_state not null default 'pending',

  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  ready_at   timestamptz,

  primary key (id),
  constraint av_id_ws_uniq unique (id, workspace_id),
  constraint av_no_uniq    unique (artifact_id, version_no),
  -- Anchor so submission_artifacts can pin the owning artifact too.
  constraint av_id_artifact_uniq unique (id, artifact_id),

  constraint av_artifact_fk
    foreign key (artifact_id, workspace_id)
    references app.artifacts(id, workspace_id)
    on update restrict on delete cascade,

  constraint av_target_chk check (
    (url is not null and object_path is null)
    or
    (url is null and object_path is not null)
  ),

  constraint av_url_scheme_chk
    check (url is null or url ~* '^https?://'),

  constraint av_ready_chk
    check ((state = 'ready') = (ready_at is not null))
);

comment on constraint av_ready_chk on app.artifact_versions is
  'Only a finalized version is ready. A failed upload can never be evidence.';

-- Immutable except for the upload state machine driving it to a terminal
-- state. The subtract-the-mutable-keys idiom survives ADD COLUMN without
-- anyone remembering to update this trigger.
create or replace function app.artifact_versions_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mutable text[] := array['state', 'ready_at', 'byte_size', 'mime_type',
                          'content_digest'];
begin
  if (to_jsonb(old) - mutable) is distinct from (to_jsonb(new) - mutable) then
    raise exception 'artifact version % is immutable', old.id
      using errcode = 'P0410';
  end if;
  -- Once ready, nothing changes at all.
  if old.state = 'ready' then
    raise exception 'artifact version % is finalized', old.id
      using errcode = 'P0410';
  end if;
  return new;
end;
$$;

create trigger av_immutable
  before update on app.artifact_versions
  for each row execute function app.artifact_versions_immutable();

-- Race-safe version allocation, same idiom as work references.
create or replace function app.allocate_artifact_version_no(p_artifact uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_no integer;
begin
  -- Lock the parent so two concurrent versions cannot claim one number.
  perform 1 from app.artifacts where id = p_artifact for update;
  select coalesce(max(version_no), 0) + 1 into v_no
    from app.artifact_versions where artifact_id = p_artifact;
  return v_no;
end;
$$;

-- -------------------------------------------------------------------------
-- submissions
--
-- The anchors below (id+submitted_by, id+work_item_id+submission_no,
-- id+content_hash) exist so review_decisions can import those facts onto its
-- own row and pin them with composite FKs. That is what lets a CHECK
-- constraint see the submitter's identity.
-- -------------------------------------------------------------------------
create table app.submissions (
  id            uuid not null default extensions.gen_random_uuid(),
  workspace_id  uuid not null,
  work_item_id  uuid not null,
  submission_no integer not null check (submission_no >= 1),

  -- The brief revision this delivery answers. Pinned to the same work item.
  revision_id   uuid not null,

  submitted_by  uuid not null default auth.uid()
                  references app.profiles(id) on delete restrict,
  submitted_at  timestamptz not null default now(),
  note          text,

  -- Digest over the ordered artifact_version content_digests. Pinned onto
  -- review_decisions so an approval names an exact artifact set.
  content_hash  bytea not null,

  status        app.submission_status not null default 'submitted',
  withdrawn_at  timestamptz,
  withdrawn_by  uuid references app.profiles(id) on delete restrict,
  withdraw_reason text,

  primary key (id),

  -- Uniqueness covers withdrawn rows too, so a number is NEVER reused.
  constraint submissions_no_uniq unique (work_item_id, submission_no),

  constraint submissions_id_ws_uniq        unique (id, workspace_id),
  constraint submissions_id_submitter_uniq unique (id, submitted_by),
  constraint submissions_id_wi_no_uniq     unique (id, work_item_id, submission_no),
  constraint submissions_id_hash_uniq      unique (id, content_hash),

  constraint submissions_work_item_fk
    foreign key (work_item_id, workspace_id)
    references app.work_items(id, workspace_id)
    on update restrict on delete restrict,

  constraint submissions_revision_fk
    foreign key (revision_id, work_item_id)
    references app.work_item_revisions(id, work_item_id)
    on update restrict on delete restrict,

  constraint submissions_withdraw_chk check (
        (status = 'withdrawn') = (withdrawn_at is not null)
    and (withdrawn_by is null) = (withdrawn_at is null)
  )
);

comment on constraint submissions_no_uniq on app.submissions is
  'Covers withdrawn rows, so a withdrawn number is retired permanently.';

-- Race-safe submission numbering: one statement, row lock on the work item.
-- A rolled-back attempt returns its number (no hole); a COMMITTED submission
-- consumes its number forever, even if later withdrawn.
create or replace function app.allocate_submission_no(p_work_item uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  update app.work_items
     set next_submission_no = next_submission_no + 1
   where id = p_work_item
  returning next_submission_no - 1;
$$;

comment on function app.allocate_submission_no(uuid) is
  'Transactional counter. Never max()+1 (race) and never a SEQUENCE (holes).';

-- A submitted submission is immutable except for withdrawal.
create or replace function app.submissions_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mutable text[] := array['status', 'withdrawn_at', 'withdrawn_by',
                          'withdraw_reason'];
begin
  if (to_jsonb(old) - mutable) is distinct from (to_jsonb(new) - mutable) then
    raise exception 'submission % is immutable', old.id
      using errcode = 'P0410';
  end if;
  if old.status = 'withdrawn' then
    raise exception 'withdrawn submission % cannot change', old.id
      using errcode = 'P0410';
  end if;
  return new;
end;
$$;

create trigger submissions_immutable
  before update on app.submissions
  for each row execute function app.submissions_immutable();

create trigger submissions_no_delete
  before delete on app.submissions
  for each row execute function app.raise_append_only();

-- -------------------------------------------------------------------------
-- submission_artifacts — the pinned artifact set for one submission
-- -------------------------------------------------------------------------
create table app.submission_artifacts (
  submission_id       uuid not null,
  artifact_version_id uuid not null,
  workspace_id        uuid not null,
  position            integer not null check (position >= 1),

  primary key (submission_id, artifact_version_id),

  constraint sa_submission_fk
    foreign key (submission_id, workspace_id)
    references app.submissions(id, workspace_id)
    on update restrict on delete restrict,

  -- RESTRICT: a referenced artifact version can never be deleted, so a
  -- submission cannot lose the evidence it was approved on.
  constraint sa_version_fk
    foreign key (artifact_version_id, workspace_id)
    references app.artifact_versions(id, workspace_id)
    on update restrict on delete restrict,

  constraint sa_position_uniq unique (submission_id, position)
);

create trigger sa_no_update
  before update on app.submission_artifacts
  for each row execute function app.raise_append_only();

create trigger sa_no_delete
  before delete on app.submission_artifacts
  for each row execute function app.raise_append_only();

-- -------------------------------------------------------------------------
-- review_decisions — append-only
--
-- INVARIANT 2 lives here as a CHECK constraint.
--
-- A CHECK can only see the current row, so the submitter's identity is
-- imported onto this row and pinned truthful by rd_submitter_fk. To defeat
-- rd_no_self_review an attacker must supply a submission_submitted_by that
-- is not the real submitter -- which the FK rejects -- and submissions
-- .submitted_by is itself immutable, so the fact cannot be retro-edited.
--
-- Why CHECK and not a trigger or policy: CHECK constraints are evaluated
-- unconditionally for every row Postgres writes. They are not suppressed by
-- session_replication_role = 'replica', not skipped by DISABLE TRIGGER, and
-- not bypassed by service_role, a SECURITY DEFINER function, or a superuser.
-- An admin who is also the submitter gets 23514, not a policy denial -- and
-- policy denials are what people write service_role escape hatches around.
-- -------------------------------------------------------------------------
create table app.review_decisions (
  id            uuid not null default extensions.gen_random_uuid(),
  workspace_id  uuid not null,
  work_item_id  uuid not null,
  submission_id uuid not null,

  -- Denormalized facts about the submission, made truthful by the FKs below.
  submission_submitted_by uuid    not null,
  submission_no           integer not null,
  submission_content_hash bytea   not null,

  decision   app.review_kind not null,
  decided_by uuid not null default auth.uid()
               references app.profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  rationale  text,

  primary key (id),

  -- The submission genuinely belongs to this work item, at this number.
  constraint rd_submission_fk
    foreign key (submission_id, work_item_id, submission_no)
    references app.submissions(id, work_item_id, submission_no)
    on update restrict on delete restrict,

  -- submission_submitted_by cannot be forged.
  constraint rd_submitter_fk
    foreign key (submission_id, submission_submitted_by)
    references app.submissions(id, submitted_by)
    on update restrict on delete restrict,

  -- The artifact set reviewed is pinned by hash.
  constraint rd_content_fk
    foreign key (submission_id, submission_content_hash)
    references app.submissions(id, content_hash)
    on update restrict on delete restrict,

  constraint rd_ws_fk
    foreign key (work_item_id, workspace_id)
    references app.work_items(id, workspace_id)
    on update restrict on delete restrict,

  -- Requesting changes must carry an explanation.
  constraint rd_rationale_chk check (
    decision <> 'changes_requested'
    or (rationale is not null and length(btrim(rationale)) >= 3)
  ),

  -- INVARIANT 2, declaratively, for every role, forever.
  constraint rd_no_self_review check (decided_by <> submission_submitted_by)
);

comment on constraint rd_no_self_review on app.review_decisions is
  'A submitter can never approve their own submission, including admins.';

-- At most one approval per submission, ever. "Un-approving" is a new
-- changes_requested row, not a mutation.
create unique index rd_one_approval_per_submission
  on app.review_decisions (submission_id)
  where decision = 'approved';

create trigger rd_no_update
  before update on app.review_decisions
  for each row execute function app.raise_append_only();

create trigger rd_no_delete
  before delete on app.review_decisions
  for each row execute function app.raise_append_only();

-- -------------------------------------------------------------------------
-- emit_event — the ONLY writer to activity_events
--
-- Being the sole writer is what prevents a future feature from changing
-- state without recording it. Called inside the same transaction as the
-- state change, so the two commit together or not at all.
-- -------------------------------------------------------------------------
create or replace function app.emit_event(
  p_workspace     uuid,
  p_event_type    text,
  p_work_item     uuid default null,
  p_project       uuid default null,
  p_submission    uuid default null,
  p_resource_kind text default null,
  p_resource_id   uuid default null,
  p_payload       jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into app.activity_events (
    workspace_id, actor_id, event_type,
    work_item_id, project_id, submission_id,
    resource_kind, resource_id, payload
  ) values (
    p_workspace, auth.uid(), p_event_type,
    p_work_item, p_project, p_submission,
    p_resource_kind, p_resource_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.emit_event is
  'Sole writer to activity_events. Actor and time come from trusted context.';

-- -------------------------------------------------------------------------
-- claim_idempotency — replay-safe action guard
--
-- Returns the stored result when the same key+digest is replayed, so a
-- retried request yields the original outcome instead of a second write.
-- The same key with a DIFFERENT payload is P0409, never a silent overwrite.
-- Doing this as check-then-insert in application code is the classic race;
-- here the primary key does the work.
-- -------------------------------------------------------------------------
create or replace function app.claim_idempotency(
  p_action text,
  p_key    text,
  p_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_keys;
begin
  insert into app.idempotency_keys (actor_id, action, request_key, payload_digest)
  values (auth.uid(), p_action, p_key, p_digest)
  on conflict (actor_id, action, request_key) do nothing;

  if found then
    -- Fresh claim: caller should proceed and then call record_idempotency.
    return null;
  end if;

  select * into v_existing
    from app.idempotency_keys
   where actor_id = auth.uid()
     and action = p_action
     and request_key = p_key;

  if v_existing.payload_digest is distinct from p_digest then
    raise exception
      'idempotency key reused with a different payload'
      using errcode = 'P0409';
  end if;

  -- Genuine replay. `result` may still be null if the original attempt has
  -- not committed yet; the caller treats that as "in flight".
  return coalesce(v_existing.result, '{"status":"in_flight"}'::jsonb);
end;
$$;

create or replace function app.record_idempotency(
  p_action text,
  p_key    text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.idempotency_keys
     set result = p_result
   where actor_id = auth.uid()
     and action = p_action
     and request_key = p_key;
$$;

-- ############ 0004_authz_and_rls.sql ############
-- =========================================================================
-- 0004 — Authorization: authz helpers, RLS policies, supporting indexes.
--
-- Design: docs/data-model.md section 5.
--
-- The access model in one paragraph:
--
--   `authenticated` gets SELECT on app tables and NOTHING else -- no INSERT,
--   UPDATE, or DELETE grant exists, so every mutation must go through a
--   definer RPC (0005). RLS then filters which rows a SELECT can see. The
--   `app` schema is not in PostgREST's exposed list, so even the SELECT
--   grant is unreachable from the Data API; it exists so that
--   security_invoker views in `public` resolve as the caller.
--
--   `anon` gets nothing, anywhere. A pgTAP test asserts this.
--
-- Helpers are SECURITY DEFINER so a policy on a membership table can read
-- that same table without tripping 42P17 infinite recursion, and STABLE with
-- a pinned search_path. Every call site wraps them as `(select ...)` so
-- Postgres evaluates them once as an InitPlan rather than per row.
-- =========================================================================

-- -------------------------------------------------------------------------
-- authz helpers
-- -------------------------------------------------------------------------

-- Workspaces where the current user is an ACTIVE member. An invited or
-- removed member gets nothing: this is the live check that makes a stale JWT
-- worthless (AC-20).
create or replace function authz.my_workspaces()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select m.workspace_id
    from app.workspace_members m
   where m.user_id = auth.uid()
     and m.status = 'active';
$$;

comment on function authz.my_workspaces() is
  'Active memberships for the caller, read live. Never from a JWT claim.';

create or replace function authz.my_admin_workspaces()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select m.workspace_id
    from app.workspace_members m
   where m.user_id = auth.uid()
     and m.status = 'active'
     and m.role in ('owner', 'admin');
$$;

-- Projects where the caller holds a given capability, via their project role.
-- Capabilities come from app.project_role_caps, so adding a role is an INSERT
-- rather than a deploy, and RLS and the RPC layer read one source.
--
-- Workspace admins are folded in for 'read' and 'manage' only: the PRD lets
-- an admin see workspace records, but reviewing requires explicit
-- designation, and no amount of admin rights lets someone approve their own
-- submission (that is a CHECK constraint in 0003).
create or replace function authz.my_projects(p_cap app.project_capability)
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select pm.project_id
    from app.project_members pm
    join app.project_role_caps rc on rc.role = pm.role
    join app.workspace_members wm
         on wm.workspace_id = pm.workspace_id
        and wm.user_id = pm.user_id
   where pm.user_id = auth.uid()
     and wm.status = 'active'
     and rc.capability = p_cap
  union
  select p.id
    from app.projects p
    join app.workspace_members wm on wm.workspace_id = p.workspace_id
   where wm.user_id = auth.uid()
     and wm.status = 'active'
     and wm.role in ('owner', 'admin')
     and p_cap in ('read', 'manage');
$$;

comment on function authz.my_projects(app.project_capability) is
  'Projects where the caller holds a capability. Admins get read/manage only.';

-- Does the caller share any active workspace with this user? Gates profile
-- visibility so a member directory cannot be enumerated across tenants.
create or replace function authz.shares_workspace_with(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from app.workspace_members mine
      join app.workspace_members theirs
           on theirs.workspace_id = mine.workspace_id
     where mine.user_id = auth.uid()
       and mine.status = 'active'
       and theirs.user_id = p_user
       and theirs.status <> 'removed'
  );
$$;

-- authenticated must be able to run these, because policies calling them are
-- evaluated as the caller. They are definer, so they read membership rows the
-- caller cannot select directly.
grant execute on function authz.my_workspaces()        to authenticated;
grant execute on function authz.my_admin_workspaces()  to authenticated;
grant execute on function authz.my_projects(app.project_capability) to authenticated;
grant execute on function authz.shares_workspace_with(uuid) to authenticated;

-- Explicitly NOT granted to anon.
revoke all on function authz.my_workspaces()       from anon;
revoke all on function authz.my_admin_workspaces() from anon;
revoke all on function authz.my_projects(app.project_capability) from anon;
revoke all on function authz.shares_workspace_with(uuid) from anon;

-- -------------------------------------------------------------------------
-- Enable RLS everywhere. FORCE on the audit table so even its owner is
-- subject to policy.
-- -------------------------------------------------------------------------
alter table app.profiles                 enable row level security;
alter table app.workspaces               enable row level security;
alter table app.workspace_members        enable row level security;
alter table app.brands                   enable row level security;
alter table app.projects                 enable row level security;
alter table app.project_members          enable row level security;
alter table app.project_role_caps        enable row level security;
alter table app.work_items               enable row level security;
alter table app.work_item_revisions      enable row level security;
alter table app.request_acknowledgements enable row level security;
alter table app.artifacts                enable row level security;
alter table app.artifact_versions        enable row level security;
alter table app.submissions              enable row level security;
alter table app.submission_artifacts     enable row level security;
alter table app.review_decisions         enable row level security;
alter table app.activity_events          enable row level security;
alter table app.idempotency_keys         enable row level security;

alter table app.activity_events  force row level security;
alter table app.idempotency_keys force row level security;

-- -------------------------------------------------------------------------
-- Grants: SELECT only, and only to authenticated.
--
-- No INSERT/UPDATE/DELETE grant exists for any client role. Mutations are
-- definer RPCs, which is what makes the "trusted actor and timestamp"
-- guarantee hold without relying on column-level grants.
-- -------------------------------------------------------------------------
grant select on app.profiles                 to authenticated;
grant select on app.workspaces               to authenticated;
grant select on app.workspace_members        to authenticated;
grant select on app.brands                   to authenticated;
grant select on app.projects                 to authenticated;
grant select on app.project_members          to authenticated;
grant select on app.project_role_caps        to authenticated;
grant select on app.work_items               to authenticated;
grant select on app.work_item_revisions      to authenticated;
grant select on app.request_acknowledgements to authenticated;
grant select on app.artifacts                to authenticated;
grant select on app.artifact_versions        to authenticated;
grant select on app.submissions              to authenticated;
grant select on app.submission_artifacts     to authenticated;
grant select on app.review_decisions         to authenticated;
grant select on app.activity_events          to authenticated;

-- idempotency_keys is operational, not readable by clients at all.

-- -------------------------------------------------------------------------
-- Policies. Every one names its role with TO, so it is never evaluated for
-- a role it does not concern.
-- -------------------------------------------------------------------------

-- profiles: yourself, plus people you actually share a workspace with.
create policy profiles_select on app.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select authz.shares_workspace_with(app.profiles.id))
  );

-- workspaces: only ones you are an active member of.
create policy workspaces_select on app.workspaces
  for select to authenticated
  using (id in (select authz.my_workspaces()));

-- workspace_members: the roster of your own workspaces. The definer helper
-- is what stops this policy recursing into its own table.
create policy workspace_members_select on app.workspace_members
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy brands_select on app.brands
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

-- projects: those you hold read on. A workspace member with no project grant
-- sees no projects, which is the point -- signing in is not access.
create policy projects_select on app.projects
  for select to authenticated
  using (id in (select authz.my_projects('read')));

create policy project_members_select on app.project_members
  for select to authenticated
  using (project_id in (select authz.my_projects('read')));

-- Capability mapping is reference data, readable by any member.
create policy project_role_caps_select on app.project_role_caps
  for select to authenticated
  using (true);

-- work_items: the central visibility rule.
--   * a project you hold read on, OR
--   * your own Inbox item (no project yet), OR
--   * anything in a workspace you administer -- the PRD gives admins sight
--     of workspace records including unassigned items.
create policy work_items_select on app.work_items
  for select to authenticated
  using (
    workspace_id in (select authz.my_workspaces())
    and (
      project_id in (select authz.my_projects('read'))
      or (project_id is null and created_by = (select auth.uid()))
      or workspace_id in (select authz.my_admin_workspaces())
    )
  );

-- Child tables inherit visibility by composing with work_items' own policy:
-- the subquery re-applies it, so there is exactly one definition of "can I
-- see this work item".
create policy work_item_revisions_select on app.work_item_revisions
  for select to authenticated
  using (work_item_id in (select id from app.work_items));

create policy request_acknowledgements_select on app.request_acknowledgements
  for select to authenticated
  using (
    revision_id in (select id from app.work_item_revisions)
  );

create policy artifacts_select on app.artifacts
  for select to authenticated
  using (work_item_id in (select id from app.work_items));

create policy artifact_versions_select on app.artifact_versions
  for select to authenticated
  using (artifact_id in (select id from app.artifacts));

create policy submissions_select on app.submissions
  for select to authenticated
  using (work_item_id in (select id from app.work_items));

create policy submission_artifacts_select on app.submission_artifacts
  for select to authenticated
  using (submission_id in (select id from app.submissions));

create policy review_decisions_select on app.review_decisions
  for select to authenticated
  using (submission_id in (select id from app.submissions));

-- activity_events: scoped to what you can actually see. A workspace-level
-- event with no work item or project is admin-only.
create policy activity_events_select on app.activity_events
  for select to authenticated
  using (
    workspace_id in (select authz.my_workspaces())
    and (
      work_item_id in (select id from app.work_items)
      or project_id in (select authz.my_projects('read'))
      or (
        work_item_id is null
        and project_id is null
        and workspace_id in (select authz.my_admin_workspaces())
      )
    )
  );

-- No policies are created for INSERT, UPDATE, or DELETE on any table. With
-- RLS enabled and no permissive policy, those commands are denied outright --
-- which is the intended default, since all writes are definer RPCs.

-- -------------------------------------------------------------------------
-- Indexes.
--
-- Every column an RLS policy filters on is indexed. Supabase's guidance is
-- explicit that an unindexed policy column is the usual cause of a policy
-- rewrite turning into a sequential scan.
-- -------------------------------------------------------------------------

-- Membership lookups: the hottest path, hit by every helper.
create index workspace_members_user_idx
  on app.workspace_members (user_id, status) include (workspace_id, role);
create index workspace_members_ws_idx
  on app.workspace_members (workspace_id, status);

create index project_members_user_idx
  on app.project_members (user_id) include (project_id, workspace_id, role);
create index project_members_project_idx
  on app.project_members (project_id);

create index projects_ws_idx      on app.projects (workspace_id)
  where archived_at is null;
create index projects_brand_idx   on app.projects (brand_id, workspace_id);
create index brands_ws_idx        on app.brands (workspace_id)
  where archived_at is null;

-- work_items: policy columns first, then the list's real filters.
create index work_items_ws_project_idx
  on app.work_items (workspace_id, project_id);
create index work_items_inbox_idx
  on app.work_items (workspace_id, created_by)
  where project_id is null;
-- Default list ordering: newest activity first, unarchived only.
create index work_items_updated_idx
  on app.work_items (workspace_id, updated_at desc)
  where archived_at is null;
create index work_items_status_idx
  on app.work_items (workspace_id, status, updated_at desc);
create index work_items_kind_idx
  on app.work_items (workspace_id, kind, updated_at desc);
create index work_items_reviewer_idx
  on app.work_items (workspace_id, reviewer_id)
  where reviewer_id is not null;
create index work_items_created_idx
  on app.work_items (workspace_id, created_at desc);
create index work_items_brand_idx
  on app.work_items (brand_id, workspace_id);

-- Permission-filtered search over titles and references. Trigram rather than
-- full-text: the PRD wants substring matching on short labels, not stemming.
create extension if not exists pg_trgm with schema extensions;
create index work_items_title_trgm_idx
  on app.work_items using gin (title extensions.gin_trgm_ops);
create index work_items_reference_idx
  on app.work_items (reference);

create index wir_item_idx
  on app.work_item_revisions (work_item_id, revision_no desc);
create index wir_summary_trgm_idx
  on app.work_item_revisions using gin (summary extensions.gin_trgm_ops);

create index ack_revision_idx
  on app.request_acknowledgements (revision_id);

create index artifacts_item_idx  on app.artifacts (work_item_id);
create index av_artifact_idx     on app.artifact_versions (artifact_id, version_no desc);
create index av_state_idx        on app.artifact_versions (state)
  where state <> 'ready';

create index submissions_item_idx
  on app.submissions (work_item_id, submission_no desc);
create index submissions_submitter_idx
  on app.submissions (workspace_id, submitted_by, submitted_at desc);

create index sa_version_idx on app.submission_artifacts (artifact_version_id);

create index rd_submission_idx
  on app.review_decisions (submission_id, decided_at desc);
create index rd_item_idx
  on app.review_decisions (work_item_id, decided_at desc);

-- Timeline: grouped by calendar date in the viewer's zone, so the index is
-- on the raw instant and the grouping happens in the query.
create index activity_ws_time_idx
  on app.activity_events (workspace_id, created_at desc);
create index activity_item_idx
  on app.activity_events (work_item_id, created_at desc)
  where work_item_id is not null;
create index activity_project_idx
  on app.activity_events (project_id, created_at desc)
  where project_id is not null;

-- ############ 0005_api_surface.sql ############
-- =========================================================================
-- 0005 — The client-facing API surface.
--
-- Everything in `public` and nothing else is reachable from the Data API.
-- Reads go through security_invoker views (so the caller's RLS applies);
-- writes go through SECURITY DEFINER RPCs, which is what lets the schema
-- forbid client writes entirely while still allowing legitimate ones.
--
-- Every RPC:
--   * derives actor and time from trusted context, never the payload
--   * takes p_expected_version where it mutates, and raises P0409 on a stale
--     save rather than overwriting
--   * emits its activity event in the SAME transaction as the state change
-- =========================================================================

-- -------------------------------------------------------------------------
-- Profile provisioning on signup.
--
-- Without this, a user can authenticate but has no app.profiles row, and
-- every foreign key referencing them fails. The trigger runs as definer
-- because auth.users is not writable by the new user.
-- -------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- -------------------------------------------------------------------------
-- State machine as DATA.
--
-- Encoding transitions in a table rather than a CASE expression means the
-- allowed moves are queryable, testable, and shown to the UI from one
-- source. `to_status = null` means "restore prior_status" (Resume).
-- -------------------------------------------------------------------------
create table app.work_transitions (
  from_status     app.work_status not null,
  action          text not null,
  to_status       app.work_status,
  reason_required boolean not null default false,
  primary key (from_status, action)
);

insert into app.work_transitions (from_status, action, to_status, reason_required) values
  ('planned',     'start',           'in_progress', false),
  ('planned',     'submit',          'submitted',   false),
  ('in_progress', 'submit',          'submitted',   false),
  ('submitted',   'approve',         'approved',    false),
  ('submitted',   'request_changes', 'in_progress', true),
  ('submitted',   'withdraw',        'in_progress', true),
  ('approved',    'reopen',          'in_progress', true),
  ('planned',     'block',           'blocked',     true),
  ('in_progress', 'block',           'blocked',     true),
  ('planned',     'pause',           'paused',      true),
  ('in_progress', 'pause',           'paused',      true),
  -- null to_status: restore whatever the execution state was before.
  ('blocked',     'resume',          null,          false),
  ('paused',      'resume',          null,          false),
  ('planned',     'cancel',          'cancelled',   true),
  ('in_progress', 'cancel',          'cancelled',   true),
  ('blocked',     'cancel',          'cancelled',   true),
  ('paused',      'cancel',          'cancelled',   true),
  ('cancelled',   'reopen',          'planned',     true),
  -- Ideas
  ('captured',    'shelve',          'shelved',     false),
  ('shelved',     'unshelve',        'captured',    false);

-- Deliberately absent: ('submitted','cancel'). The PRD requires withdrawing
-- first, so a pending review is never discarded silently.

alter table app.work_transitions enable row level security;
grant select on app.work_transitions to authenticated;
create policy work_transitions_select on app.work_transitions
  for select to authenticated using (true);

-- -------------------------------------------------------------------------
-- Views. Every one is security_invoker, so the caller's RLS applies rather
-- than the view owner's. A pgTAP test enumerates these and fails if any is
-- missing the setting -- the most common Supabase RLS bypass.
-- -------------------------------------------------------------------------

create view public.my_profile
with (security_invoker = on) as
  select p.id, p.display_name, p.email, p.timezone, p.theme
    from app.profiles p
   where p.id = (select auth.uid());

create view public.my_workspaces
with (security_invoker = on) as
  select w.id, w.slug, w.name, w.owner_id, w.created_at,
         m.role, m.status, m.joined_at
    from app.workspaces w
    join app.workspace_members m on m.workspace_id = w.id
   where m.user_id = (select auth.uid())
     and m.status = 'active';

create view public.brands
with (security_invoker = on) as
  select b.id, b.workspace_id, b.name, b.archived_at, b.version
    from app.brands b;

create view public.projects
with (security_invoker = on) as
  select p.id, p.workspace_id, p.brand_id, p.name, p.brief,
         p.archived_at, p.created_at, p.version
    from app.projects p;

create view public.workspace_people
with (security_invoker = on) as
  select m.workspace_id, m.user_id, m.role, m.status,
         pr.display_name, pr.email
    from app.workspace_members m
    join app.profiles pr on pr.id = m.user_id;

-- The work list. Current revision is DERIVED here rather than cached on the
-- row: a cache cannot be guaranteed correct, so it is declined.
create view public.work_items
with (security_invoker = on) as
  select
    w.id,
    w.workspace_id,
    w.reference,
    w.project_id,
    w.brand_id,
    w.kind,
    w.status,
    w.title,
    w.priority,
    w.progress_note,
    w.state_reason,
    w.next_action,
    w.reviewer_id,
    w.deadline_date,
    w.deadline_at,
    w.archived_at,
    w.created_at,
    w.created_by,
    w.updated_at,
    w.version,
    p.name  as project_name,
    b.name  as brand_name,
    author.display_name as author_name,
    rev.id          as current_revision_id,
    rev.revision_no as current_revision_no,
    rev.summary     as request_summary,
    rev.expected_outcome,
    rev.acceptance_criteria,
    rev.requester_label,
    rev.requester_user_id,
    rev.source      as request_source,
    rev.source_url,
    rev.reported_request_date,
    -- Confirmation state, computed from the digest binding. This is why the
    -- acknowledgement invariant needs no trigger: it is a join.
    (ack.id is not null)     as is_confirmed,
    ack.created_at           as confirmed_at,
    (rev.revision_no > 1)    as has_revisions,
    sub.submission_no        as latest_submission_no,
    sub.submitted_at         as latest_submitted_at,
    appr.submission_no       as approved_submission_no,
    -- True when work has moved on since the approved version.
    (appr.submission_no is not null
      and sub.submission_no > appr.submission_no) as newer_submission_exists
  from app.work_items w
  left join app.projects p on p.id = w.project_id
  left join app.brands   b on b.id = w.brand_id
  left join app.profiles author on author.id = w.created_by
  left join lateral (
    select r.* from app.work_item_revisions r
     where r.work_item_id = w.id
     order by r.revision_no desc
     limit 1
  ) rev on true
  left join lateral (
    select a.id, a.created_at
      from app.request_acknowledgements a
     where a.revision_id = rev.id
       and a.decision = 'confirmed'
       and a.user_id = rev.requester_user_id
     limit 1
  ) ack on true
  left join lateral (
    select s.submission_no, s.submitted_at
      from app.submissions s
     where s.work_item_id = w.id and s.status = 'submitted'
     order by s.submission_no desc
     limit 1
  ) sub on true
  left join lateral (
    select s.submission_no
      from app.review_decisions d
      join app.submissions s on s.id = d.submission_id
     where d.work_item_id = w.id and d.decision = 'approved'
     order by s.submission_no desc
     limit 1
  ) appr on true;

create view public.work_item_revisions
with (security_invoker = on) as
  select r.id, r.workspace_id, r.work_item_id, r.revision_no,
         r.summary, r.rationale, r.expected_outcome, r.acceptance_criteria,
         r.requester_label, r.requester_user_id, r.source, r.source_url,
         r.reported_request_date, r.change_reason,
         r.created_at, r.created_by,
         pr.display_name as author_name
    from app.work_item_revisions r
    left join app.profiles pr on pr.id = r.created_by;

create view public.activity_events
with (security_invoker = on) as
  select e.id, e.workspace_id, e.actor_id, e.event_type,
         e.work_item_id, e.project_id, e.submission_id,
         case when e.redacted_at is null then e.payload else '{}'::jsonb end
           as payload,
         (e.redacted_at is not null) as is_redacted,
         e.created_at,
         pr.display_name as actor_name
    from app.activity_events e
    left join app.profiles pr on pr.id = e.actor_id;

grant select on public.my_profile        to authenticated;
grant select on public.my_workspaces     to authenticated;
grant select on public.brands            to authenticated;
grant select on public.projects          to authenticated;
grant select on public.workspace_people  to authenticated;
grant select on public.work_items        to authenticated;
grant select on public.work_item_revisions to authenticated;
grant select on public.activity_events   to authenticated;

-- =========================================================================
-- RPCs
-- =========================================================================

-- -------------------------------------------------------------------------
-- Onboarding: create a workspace, make the caller its owner, seed brands.
-- -------------------------------------------------------------------------
create or replace function public.bootstrap_workspace(
  p_name        text,
  p_timezone    text default 'Asia/Kolkata',
  p_brands      text[] default array['Newform Tech', 'Newform Social'],
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_ws   uuid;
  v_slug text;
  b      text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  if p_display_name is not null and btrim(p_display_name) <> '' then
    update app.profiles set display_name = btrim(p_display_name),
                            timezone = coalesce(p_timezone, timezone),
                            updated_at = now()
     where id = v_uid;
  else
    update app.profiles set timezone = coalesce(p_timezone, timezone),
                            updated_at = now()
     where id = v_uid;
  end if;

  -- Slug from the name, disambiguated. Never trusted from the client.
  v_slug := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then v_slug := 'workspace'; end if;
  v_slug := v_slug || '-' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 6);

  insert into app.workspaces (slug, name, owner_id, created_by, updated_by)
  values (v_slug, p_name, v_uid, v_uid, v_uid)
  returning id into v_ws;

  insert into app.workspace_members (workspace_id, user_id, role, status, joined_at)
  values (v_ws, v_uid, 'owner', 'active', now());

  foreach b in array coalesce(p_brands, '{}'::text[]) loop
    if btrim(b) <> '' then
      insert into app.brands (workspace_id, name, created_by, updated_by)
      values (v_ws, btrim(b), v_uid, v_uid)
      on conflict (workspace_id, name) do nothing;
    end if;
  end loop;

  perform app.emit_event(v_ws, 'workspace.created', null, null, null,
                         'workspace', v_ws,
                         jsonb_build_object('name', p_name));
  return v_ws;
end;
$$;

-- -------------------------------------------------------------------------
-- Quick capture. Title + summary are the only required inputs, matching the
-- PRD's 60-second capture goal; everything else is optional detail.
--
-- The work item and its first brief revision are created in ONE transaction,
-- so an item can never exist without a request.
-- -------------------------------------------------------------------------
create or replace function public.create_work_item(
  p_workspace           uuid,
  p_title               text,
  p_summary             text,
  p_kind                app.work_kind default 'work',
  p_project_id          uuid default null,
  p_brand_id            uuid default null,
  p_expected_outcome    text default null,
  p_acceptance_criteria text default null,
  p_requester_label     text default null,
  p_requester_user_id   uuid default null,
  p_source              app.request_source default 'self',
  p_source_url          text default null,
  p_reported_request_date date default null,
  p_priority            app.priority default 'normal',
  p_deadline_date       date default null,
  p_reviewer_id         uuid default null,
  p_idempotency_key     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   uuid;
  v_no     integer;
  v_ref    text;
  v_replay jsonb;
  v_digest bytea;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  -- Must be an active member of the target workspace.
  if not exists (
    select 1 from app.workspace_members
     where workspace_id = p_workspace and user_id = v_uid and status = 'active'
  ) then
    raise exception 'not a member of this workspace' using errcode = 'P0403';
  end if;

  -- If a project is named, the caller must be able to submit into it.
  if p_project_id is not null
     and p_project_id not in (select authz.my_projects('submit')) then
    raise exception 'no submit capability on that project' using errcode = 'P0403';
  end if;

  if p_idempotency_key is not null then
    v_digest := extensions.digest(
      coalesce(p_title,'') || '|' || coalesce(p_summary,'') || '|' ||
      coalesce(p_project_id::text,''), 'sha256');
    v_replay := app.claim_idempotency('create_work_item', p_idempotency_key, v_digest);
    if v_replay is not null then
      return nullif(v_replay->>'work_item_id', '')::uuid;
    end if;
  end if;

  v_no  := app.allocate_work_no(p_workspace);
  v_ref := 'WL-' || lpad(v_no::text, 4, '0');

  insert into app.work_items (
    workspace_id, reference, project_id, brand_id, kind, status, title,
    priority, deadline_date, reviewer_id, created_by, updated_by
  ) values (
    p_workspace, v_ref, p_project_id, p_brand_id, p_kind,
    case when p_kind = 'idea' then 'captured'::app.work_status
         else 'planned'::app.work_status end,
    p_title, p_priority, p_deadline_date, p_reviewer_id, v_uid, v_uid
  )
  returning id into v_item;

  insert into app.work_item_revisions (
    workspace_id, work_item_id, revision_no, summary, expected_outcome,
    acceptance_criteria, requester_label, requester_user_id, source,
    source_url, reported_request_date, created_by
  ) values (
    p_workspace, v_item, 1, p_summary, p_expected_outcome,
    p_acceptance_criteria, p_requester_label, p_requester_user_id, p_source,
    p_source_url, p_reported_request_date, v_uid
  );

  perform app.emit_event(
    p_workspace, 'work_item.created', v_item, p_project_id, null,
    'work_item', v_item,
    jsonb_build_object('reference', v_ref, 'kind', p_kind, 'title', p_title)
  );

  if p_idempotency_key is not null then
    perform app.record_idempotency(
      'create_work_item', p_idempotency_key,
      jsonb_build_object('work_item_id', v_item));
  end if;

  return v_item;
end;
$$;

-- -------------------------------------------------------------------------
-- Record a changed brief. Always a NEW revision; the original is never
-- overwritten. A material change lapses the current acknowledgement by
-- construction, because the digest changes.
-- -------------------------------------------------------------------------
create or replace function public.update_work_request(
  p_work_item           uuid,
  p_expected_version    integer,
  p_summary             text,
  p_change_reason       text,
  p_expected_outcome    text default null,
  p_acceptance_criteria text default null,
  p_requester_label     text default null,
  p_requester_user_id   uuid default null,
  p_source              app.request_source default null,
  p_source_url          text default null,
  p_reported_request_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_item app.work_items;
  v_prev app.work_item_revisions;
  v_new  uuid;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  select * into v_item from app.work_items where id = p_work_item;
  if v_item.id is null then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  -- Visibility and capability. An RLS-invisible row must look identical to a
  -- missing one, so both map to P0404 -- no existence oracle.
  if p_work_item not in (select id from public.work_items) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;
  if not (
    v_item.created_by = v_uid
    or v_item.project_id in (select authz.my_projects('submit'))
    or v_item.workspace_id in (select authz.my_admin_workspaces())
  ) then
    raise exception 'not permitted to edit this request' using errcode = 'P0403';
  end if;

  select * into v_prev from app.work_item_revisions
   where work_item_id = p_work_item order by revision_no desc limit 1;

  insert into app.work_item_revisions (
    workspace_id, work_item_id, revision_no, summary, rationale,
    expected_outcome, acceptance_criteria, requester_label,
    requester_user_id, source, source_url, reported_request_date,
    change_reason, created_by
  ) values (
    v_item.workspace_id, p_work_item, v_prev.revision_no + 1,
    coalesce(p_summary, v_prev.summary),
    v_prev.rationale,
    coalesce(p_expected_outcome, v_prev.expected_outcome),
    coalesce(p_acceptance_criteria, v_prev.acceptance_criteria),
    coalesce(p_requester_label, v_prev.requester_label),
    coalesce(p_requester_user_id, v_prev.requester_user_id),
    coalesce(p_source, v_prev.source),
    coalesce(p_source_url, v_prev.source_url),
    coalesce(p_reported_request_date, v_prev.reported_request_date),
    p_change_reason, v_uid
  )
  returning id into v_new;

  -- Compare-and-swap. A stale expected_version matches zero rows.
  update app.work_items
     set version = version + 1
   where id = p_work_item and version = p_expected_version
  returning id into v_id;

  if v_id is null then
    raise exception 'version_conflict' using errcode = 'P0409',
      detail = format('expected %s', p_expected_version);
  end if;

  perform app.emit_event(
    v_item.workspace_id, 'work_item.request_revised', p_work_item,
    v_item.project_id, null, 'revision', v_new,
    jsonb_build_object(
      'from_revision', v_prev.revision_no,
      'to_revision', v_prev.revision_no + 1,
      'reason', p_change_reason,
      'material_change',
        (select r.material_digest from app.work_item_revisions r where r.id = v_new)
          is distinct from v_prev.material_digest
    )
  );

  return v_new;
end;
$$;

-- -------------------------------------------------------------------------
-- State transitions, validated against app.work_transitions.
-- -------------------------------------------------------------------------
create or replace function public.transition_work_state(
  p_work_item        uuid,
  p_expected_version integer,
  p_action           text,
  p_reason           text default null
)
returns app.work_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   app.work_items;
  v_tr     app.work_transitions;
  v_target app.work_status;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  select * into v_item from app.work_items where id = p_work_item;
  if v_item.id is null
     or p_work_item not in (select id from public.work_items) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  if not (
    v_item.created_by = v_uid
    or v_item.project_id in (select authz.my_projects('submit'))
    or v_item.workspace_id in (select authz.my_admin_workspaces())
  ) then
    raise exception 'not permitted' using errcode = 'P0403';
  end if;

  select * into v_tr from app.work_transitions
   where from_status = v_item.status and action = p_action;

  if v_tr.from_status is null then
    raise exception
      'cannot % from status %', p_action, v_item.status
      using errcode = 'P0410';
  end if;

  if v_tr.reason_required
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception '% requires a reason', p_action using errcode = 'P0400';
  end if;

  -- Approval and change requests are NOT reachable here: they require a
  -- review decision row bound to a submission, which carries the
  -- self-approval CHECK. Route them through the review RPC instead (M3).
  if p_action in ('approve', 'request_changes') then
    raise exception
      'use the review RPC: a decision must be bound to a submission'
      using errcode = 'P0403';
  end if;

  -- Resume restores the execution state captured when the item was
  -- blocked or paused.
  v_target := coalesce(v_tr.to_status, v_item.prior_status, 'in_progress');

  update app.work_items
     set status = v_target,
         prior_status = case
           when p_action in ('block', 'pause') then v_item.status
           when p_action = 'resume' then null
           else v_item.prior_status end,
         state_reason = case
           when v_tr.reason_required then p_reason
           when p_action = 'resume' then null
           else state_reason end,
         version = version + 1
   where id = p_work_item and version = p_expected_version
  returning id into v_id;

  if v_id is null then
    raise exception 'version_conflict' using errcode = 'P0409';
  end if;

  perform app.emit_event(
    v_item.workspace_id, 'work_item.' || p_action, p_work_item,
    v_item.project_id, null, 'work_item', p_work_item,
    jsonb_build_object('from', v_item.status, 'to', v_target,
                       'reason', p_reason)
  );

  return v_target;
end;
$$;

-- -------------------------------------------------------------------------
-- Acknowledge a brief revision. The acting user is always auth.uid(), so
-- nobody can acknowledge on someone else's behalf.
-- -------------------------------------------------------------------------
create or replace function public.acknowledge_revision(
  p_revision_id uuid,
  p_decision    app.ack_decision default 'confirmed',
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev app.work_item_revisions;
  v_ack uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  select * into v_rev from app.work_item_revisions where id = p_revision_id;
  if v_rev.id is null
     or p_revision_id not in (select id from public.work_item_revisions) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  -- Only the named requester may confirm. An author cannot manufacture
  -- their own confirmation, which is the point of AC-03.
  if v_rev.requester_user_id is distinct from v_uid then
    raise exception
      'only the named requester can acknowledge this request'
      using errcode = 'P0403';
  end if;

  insert into app.request_acknowledgements (
    workspace_id, revision_id, acknowledged_material_digest,
    user_id, decision, note
  ) values (
    v_rev.workspace_id, p_revision_id, v_rev.material_digest,
    v_uid, p_decision, p_note
  )
  returning id into v_ack;

  perform app.emit_event(
    v_rev.workspace_id, 'request.' || p_decision, v_rev.work_item_id,
    null, null, 'revision', p_revision_id,
    jsonb_build_object('revision_no', v_rev.revision_no)
  );

  return v_ack;
end;
$$;

-- -------------------------------------------------------------------------
-- Grants. `authenticated` only; anon gets nothing.
-- -------------------------------------------------------------------------
grant execute on function public.bootstrap_workspace(text, text, text[], text) to authenticated;
grant execute on function public.create_work_item(
  uuid, text, text, app.work_kind, uuid, uuid, text, text, text, uuid,
  app.request_source, text, date, app.priority, date, uuid, text
) to authenticated;
grant execute on function public.update_work_request(
  uuid, integer, text, text, text, text, text, uuid, app.request_source,
  text, date
) to authenticated;
grant execute on function public.transition_work_state(uuid, integer, text, text) to authenticated;
grant execute on function public.acknowledge_revision(uuid, app.ack_decision, text) to authenticated;

revoke all on function public.bootstrap_workspace(text, text, text[], text) from anon;
revoke all on function public.transition_work_state(uuid, integer, text, text) from anon;
revoke all on function public.acknowledge_revision(uuid, app.ack_decision, text) from anon;

-- ############ 0006_api_fixes.sql ############
-- =========================================================================
-- 0006 — Two bugs found by live verification against the hosted project.
--
-- BUG 1: enum parameters in the public API signature were uncallable.
--
--   `authenticated` has no USAGE on schema `app` — deliberately, so base
--   tables stay sealed. But an RPC whose SIGNATURE names an `app.*` enum
--   forces the caller to resolve that type, which fails with
--   42501 "permission denied for schema app".
--
--   It went unnoticed because the failing parameters all have defaults: a
--   call that omits them succeeds, and only a call that supplies them fails.
--   Fix: the public API takes TEXT and casts internally after validating.
--   The enums remain the storage type; only the boundary changes. Granting
--   USAGE on `app` would have been the smaller diff and the worse answer —
--   it would also expose the definer helpers in that schema.
--
-- BUG 2: an existence oracle across workspaces.
--
--   `update_work_request` and `transition_work_state` tested visibility with
--   `p_work_item not in (select id from public.work_items)`. Inside a
--   SECURITY DEFINER function that view resolves as the DEFINER, so RLS does
--   not filter it and every row looks visible. A non-member therefore fell
--   through to the capability check and got P0403 — which confirms the
--   record exists. Verified: user B received P0403, not P0404.
--
--   Fix: check visibility explicitly through the authz helpers, which read
--   membership live. Not visible -> P0404. Visible but not permitted ->
--   P0403, which leaks nothing the caller cannot already see.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Visibility helper: the single definition of "can this caller see it".
-- Mirrors the work_items RLS policy, and is usable INSIDE definer functions
-- where RLS does not apply.
-- -------------------------------------------------------------------------
create or replace function authz.can_see_work_item(p_item uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from app.work_items w
     where w.id = p_item
       and w.workspace_id in (select authz.my_workspaces())
       and (
         w.project_id in (select authz.my_projects('read'))
         or (w.project_id is null and w.created_by = auth.uid())
         or w.workspace_id in (select authz.my_admin_workspaces())
       )
  );
$$;

comment on function authz.can_see_work_item(uuid) is
  'Visibility check for use inside definer functions, where RLS is bypassed.';

grant execute on function authz.can_see_work_item(uuid) to authenticated;
revoke all on function authz.can_see_work_item(uuid) from anon;

-- -------------------------------------------------------------------------
-- Drop the old signatures. The parameter lists changed, so CREATE OR REPLACE
-- would leave the uncallable versions behind as overloads.
-- -------------------------------------------------------------------------
drop function if exists public.create_work_item(
  uuid, text, text, app.work_kind, uuid, uuid, text, text, text, uuid,
  app.request_source, text, date, app.priority, date, uuid, text
);
drop function if exists public.update_work_request(
  uuid, integer, text, text, text, text, text, uuid, app.request_source,
  text, date
);
drop function if exists public.acknowledge_revision(
  uuid, app.ack_decision, text
);
-- Its return type changes from app.work_status to text, and CREATE OR REPLACE
-- cannot change a return type.
drop function if exists public.transition_work_state(uuid, integer, text, text);

-- -------------------------------------------------------------------------
-- create_work_item — text at the boundary, enums in storage.
-- -------------------------------------------------------------------------
create or replace function public.create_work_item(
  p_workspace           uuid,
  p_title               text,
  p_summary             text,
  p_kind                text default 'work',
  p_project_id          uuid default null,
  p_brand_id            uuid default null,
  p_expected_outcome    text default null,
  p_acceptance_criteria text default null,
  p_requester_label     text default null,
  p_requester_user_id   uuid default null,
  p_source              text default 'self',
  p_source_url          text default null,
  p_reported_request_date date default null,
  p_priority            text default 'normal',
  p_deadline_date       date default null,
  p_reviewer_id         uuid default null,
  p_idempotency_key     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   uuid;
  v_no     integer;
  v_ref    text;
  v_replay jsonb;
  v_digest bytea;
  v_kind     app.work_kind;
  v_source   app.request_source;
  v_priority app.priority;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  -- Validate at the boundary so a bad value is a clean 400, not a raw
  -- Postgres cast error.
  begin
    v_kind     := coalesce(p_kind, 'work')::app.work_kind;
    v_source   := coalesce(p_source, 'self')::app.request_source;
    v_priority := coalesce(p_priority, 'normal')::app.priority;
  exception when invalid_text_representation or others then
    raise exception 'invalid kind, source or priority' using errcode = 'P0400';
  end;

  if not exists (
    select 1 from app.workspace_members
     where workspace_id = p_workspace and user_id = v_uid and status = 'active'
  ) then
    raise exception 'not a member of this workspace' using errcode = 'P0403';
  end if;

  if p_project_id is not null
     and p_project_id not in (select authz.my_projects('submit')) then
    raise exception 'no submit capability on that project' using errcode = 'P0403';
  end if;

  if p_idempotency_key is not null then
    v_digest := extensions.digest(
      coalesce(p_title,'') || '|' || coalesce(p_summary,'') || '|' ||
      coalesce(p_project_id::text,''), 'sha256');
    v_replay := app.claim_idempotency('create_work_item', p_idempotency_key, v_digest);
    if v_replay is not null then
      return nullif(v_replay->>'work_item_id', '')::uuid;
    end if;
  end if;

  v_no  := app.allocate_work_no(p_workspace);
  v_ref := 'WL-' || lpad(v_no::text, 4, '0');

  insert into app.work_items (
    workspace_id, reference, project_id, brand_id, kind, status, title,
    priority, deadline_date, reviewer_id, created_by, updated_by
  ) values (
    p_workspace, v_ref, p_project_id, p_brand_id, v_kind,
    case when v_kind = 'idea' then 'captured'::app.work_status
         else 'planned'::app.work_status end,
    p_title, v_priority, p_deadline_date, p_reviewer_id, v_uid, v_uid
  )
  returning id into v_item;

  insert into app.work_item_revisions (
    workspace_id, work_item_id, revision_no, summary, expected_outcome,
    acceptance_criteria, requester_label, requester_user_id, source,
    source_url, reported_request_date, created_by
  ) values (
    p_workspace, v_item, 1, p_summary, p_expected_outcome,
    p_acceptance_criteria, p_requester_label, p_requester_user_id, v_source,
    p_source_url, p_reported_request_date, v_uid
  );

  perform app.emit_event(
    p_workspace, 'work_item.created', v_item, p_project_id, null,
    'work_item', v_item,
    jsonb_build_object('reference', v_ref, 'kind', v_kind, 'title', p_title)
  );

  if p_idempotency_key is not null then
    perform app.record_idempotency(
      'create_work_item', p_idempotency_key,
      jsonb_build_object('work_item_id', v_item));
  end if;

  return v_item;
end;
$$;

-- -------------------------------------------------------------------------
-- update_work_request — text boundary, plus the P0404 fix.
-- -------------------------------------------------------------------------
create or replace function public.update_work_request(
  p_work_item           uuid,
  p_expected_version    integer,
  p_summary             text,
  p_change_reason       text,
  p_expected_outcome    text default null,
  p_acceptance_criteria text default null,
  p_requester_label     text default null,
  p_requester_user_id   uuid default null,
  p_source              text default null,
  p_source_url          text default null,
  p_reported_request_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   app.work_items;
  v_prev   app.work_item_revisions;
  v_new    uuid;
  v_id     uuid;
  v_source app.request_source;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  -- Visibility FIRST, via the authz helpers. Inside a definer function the
  -- security_invoker view would not filter, which is how the oracle arose.
  if not authz.can_see_work_item(p_work_item) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  select * into v_item from app.work_items where id = p_work_item;
  if v_item.id is null then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  -- Visible but not permitted. P0403 here leaks nothing new.
  if not (
    v_item.created_by = v_uid
    or v_item.project_id in (select authz.my_projects('submit'))
    or v_item.workspace_id in (select authz.my_admin_workspaces())
  ) then
    raise exception 'not permitted to edit this request' using errcode = 'P0403';
  end if;

  if p_source is not null then
    begin
      v_source := p_source::app.request_source;
    exception when others then
      raise exception 'invalid request source' using errcode = 'P0400';
    end;
  end if;

  select * into v_prev from app.work_item_revisions
   where work_item_id = p_work_item order by revision_no desc limit 1;

  insert into app.work_item_revisions (
    workspace_id, work_item_id, revision_no, summary, rationale,
    expected_outcome, acceptance_criteria, requester_label,
    requester_user_id, source, source_url, reported_request_date,
    change_reason, created_by
  ) values (
    v_item.workspace_id, p_work_item, v_prev.revision_no + 1,
    coalesce(p_summary, v_prev.summary),
    v_prev.rationale,
    coalesce(p_expected_outcome, v_prev.expected_outcome),
    coalesce(p_acceptance_criteria, v_prev.acceptance_criteria),
    coalesce(p_requester_label, v_prev.requester_label),
    coalesce(p_requester_user_id, v_prev.requester_user_id),
    coalesce(v_source, v_prev.source),
    coalesce(p_source_url, v_prev.source_url),
    coalesce(p_reported_request_date, v_prev.reported_request_date),
    p_change_reason, v_uid
  )
  returning id into v_new;

  update app.work_items
     set version = version + 1
   where id = p_work_item and version = p_expected_version
  returning id into v_id;

  if v_id is null then
    raise exception 'version_conflict' using errcode = 'P0409',
      detail = format('expected %s', p_expected_version);
  end if;

  perform app.emit_event(
    v_item.workspace_id, 'work_item.request_revised', p_work_item,
    v_item.project_id, null, 'revision', v_new,
    jsonb_build_object(
      'from_revision', v_prev.revision_no,
      'to_revision', v_prev.revision_no + 1,
      'reason', p_change_reason,
      'material_change',
        (select r.material_digest from app.work_item_revisions r where r.id = v_new)
          is distinct from v_prev.material_digest
    )
  );

  return v_new;
end;
$$;

-- -------------------------------------------------------------------------
-- transition_work_state — the P0404 fix.
-- -------------------------------------------------------------------------
create or replace function public.transition_work_state(
  p_work_item        uuid,
  p_expected_version integer,
  p_action           text,
  p_reason           text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   app.work_items;
  v_tr     app.work_transitions;
  v_target app.work_status;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  if not authz.can_see_work_item(p_work_item) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  select * into v_item from app.work_items where id = p_work_item;
  if v_item.id is null then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  if not (
    v_item.created_by = v_uid
    or v_item.project_id in (select authz.my_projects('submit'))
    or v_item.workspace_id in (select authz.my_admin_workspaces())
  ) then
    raise exception 'not permitted' using errcode = 'P0403';
  end if;

  -- Checked BEFORE the transition table, so the caller learns the real
  -- reason rather than "cannot approve from in_progress".
  if p_action in ('approve', 'request_changes') then
    raise exception
      'use the review flow: a decision must be bound to a submission'
      using errcode = 'P0403';
  end if;

  select * into v_tr from app.work_transitions
   where from_status = v_item.status and action = p_action;

  if v_tr.from_status is null then
    raise exception
      'cannot % from status %', p_action, v_item.status
      using errcode = 'P0410';
  end if;

  if v_tr.reason_required
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception '% requires a reason', p_action using errcode = 'P0400';
  end if;

  v_target := coalesce(v_tr.to_status, v_item.prior_status, 'in_progress');

  update app.work_items
     set status = v_target,
         prior_status = case
           when p_action in ('block', 'pause') then v_item.status
           when p_action = 'resume' then null
           else v_item.prior_status end,
         state_reason = case
           when v_tr.reason_required then p_reason
           when p_action = 'resume' then null
           else state_reason end,
         version = version + 1
   where id = p_work_item and version = p_expected_version
  returning id into v_id;

  if v_id is null then
    raise exception 'version_conflict' using errcode = 'P0409';
  end if;

  perform app.emit_event(
    v_item.workspace_id, 'work_item.' || p_action, p_work_item,
    v_item.project_id, null, 'work_item', p_work_item,
    jsonb_build_object('from', v_item.status, 'to', v_target,
                       'reason', p_reason)
  );

  return v_target::text;
end;
$$;

-- -------------------------------------------------------------------------
-- acknowledge_revision — text boundary.
-- -------------------------------------------------------------------------
create or replace function public.acknowledge_revision(
  p_revision_id uuid,
  p_decision    text default 'confirmed',
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev app.work_item_revisions;
  v_ack uuid;
  v_dec app.ack_decision;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  begin
    v_dec := coalesce(p_decision, 'confirmed')::app.ack_decision;
  exception when others then
    raise exception 'invalid decision' using errcode = 'P0400';
  end;

  select * into v_rev from app.work_item_revisions where id = p_revision_id;
  if v_rev.id is null or not authz.can_see_work_item(v_rev.work_item_id) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  -- Only the named requester may acknowledge. An author cannot manufacture
  -- their own confirmation, which is the whole point of AC-03.
  if v_rev.requester_user_id is distinct from v_uid then
    raise exception
      'only the named requester can acknowledge this request'
      using errcode = 'P0403';
  end if;

  insert into app.request_acknowledgements (
    workspace_id, revision_id, acknowledged_material_digest,
    user_id, decision, note
  ) values (
    v_rev.workspace_id, p_revision_id, v_rev.material_digest,
    v_uid, v_dec, p_note
  )
  returning id into v_ack;

  perform app.emit_event(
    v_rev.workspace_id, 'request.' || v_dec, v_rev.work_item_id,
    null, null, 'revision', p_revision_id,
    jsonb_build_object('revision_no', v_rev.revision_no)
  );

  return v_ack;
end;
$$;

-- -------------------------------------------------------------------------
-- Grants for the new signatures. anon gets nothing.
-- -------------------------------------------------------------------------
grant execute on function public.create_work_item(
  uuid, text, text, text, uuid, uuid, text, text, text, uuid,
  text, text, date, text, date, uuid, text
) to authenticated;

grant execute on function public.update_work_request(
  uuid, integer, text, text, text, text, text, uuid, text, text, date
) to authenticated;

grant execute on function public.transition_work_state(uuid, integer, text, text)
  to authenticated;

grant execute on function public.acknowledge_revision(uuid, text, text)
  to authenticated;

revoke all on function public.create_work_item(
  uuid, text, text, text, uuid, uuid, text, text, text, uuid,
  text, text, date, text, date, uuid, text
) from anon;
revoke all on function public.update_work_request(
  uuid, integer, text, text, text, text, text, uuid, text, text, date
) from anon;
revoke all on function public.transition_work_state(uuid, integer, text, text)
  from anon;
revoke all on function public.acknowledge_revision(uuid, text, text) from anon;

commit;
