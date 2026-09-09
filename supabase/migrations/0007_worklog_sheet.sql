-- =========================================================================
-- 0007 — The work sheet: what was done, on which day, with the proof.
--
-- This is the product the user actually asked for: a day-by-day visual log
-- of work, with Figma/site/video links and pasted screenshots, shareable by
-- link so a manager can view, interact and download.
--
-- It deliberately does NOT use the approval/review/revision machinery from
-- 0002-0006. Those tables stay in place (inert, no UI references) rather
-- than being dropped, since dropping is destructive and the governance model
-- may be wanted later. See docs/decisions.md D-25.
--
-- What carries over, because it was right: workspaces, members, live-read
-- RLS, definer RPCs for writes, tenant pinning by composite FK, and the
-- append-only audit trail.
-- =========================================================================

create type app.asset_kind as enum ('link', 'image', 'video', 'file');

-- Providers get a real icon and embed treatment. 'website' is the catch-all
-- that still renders a proper card; 'other' means we know nothing about it.
create type app.link_provider as enum (
  'figma', 'github', 'youtube', 'vimeo', 'loom', 'drive', 'notion',
  'dribbble', 'behance', 'codepen', 'website', 'other'
);

-- -------------------------------------------------------------------------
-- entries — one thing done, on one day
--
-- work_date is a DATE, not a timestamp: "what I did on Tuesday" is a
-- calendar fact in the author's own timezone, and storing it as an instant
-- would shift it across zones. created_at separately records when it was
-- logged, so a backfilled entry stays honest.
-- -------------------------------------------------------------------------
create table app.entries (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  author_id    uuid not null default auth.uid()
                 references app.profiles(id) on delete restrict,

  work_date    date not null,
  title        app.title_text not null,
  note         text,
  -- Free-form tags for filtering. Kept as text[] rather than a join table:
  -- this is a personal log, not a taxonomy.
  tags         text[] not null default '{}',

  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1 check (version >= 1),

  primary key (id),
  constraint entries_id_ws_uniq unique (id, workspace_id),

  -- The author must be an active member of this workspace.
  constraint entries_author_fk
    foreign key (workspace_id, author_id)
    references app.workspace_members(workspace_id, user_id)
    on update restrict on delete restrict,

  -- A log entry cannot be dated in the future: it records work already done.
  -- One day of slack absorbs timezone differences either side of UTC.
  constraint entries_not_future
    check (work_date <= ((now() at time zone 'utc')::date + 1))
);

comment on column app.entries.work_date is
  'The calendar day the work belongs to, in the author''s timezone. Not an instant.';

-- -------------------------------------------------------------------------
-- entry_assets — the proof
--
-- A link and an upload are the same idea from the reader's point of view:
-- something to look at. One table, discriminated by kind, with a CHECK that
-- keeps each shape honest.
-- -------------------------------------------------------------------------
create table app.entry_assets (
  id           uuid not null default extensions.gen_random_uuid(),
  entry_id     uuid not null,
  workspace_id uuid not null,
  kind         app.asset_kind not null,

  -- Links
  url      text,
  provider app.link_provider,

  -- Uploads. object_path is the key in the private `work-assets` bucket.
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

  -- A link has a URL and no object; an upload has an object and no URL.
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

-- -------------------------------------------------------------------------
-- share_links — read-only public access to a slice of the sheet
--
-- Only the peppered hash is stored, so a database dump cannot resolve or
-- forge a link. Scope is explicit: one author or the whole workspace, and
-- optionally a date window.
-- -------------------------------------------------------------------------
create table app.share_links (
  id           uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  token_hash   bytea not null unique,
  created_by   uuid not null default auth.uid()
                 references app.profiles(id) on delete restrict,

  label text,

  -- null author_id means the whole team's sheet.
  author_id uuid references app.profiles(id) on delete cascade,
  from_date date,
  to_date   date,

  allow_download boolean not null default true,

  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- Purely informational; never shown to a guest.
  last_viewed_at timestamptz,
  view_count     integer not null default 0,

  primary key (id),
  constraint share_links_window_chk
    check (from_date is null or to_date is null or from_date <= to_date)
);

create index share_links_ws_idx on app.share_links (workspace_id, created_at desc);

-- -------------------------------------------------------------------------
-- Storage: one private bucket. Images are never world-readable by object
-- URL; a guest reads them through a server route that checks the share.
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-assets', 'work-assets', false,
  26214400, -- 25 MB, matching the PRD default
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object keys are `<workspace_id>/<entry_id>/<random>.<ext>`, so the first
-- path segment is the tenant and membership can be checked from it.
create policy work_assets_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-assets'
    and (storage.foldername(name))[1]::uuid in (select authz.my_workspaces())
  );

