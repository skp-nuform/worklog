import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Email link confirmation — the documented server-side pattern.
 *
 * Supabase delivers email links in one of two shapes depending on how the
 * flow was initiated and what the email template points at:
 *
 *   /auth/callback?code=...                  PKCE (browser-initiated)
 *   /auth/confirm?token_hash=...&type=...    the SSR email pattern
 *
 * Both are supported so a template change cannot silently break sign-in.
 * This route handles the second: verifyOtp POSTs to Supabase Auth and the
 * session comes back in the response body, where the server can read it and
 * write it to cookies.
 *
 * To route email through here, set the template to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */

const ALLOWED_TYPES: readonly EmailOtpType[] = [
  "email",
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!tokenHash || !rawType) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", url.origin),
    );
  }

  // Never pass an unvalidated `type` through to the auth call.
  if (!ALLOWED_TYPES.includes(rawType as EmailOtpType)) {
    return NextResponse.redirect(
      new URL("/login?error=expired_link", url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: rawType as EmailOtpType,
    token_hash: tokenHash,
  });

  if (error) {
    // Most often an expired or already-used link. One-time by design.
    return NextResponse.redirect(
      new URL("/login?error=expired_link", url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
