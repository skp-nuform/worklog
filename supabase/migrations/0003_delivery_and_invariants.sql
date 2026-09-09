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
