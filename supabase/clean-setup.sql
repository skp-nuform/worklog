-- =========================================================================
-- Clean Setup for Worklog Visual Work Sheet
--
-- Contains ONLY the tables, views, RLS policies, and RPCs actively used
-- by the current day-by-day work tracker.
-- =========================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext   with schema extensions;

-- -------------------------------------------------------------------------
-- Schemas
-- -------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists authz;

revoke all on schema app   from public;
revoke all on schema authz from public;
revoke all on schema public from public;

grant usage on schema app   to postgres, service_role;
grant usage on schema authz to postgres, service_role, authenticated;
grant usage on schema public to postgres, service_role, authenticated, anon;

alter default privileges in schema app   revoke all on tables    from public;
alter default privileges in schema app   revoke all on sequences from public;
alter default privileges in schema app   revoke all on functions from public;
alter default privileges in schema authz revoke all on functions from public;

-- -------------------------------------------------------------------------
-- Domains & Enums
-- -------------------------------------------------------------------------
create domain app.short_text as text
  check (length(value) between 1 and 300);

create domain app.title_text as text
  check (length(btrim(value)) between 3 and 180);

create type app.workspace_role as enum ('owner', 'admin', 'member', 'guest');
create type app.member_status as enum ('active', 'invited', 'removed');
create type app.asset_kind as enum ('link', 'image', 'video', 'file');
create type app.link_provider as enum (
  'figma', 'github', 'youtube', 'vimeo', 'loom', 'drive', 'notion',
  'dribbble', 'behance', 'codepen', 'website', 'other'
);

-- -------------------------------------------------------------------------
-- Shared Trigger Helpers
-- -------------------------------------------------------------------------
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

create or replace function app.stamp_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.created_at := now();
  new.created_by := coalesce(auth.uid(), new.created_by);
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
  end if;
  return new;
end;
$$;

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
  return new;
end;
$$;

-- -------------------------------------------------------------------------
-- Base Tables
-- -------------------------------------------------------------------------

-- profiles
create table app.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  app.short_text not null,
  email         extensions.citext not null,
  timezone      text not null default 'Asia/Kolkata',
  theme         text not null default 'system'
                  check (theme in ('light', 'dark', 'system')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- workspaces
create table app.workspaces (
  id           uuid primary key default extensions.gen_random_uuid(),
  slug         extensions.citext not null unique,
  name         app.short_text not null,
  owner_id     uuid not null references app.profiles(id) on delete restrict,
  next_work_no integer not null default 1 check (next_work_no >= 1),
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid not null default auth.uid(),
  version      integer not null default 1 check (version >= 1)
);

-- workspace_members
create table app.workspace_members (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  user_id      uuid not null references app.profiles(id) on delete cascade,
  role         app.workspace_role not null default 'member',
  status       app.member_status  not null default 'active',
  invited_at   timestamptz not null default now(),
  joined_at    timestamptz,
  removed_at   timestamptz,

  primary key (workspace_id, user_id),
  constraint wm_ws_user_uniq unique (workspace_id, user_id),
  constraint wm_status_chk check (
        (status = 'active'  and joined_at is not null and removed_at is null)
     or (status = 'invited' and joined_at is null     and removed_at is null)
     or (status = 'removed' and removed_at is not null)
  )
);

-- brands
create table app.brands (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  name         app.short_text not null,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid not null default auth.uid(),
  version      integer not null default 1 check (version >= 1),

  primary key (id),
  constraint brands_id_ws_uniq unique (id, workspace_id),
  constraint brands_name_uniq  unique (workspace_id, name)
);

-- projects
create table app.projects (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  brand_id     uuid,
  name         app.short_text not null,
  brief        text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid not null default auth.uid(),
  version      integer not null default 1 check (version >= 1),

  primary key (id),
  constraint projects_id_ws_uniq unique (id, workspace_id),
  constraint projects_brand_fk
    foreign key (brand_id, workspace_id)
    references app.brands(id, workspace_id)
    on update restrict on delete restrict
);

-- activity_events
create table app.activity_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references app.workspaces(id) on delete cascade,
  actor_id      uuid,
  event_type    text not null check (length(event_type) between 3 and 80),
  work_item_id  uuid,
  project_id    uuid,
  submission_id uuid,
  resource_kind text,
  resource_id   uuid,
  payload       jsonb not null default '{}'::jsonb,
  redacted_at   timestamptz,
  created_at    timestamptz not null default now()
);