create policy work_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-assets'
    and (storage.foldername(name))[1]::uuid in (select authz.my_workspaces())
    and owner_id = (select auth.uid()::text)
  );

-- Authors may remove their own uploads. No UPDATE policy: a replacement is a
-- new object, never an overwrite of one already referenced.
create policy work_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'work-assets'
    and owner_id = (select auth.uid()::text)
  );

-- -------------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------------
alter table app.entries      enable row level security;
alter table app.entry_assets enable row level security;
alter table app.share_links  enable row level security;

grant select on app.entries      to authenticated;
grant select on app.entry_assets to authenticated;
grant select on app.share_links  to authenticated;

-- Everyone in the workspace can see the whole team's sheet: that is the
-- point of a shared tracker. Writing is still author-only, enforced in the
-- RPCs below.
create policy entries_select on app.entries
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

create policy entry_assets_select on app.entry_assets
  for select to authenticated
  using (workspace_id in (select authz.my_workspaces()));

-- Share links are visible to the person who made them and to workspace
-- admins, who are responsible for publication policy.
create policy share_links_select on app.share_links
  for select to authenticated
  using (
    workspace_id in (select authz.my_workspaces())
    and (
      created_by = (select auth.uid())
      or workspace_id in (select authz.my_admin_workspaces())
    )
  );

-- =========================================================================
-- Views
-- =========================================================================

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

grant select on public.entries      to authenticated;
grant select on public.entry_assets to authenticated;
grant select on public.share_links  to authenticated;

-- =========================================================================
-- RPCs
-- =========================================================================

-- -------------------------------------------------------------------------
-- Create an entry, optionally with its assets in the same transaction, so a
-- pasted screenshot and its entry can never end up half-saved.
--
-- p_assets is a JSON array of
--   {kind, url?, provider?, object_path?, mime_type?, byte_size?,
--    width?, height?, label?}
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- Edit an entry. Author only, with the expected_version discipline.
-- -------------------------------------------------------------------------
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
  -- Not visible and not existing are the same answer: no existence oracle.
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

-- -------------------------------------------------------------------------
-- Attach an asset to an existing entry (used after a direct upload).
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- Publish a share link. The RAW token never reaches the database: the app
-- generates it, HMACs it with a pepper held outside the database, and stores
-- only the hash.
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- Read a shared sheet. Callable by `anon`, because that is the whole point
-- of a link — but it takes a HASH, so possession of the raw token is the
-- only way in, and it returns an explicit projection rather than table rows.
--
-- Wrong, revoked and expired tokens all return NULL, indistinguishably.
-- -------------------------------------------------------------------------
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
    return null;  -- wrong, revoked or expired: all the same answer
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
                                  -- object_path is deliberately withheld:
                                  -- a guest fetches bytes through the
                                  -- server route by asset id only.
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

-- Resolve one shared asset for the byte-streaming route. Returns the object
-- path only if the share is live and actually covers that asset.
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

  return v_r;  -- null when the share does not cover this asset
end;
$$;

-- -------------------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------------------
grant execute on function public.create_entry(uuid, text, date, text, text[], jsonb, text) to authenticated;
grant execute on function public.update_entry(uuid, integer, text, text, date, text[]) to authenticated;
grant execute on function public.add_entry_asset(uuid, text, text, text, text, text, bigint, integer, integer, text) to authenticated;
grant execute on function public.delete_entry_asset(uuid) to authenticated;
grant execute on function public.delete_entry(uuid) to authenticated;
grant execute on function public.create_share_link(uuid, bytea, text, uuid, date, date, boolean, timestamptz) to authenticated;
grant execute on function public.revoke_share_link(uuid) to authenticated;

-- The share readers are the only functions `anon` may call, and both require
-- a 256-bit token hash.
grant execute on function public.read_shared_sheet(bytea) to anon, authenticated;
grant execute on function public.resolve_shared_asset(bytea, uuid) to anon, authenticated;

-- Indexes for the sheet's real access patterns.
create index entries_ws_date_idx
  on app.entries (workspace_id, work_date desc)
  where archived_at is null;
create index entries_author_date_idx
  on app.entries (workspace_id, author_id, work_date desc)
  where archived_at is null;
create index entries_tags_idx
  on app.entries using gin (tags);
