"use server";

import { redirect } from "next/navigation";
import { isNuformEmail, NUFORM_DOMAIN } from "./domain";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMagicLinkViaBrevo } from "@/lib/brevo";
import { safeNextPath } from "@/lib/safe-redirect";
import { publicEnv } from "@/lib/env";

/**
 * Ensures the given user is an active member of the company workspace.
 */
async function ensureCompanyWorkspaceMembership(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
) {
  try {
    // 1. Check if user already belongs to any active workspace
    const { data: existing } = await service
      .schema("app")
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1);

    if (existing && existing.length > 0) {
      return existing[0].workspace_id;
    }

    // 2. Find primary company workspace (oldest created workspace)
    const { data: workspaces } = await service
      .schema("app")
      .from("workspaces")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1);

    let workspaceId = workspaces?.[0]?.id;

    if (!workspaceId) {
      // Create initial company workspace
      const { data: newWs, error: createErr } = await service
        .schema("app")
        .from("workspaces")
        .insert({
          slug: "nuform-social",
          name: "Nuform Social",
          owner_id: userId,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();

      if (!createErr && newWs) {
        workspaceId = newWs.id;
        await service
          .schema("app")
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: userId,
            role: "owner",
            status: "active",
            joined_at: new Date().toISOString(),
          });
        return workspaceId;
      }
    }

    if (workspaceId) {
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

    return workspaceId;
  } catch (err) {
    console.error("[auth] Failed to ensure workspace membership:", err);
    return null;
  }
}

/**
 * Check if an email is registered in Supabase Auth.
 */
export async function checkEmailRegistration(emailInput: string) {
  const email = emailInput.trim().toLowerCase();

  if (!isNuformEmail(email)) {
    return {
      ok: false,
      error: `Access restricted: Only ${NUFORM_DOMAIN} email addresses are allowed.`,
    };
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service.auth.admin.listUsers();
    if (error) {
      return { ok: false, error: error.message };
    }

    const exists = Boolean(
      data.users?.some((u) => u.email?.toLowerCase() === email),
    );
    return { ok: true, exists };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to check email status",
    };
  }
}

/**
 * Instant sign in for existing @nuformsocial.com users.
 */
export async function instantSignIn(emailInput?: string) {
  const email = emailInput?.trim().toLowerCase() || "";

  if (!email) {
    return { ok: false, error: "Enter your work email address." };
  }

  if (!isNuformEmail(email)) {
    return {
      ok: false,
      error: `Access restricted: Only ${NUFORM_DOMAIN} email addresses are allowed.`,
    };
  }

  try {
    const service = createServiceClient();

    // Check if user exists in auth
    const { data: listData, error: listErr } = await service.auth.admin.listUsers();
    if (listErr) {
      return { ok: false, error: listErr.message };
    }

    let existingUser = listData.users?.find(
      (u) => u.email?.toLowerCase() === email,
    );

    let isNewUser = false;

    if (!existingUser) {
      // User does not exist yet: create user account in Supabase Auth
      const { data: createData, error: createErr } =
        await service.auth.admin.createUser({
          email,
          email_confirm: true,
        });

      if (createErr || !createData.user) {
        return {
          ok: false,
          error: createErr?.message || "Failed to initialize user account.",
        };
      }
      existingUser = createData.user;
      isNewUser = true;
    } else {
      // Check if user has already completed onboarding (active workspace membership)
      const { data: memberships } = await service
        .schema("app")
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", existingUser.id)
        .eq("status", "active")
        .limit(1);

      if (!memberships || memberships.length === 0) {
        isNewUser = true;
      }
    }

    // Generate link and verify OTP to set the cookie session
    const { data, error } = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (error || !data.properties?.hashed_token) {
      return {
        ok: false,
        error: error?.message || "Failed to generate sign-in session",
      };
    }

    const supabase = await createClient();
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: data.properties.hashed_token,
    });

    if (verifyErr) {
      return { ok: false, error: verifyErr.message };
    }

    // If existing user already has workspace, ensure company workspace access is in sync
    if (!isNewUser) {
      await ensureCompanyWorkspaceMembership(service, existingUser.id);
    }

    if (isNewUser) {
      redirect("/onboarding");
    } else {
      redirect("/sheet");
    }
  } catch (err) {
    // Propagate Next.js redirect
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String(err.digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Unexpected error during instant sign in",
    };
  }
}

