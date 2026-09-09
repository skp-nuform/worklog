-- =========================================================================
-- 020 — Tenant isolation (AC-15, AC-16).
--
-- Two halves:
--
--   Writes are attempted as the OWNING role, not as `authenticated`. That is
--   deliberate and it is the stronger claim: `authenticated` has no write
--   grant at all (asserted structurally in 010), so testing as a client
--   would only re-prove the grant. Testing as postgres proves the composite
--   foreign keys hold even for a privileged path -- including the definer
--   RPCs and any future break-glass script.
--
--   Reads are attempted as a real member of the other workspace, which is
--   the actual attack: a valid session plus a substituted id.
-- =========================================================================

begin;
select plan(12);

select tests.as_owner();
create temporary table fx as select tests.seed() as f;

-- -------------------------------------------------------------------------
-- Cross-tenant WRITES all fail as foreign key violations (23503), never as
-- a policy error. A policy error is what people write escape hatches around.
-- -------------------------------------------------------------------------

-- A project cannot borrow another workspace's brand.
select throws_ok(
  format(
    $$ insert into app.projects (workspace_id, brand_id, name, created_by, updated_by)
       values (%L, %L, 'Stolen brand', %L, %L) $$,
    (select f->>'ws_b' from fx), (select f->>'brand_a' from fx),
    (select f->>'member_b' from fx), (select f->>'member_b' from fx)
  ),
  '23503', null,
  'a project cannot reference another workspace brand'
);

-- A work item cannot be filed under another workspace's project.
select throws_ok(
  format(
    $$ insert into app.work_items
         (workspace_id, reference, project_id, title, created_by, updated_by)
       values (%L, 'WL-9001', %L, 'Cross tenant item', %L, %L) $$,
    (select f->>'ws_a' from fx), (select f->>'p3' from fx),
    (select f->>'contrib_a' from fx), (select f->>'contrib_a' from fx)
  ),
  '23503', null,
  'a work item cannot be filed under another workspace project'
);

-- A project grant cannot be issued to a non-member of that workspace.
select throws_ok(
  format(
    $$ insert into app.project_members
         (project_id, workspace_id, user_id, role, created_by)
       values (%L, %L, %L, 'contributor', %L) $$,
    (select f->>'p1' from fx), (select f->>'ws_a' from fx),
    (select f->>'member_b' from fx), (select f->>'owner_a' from fx)
  ),
  '23503', null,
  'a project grant cannot be issued to a non-member of the workspace'
);

-- A revision cannot attach to another workspace's work item.
select throws_ok(
  format(
    $$ insert into app.work_item_revisions
         (workspace_id, work_item_id, revision_no, summary, created_by)
       values (%L, %L, 1, 'Cross tenant revision', %L) $$,
    (select f->>'ws_a' from fx), (select f->>'item_b' from fx),
    (select f->>'contrib_a' from fx)
  ),
  '23503', null,
  'a revision cannot attach to another workspace work item'
);

-- A named requester must be a member of the item's workspace. This one is a
-- trigger rather than a composite FK -- historical attribution must survive
-- a member being removed -- so it raises 23503 explicitly to match.
select throws_ok(
  format(
    $$ insert into app.work_item_revisions
         (workspace_id, work_item_id, revision_no, summary,
          requester_user_id, created_by)
       values (%L, %L, 2, 'Foreign requester', %L, %L) $$,
    (select f->>'ws_a' from fx), (select f->>'item1' from fx),
    (select f->>'member_b' from fx), (select f->>'contrib_a' from fx)
  ),
  '23503', null,
  'a requester from another workspace is rejected'
);

-- A reviewer must be a member of the item's workspace.
select throws_ok(
  format(
    $$ update app.work_items
          set reviewer_id = %L, version = version + 1
        where id = %L $$,
    (select f->>'member_b' from fx), (select f->>'item1' from fx)
  ),
  '23503', null,
  'a reviewer from another workspace cannot be assigned'
);

-- -------------------------------------------------------------------------
-- Cross-tenant READS return nothing, with a genuine session.
-- -------------------------------------------------------------------------
select tests.as_user((select (f->>'member_b')::uuid from fx));

select is_empty(
  format($$ select id from app.work_items where workspace_id = %L $$,
         (select f->>'ws_a' from fx)),
  'a member of workspace B sees no work items from workspace A'
);

select is_empty(
  format($$ select id from app.projects where workspace_id = %L $$,
         (select f->>'ws_a' from fx)),
  'a member of workspace B sees no projects from workspace A'
);

select is_empty(
  format($$ select id from app.brands where workspace_id = %L $$,
         (select f->>'ws_a' from fx)),
  'a member of workspace B sees no brands from workspace A'
);

-- Substituting a known-good id directly is the real attack, and it must
-- return zero rows rather than an error that confirms the row exists.
select is_empty(
  format($$ select id from app.work_items where id = %L $$,
         (select f->>'item1' from fx)),
  'substituting a work item id from another workspace returns nothing'
);

select is_empty(
  format($$ select user_id from app.workspace_members where workspace_id = %L $$,
         (select f->>'ws_a' from fx)),
  'the roster of another workspace is not enumerable'
);

-- -------------------------------------------------------------------------
-- Within one workspace, a project grant is still required (AC-16). A
-- workspace member with no grant on Project Two must not see it.
-- -------------------------------------------------------------------------
select tests.as_user((select (f->>'contrib_a')::uuid from fx));

select is_empty(
  format($$ select id from app.projects where id = %L $$,
         (select f->>'p2' from fx)),
  'a workspace member sees no project they hold no grant on'
);

select * from finish();
rollback;
