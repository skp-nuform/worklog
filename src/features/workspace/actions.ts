"use server";

import { revalidatePath } from "next/cache";

import { requireViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { messageForCode } from "@/lib/validation/errors";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function field(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** First-run setup: workspace, owner membership, and the brand labels. */
export async function bootstrapWorkspace(
  formData: FormData,
): Promise<ActionResult<{ workspaceId: string }>> {
  await requireViewer();

  const name = field(formData, "name") ?? "";
  const displayName = field(formData, "displayName") ?? "";
  const timezone = field(formData, "timezone") ?? "Asia/Kolkata";
  const brands = (field(formData, "brands") ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

  if (name.length < 2) {
    return {
      ok: false,
      error: "Give the workspace a name of at least two characters.",
      fieldErrors: { name: ["Enter a workspace name."] },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bootstrap_workspace", {
    p_name: name,
    p_timezone: timezone,
    p_brands: brands.length ? brands : ["Newform Tech", "Newform Social"],
    p_display_name: displayName || null,
  });

  if (error) {
    return {
      ok: false,
      error: messageForCode(error.code, "Could not create the workspace."),
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { workspaceId: data as string } };
}
