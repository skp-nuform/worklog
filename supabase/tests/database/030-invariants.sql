-- =========================================================================
-- 030 — Delivery invariants (AC-09, AC-10, AC-11).
--
-- Self-approval, submission numbering, approval pinning, and the
-- expected_version conflict. Run as the owning role throughout: the claim
-- being tested is that these hold for EVERY writer, including a privileged
-- one, not merely that a client lacks a grant.
-- =========================================================================

begin;
select plan(16);

select tests.as_owner();
create temporary table fx as select tests.seed() as f;

-- Helper: create a ready artifact version and a submission for a given
-- submitter, returning the submission id.
create or replace function pg_temp.mk_submission(
  p_ws uuid, p_item uuid, p_by uuid
)
returns uuid
language plpgsql
as $$
declare
  v_no      integer;
  v_rev     uuid;
  v_sub     uuid;
  v_art     uuid;
  v_ver     uuid;
  v_digest  bytea;
begin
  select id into v_rev
    from app.work_item_revisions
   where work_item_id = p_item
   order by revision_no desc limit 1;

  insert into app.artifacts (workspace_id, work_item_id, kind, label, created_by)
  values (p_ws, p_item, 'link', 'Figma file', p_by)
  returning id into v_art;

  v_digest := extensions.digest('https://figma.com/file/abc', 'sha256');

  insert into app.artifact_versions
    (workspace_id, artifact_id, version_no, url, content_digest,
     state, ready_at, created_by)
  values (p_ws, v_art, 1, 'https://figma.com/file/abc', v_digest,
          'ready', now(), p_by)
  returning id into v_ver;

  v_no := app.allocate_submission_no(p_item);

  insert into app.submissions
    (workspace_id, work_item_id, submission_no, revision_id,
     submitted_by, note, content_hash)
  values (p_ws, p_item, v_no, v_rev, p_by, 'Delivered', v_digest)
  returning id into v_sub;

  insert into app.submission_artifacts
    (submission_id, artifact_version_id, workspace_id, position)
  values (v_sub, v_ver, p_ws, 1);

  return v_sub;
end;
$$;

-- -------------------------------------------------------------------------
-- INVARIANT 2 — the submitter can never approve (AC-10).
-- -------------------------------------------------------------------------

-- Contributor submits.
create temporary table s1 as
select pg_temp.mk_submission(
  (select (f->>'ws_a')::uuid from fx),
  (select (f->>'item1')::uuid from fx),
  (select (f->>'contrib_a')::uuid from fx)
) as id;

-- (a) The contributor cannot approve their own submission.
select throws_ok(
  format(
    $$ insert into app.review_decisions
         (workspace_id, work_item_id, submission_id,
          submission_submitted_by, submission_no, submission_content_hash,
          decision, decided_by)
       select workspace_id, work_item_id, id,
              submitted_by, submission_no, content_hash,
              'approved', submitted_by
         from app.submissions where id = %L $$,
    (select id from s1)
  ),
  '23514', null,
  'a contributor cannot approve their own submission'
);

-- (b) A designated reviewer CAN approve it. Positive control: without this,
--     the test above could pass for the wrong reason.
select lives_ok(
  format(
    $$ insert into app.review_decisions
         (workspace_id, work_item_id, submission_id,
          submission_submitted_by, submission_no, submission_content_hash,
          decision, decided_by, rationale)
       select workspace_id, work_item_id, id,
              submitted_by, submission_no, content_hash,
              'approved', %L, 'Looks right'
         from app.submissions where id = %L $$,
    (select f->>'reviewer_a' from fx), (select id from s1)
  ),
  'a designated reviewer can approve another user submission'
);

-- (c) One approval per submission, ever.
select throws_ok(
  format(
    $$ insert into app.review_decisions
         (workspace_id, work_item_id, submission_id,
          submission_submitted_by, submission_no, submission_content_hash,
          decision, decided_by)
       select workspace_id, work_item_id, id,
              submitted_by, submission_no, content_hash,
              'approved', %L
         from app.submissions where id = %L $$,
    (select f->>'owner_a' from fx), (select id from s1)
  ),
  '23505', null,
  'a submission cannot be approved twice'
);

-- (d) Forging the submitter to slip past the CHECK fails at the FK first.
select throws_ok(
  format(
    $$ insert into app.review_decisions
         (workspace_id, work_item_id, submission_id,
          submission_submitted_by, submission_no, submission_content_hash,
          decision, decided_by)
       select workspace_id, work_item_id, id,
              %L, submission_no, content_hash,
              'approved', %L
         from app.submissions where id = %L $$,
    (select f->>'viewer_a' from fx),
    (select f->>'contrib_a' from fx),
    (select id from s1)
  ),
  '23503', null,
  'a forged submission_submitted_by is rejected by the composite FK'
);

-- (e) THE ADMIN CASE. A workspace owner who is also the submitter is refused.
--     This is the case that proves privilege escalation does not help.
create temporary table s_owner as
select pg_temp.mk_submission(
  (select (f->>'ws_a')::uuid from fx),
  (select (f->>'item_inbox')::uuid from fx),
  (select (f->>'owner_a')::uuid from fx)
) as id;

