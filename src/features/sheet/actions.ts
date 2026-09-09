"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireViewer } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { messageForCode } from "@/lib/validation/errors";
import { newShareToken } from "@/lib/share-token";

export type Result<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type AssetInput = {
  kind: "link" | "image" | "video" | "file";
  url?: string;
  provider?: string;
  object_path?: string;
  mime_type?: string;
  byte_size?: number;
  width?: number;
  height?: number;
  label?: string;
};

export async function createEntry(input: {
  workspaceId: string;
  title: string;
  workDate?: string;
  note?: string;
  tags?: string[];
  assets?: AssetInput[];
  idempotencyKey?: string;
}): Promise<Result<{ id: string }>> {
  await requireViewer();

  const title = input.title.trim();
  if (title.length < 3) {
    return { ok: false, error: "Give it a title of at least three characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_entry", {
    p_workspace: input.workspaceId,
    p_title: title,
    p_work_date: input.workDate ?? null,
    p_note: input.note?.trim() || null,
    p_tags: input.tags?.filter(Boolean) ?? [],
    p_assets: input.assets ?? [],
    p_idempotency_key: input.idempotencyKey ?? randomUUID(),
  });

  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not save that.") };
  }

  revalidatePath("/sheet");
  return { ok: true, data: { id: data as string } };
}

export async function addAsset(input: {
  entryId: string;
  asset: AssetInput;
}): Promise<Result<{ id: string }>> {
  await requireViewer();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("add_entry_asset", {
    p_entry: input.entryId,
    p_kind: input.asset.kind,
    p_url: input.asset.url ?? null,
    p_provider: input.asset.provider ?? null,
    p_object_path: input.asset.object_path ?? null,
    p_mime_type: input.asset.mime_type ?? null,
    p_byte_size: input.asset.byte_size ?? null,
    p_width: input.asset.width ?? null,
    p_height: input.asset.height ?? null,
    p_label: input.asset.label ?? null,
  });

  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not attach that.") };
  }
  revalidatePath("/sheet");
  return { ok: true, data: { id: data as string } };
}

export async function deleteAsset(assetId: string): Promise<Result> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_entry_asset", { p_asset: assetId });
  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not remove that.") };
  }
  revalidatePath("/sheet");
  return { ok: true, data: undefined };
}

export async function deleteEntry(entryId: string): Promise<Result> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_entry", { p_entry: entryId });
  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not delete that.") };
  }
  revalidatePath("/sheet");
  return { ok: true, data: undefined };
}

export async function updateEntry(input: {
  entryId: string;
  expectedVersion: number;
  title?: string;
  note?: string;
  workDate?: string;
  tags?: string[];
}): Promise<Result<{ version: number }>> {
  await requireViewer();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_entry", {
    p_entry: input.entryId,
    p_expected_version: input.expectedVersion,
    p_title: input.title?.trim() || null,
    p_note: input.note?.trim() ?? null,
    p_work_date: input.workDate ?? null,
    p_tags: input.tags ?? null,
  });

  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not save the change.") };
  }
  revalidatePath("/sheet");
  return { ok: true, data: { version: data as number } };
}

/**
 * Publish a share link. The full URL is returned ONCE — only its hash is
 * stored, so it cannot be recovered later, only rotated.
 */
export async function createShareLink(input: {
  workspaceId: string;
  label?: string;
  authorId?: string;
  fromDate?: string;
  toDate?: string;
  allowDownload?: boolean;
  expiresInDays?: number | null;
}): Promise<Result<{ url: string }>> {
  await requireViewer();

  let hashHex: string;
  let token: string;
  try {
    const generated = newShareToken();
    token = generated.token;
    hashHex = generated.hashHex;
  } catch {
    return {
      ok: false,
      error:
        "Sharing needs SHARE_TOKEN_PEPPER set in .env.local. Generate one with: openssl rand -base64 48",
    };
  }

  // The PRD's default: 30 days, with the exact date shown to the publisher.
  const days = input.expiresInDays === null ? null : (input.expiresInDays ?? 30);
  const expiresAt =
    days === null
      ? null
      : new Date(Date.now() + days * 86_400_000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_share_link", {
    p_workspace: input.workspaceId,
    p_token_hash: hashHex,
    p_label: input.label ?? null,
    p_author_id: input.authorId ?? null,
    p_from_date: input.fromDate ?? null,
    p_to_date: input.toDate ?? null,
    p_allow_download: input.allowDownload ?? true,
    p_expires_at: expiresAt,
  });

  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not create the link.") };
  }

  revalidatePath("/sheet");
  return {
    ok: true,
    data: { url: `${publicEnv().NEXT_PUBLIC_SITE_URL}/s/${token}` },
  };
}

export async function revokeShareLink(shareId: string): Promise<Result> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_share_link", { p_share: shareId });
  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not revoke that link.") };
  }
  revalidatePath("/sheet");
  return { ok: true, data: undefined };
}

export async function reorderAssets(entryId: string, assetIds: string[]): Promise<Result> {
  await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_entry_assets", {
    p_entry: entryId,
    p_asset_ids: assetIds,
  });
  if (error) {
    return { ok: false, error: messageForCode(error.code, "Could not reorder attachments.") };
  }
  revalidatePath("/sheet");
  return { ok: true, data: undefined };
}

export async function addCommentToEntry(input: {
  entryId: string;
  author: string;
  text: string;
  badge?: "feedback" | "approved" | "update";
  token?: string;
}): Promise<Result<{ comment: import("@/lib/comments").EntryComment }>> {
  const author = input.author.trim() || "Abhishek";
  const text = input.text.trim();
  if (!text) {
    return { ok: false, error: "Please enter a comment." };
  }

  const { parseEntryContent, serializeEntryContent } = await import("@/lib/comments");
  const { createServiceClient } = await import("@/lib/supabase/service");

  const comment = {
    id: randomUUID(),
    author,
    text,
    badge: input.badge,
    createdAt: new Date().toISOString(),
  };

  const service = createServiceClient();
  const { data: entry, error: fetchErr } = await service
    .schema("app")
    .from("entries")
    .select("id, note, version, title, work_date, tags")
    .eq("id", input.entryId)
    .single();

  if (fetchErr || !entry) {
    return { ok: false, error: "Entry not found." };
  }

  const { note: cleanNote, comments } = parseEntryContent(entry.note);
  const updatedComments = [...comments, comment];
  const newRawNote = serializeEntryContent(cleanNote, updatedComments);

  const { error: updateErr } = await service
    .schema("app")
    .from("entries")
    .update({ note: newRawNote, updated_at: new Date().toISOString() })
    .eq("id", input.entryId);

  if (updateErr) {
    return { ok: false, error: updateErr.message || "Failed to post comment." };
  }

  revalidatePath("/sheet");
  if (input.token) {
    revalidatePath(`/s/${input.token}`);
  }

  return { ok: true, data: { comment } };
}

export async function createFutureTarget(input: {
  workspaceId: string;
  targetDate: string;
  title: string;
  note?: string;
}): Promise<Result<{ id: string }>> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "Please specify a target to be achieved." };
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  return createEntry({
    workspaceId: input.workspaceId,
    title: `🎯 Target: ${title}`,
    workDate: todayKey,
    note: input.note ? `Target for ${input.targetDate}: ${input.note.trim()}` : `Target to be achieved by ${input.targetDate}`,
    tags: ["target", `target:${input.targetDate}`],
  });
}

