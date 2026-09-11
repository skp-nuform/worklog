import "server-only";

import { createClient } from "@/lib/supabase/server";

/** One asset attached to an entry. */
export type AssetRow = {
  id: string;
  entry_id: string;
  workspace_id: string;
  kind: "link" | "image" | "video" | "file";
  url: string | null;
  provider: string | null;
  object_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  label: string | null;
  position: number;
  created_at: string;
};

export type EntryRow = {
  id: string;
  workspace_id: string;
  author_id: string;
  work_date: string;
  title: string;
  note: string | null;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  author_name: string | null;
  author_email: string | null;
  asset_count: number;
};

export type EntryWithAssets = EntryRow & { assets: AssetRow[] };

/** A day on the sheet: the unit the whole product is organised around. */
export type DayGroup = {
  workDate: string;
  entries: EntryWithAssets[];
};

export type SheetFilters = {
  authorId?: string;
  from?: string;
  to?: string;
  tag?: string;
  q?: string;
};

/**
 * The sheet: entries grouped by calendar day, newest first.
 *
 * Grouping happens here rather than in SQL so the day boundaries follow the
 * stored `work_date` exactly — no timezone arithmetic, because work_date is
 * already a calendar fact rather than an instant.
 */
export async function getSheet(
  workspaceId: string,
  filters: SheetFilters = {},
  limitDays = 60,
): Promise<DayGroup[]> {
  const supabase = await createClient();

  let query = supabase
    .from("entries")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limitDays * 20);

  if (filters.authorId) query = query.eq("author_id", filters.authorId);
  if (filters.from) query = query.gte("work_date", filters.from);
  if (filters.to) query = query.lte("work_date", filters.to);
  if (filters.tag) query = query.contains("tags", [filters.tag]);
  if (filters.q?.trim()) {
    const term = filters.q.trim().replace(/[%,()]/g, "");
    query = query.or(`title.ilike.%${term}%,note.ilike.%${term}%`);
  }

  const { data: entries, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (entries as EntryRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const { data: assets } = await supabase
    .from("entry_assets")
    .select("*")
    .in(
      "entry_id",
      rows.map((r) => r.id),
    )
    .order("position", { ascending: true });

  const byEntry = new Map<string, AssetRow[]>();
  for (const a of ((assets as AssetRow[] | null) ?? [])) {
    const list = byEntry.get(a.entry_id) ?? [];
    list.push(a);
    byEntry.set(a.entry_id, list);
  }

  const days = new Map<string, EntryWithAssets[]>();
  for (const r of rows) {
    const list = days.get(r.work_date) ?? [];
    list.push({ ...r, assets: byEntry.get(r.id) ?? [] });
    days.set(r.work_date, list);
  }

  return Array.from(days.entries())
    .map(([workDate, dayEntries]) => ({ workDate, entries: dayEntries }))
    .slice(0, limitDays);
}

export async function getPeople(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_people")
    .select("user_id, display_name, email, role, department")
    .eq("workspace_id", workspaceId)
    .neq("status", "removed")
    .order("display_name");
  return (
    (data as
      | { user_id: string; display_name: string; email: string; role: string; department?: string | null }[]
      | null) ?? []
  );
}

export async function getShareLinks(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("share_links")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return (data as Record<string, unknown>[] | null) ?? [];
}

export async function getWorkspaceTags(workspaceId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("entries")
    .select("tags")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  const set = new Set<string>();
  for (const row of (data as { tags: string[] }[] | null) ?? []) {
    for (const t of row.tags ?? []) {
      const trimmed = t?.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set).sort();
}


/**
 * Signed URLs for uploaded assets, for a signed-in viewer.
 *
 * Uses the caller's own session, so Storage RLS decides what resolves — no
 * service key involved on this path. Short-lived by design.
 */
export async function signAssetUrls(
  paths: string[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("work-assets")
    .createSignedUrls(paths, expiresIn);

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) out.set(item.path, item.signedUrl);
  }
  return out;
}
