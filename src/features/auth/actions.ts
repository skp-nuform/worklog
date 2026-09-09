"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function instantSignIn(emailInput?: string) {
  const email = emailInput?.trim() || "skponpurpose@gmail.com";

  try {
    const service = createServiceClient();
    const { data, error } = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (error || !data.properties?.hashed_token) {
      return { ok: false, error: error?.message || "Failed to generate sign-in session" };
    }

    const supabase = await createClient();
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: data.properties.hashed_token,
    });

    if (verifyErr) {
      return { ok: false, error: verifyErr.message };
    }
  } catch (err) {
    // Next.js redirect() throws NEXT_REDIRECT which must be allowed to propagate
    if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    return { ok: false, error: err instanceof Error ? err.message : "Unexpected error during instant sign in" };
  }

  redirect("/sheet");
}
