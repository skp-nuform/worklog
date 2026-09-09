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