create trigger activity_no_update
  before update on app.activity_events
  for each row execute function app.raise_append_only();

create trigger activity_no_delete
  before delete on app.activity_events
  for each row execute function app.raise_append_only();

-- idempotency_keys
create table app.idempotency_keys (
  actor_id       uuid not null,
  action         text not null,
  request_key    text not null,
  payload_digest bytea not null,
  result         jsonb,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',

  primary key (actor_id, action, request_key)
);

create index idempotency_expiry_idx
  on app.idempotency_keys (expires_at);

-- entries
create table app.entries (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  author_id    uuid not null default auth.uid()
                 references app.profiles(id) on delete restrict,

  work_date    date not null,
  title        app.title_text not null,
  note         text,
  tags         text[] not null default '{}',

  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1 check (version >= 1),

  primary key (id),
  constraint entries_id_ws_uniq unique (id, workspace_id),

  constraint entries_author_fk
    foreign key (workspace_id, author_id)
    references app.workspace_members(workspace_id, user_id)
    on update restrict on delete restrict,

  constraint entries_not_future
    check (work_date <= ((now() at time zone 'utc')::date + 1))
);

-- entry_assets
create table app.entry_assets (
  id           uuid not null default extensions.gen_random_uuid(),
  entry_id     uuid not null,
  workspace_id uuid not null,
  kind         app.asset_kind not null,

  url      text,
  provider app.link_provider,

  object_path text,
  mime_type   text,
  byte_size   bigint check (byte_size is null or byte_size > 0),
  width       integer check (width  is null or width  > 0),
  height      integer check (height is null or height > 0),

  label     text,
  position  integer not null default 1 check (position >= 1),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),

  primary key (id),
  constraint entry_assets_id_ws_uniq unique (id, workspace_id),

  constraint entry_assets_entry_fk
    foreign key (entry_id, workspace_id)
    references app.entries(id, workspace_id)
    on update restrict on delete cascade,

  constraint entry_assets_shape_chk check (
    (kind = 'link'  and url is not null and object_path is null)
    or
    (kind <> 'link' and object_path is not null and url is null)
  ),

  constraint entry_assets_url_scheme_chk
    check (url is null or url ~* '^https?://')
);

create index entry_assets_entry_idx
  on app.entry_assets (entry_id, position);

-- share_links
create table app.share_links (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  token_hash   bytea not null unique,
  created_by   uuid not null default auth.uid()
                 references app.profiles(id) on delete restrict,

  label text,
  author_id uuid references app.profiles(id) on delete cascade,
  from_date date,
  to_date   date,

  allow_download boolean not null default true,

  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  view_count     integer not null default 0,

  primary key (id),
  constraint share_links_window_chk
    check (from_date is null or to_date is null or from_date <= to_date)
);

create index share_links_ws_idx on app.share_links (workspace_id, created_at desc);

create index entries_ws_date_idx
  on app.entries (workspace_id, work_date desc)
  where archived_at is null;

create index entries_author_date_idx
  on app.entries (workspace_id, author_id, work_date desc)
  where archived_at is null;

create index entries_tags_idx
  on app.entries using gin (tags);

-- -------------------------------------------------------------------------
-- Internal App Functions
-- -------------------------------------------------------------------------