/**
 * Register a new @nuformsocial.com user with Name, Email, and Department.
 */
export async function registerNuformUser(data: {
  name: string;
  email: string;
  department: string;
}) {
  const name = data.name.trim();
  const email = data.email.trim().toLowerCase();
  const department = data.department.trim();

  if (name.length < 2) {
    return { ok: false, error: "Please enter your full name (at least 2 characters)." };
  }

  if (!isNuformEmail(email)) {
    return {
      ok: false,
      error: `Access restricted: Only ${NUFORM_DOMAIN} email addresses are allowed.`,
    };
  }

  if (department.length < 2) {
    return { ok: false, error: "Please select or enter your department." };
  }

  try {
    const service = createServiceClient();

    // Check if user already exists
    const { data: listData } = await service.auth.admin.listUsers();
    let user = listData?.users?.find((u) => u.email?.toLowerCase() === email);

    if (!user) {
      // Create new user in Supabase Auth
      const { data: createData, error: createErr } =
        await service.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            display_name: name,
            department,
          },
        });

      if (createErr || !createData.user) {
        return {
          ok: false,
          error: createErr?.message || "Failed to create user account.",
        };
      }
      user = createData.user;
    } else {
      // Update metadata on existing auth user
      await service.auth.admin.updateUserById(user.id, {
        user_metadata: {
          display_name: name,
          department,
        },
      });
    }

    // Upsert app profile directly
    await service
      .schema("app")
      .from("profiles")
      .upsert(
        {
          id: user.id,
          display_name: name,
          email,
          timezone: "Asia/Kolkata",
          department,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    // Auto-enroll in company workspace
    await ensureCompanyWorkspaceMembership(service, user.id);

    // Establish browser session via magic link token
    const { data: linkData, error: linkErr } =
      await service.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkErr || !linkData.properties?.hashed_token) {
      return {
        ok: false,
        error: linkErr?.message || "Account created, but sign-in session failed.",
      };
    }

    const supabase = await createClient();
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });

    if (verifyErr) {
      return { ok: false, error: verifyErr.message };
    }
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String(err.digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to complete registration.",
    };
  }

  redirect("/sheet");
}

/**
 * Generates a Supabase magic link and delivers it via Brevo transactional email.
 * This bypasses Supabase's default mailer 2/hour rate limit entirely.
 */
export async function sendMagicLink(emailInput: string, nextPath?: string) {
  const email = emailInput?.trim().toLowerCase() || "";

  if (!email) {
    return { ok: false, error: "Please enter your work email address." };
  }

  if (!isNuformEmail(email)) {
    return {
      ok: false,
      error: `Access restricted: Only ${NUFORM_DOMAIN} email addresses are allowed.`,
    };
  }

  try {
    const service = createServiceClient();
    const next = safeNextPath(nextPath);

    // 1. Ensure user exists in Supabase Auth (or initialize them)
    const { data: listData } = await service.auth.admin.listUsers();
    let user = listData?.users?.find((u) => u.email?.toLowerCase() === email);

    if (!user) {
      const { data: createData, error: createErr } =
        await service.auth.admin.createUser({
          email,
          email_confirm: true,
        });
      if (createErr || !createData.user) {
        return {
          ok: false,
          error: createErr?.message || "Failed to initialize user account.",
        };
      }
      user = createData.user;
    }

    // 2. Generate magic link token without consuming Supabase email quota
    const { data: linkData, error: linkErr } =
      await service.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkErr || !linkData.properties?.hashed_token) {
      return {
        ok: false,
        error: linkErr?.message || "Failed to generate sign-in link.",
      };
    }

    const origin = publicEnv().NEXT_PUBLIC_SITE_URL;
    const magicLinkUrl = `${origin}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`;

    // 3. Send email via Brevo transactional email API
    await sendMagicLinkViaBrevo({
      toEmail: email,
      magicLinkUrl,
      recipientName: user.user_metadata?.display_name ?? null,
    });

    return { ok: true };
  } catch (err) {
    console.error("[auth] Failed to send magic link via Brevo:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to send magic link email.",
    };
  }
}

