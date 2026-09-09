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
