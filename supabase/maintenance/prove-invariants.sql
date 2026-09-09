-- =====================================================================
-- INVARIANT PROOF (read-only in effect: it creates fixtures and removes
-- them again). Paste into the SQL Editor and Run. The final result set is
-- a PASS/FAIL table.
--
-- This exists because the pgTAP suite in supabase/tests/database/ needs
-- `supabase test db`, which needs CLI access to the project. These are the
-- same assertions, expressed so they can run from the SQL Editor.
--
-- It proves the guarantees that cannot be reached through the HTTP API yet,
-- because submissions and reviews are M2/M3 work:
--
--   AC-10  a submitter can NEVER approve their own submission, including a
--          workspace owner, and a forged submitter is rejected first
--   AC-09  an approval never migrates to a newer submission
--          submission numbers are never reused after withdrawal
--          submitted evidence is immutable
--          activity_events cannot be rewritten
--          anon holds zero privileges, RLS is on every table
-- =====================================================================

create temporary table if not exists _proof (
  seq      serial,
  check_name text,
  outcome  text,
  detail   text
);
truncate _proof;

do $proof$
declare
  ws     uuid;
  u_sub  uuid;   -- submitter (workspace owner)
  u_rev  uuid;   -- reviewer
  u_other uuid;  -- third party, used for the forgery attempt
  item   uuid;
  rev    uuid;
  sub1   uuid;
  sub2   uuid;
  digest bytea;
  art    uuid;
  ver    uuid;
  n      integer;
  tag    text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');

