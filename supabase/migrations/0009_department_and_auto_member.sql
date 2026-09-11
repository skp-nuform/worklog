-- =========================================================================
-- 0009 — Add department to profiles and auto-enroll @nuformsocial.com users
-- =========================================================================

begin;

-- 1. Add department column to app.profiles if it doesn't exist
alter table app.profiles add column if not exists department text;

-- 2. Update my_profile view to expose department
create or replace view public.my_profile
with (security_invoker = on) as
  select p.id, p.display_name, p.email, p.timezone, p.theme, p.department
    from app.profiles p
   where p.id = (select auth.uid());

-- 3. Update workspace_people view to expose department
create or replace view public.workspace_people
with (security_invoker = on) as
  select m.workspace_id, m.user_id, m.role, m.status,
         pr.display_name, pr.email, pr.department
    from app.workspace_members m
    join app.profiles pr on pr.id = m.user_id;

-- 4. Auto-enrollment helper: attaches any @nuformsocial.com user to company workspace
create or replace function app.ensure_nuform_membership(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_ws_id uuid;
begin
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    return null;
  end if;

  -- Only nuformsocial.com users get auto-enrolled
  if lower(v_email) not like '%@nuformsocial.com' then
    return null;
  end if;

  -- Locate primary company workspace (the first created workspace)
  select id into v_ws_id
    from app.workspaces
   order by created_at asc
   limit 1;

  -- If no workspace exists yet, create the default "Nuform Social"
  if v_ws_id is null then
    insert into app.workspaces (slug, name, owner_id, created_by, updated_by)
    values ('nuform-social', 'Nuform Social', p_user_id, p_user_id, p_user_id)
    returning id into v_ws_id;

    insert into app.workspace_members (workspace_id, user_id, role, status, joined_at)
    values (v_ws_id, p_user_id, 'owner', 'active', now())
    on conflict (workspace_id, user_id) do nothing;
  else
    -- Add as active member to the primary workspace
    insert into app.workspace_members (workspace_id, user_id, role, status, joined_at)
    values (v_ws_id, p_user_id, 'member', 'active', now())
    on conflict (workspace_id, user_id) do update
      set status = 'active',
          joined_at = coalesce(app.workspace_members.joined_at, now());
  end if;

  return v_ws_id;
end;
$$;

grant execute on function app.ensure_nuform_membership(uuid) to postgres, service_role, authenticated;

-- 5. Update auth trigger to pull department and trigger workspace auto-enrollment
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.profiles (id, display_name, email, department)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    nullif(btrim(new.raw_user_meta_data->>'department'), '')
  )
  on conflict (id) do update set
    display_name = coalesce(nullif(btrim(excluded.display_name), ''), app.profiles.display_name),
    department = coalesce(nullif(btrim(excluded.department), ''), app.profiles.department),
    updated_at = now();

  -- Auto-enroll if nuformsocial.com
  perform app.ensure_nuform_membership(new.id);

  return new;
end;
$$;

commit;