create or replace function app.emit_event(
  p_workspace     uuid,
  p_event_type    text,
  p_work_item     uuid default null,
  p_project       uuid default null,
  p_submission    uuid default null,
  p_resource_kind text default null,
  p_resource_id   uuid default null,
  p_payload       jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into app.activity_events (
    workspace_id, actor_id, event_type,
    work_item_id, project_id, submission_id,
    resource_kind, resource_id, payload
  ) values (
    p_workspace, auth.uid(), p_event_type,
    p_work_item, p_project, p_submission,
    p_resource_kind, p_resource_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.claim_idempotency(
  p_action text,
  p_key    text,
  p_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing app.idempotency_keys;
begin
  insert into app.idempotency_keys (actor_id, action, request_key, payload_digest)
  values (auth.uid(), p_action, p_key, p_digest)
  on conflict (actor_id, action, request_key) do nothing;

  if found then
    return null;
  end if;

  select * into v_existing
    from app.idempotency_keys
   where actor_id = auth.uid()
     and action = p_action
     and request_key = p_key;

  if v_existing.payload_digest is distinct from p_digest then
    raise exception
      'idempotency key reused with a different payload'
      using errcode = 'P0409';
  end if;

  return coalesce(v_existing.result, '{"status":"in_flight"}'::jsonb);
end;
$$;

create or replace function app.record_idempotency(
  p_action text,
  p_key    text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.idempotency_keys
     set result = p_result
   where actor_id = auth.uid()
     and action = p_action
     and request_key = p_key;
$$;

-- Profile sync trigger on auth.users
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Backfill profiles for existing auth.users
insert into app.profiles (id, display_name, email)
select id,
       coalesce(
         nullif(btrim(raw_user_meta_data->>'display_name'), ''),
         split_part(email, '@', 1),
         'User'
       ),
       email
  from auth.users
on conflict (id) do nothing;

-- -------------------------------------------------------------------------
-- Authz Functions
-- -------------------------------------------------------------------------

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

grant execute on function authz.my_workspaces()       to authenticated;
grant execute on function authz.my_admin_workspaces() to authenticated;
grant execute on function authz.shares_workspace_with(uuid) to authenticated;

revoke all on function authz.my_workspaces()       from anon;
revoke all on function authz.my_admin_workspaces() from anon;
revoke all on function authz.shares_workspace_with(uuid) from anon;

-- -------------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------------

alter table app.profiles          enable row level security;
alter table app.workspaces        enable row level security;
alter table app.workspace_members enable row level security;
alter table app.brands            enable row level security;
alter table app.projects          enable row level security;
alter table app.activity_events   enable row level security;
alter table app.idempotency_keys  enable row level security;
alter table app.entries           enable row level security;
alter table app.entry_assets      enable row level security;
alter table app.share_links       enable row level security;

alter table app.activity_events  force row level security;
alter table app.idempotency_keys force row level security;

grant select on app.profiles          to authenticated;
grant select on app.workspaces        to authenticated;
grant select on app.workspace_members to authenticated;
grant select on app.brands            to authenticated;
grant select on app.projects          to authenticated;
grant select on app.activity_events   to authenticated;
grant select on app.entries           to authenticated;
grant select on app.entry_assets      to authenticated;
grant select on app.share_links       to authenticated;

create policy profiles_select on app.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select authz.shares_workspace_with(app.profiles.id))
  );

create policy workspaces_select on app.workspaces
  for select to authenticated
  using (id in (select authz.my_workspaces()));

create policy workspace_members_select on app.workspace_members
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy brands_select on app.brands
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy projects_select on app.projects
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy entries_select on app.entries
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy entry_assets_select on app.entry_assets
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy share_links_select on app.share_links
  for select to authenticated
  using (
    workspace_id in (select authz.my_workspaces())
    and (
      created_by = (select auth.uid())
      or workspace_id in (select authz.my_admin_workspaces())
    )
  );

-- Storage policies for work-assets
drop policy if exists work_assets_read on storage.objects;
create policy work_assets_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-assets'
    and (storage.foldername(name))[1]::uuid in (select authz.my_workspaces())
  );

drop policy if exists work_assets_insert on storage.objects;
create policy work_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-assets'
    and (storage.foldername(name))[1]::uuid in (select authz.my_workspaces())
    and owner_id = (select auth.uid()::text)
  );

drop policy if exists work_assets_delete on storage.objects;
create policy work_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'work-assets'
    and owner_id = (select auth.uid()::text)
  );

