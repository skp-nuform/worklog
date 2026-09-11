"use server";

import { revalidatePath } from "next/cache";

import { requireViewer } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function field(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Complete first-time user onboarding: name, department, timezone, and workspace enrollment. */
export async function completeOnboarding(
  formData: FormData,
): Promise<ActionResult<{ workspaceId: string }>> {
  const viewer = await requireViewer();

  const displayName = field(formData, "displayName") ?? "";
  const department = field(formData, "department") ?? "Design";
  const timezone = field(formData, "timezone") ?? "Asia/Kolkata";
  const workspaceName = field(formData, "name") ?? "Nuform Social";

  if (displayName.length < 2) {
    return {
      ok: false,
      error: "Please enter your full name (at least 2 characters).",
      fieldErrors: { displayName: ["Enter your full name."] },
    };
  }

  try {
    const service = createServiceClient();
    const userId = viewer.id;
    const email = viewer.email ?? "";

    // 1. Update app.profiles
    await service
      .schema("app")
      .from("profiles")
      .upsert(
        {
          id: userId,
          display_name: displayName,
          email,
          department,
          timezone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    // 2. Check for existing company workspace
    const { data: workspaces } = await service
      .schema("app")
      .from("workspaces")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1);

    let workspaceId = workspaces?.[0]?.id;

    if (!workspaceId) {
      // First workspace creation
      const slug =
        workspaceName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "nuform-social";

      const { data: newWs, error: wsErr } = await service
        .schema("app")
        .from("workspaces")
        .insert({
          slug,
          name: workspaceName,
          owner_id: userId,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();

      if (wsErr || !newWs) {
        return {
          ok: false,
          error: wsErr?.message || "Failed to create company workspace.",
        };
      }

      workspaceId = newWs.id;

      // Add default brands
      await service.schema("app").from("brands").insert([
        {
          workspace_id: workspaceId,
          name: "Nuform Social",
          created_by: userId,
          updated_by: userId,
        },
        {
          workspace_id: workspaceId,
          name: "Nuform Tech",
          created_by: userId,
          updated_by: userId,
        },
      ]);

      // Add user as owner
      await service.schema("app").from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "owner",
        status: "active",
        joined_at: new Date().toISOString(),
      });
    } else {
      // Join existing company workspace as active member
      await service
        .schema("app")
        .from("workspace_members")
        .upsert(
          {
            workspace_id: workspaceId,
            user_id: userId,
            role: "member",
            status: "active",
            joined_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,user_id" },
        );
    }

    revalidatePath("/", "layout");
    return { ok: true, data: { workspaceId } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to complete onboarding.",
    };
  }
}

// Keep bootstrapWorkspace aliasing completeOnboarding for backward compatibility
export const bootstrapWorkspace = completeOnboarding;

