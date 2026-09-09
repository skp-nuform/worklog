import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Brand, MyProfile, MyWorkspace, Project } from "@/lib/database.types";

/**
 * Server-only reads. Every query runs through the user-scoped client, so RLS
 * applies — these helpers shape data, they do not grant access.
 */

export async function getProfile(): Promise<MyProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("my_profile").select("*").maybeSingle();
  return (data as MyProfile | null) ?? null;
}

export async function getMyWorkspaces(): Promise<MyWorkspace[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("my_workspaces")
    .select("*")
    .order("created_at", { ascending: true });
  return (data as MyWorkspace[] | null) ?? [];
}

/** The active workspace. First membership until a switcher exists (M2). */
export async function getCurrentWorkspace(): Promise<MyWorkspace | null> {
  const all = await getMyWorkspaces();
  return all[0] ?? null;
}

export async function getBrands(workspaceId: string): Promise<Brand[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brands")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("name");
  return (data as Brand[] | null) ?? [];
}

export async function getProjects(workspaceId: string): Promise<Project[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("name");
  return (data as Project[] | null) ?? [];
}