-- -------------------------------------------------------------------------
-- Public Views
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

create view public.entries
with (security_invoker = on) as
  select e.id,
         e.workspace_id,
         e.author_id,
         e.work_date,
         e.title,
         e.note,
         e.tags,
         e.archived_at,
         e.created_at,
         e.updated_at,
         e.version,
         p.display_name as author_name,
         p.email        as author_email,
         (select count(*) from app.entry_assets a where a.entry_id = e.id)
           as asset_count
    from app.entries e
    left join app.profiles p on p.id = e.author_id;

create view public.entry_assets
with (security_invoker = on) as
  select a.id, a.entry_id, a.workspace_id, a.kind, a.url, a.provider,
         a.object_path, a.mime_type, a.byte_size, a.width, a.height,
         a.label, a.position, a.created_at
    from app.entry_assets a;

create view public.share_links
with (security_invoker = on) as
  select s.id, s.workspace_id, s.label, s.author_id, s.from_date, s.to_date,
         s.allow_download, s.expires_at, s.revoked_at, s.created_at,
         s.last_viewed_at, s.view_count,
         (s.revoked_at is null
          and (s.expires_at is null or s.expires_at > now())) as is_active
    from app.share_links s;

grant select on public.my_profile       to authenticated;
grant select on public.my_workspaces    to authenticated;
grant select on public.brands           to authenticated;
grant select on public.projects         to authenticated;
grant select on public.workspace_people to authenticated;
grant select on public.entries          to authenticated;
grant select on public.entry_assets     to authenticated;
grant select on public.share_links      to authenticated;

-- -------------------------------------------------------------------------
-- Public RPCs
-- -------------------------------------------------------------------------

-- bootstrap_workspace
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

  -- Ensure profile row exists
  insert into app.profiles (id, display_name, email, timezone)
  select v_uid,
         coalesce(nullif(btrim(p_display_name), ''), split_part(u.email, '@', 1), 'User'),
         u.email,
         coalesce(p_timezone, 'Asia/Kolkata')
    from auth.users u
   where u.id = v_uid
  on conflict (id) do update
    set display_name = coalesce(nullif(btrim(p_display_name), ''), app.profiles.display_name),
        timezone = coalesce(p_timezone, app.profiles.timezone),
        updated_at = now();

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

-- create_entry
create or replace function public.create_entry(
  p_workspace uuid,
  p_title     text,
  p_work_date date default null,
  p_note      text default null,
  p_tags      text[] default '{}',
  p_assets    jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_entry  uuid;
  v_asset  jsonb;
  v_pos    integer := 0;
  v_replay jsonb;
  v_digest bytea;
  v_date   date;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  if not exists (
    select 1 from app.workspace_members
     where workspace_id = p_workspace and user_id = v_uid and status = 'active'
  ) then
    raise exception 'not a member of this workspace' using errcode = 'P0403';
  end if;

  v_date := coalesce(p_work_date, (now() at time zone 'utc')::date);

  if p_idempotency_key is not null then
    v_digest := extensions.digest(
      coalesce(p_title, '') || '|' || v_date::text || '|' ||
      coalesce(p_assets::text, ''), 'sha256');
    v_replay := app.claim_idempotency('create_entry', p_idempotency_key, v_digest);
    if v_replay is not null then
      return nullif(v_replay->>'entry_id', '')::uuid;
    end if;
  end if;

  insert into app.entries (workspace_id, author_id, work_date, title, note, tags)
  values (p_workspace, v_uid, v_date, p_title, p_note, coalesce(p_tags, '{}'))
  returning id into v_entry;

  for v_asset in select * from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb))
  loop
    v_pos := v_pos + 1;
    insert into app.entry_assets (
      entry_id, workspace_id, kind, url, provider, object_path,
      mime_type, byte_size, width, height, label, position, created_by
    ) values (
      v_entry, p_workspace,
      (v_asset->>'kind')::app.asset_kind,
      nullif(v_asset->>'url', ''),
      nullif(v_asset->>'provider', '')::app.link_provider,
      nullif(v_asset->>'object_path', ''),
      nullif(v_asset->>'mime_type', ''),
      nullif(v_asset->>'byte_size', '')::bigint,
      nullif(v_asset->>'width', '')::integer,
      nullif(v_asset->>'height', '')::integer,
      nullif(v_asset->>'label', ''),
      v_pos, v_uid
    );
  end loop;

  perform app.emit_event(
    p_workspace, 'entry.created', null, null, null, 'entry', v_entry,
    jsonb_build_object('title', p_title, 'work_date', v_date,
                       'assets', jsonb_array_length(coalesce(p_assets, '[]'::jsonb)))
  );

  if p_idempotency_key is not null then
    perform app.record_idempotency('create_entry', p_idempotency_key,
                                   jsonb_build_object('entry_id', v_entry));
  end if;

  return v_entry;