select throws_ok(
  format(
    $$ insert into app.review_decisions
         (workspace_id, work_item_id, submission_id,
          submission_submitted_by, submission_no, submission_content_hash,
          decision, decided_by)
       select workspace_id, work_item_id, id,
              submitted_by, submission_no, content_hash,
              'approved', submitted_by
         from app.submissions where id = %L $$,
    (select id from s_owner)
  ),
  '23514', null,
  'a workspace OWNER cannot approve their own submission either'
);

-- (f) Requesting changes without a rationale is refused.
select throws_ok(
  format(
    $$ insert into app.review_decisions
         (workspace_id, work_item_id, submission_id,
          submission_submitted_by, submission_no, submission_content_hash,
          decision, decided_by)
       select workspace_id, work_item_id, id,
              submitted_by, submission_no, content_hash,
              'changes_requested', %L
         from app.submissions where id = %L $$,
    (select f->>'reviewer_a' from fx), (select id from s_owner)
  ),
  '23514', null,
  'requesting changes requires an explanatory rationale'
);

-- -------------------------------------------------------------------------
-- INVARIANT 1 — submission numbers are never reused (AC-09 groundwork).
-- -------------------------------------------------------------------------
select is(
  (select submission_no from app.submissions where id = (select id from s1)),
  1,
  'the first submission is number 1'
);

create temporary table s2 as
select pg_temp.mk_submission(
  (select (f->>'ws_a')::uuid from fx),
  (select (f->>'item1')::uuid from fx),
  (select (f->>'contrib_a')::uuid from fx)
) as id;

select is(
  (select submission_no from app.submissions where id = (select id from s2)),
  2,
  'the second submission is number 2'
);

-- Withdraw #2, then submit again: the next number is 3, NOT a reused 2.
update app.submissions
   set status = 'withdrawn', withdrawn_at = now(),
       withdrawn_by = (select (f->>'contrib_a')::uuid from fx),
       withdraw_reason = 'Wrong file attached'
 where id = (select id from s2);

create temporary table s3 as
select pg_temp.mk_submission(
  (select (f->>'ws_a')::uuid from fx),
  (select (f->>'item1')::uuid from fx),
  (select (f->>'contrib_a')::uuid from fx)
) as id;

select is(
  (select submission_no from app.submissions where id = (select id from s3)),
  3,
  'a withdrawn number is retired: the next submission is 3, not a reused 2'
);

-- Claiming a used number directly is a unique violation.
select throws_ok(
  format(
    $$ insert into app.submissions
         (workspace_id, work_item_id, submission_no, revision_id,
          submitted_by, content_hash)
       select workspace_id, work_item_id, 2, revision_id,
              submitted_by, content_hash
         from app.submissions where id = %L $$,
    (select id from s1)
  ),
  '23505', null,
  'a retired submission number cannot be claimed again'
);

-- A withdrawn submission is frozen.
select throws_ok(
  format($$ update app.submissions set note = 'edited' where id = %L $$,
         (select id from s2)),
  'P0410', null,
  'a withdrawn submission cannot be modified'
);

-- A submitted submission's evidence cannot be rewritten.
select throws_ok(
  format($$ update app.submissions set content_hash = %L where id = %L $$,
         '\x00'::bytea, (select id from s1)),
  'P0410', null,
  'a submission content hash is immutable'
);

-- -------------------------------------------------------------------------
-- INVARIANT 3 — approval does not migrate to a newer submission (AC-09).
-- -------------------------------------------------------------------------
select is(
  (select submission_no
     from app.submissions
    where id = (select submission_id
                  from app.review_decisions
                 where decision = 'approved'
                   and work_item_id = (select (f->>'item1')::uuid from fx))),
  1,
  'after submissions 2 and 3 exist, the approval still names submission 1'
);

-- -------------------------------------------------------------------------
-- INVARIANT 8 — expected_version (AC-11).
-- -------------------------------------------------------------------------

-- A substantive change without a version bump is refused outright.
select throws_ok(
  format($$ update app.work_items set title = 'Renamed' where id = %L $$,
         (select f->>'item1' from fx)),
  'P0409', null,
  'a substantive update without a version bump is refused'
);

-- The compare-and-swap: a stale expected_version matches zero rows, so the
-- title is unchanged. No silent overwrite.
update app.work_items
   set title = 'First writer wins', version = version + 1
 where id = (select (f->>'item1')::uuid from fx) and version = 1;

with stale as (
  update app.work_items
     set title = 'Second writer', version = version + 1
   where id = (select (f->>'item1')::uuid from fx) and version = 1
  returning id
)
select is(
  (select count(*)::int from stale),
  0,
  'a stale expected_version matches zero rows rather than overwriting'
);

select is(
  (select title::text from app.work_items
    where id = (select (f->>'item1')::uuid from fx)),
  'First writer wins',
  'the first writer value survives: the stale save did not overwrite it'
);

select * from finish();
rollback;
