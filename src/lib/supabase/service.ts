import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { supabaseSecretKey } from "@/lib/env.server";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Permitted call sites, and no others:
 *   1. the guest asset proxy  (src/app/s/[token]/asset/[id]/route.ts)
 *   2. upload finalization    (not yet built)
 *   3. scheduled cleanup      (not yet built)
 *
 * Anything a signed-in user does goes through the user-scoped client so RLS
 * applies. If you are reaching for this anywhere else, the answer is a
 * definer RPC instead.
 */
export function createServiceClient() {
  return createSupabaseClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    supabaseSecretKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** True when the secret key is configured, so callers can degrade politely. */
export function hasServiceKey(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}