end;
$$;

-- update_entry
create or replace function public.update_entry(
  p_entry            uuid,
  p_expected_version integer,
  p_title            text default null,
  p_note             text default null,
  p_work_date        date default null,
  p_tags             text[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_e   app.entries;
  v_new integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  select * into v_e from app.entries where id = p_entry;
  if v_e.id is null
     or v_e.workspace_id not in (select authz.my_workspaces()) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  if v_e.author_id <> v_uid
     and v_e.workspace_id not in (select authz.my_admin_workspaces()) then
    raise exception 'only the author can edit this entry' using errcode = 'P0403';
  end if;

  update app.entries
     set title     = coalesce(p_title, title),
         note      = coalesce(p_note, note),
         work_date = coalesce(p_work_date, work_date),
         tags      = coalesce(p_tags, tags),
         updated_at = now(),
         version   = version + 1
   where id = p_entry and version = p_expected_version
  returning version into v_new;

  if v_new is null then
    raise exception 'version_conflict' using errcode = 'P0409';
  end if;

  perform app.emit_event(v_e.workspace_id, 'entry.updated', null, null, null,
                         'entry', p_entry, '{}'::jsonb);
  return v_new;
end;
$$;

-- add_entry_asset
create or replace function public.add_entry_asset(
  p_entry       uuid,
  p_kind        text,
  p_url         text default null,
  p_provider    text default null,
  p_object_path text default null,
  p_mime_type   text default null,
  p_byte_size   bigint default null,
  p_width       integer default null,
  p_height      integer default null,
  p_label       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_e   app.entries;
  v_id  uuid;
  v_pos integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  select * into v_e from app.entries where id = p_entry;
  if v_e.id is null
     or v_e.workspace_id not in (select authz.my_workspaces()) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  if v_e.author_id <> v_uid then
    raise exception 'only the author can attach to this entry'
      using errcode = 'P0403';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
    from app.entry_assets where entry_id = p_entry;

  insert into app.entry_assets (
    entry_id, workspace_id, kind, url, provider, object_path, mime_type,
    byte_size, width, height, label, position, created_by
  ) values (
    p_entry, v_e.workspace_id, p_kind::app.asset_kind,
    nullif(p_url, ''), nullif(p_provider, '')::app.link_provider,
    nullif(p_object_path, ''), nullif(p_mime_type, ''),
    p_byte_size, p_width, p_height, nullif(p_label, ''), v_pos, v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- delete_entry_asset
create or replace function public.delete_entry_asset(p_asset uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a   app.entry_assets;
  v_e   app.entries;
begin
  select * into v_a from app.entry_assets where id = p_asset;
  if v_a.id is null
     or v_a.workspace_id not in (select authz.my_workspaces()) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;
  select * into v_e from app.entries where id = v_a.entry_id;
  if v_e.author_id <> v_uid then
    raise exception 'only the author can remove this' using errcode = 'P0403';
  end if;
  delete from app.entry_assets where id = p_asset;
end;
$$;

-- delete_entry
create or replace function public.delete_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_e   app.entries;
begin
  select * into v_e from app.entries where id = p_entry;
  if v_e.id is null
     or v_e.workspace_id not in (select authz.my_workspaces()) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;
  if v_e.author_id <> v_uid
     and v_e.workspace_id not in (select authz.my_admin_workspaces()) then
    raise exception 'only the author can delete this entry' using errcode = 'P0403';
  end if;

  perform app.emit_event(v_e.workspace_id, 'entry.deleted', null, null, null,
                         'entry', p_entry,
                         jsonb_build_object('title', v_e.title,
                                            'work_date', v_e.work_date));
  delete from app.entries where id = p_entry;
end;
$$;

-- reorder_entry_assets
create or replace function public.reorder_entry_assets(
  p_entry     uuid,
  p_asset_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_e   app.entries;
  v_id  uuid;
  v_pos integer := 1;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;

  select * into v_e from app.entries where id = p_entry;
  if v_e.id is null
     or v_e.workspace_id not in (select authz.my_workspaces()) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;

  if v_e.author_id <> v_uid
     and v_e.workspace_id not in (select authz.my_admin_workspaces()) then
    raise exception 'only the author can reorder assets' using errcode = 'P0403';
  end if;

  foreach v_id in array p_asset_ids
  loop
    update app.entry_assets
       set position = v_pos
     where id = v_id and entry_id = p_entry;
    v_pos := v_pos + 1;
  end loop;
end;
$$;

-- create_share_link
create or replace function public.create_share_link(
  p_workspace      uuid,
  p_token_hash     bytea,
  p_label          text default null,
  p_author_id      uuid default null,
  p_from_date      date default null,
  p_to_date        date default null,
  p_allow_download boolean default true,
  p_expires_at     timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0401';
  end if;
  if not exists (
    select 1 from app.workspace_members
     where workspace_id = p_workspace and user_id = v_uid and status = 'active'
  ) then
    raise exception 'not a member of this workspace' using errcode = 'P0403';
  end if;
  if octet_length(p_token_hash) < 32 then
    raise exception 'token hash too short' using errcode = 'P0400';
  end if;

  insert into app.share_links (
    workspace_id, token_hash, created_by, label, author_id,
    from_date, to_date, allow_download, expires_at
  ) values (
    p_workspace, p_token_hash, v_uid, nullif(p_label, ''), p_author_id,
    p_from_date, p_to_date, coalesce(p_allow_download, true), p_expires_at
  )
  returning id into v_id;

  perform app.emit_event(p_workspace, 'share.created', null, null, null,
                         'share_link', v_id,
                         jsonb_build_object('label', p_label,
                                            'scoped_to_author', p_author_id is not null));
  return v_id;
end;
$$;

-- revoke_share_link
create or replace function public.revoke_share_link(p_share uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s   app.share_links;
begin
  select * into v_s from app.share_links where id = p_share;
  if v_s.id is null
     or v_s.workspace_id not in (select authz.my_workspaces()) then
    raise exception 'not_found' using errcode = 'P0404';
  end if;
  if v_s.created_by <> v_uid
     and v_s.workspace_id not in (select authz.my_admin_workspaces()) then
    raise exception 'not permitted' using errcode = 'P0403';
  end if;

  update app.share_links set revoked_at = now()
   where id = p_share and revoked_at is null;

  perform app.emit_event(v_s.workspace_id, 'share.revoked', null, null, null,
                         'share_link', p_share, '{}'::jsonb);
end;
$$;

-- read_shared_sheet
create or replace function public.read_shared_sheet(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s   app.share_links;
  v_doc jsonb;
begin
  select * into v_s from app.share_links
   where token_hash = p_token_hash
     and revoked_at is null
     and (expires_at is null or expires_at > now());

  if v_s.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'label', v_s.label,
    'allow_download', v_s.allow_download,
    'expires_at', v_s.expires_at,
    'scope', jsonb_build_object(
      'from_date', v_s.from_date,
      'to_date', v_s.to_date,
      'single_author', v_s.author_id is not null
    ),
    'people', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
               'id', p.id, 'name', p.display_name))
        from app.entries e
        join app.profiles p on p.id = e.author_id
       where e.workspace_id = v_s.workspace_id
         and e.archived_at is null
         and (v_s.author_id is null or e.author_id = v_s.author_id)
         and (v_s.from_date is null or e.work_date >= v_s.from_date)
         and (v_s.to_date   is null or e.work_date <= v_s.to_date)
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(day order by day->>'work_date' desc)
        from (
          select jsonb_build_object(
                   'work_date', e.work_date,
                   'entries', jsonb_agg(
                     jsonb_build_object(
                       'id', e.id,
                       'title', e.title,
                       'note', e.note,
                       'tags', e.tags,
                       'author_name', p.display_name,
                       'author_id', e.author_id,
                       'assets', coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', a.id,
                                  'kind', a.kind,
                                  'url', a.url,
                                  'provider', a.provider,
                                  'label', a.label,
                                  'mime_type', a.mime_type,
                                  'byte_size', a.byte_size,
                                  'width', a.width,
                                  'height', a.height,
                                  'has_file', a.object_path is not null
                                ) order by a.position)
                            from app.entry_assets a where a.entry_id = e.id
                        ), '[]'::jsonb)
                      ) order by e.created_at
                    )
                  ) as day
             from app.entries e
             join app.profiles p on p.id = e.author_id
            where e.workspace_id = v_s.workspace_id
              and e.archived_at is null
              and (v_s.author_id is null or e.author_id = v_s.author_id)
              and (v_s.from_date is null or e.work_date >= v_s.from_date)
              and (v_s.to_date   is null or e.work_date <= v_s.to_date)
            group by e.work_date
        ) grouped
    ), '[]'::jsonb)
  ) into v_doc;

  update app.share_links
     set last_viewed_at = now(), view_count = view_count + 1
   where id = v_s.id;

  return v_doc;
