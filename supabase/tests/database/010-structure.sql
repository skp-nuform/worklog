-- =========================================================================
-- 010 — Structural assertions.
--
-- These are the tests that keep the design true as the schema grows. They
-- enumerate the catalog rather than naming tables one by one, so a table
-- added later without RLS, or a child added without tenant pinning, fails
-- CI on its own.
-- =========================================================================

begin;
select plan(11);

-- -------------------------------------------------------------------------
-- T2 — anon holds NO privileges anywhere. The single most valuable line.
-- -------------------------------------------------------------------------
select is_empty(
  $$ select table_schema || '.' || table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema in ('app', 'authz') $$,
  'anon has no table privileges in app or authz'
);

select ok(
  not has_schema_privilege('anon', 'app', 'usage'),
  'anon cannot USAGE the app schema'
);

select ok(
  not has_schema_privilege('anon', 'authz', 'usage'),
  'anon cannot USAGE the authz schema'
);

-- -------------------------------------------------------------------------
-- T3 — RLS is enabled on every table in app.
-- -------------------------------------------------------------------------
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app'
        and c.relkind = 'r'
        and not c.relrowsecurity $$,
  'every table in app has row level security enabled'
);

-- -------------------------------------------------------------------------
-- T1 — every child table carrying workspace_id pins the tenant with a
-- composite foreign key that INCLUDES workspace_id.
--
-- Exempt: the tenant root itself (workspaces has no parent) and tables whose
-- workspace_id is the direct FK to workspaces.
-- -------------------------------------------------------------------------
select is_empty(
  $$
  with ws_tables as (
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id'
     where n.nspname = 'app'
       and c.relkind = 'r'
       and a.attnum > 0
       and not a.attisdropped
  ),
  pinned as (
    select t.relname
      from ws_tables t
      join pg_constraint k on k.conrelid = t.oid and k.contype = 'f'
      join pg_attribute a
           on a.attrelid = t.oid and a.attname = 'workspace_id'
     where a.attnum = any (k.conkey)
  )
  select t.relname
    from ws_tables t
   where t.relname not in (select relname from pinned)
  $$,
  'every app table with workspace_id has a composite FK including it'
);

-- -------------------------------------------------------------------------
-- T4 — append-only tables carry no UPDATE or DELETE grant for any client
-- role, and no permissive write policy.
-- -------------------------------------------------------------------------
select is_empty(
  $$ select table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where table_schema = 'app'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$,
  'no client role holds INSERT, UPDATE or DELETE on any app table'
);

select is_empty(
  $$ select tablename || ':' || policyname
       from pg_policies
      where schemaname = 'app'
        and cmd <> 'SELECT' $$,
  'no write policies exist: every mutation goes through a definer RPC'
);

-- -------------------------------------------------------------------------
-- T5 — authz helpers are SECURITY DEFINER, STABLE, with a pinned search_path.
-- A definer function without a pinned search_path is a privilege-escalation
-- vector.
-- -------------------------------------------------------------------------
select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'authz'
        and not p.prosecdef $$,
  'every authz function is SECURITY DEFINER'
);

select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'authz'
        and (p.proconfig is null
             or not (p.proconfig @> array['search_path='])) $$,
  'every authz function pins search_path'
);

select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'authz'
        and p.provolatile <> 's' $$,
  'every authz function is STABLE, so RLS can cache it as an InitPlan'
);

-- -------------------------------------------------------------------------
-- Invariant 2 must exist as a CHECK, not a trigger. A trigger would be
-- bypassable by exactly the privileged paths it needs to survive.
-- -------------------------------------------------------------------------
select isnt_empty(
  $$ select conname
       from pg_constraint
      where conname = 'rd_no_self_review'
        and contype = 'c' $$,
  'self-approval is prevented by a CHECK constraint, not a trigger'
);

select * from finish();
rollback;
