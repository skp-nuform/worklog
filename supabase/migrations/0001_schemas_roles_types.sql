-- =========================================================================
-- 0001 — Schemas, types, and the privilege baseline.
--
-- Design: docs/data-model.md section 1-2.
--
-- Three schemas, three privilege tiers:
--   app     base tables. NOT exposed. anon and authenticated get nothing.
--   authz   SECURITY DEFINER STABLE helpers used inside RLS policies.
--           NOT exposed: a definer function in an exposed schema is callable
--           with elevated privileges through the Data API.
--   public  the ONLY exposed surface: security_invoker views + definer RPCs.
--
-- The PRD names the exposed schema `api`. PostgREST's exposed-schema list is
-- project configuration, so using `public` (already exposed) avoids a manual
-- dashboard step and a silent misconfiguration mode. What matters is
-- unchanged: base tables are unreachable from the Data API. Recorded as
-- docs/decisions.md D-21.
-- =========================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext   with schema extensions;

-- -------------------------------------------------------------------------
-- Schemas
-- -------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists authz;

comment on schema app   is 'Base tables. Not exposed via PostgREST.';
comment on schema authz is 'RLS helper functions. Not exposed via PostgREST.';

-- Nothing in app or authz is reachable by a client, ever. Policies and the
-- public API surface are the only paths in.
revoke all on schema app   from public;
revoke all on schema authz from public;
revoke all on schema public from public;

grant usage on schema app   to postgres, service_role;
grant usage on schema authz to postgres, service_role, authenticated;
grant usage on schema public to postgres, service_role, authenticated, anon;

-- authenticated needs EXECUTE on the authz helpers because RLS policies that
-- call them are evaluated as the caller. The helpers are definer, so they can
-- read membership rows the caller cannot select directly.
-- Grants on individual functions are issued in 0004 where they are defined.

-- Future tables in app must not silently acquire grants.
alter default privileges in schema app   revoke all on tables    from public;
alter default privileges in schema app   revoke all on sequences from public;
alter default privileges in schema app   revoke all on functions from public;
alter default privileges in schema authz revoke all on functions from public;

-- -------------------------------------------------------------------------
-- Enumerated types
-- -------------------------------------------------------------------------
create type app.workspace_role as enum ('owner', 'admin', 'member', 'guest');

create type app.member_status as enum ('active', 'invited', 'removed');

-- Capabilities are data, not code: adding a role is an INSERT, not a deploy.
create type app.project_capability as enum
  ('read', 'comment', 'submit', 'review', 'manage');

create type app.project_role as enum ('contributor', 'reviewer', 'viewer');

create type app.brand_kind as enum ('brand');

-- Work lifecycle. Ideas share the base record but use idea-specific states,
-- so one enum covers both and an idea can never be 'approved'.
create type app.work_kind as enum ('work', 'idea');

create type app.work_status as enum (
  -- work
  'planned', 'in_progress', 'submitted', 'approved',
  'blocked', 'paused', 'cancelled',
  -- idea
  'captured', 'shelved'
);

create type app.request_source as enum (
  'verbal', 'meeting', 'chat', 'email', 'ticket', 'self', 'other'
);

create type app.priority as enum ('low', 'normal', 'high', 'urgent');

create type app.submission_status as enum ('submitted', 'withdrawn');

-- 'rejected' is deliberately absent: the PRD's only negative decision is
-- "request changes", which returns the item to In progress.
create type app.review_kind as enum ('approved', 'changes_requested');

-- 'internal' never reaches a guest projection. 'client' is scoped to one
-- share grant.
create type app.comment_visibility as enum ('internal', 'client');

create type app.ack_decision as enum ('confirmed', 'disputed');

create type app.artifact_kind as enum ('link', 'file');

create type app.artifact_state as enum
  ('pending', 'uploading', 'processing', 'ready', 'failed', 'cancelled');

create type app.share_mode as enum ('invited', 'unlisted');

-- -------------------------------------------------------------------------
-- Domains
-- -------------------------------------------------------------------------
create domain app.short_text as text
  check (length(value) between 1 and 300);

create domain app.title_text as text
  check (length(btrim(value)) between 3 and 180);

-- -------------------------------------------------------------------------
-- Shared trigger helpers
-- -------------------------------------------------------------------------

-- Append-only guard. Attached to UPDATE and/or DELETE on tables that must
-- never be rewritten. P0410 is this codebase's "immutable row" signal.
create or replace function app.raise_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    '% is append-only (attempted % on %)',
    tg_table_name, tg_op, coalesce(old.id::text, 'unknown')
    using errcode = 'P0410';
end;
$$;

comment on function app.raise_append_only() is
  'Rejects UPDATE/DELETE on append-only tables. Raises P0410.';

-- Stamps trusted creation metadata. Belt and braces: the columns are also
-- absent from every client GRANT, so a client cannot even name them. This
-- covers the definer-RPC paths where column grants do not apply.
create or replace function app.stamp_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- now() is the transaction timestamp, so a state change and its activity
  -- event share one instant. Never clock_timestamp().
  new.created_at := now();
  new.created_by := coalesce(auth.uid(), new.created_by);
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
  end if;
  return new;
end;
$$;

comment on function app.stamp_insert() is
  'Forces created_at/created_by from trusted context, ignoring the payload.';

-- Enforces the expected_version discipline. The CAS predicate in the RPC is
-- the actual concurrency control; this catches any path that forgets to bump
-- or tries to set version arbitrarily. P0409 is this codebase's conflict.
create or replace function app.enforce_version_bump()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.version is distinct from old.version + 1 then
    raise exception
      'version must increment by exactly one (had %, got %)',
      old.version, new.version
      using errcode = 'P0409';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  -- Creation facts are immutable.
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

comment on function app.enforce_version_bump() is
  'Requires version = old.version + 1 and re-stamps updated_*. Raises P0409.';