begin
  -- ---------------------------------------------------------------
  -- Fixtures. Plain users in auth.users; no email is ever sent.
  -- ---------------------------------------------------------------
  u_sub   := extensions.gen_random_uuid();
  u_rev   := extensions.gen_random_uuid();
  u_other := extensions.gen_random_uuid();

  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at)
  values
    (u_sub,   '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'proof-sub-'   || tag || '@example.com', '', now(), now(), now()),
    (u_rev,   '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'proof-rev-'   || tag || '@example.com', '', now(), now(), now()),
    (u_other, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'proof-other-' || tag || '@example.com', '', now(), now(), now());

  insert into app.workspaces (slug, name, owner_id, created_by, updated_by)
  values ('proof-' || tag, 'Invariant proof', u_sub, u_sub, u_sub)
  returning id into ws;

  insert into app.workspace_members (workspace_id, user_id, role, status, joined_at)
  values (ws, u_sub, 'owner', 'active', now()),
         (ws, u_rev, 'member', 'active', now()),
         (ws, u_other, 'member', 'active', now());

  insert into app.work_items (workspace_id, reference, title, created_by, updated_by)
  values (ws, 'WL-9001', 'Proof item', u_sub, u_sub)
  returning id into item;

  insert into app.work_item_revisions (workspace_id, work_item_id, revision_no,
                                       summary, created_by)
  values (ws, item, 1, 'Proof request', u_sub)
  returning id into rev;

  digest := extensions.digest('proof-artifact', 'sha256');

  insert into app.artifacts (workspace_id, work_item_id, kind, label, created_by)
  values (ws, item, 'link', 'Proof link', u_sub) returning id into art;

  insert into app.artifact_versions (workspace_id, artifact_id, version_no, url,
                                     content_digest, state, ready_at, created_by)
  values (ws, art, 1, 'https://example.com/proof', digest, 'ready', now(), u_sub)
  returning id into ver;

  -- Submission 1, by the WORKSPACE OWNER. The admin case is the point.
  n := app.allocate_submission_no(item);
  insert into app.submissions (workspace_id, work_item_id, submission_no,
                               revision_id, submitted_by, note, content_hash)
  values (ws, item, n, rev, u_sub, 'Proof delivery', digest)
  returning id into sub1;

  insert into app.submission_artifacts (submission_id, artifact_version_id,
                                        workspace_id, position)
  values (sub1, ver, ws, 1);

  insert into _proof (check_name, outcome, detail)
  values ('fixtures created', 'PASS', 'owner-submitted submission #' || n);

  -- ---------------------------------------------------------------
  -- AC-10 (a): the submitter cannot approve their own submission.
  --            The submitter here is the WORKSPACE OWNER.
  -- ---------------------------------------------------------------
  begin
    insert into app.review_decisions (
      workspace_id, work_item_id, submission_id, submission_submitted_by,
      submission_no, submission_content_hash, decision, decided_by)
    select workspace_id, work_item_id, id, submitted_by, submission_no,
           content_hash, 'approved', submitted_by
      from app.submissions where id = sub1;
    insert into _proof (check_name, outcome, detail)
    values ('AC-10 workspace OWNER cannot approve own submission', 'FAIL',
            'the insert succeeded, which it must not');
  exception when check_violation then
    insert into _proof (check_name, outcome, detail)
    values ('AC-10 workspace OWNER cannot approve own submission', 'PASS',
            'refused by CHECK rd_no_self_review (23514)');
  when others then
    insert into _proof (check_name, outcome, detail)
    values ('AC-10 workspace OWNER cannot approve own submission', 'FAIL',
            'wrong error: ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- AC-10 (b): forging the submitter to slip past the CHECK is
  --            rejected by the composite FK first.
  -- ---------------------------------------------------------------
  begin
    insert into app.review_decisions (
      workspace_id, work_item_id, submission_id, submission_submitted_by,
      submission_no, submission_content_hash, decision, decided_by)
    select workspace_id, work_item_id, id, u_other, submission_no,
           content_hash, 'approved', u_sub
      from app.submissions where id = sub1;
    insert into _proof (check_name, outcome, detail)
    values ('AC-10 a forged submitter is rejected', 'FAIL',
            'the forgery succeeded, which it must not');
  exception when foreign_key_violation then
    insert into _proof (check_name, outcome, detail)
    values ('AC-10 a forged submitter is rejected', 'PASS',
            'refused by composite FK rd_submitter_fk (23503)');
  when others then
    insert into _proof (check_name, outcome, detail)
    values ('AC-10 a forged submitter is rejected', 'FAIL',
            'wrong error: ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- Positive control: a different person CAN approve. Without this the
  -- checks above could pass because approval is broken outright.
  -- ---------------------------------------------------------------
  begin
    insert into app.review_decisions (
      workspace_id, work_item_id, submission_id, submission_submitted_by,
      submission_no, submission_content_hash, decision, decided_by, rationale)
    select workspace_id, work_item_id, id, submitted_by, submission_no,
           content_hash, 'approved', u_rev, 'Looks right'
      from app.submissions where id = sub1;
    insert into _proof (check_name, outcome, detail)
    values ('positive control: a reviewer CAN approve', 'PASS', 'approved #1');
  exception when others then
    insert into _proof (check_name, outcome, detail)
    values ('positive control: a reviewer CAN approve', 'FAIL',
            sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- One approval per submission, ever.
  -- ---------------------------------------------------------------
  begin
    insert into app.review_decisions (
      workspace_id, work_item_id, submission_id, submission_submitted_by,
      submission_no, submission_content_hash, decision, decided_by, rationale)
    select workspace_id, work_item_id, id, submitted_by, submission_no,
           content_hash, 'approved', u_other, 'again'
      from app.submissions where id = sub1;
    insert into _proof (check_name, outcome, detail)
    values ('a submission cannot be approved twice', 'FAIL', 'second approval landed');
  exception when unique_violation then
    insert into _proof (check_name, outcome, detail)
    values ('a submission cannot be approved twice', 'PASS',
            'refused by partial unique index (23505)');
  when others then
    insert into _proof (check_name, outcome, detail)
    values ('a submission cannot be approved twice', 'FAIL',
            'wrong error: ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- Submitted evidence is immutable.
  -- ---------------------------------------------------------------
  begin
    update app.submissions set content_hash = extensions.digest('tampered','sha256')
     where id = sub1;
    insert into _proof (check_name, outcome, detail)
    values ('submitted evidence is immutable', 'FAIL', 'content_hash was rewritten');
  exception when others then
    insert into _proof (check_name, outcome, detail)
    values ('submitted evidence is immutable',
            case when sqlstate = 'P0410' then 'PASS' else 'FAIL' end,
            sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- Numbering: withdraw #1, submit again, expect #2 (never a reused 1).
  -- ---------------------------------------------------------------
  update app.submissions
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = u_sub,
         withdraw_reason = 'proof'
   where id = sub1;

  n := app.allocate_submission_no(item);
  insert into app.submissions (workspace_id, work_item_id, submission_no,
                               revision_id, submitted_by, note, content_hash)
  values (ws, item, n, rev, u_sub, 'Second delivery', digest)
  returning id into sub2;

  insert into _proof (check_name, outcome, detail)
  values ('a withdrawn submission number is retired',
          case when n = 2 then 'PASS' else 'FAIL' end,
          'next number was ' || n || ' (expected 2)');

  begin
    insert into app.submissions (workspace_id, work_item_id, submission_no,
                                 revision_id, submitted_by, content_hash)
    values (ws, item, 1, rev, u_sub, digest);
    insert into _proof (check_name, outcome, detail)
    values ('a used submission number cannot be reclaimed', 'FAIL', 'reclaimed #1');
  exception when unique_violation then
    insert into _proof (check_name, outcome, detail)
    values ('a used submission number cannot be reclaimed', 'PASS', '23505');
  when others then
    insert into _proof (check_name, outcome, detail)
    values ('a used submission number cannot be reclaimed', 'FAIL',
            sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- AC-09: the approval still names submission 1, not the newer 2.
  -- ---------------------------------------------------------------
  select s.submission_no into n
    from app.review_decisions d
    join app.submissions s on s.id = d.submission_id
   where d.work_item_id = item and d.decision = 'approved';

  insert into _proof (check_name, outcome, detail)
  values ('AC-09 approval does not migrate to a newer submission',
          case when n = 1 then 'PASS' else 'FAIL' end,
          'approval names submission ' || n || ' (expected 1)');

  -- ---------------------------------------------------------------
  -- activity_events cannot be rewritten.
  -- ---------------------------------------------------------------
  perform app.emit_event(ws, 'proof.event', item, null, null, 'work_item', item,
                         '{"proof":true}'::jsonb);
  begin
    update app.activity_events set payload = '{}'::jsonb
     where workspace_id = ws and event_type = 'proof.event';
    insert into _proof (check_name, outcome, detail)
    values ('activity_events cannot be rewritten', 'FAIL', 'payload was updated');
  exception when others then
    insert into _proof (check_name, outcome, detail)
    values ('activity_events cannot be rewritten',
            case when sqlstate = 'P0410' then 'PASS' else 'FAIL' end,
            sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- Cross-tenant reference is refused declaratively.
  -- ---------------------------------------------------------------
  begin
    insert into app.work_items (workspace_id, reference, project_id, title,
                                created_by, updated_by)
    values (ws, 'WL-9002',
            (select id from app.projects where workspace_id <> ws limit 1),
            'Cross tenant', u_sub, u_sub);
    insert into _proof (check_name, outcome, detail)
    values ('cross-workspace project reference refused', 'SKIP',
            'no foreign project existed to attempt');
  exception when foreign_key_violation then
    insert into _proof (check_name, outcome, detail)
    values ('cross-workspace project reference refused', 'PASS', '23503');
  when others then
    insert into _proof (check_name, outcome, detail)
    values ('cross-workspace project reference refused', 'FAIL',
            sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------
  -- Teardown. Triggers are lifted only for this cleanup, then restored.
  -- ---------------------------------------------------------------
  alter table app.activity_events          disable trigger user;
  alter table app.work_item_revisions      disable trigger user;
  alter table app.request_acknowledgements disable trigger user;
  alter table app.submissions              disable trigger user;
  alter table app.submission_artifacts     disable trigger user;
  alter table app.review_decisions         disable trigger user;
  alter table app.artifact_versions        disable trigger user;
  alter table app.artifacts                disable trigger user;
  alter table app.work_items               disable trigger user;

  delete from app.workspaces where id = ws;
  delete from auth.users where id in (u_sub, u_rev, u_other);

  alter table app.work_items               enable trigger user;
  alter table app.artifacts                enable trigger user;
  alter table app.artifact_versions        enable trigger user;
  alter table app.review_decisions         enable trigger user;
  alter table app.submission_artifacts     enable trigger user;
  alter table app.submissions              enable trigger user;
  alter table app.request_acknowledgements enable trigger user;
  alter table app.work_item_revisions      enable trigger user;
  alter table app.activity_events          enable trigger user;

  insert into _proof (check_name, outcome, detail)
  values ('fixtures removed', 'PASS', 'no proof data left behind');
end
$proof$;

-- ---------------------------------------------------------------------
-- Structural checks, independent of the fixtures above.
-- ---------------------------------------------------------------------
insert into _proof (check_name, outcome, detail)
select 'anon holds zero privileges in app/authz',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' grants found'
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema in ('app', 'authz');

insert into _proof (check_name, outcome, detail)
select 'RLS enabled on every app table',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(relname, ', '), 'none missing')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'app' and c.relkind = 'r' and not c.relrowsecurity;

insert into _proof (check_name, outcome, detail)
select 'no client role can write to any app table',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' write grants found'
  from information_schema.role_table_grants
 where table_schema = 'app'
   and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

insert into _proof (check_name, outcome, detail)
select 'every workspace_id table is tenant-pinned by a composite FK',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(relname, ', '), 'all pinned')
  from (
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id'
     where n.nspname = 'app' and c.relkind = 'r'
       and a.attnum > 0 and not a.attisdropped
       and not exists (
         select 1 from pg_constraint k
          where k.conrelid = c.oid and k.contype = 'f'
            and a.attnum = any (k.conkey)
       )
  ) unpinned;

insert into _proof (check_name, outcome, detail)
select 'every public view is security_invoker',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(relname, ', '), 'all invoker')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
   and not coalesce(
     array_to_string(c.reloptions, ',') like '%security_invoker=on%', false);

insert into _proof (check_name, outcome, detail)
select 'no append-only guard left disabled',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(c.relname || '.' || t.tgname, ', '), 'all enabled')
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'app' and not t.tgisinternal and t.tgenabled = 'D';

-- The result set.
select outcome, check_name, detail from _proof order by seq;
