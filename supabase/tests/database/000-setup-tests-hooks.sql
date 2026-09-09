-- =========================================================================
-- 000 — Test harness.
--
-- Files in this directory run in ALPHABETICAL order, each in its own
-- transaction that rolls back individually. This file only defines helpers;
-- it asserts nothing.
--
-- Because every test rolls back, this suite is safe to run against the
-- hosted project with `supabase test db --linked`. It still must never be
-- pointed at a database holding real business records -- use a dedicated
-- development project.
-- =========================================================================

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Create a confirmed auth user and return its id.
create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
as $$
declare v_id uuid := extensions.gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', p_email,
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    now(), now(), now()
  );

  insert into app.profiles (id, display_name, email)
  values (v_id, split_part(p_email, '@', 1), p_email);

  return v_id;
end;
$$;

-- Impersonate a user: role `authenticated`, with auth.uid() resolving to
-- p_uid. `local` scopes it to the surrounding transaction.
create or replace function tests.as_user(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Impersonate a user whose token still carries STALE capability claims.
-- Used to prove that authorization reads the database, not the token.
create or replace function tests.as_user_with_stale_claims(
  p_uid uuid,
  p_claims jsonb
)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    (jsonb_build_object('sub', p_uid, 'role', 'authenticated') || p_claims)::text,
    true
  );
end;
$$;

create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- Return to the owning role.
create or replace function tests.as_owner()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- -------------------------------------------------------------------------
-- Standard fixture: two workspaces so every isolation test has a real
-- "other tenant" to attempt, rather than a hypothetical one.
--
--   WS_A: owner_a, admin_a, contributor_a, reviewer_a, viewer_a, removed_a
--         project P1 (all of the above granted), project P2 (nobody)
--   WS_B: member_b, project P3
-- -------------------------------------------------------------------------
create or replace function tests.seed()
returns jsonb
language plpgsql
as $$
declare
  ws_a uuid; ws_b uuid;
  owner_a uuid; admin_a uuid; contrib_a uuid; reviewer_a uuid;
  viewer_a uuid; removed_a uuid; member_b uuid;
  brand_a uuid; p1 uuid; p2 uuid; p3 uuid;
  item1 uuid; item_inbox uuid; item_b uuid;
  suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
begin
  owner_a    := tests.create_user('owner-'      || suffix || '@example.test');
  admin_a    := tests.create_user('admin-'      || suffix || '@example.test');
  contrib_a  := tests.create_user('contrib-'    || suffix || '@example.test');
  reviewer_a := tests.create_user('reviewer-'   || suffix || '@example.test');
  viewer_a   := tests.create_user('viewer-'     || suffix || '@example.test');
  removed_a  := tests.create_user('removed-'    || suffix || '@example.test');
  member_b   := tests.create_user('memberb-'    || suffix || '@example.test');

  insert into app.workspaces (slug, name, owner_id, created_by, updated_by)
  values ('ws-a-' || suffix, 'Workspace A', owner_a, owner_a, owner_a)
  returning id into ws_a;

  insert into app.workspaces (slug, name, owner_id, created_by, updated_by)
  values ('ws-b-' || suffix, 'Workspace B', member_b, member_b, member_b)
  returning id into ws_b;

  insert into app.workspace_members (workspace_id, user_id, role, status, joined_at)
  values
    (ws_a, owner_a,    'owner',  'active',  now()),
    (ws_a, admin_a,    'admin',  'active',  now()),
    (ws_a, contrib_a,  'member', 'active',  now()),
    (ws_a, reviewer_a, 'member', 'active',  now()),
    (ws_a, viewer_a,   'member', 'active',  now()),
    (ws_a, removed_a,  'admin',  'active',  now()),
    (ws_b, member_b,   'owner',  'active',  now());

  insert into app.brands (workspace_id, name, created_by, updated_by)
  values (ws_a, 'Newform Tech', owner_a, owner_a)
  returning id into brand_a;

  insert into app.projects (workspace_id, brand_id, name, created_by, updated_by)
  values (ws_a, brand_a, 'Project One', owner_a, owner_a)
  returning id into p1;

  insert into app.projects (workspace_id, name, created_by, updated_by)
  values (ws_a, 'Project Two (nobody granted)', owner_a, owner_a)
  returning id into p2;

  insert into app.projects (workspace_id, name, created_by, updated_by)
  values (ws_b, 'Project Three', member_b, member_b)
  returning id into p3;

  insert into app.project_members (project_id, workspace_id, user_id, role, created_by)
  values
    (p1, ws_a, contrib_a,  'contributor', owner_a),
    (p1, ws_a, reviewer_a, 'reviewer',    owner_a),
    (p1, ws_a, viewer_a,   'viewer',      owner_a);

  insert into app.work_items
    (workspace_id, reference, project_id, brand_id, title, created_by, updated_by)
  values
    (ws_a, 'WL-0001', p1, brand_a, 'Item in project one', contrib_a, contrib_a)
  returning id into item1;

  -- Inbox item: no project, authored by the contributor.
  insert into app.work_items
    (workspace_id, reference, title, created_by, updated_by)
  values (ws_a, 'WL-0002', 'Unassigned inbox item', contrib_a, contrib_a)
  returning id into item_inbox;

  insert into app.work_items
    (workspace_id, reference, project_id, title, created_by, updated_by)
  values (ws_b, 'WL-0001', p3, 'Item in workspace B', member_b, member_b)
  returning id into item_b;

  insert into app.work_item_revisions
    (workspace_id, work_item_id, revision_no, summary, created_by)
  values (ws_a, item1, 1, 'Original request summary', contrib_a);

  return jsonb_build_object(
    'ws_a', ws_a, 'ws_b', ws_b,
    'owner_a', owner_a, 'admin_a', admin_a, 'contrib_a', contrib_a,
    'reviewer_a', reviewer_a, 'viewer_a', viewer_a, 'removed_a', removed_a,
    'member_b', member_b,
    'brand_a', brand_a, 'p1', p1, 'p2', p2, 'p3', p3,
    'item1', item1, 'item_inbox', item_inbox, 'item_b', item_b
  );
end;
$$;