end;
$$;

-- resolve_shared_asset
create or replace function public.resolve_shared_asset(
  p_token_hash bytea,
  p_asset      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s app.share_links;
  v_r jsonb;
begin
  select * into v_s from app.share_links
   where token_hash = p_token_hash
     and revoked_at is null
     and (expires_at is null or expires_at > now());
  if v_s.id is null then return null; end if;

  select jsonb_build_object(
           'object_path', a.object_path,
           'mime_type', a.mime_type,
           'byte_size', a.byte_size,
           'label', a.label,
           'allow_download', v_s.allow_download
         ) into v_r
    from app.entry_assets a
    join app.entries e on e.id = a.entry_id
   where a.id = p_asset
     and a.object_path is not null
     and e.workspace_id = v_s.workspace_id
     and e.archived_at is null
     and (v_s.author_id is null or e.author_id = v_s.author_id)
     and (v_s.from_date is null or e.work_date >= v_s.from_date)
     and (v_s.to_date   is null or e.work_date <= v_s.to_date);

  return v_r;
end;
$$;

-- -------------------------------------------------------------------------
-- Grants on RPCs
-- -------------------------------------------------------------------------
grant execute on function public.bootstrap_workspace(text, text, text[], text) to authenticated;
revoke all on function public.bootstrap_workspace(text, text, text[], text) from anon;

grant execute on function public.create_entry(uuid, text, date, text, text[], jsonb, text) to authenticated;
grant execute on function public.update_entry(uuid, integer, text, text, date, text[]) to authenticated;
grant execute on function public.add_entry_asset(uuid, text, text, text, text, text, bigint, integer, integer, text) to authenticated;
grant execute on function public.delete_entry_asset(uuid) to authenticated;
grant execute on function public.delete_entry(uuid) to authenticated;
grant execute on function public.reorder_entry_assets(uuid, uuid[]) to authenticated;
grant execute on function public.create_share_link(uuid, bytea, text, uuid, date, date, boolean, timestamptz) to authenticated;
grant execute on function public.revoke_share_link(uuid) to authenticated;

grant execute on function public.read_shared_sheet(bytea) to anon, authenticated;
grant execute on function public.resolve_shared_asset(bytea, uuid) to anon, authenticated;

commit;
