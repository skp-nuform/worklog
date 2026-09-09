-- =========================================================================
-- Apply 0008: Sheet Curation (reorder_entry_assets)
-- =========================================================================

begin;

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

grant execute on function public.reorder_entry_assets(uuid, uuid[]) to authenticated;

commit;
