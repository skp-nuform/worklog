-- =========================================================================
-- 040 — Membership is live, not a token claim (AC-20).
--
-- This is the test that would fail under any JWT-claims-based authorization
-- design. Supabase access tokens last an hour and are not proactively
-- destroyed when access changes, so a removed member keeps a syntactically
-- valid token carrying stale capabilities. Authorization must therefore read
-- the database.
--
-- Each case impersonates a user whose token STILL says `admin`, then removes
-- the membership row, then asserts nothing is visible.
-- =========================================================================

begin;
select plan(9);

select tests.as_owner();
create temporary table fx as select tests.seed() as f;

-- -------------------------------------------------------------------------
-- Baseline: while active, removed_a really is an admin and really can see
-- workspace A. Without this, the denial assertions below could pass for the
-- wrong reason.
-- -------------------------------------------------------------------------
select tests.as_user((select (f->>'removed_a')::uuid from fx));

select isnt_empty(
  format($$ select id from app.work_items where workspace_id = %L $$,
         (select f->>'ws_a' from fx)),
  'while active, an admin sees workspace A work items'
);

select isnt_empty(
  $$ select authz.my_workspaces() $$,
  'while active, my_workspaces() returns the membership'
);

select isnt_empty(
  $$ select authz.my_admin_workspaces() $$,
  'while active, my_admin_workspaces() returns the membership'
);

-- Admins see unassigned Inbox items belonging to other members.
select isnt_empty(
  format($$ select id from app.work_items where id = %L $$,
         (select f->>'item_inbox' from fx)),
  'while active, an admin sees another member unassigned inbox item'
);

-- -------------------------------------------------------------------------
-- Remove the membership, then re-impersonate with a token that STILL claims
-- admin rights on that workspace.
-- -------------------------------------------------------------------------
select tests.as_owner();

update app.workspace_members
   set status = 'removed', removed_at = now()
 where workspace_id = (select (f->>'ws_a')::uuid from fx)
   and user_id = (select (f->>'removed_a')::uuid from fx);

select tests.as_user_with_stale_claims(
  (select (f->>'removed_a')::uuid from fx),
  jsonb_build_object(
    'workspace_role', 'admin',
    'workspaces', jsonb_build_array((select f->>'ws_a' from fx)),
    'projects', jsonb_build_array((select f->>'p1' from fx))
  )
);

-- The claims are present in the token...
select is(
  (current_setting('request.jwt.claims', true)::jsonb)->>'workspace_role',
  'admin',
  'the token still carries an admin claim (a 59-minute-old session)'
);

-- ...and they authorize nothing.
select is_empty(
  $$ select authz.my_workspaces() $$,
  'a removed member resolves to no workspaces, despite the stale claim'
);

select is_empty(
  $$ select authz.my_admin_workspaces() $$,
  'a removed member resolves to no admin workspaces'
);

select is_empty(
  format($$ select id from app.work_items where workspace_id = %L $$,
         (select f->>'ws_a' from fx)),
  'a removed member sees no work items, despite the stale admin claim'
);

-- Direct id substitution with the stale token is the real attack.
select is_empty(
  format($$ select id from app.work_items where id = %L $$,
         (select f->>'item1' from fx)),
  'substituting a known work item id with a stale token returns nothing'
);

select * from finish();
rollback;
