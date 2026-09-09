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
