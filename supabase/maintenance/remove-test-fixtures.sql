-- =====================================================================
-- MAINTENANCE (not a migration).
--
-- Removes the throwaway users and workspaces created by automated
-- verification: emails matching 'worklog-verify-%' or 'worklog-e2e-%' at
-- @example.com. Nothing else is touched.
--
-- WHY THIS NEEDS A SCRIPT
--
-- Several tables are append-only by design (app.raise_append_only fires on
-- UPDATE and DELETE): activity_events, work_item_revisions,
-- request_acknowledgements, submissions, submission_artifacts,
-- review_decisions. Deleting a workspace cascades into all of them, so the
-- cascade is blocked. That is the PRD's intent — business history is never
-- silently discarded — which makes removing a workspace a deliberate,
-- audited maintenance operation rather than a routine one.
--
-- An earlier version of this script disabled the guard on activity_events
-- only, and failed on work_item_revisions. This disables USER triggers on
-- every table the cascade reaches. `DISABLE TRIGGER USER` leaves the
-- internal foreign-key triggers active, so referential integrity still
-- holds while it runs.
--
-- Run in the SQL Editor. Safe to re-run; it is a no-op once clean.
-- =====================================================================

begin;

alter table app.activity_events          disable trigger user;
alter table app.work_item_revisions      disable trigger user;
alter table app.request_acknowledgements disable trigger user;
alter table app.submissions              disable trigger user;
alter table app.submission_artifacts     disable trigger user;
alter table app.review_decisions         disable trigger user;
alter table app.artifact_versions        disable trigger user;
alter table app.artifacts                disable trigger user;
alter table app.work_items               disable trigger user;

-- Workspaces owned by a fixture user. The cascade clears brands, projects,
-- work items, revisions, artifacts, submissions and events beneath them.
delete from app.workspaces
 where owner_id in (
   select id from auth.users
    where email like 'worklog-verify-%@example.com'
       or email like 'worklog-e2e-%@example.com'
       or email like 'worklog-sheet-%@example.com'
 );

-- Any fixture-owned rows that survived because a real user owns the
-- workspace they sit in (none expected, but this keeps the script honest).
delete from app.work_items
 where created_by in (
   select id from auth.users
    where email like 'worklog-verify-%@example.com'
       or email like 'worklog-e2e-%@example.com'
       or email like 'worklog-sheet-%@example.com'
 );

alter table app.work_items               enable trigger user;
alter table app.artifacts                enable trigger user;
alter table app.artifact_versions        enable trigger user;
alter table app.review_decisions         enable trigger user;
alter table app.submission_artifacts     enable trigger user;
alter table app.submissions              enable trigger user;
alter table app.request_acknowledgements enable trigger user;
alter table app.work_item_revisions      enable trigger user;
alter table app.activity_events          enable trigger user;

-- With the workspaces gone the profiles are unreferenced, so removing the
-- auth users cascades cleanly into app.profiles.
delete from auth.users
 where email like 'worklog-verify-%@example.com'
    or email like 'worklog-e2e-%@example.com'
    or email like 'worklog-sheet-%@example.com';

commit;

-- Verification. Both should return 0.
select count(*) as leftover_fixture_users
  from auth.users
 where email like 'worklog-verify-%@example.com'
    or email like 'worklog-e2e-%@example.com'
    or email like 'worklog-sheet-%@example.com';

select count(*) as leftover_fixture_workspaces
  from app.workspaces
 where name in ('Verify A', 'Verify B', 'Nuform E2E', 'Sheet Test A', 'Sheet Test B');

-- Confirm the append-only guards are back on. Should list no rows.
select c.relname, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'app'
   and not t.tgisinternal
   and t.tgenabled = 'D';
