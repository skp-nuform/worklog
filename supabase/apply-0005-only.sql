-- =====================================================================
-- Worklog schema — migration 0005 ONLY (the API surface).
-- Use this if 0001-0004 were already applied.
--
-- Atomic: if any statement fails, NOTHING is applied and the database is
-- left exactly as it was. Safe to re-run against a fresh database; if the
-- schema is already partly applied it fails cleanly without changing it.
-- =====================================================================

begin;

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

commit;
