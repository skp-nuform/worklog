import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Email sign-in callback.
 *
 * The `next` parameter is attacker-controllable, so it is validated against
 * same-site paths only (see safeNextPath). An invalid or foreign value falls
 * back rather than redirecting off-origin.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Most often an expired or already-used link. Say so plainly.
    return NextResponse.redirect(
      new URL("/login?error=expired_link", url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
