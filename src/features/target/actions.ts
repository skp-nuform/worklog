"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/session";
import { getCurrentWorkspace, getProfile } from "@/lib/data/workspace";
import { createServiceClient } from "@/lib/supabase/service";
import { createEntry } from "@/features/sheet/actions";

export type TargetStatus = "upcoming" | "in_progress" | "done" | "missed";

export type TargetItem = {
  id: string;
  title: string;
  note: string | null;
  targetDate: string;
  assigneeId: string;
  assigneeName: string;
  assigneeDepartment?: string | null;
  status: TargetStatus;
  createdBy: string;
  createdByName?: string | null;
  completedAt?: string | null;
  createdAt: string;
};

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Creates a new Target.
 *
 * Rules:
 * - A normal employee can only create a target for THEMSELVES (server-enforced).
 * - An admin/owner can create a target for ANY employee in the workspace.
 * - Records creator attribution so the UI displays: "Target for [Assignee] • Set by [Admin]".
 */
export async function createTarget(input: {
  workspaceId: string;
  title: string;
  targetDate: string;
  note?: string;
  assigneeId?: string;
}): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireViewer();
  const workspace = await getCurrentWorkspace();

  if (!workspace || workspace.id !== input.workspaceId) {
    return { ok: false, error: "Unauthorized workspace access." };
  }

  const title = input.title.trim();
  if (title.length < 2) {
    return { ok: false, error: "Please provide a target title." };
  }

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const profile = await getProfile();
  const creatorName = profile?.display_name || viewer.email?.split("@")[0] || "Team Lead";

  // Section 17 & 18: Derive assignee securely
  let targetAssigneeId = viewer.id;
  let isAssignedByAdmin = false;

  if (isAdmin && input.assigneeId && input.assigneeId !== viewer.id) {
    targetAssigneeId = input.assigneeId;
    isAssignedByAdmin = true;
  }

  const tags = [
    "target",
    `target:${input.targetDate}`,
    "target-status:upcoming",
    `target-assignee:${targetAssigneeId}`,
    `target-creator:${viewer.id}`,
  ];

  if (isAssignedByAdmin) {
    tags.push(`target-creator-name:${encodeURIComponent(creatorName)}`);
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  const res = await createEntry({
    workspaceId: input.workspaceId,
    title: `🎯 Target: ${title}`,
    workDate: todayKey,
    note: input.note?.trim() || undefined,
    tags,
  });

  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  revalidatePath("/sheet");
  return { ok: true, data: { id: res.data.id } };
}

/**
 * Updates a target's status (upcoming, in_progress, done, missed).
 */
export async function updateTargetStatus(input: {
  targetId: string;
  status: TargetStatus;
}): Promise<ActionResult> {
  const viewer = await requireViewer();
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return { ok: false, error: "Unauthorized." };
  }

  const service = createServiceClient();
  const { data: entry, error: fetchErr } = await service
    .schema("app")
    .from("entries")
    .select("id, author_id, workspace_id, tags")
    .eq("id", input.targetId)
    .single();

  if (fetchErr || !entry) {
    return { ok: false, error: "Target not found." };
  }

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isAssignee = entry.author_id === viewer.id;

  if (!isAdmin && !isAssignee) {
    return { ok: false, error: "You can only update your own targets." };
  }

  // Filter out existing status and done tags
  const cleanTags = (entry.tags || []).filter(
    (t: string) =>
      !t.startsWith("target-status:") && !t.startsWith("target-done:"),
  );

  cleanTags.push(`target-status:${input.status}`);
  if (input.status === "done") {
    cleanTags.push(`target-done:${new Date().toISOString()}`);
  }

  const { error: updateErr } = await service
    .schema("app")
    .from("entries")
    .update({
      tags: cleanTags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.targetId);

  if (updateErr) {
    return { ok: false, error: updateErr.message || "Failed to update target status." };
  }

  revalidatePath("/sheet");
  return { ok: true, data: undefined };
}

/**
 * Deletes a target.
 */
export async function deleteTarget(targetId: string): Promise<ActionResult> {
  const viewer = await requireViewer();
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return { ok: false, error: "Unauthorized." };
  }

  const service = createServiceClient();
  const { data: entry, error: fetchErr } = await service
    .schema("app")
    .from("entries")
    .select("id, author_id, workspace_id")
    .eq("id", targetId)
    .single();

  if (fetchErr || !entry) {
    return { ok: false, error: "Target not found." };
  }

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isAssignee = entry.author_id === viewer.id;

  if (!isAdmin && !isAssignee) {
    return { ok: false, error: "You do not have permission to delete this target." };
  }

  const { error: delErr } = await service
    .schema("app")
    .from("entries")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", targetId);

  if (delErr) {
    return { ok: false, error: delErr.message || "Failed to delete target." };
  }

  revalidatePath("/sheet");
  return { ok: true, data: undefined };
}
