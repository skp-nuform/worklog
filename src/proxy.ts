import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";

/**
 * Session refresh at the network boundary.
 *
 * This is a CONVENIENCE, not a security control. Next.js handles Server
 * Functions as POST requests to the route that uses them, so a matcher change
 * or a moved action can silently remove proxy coverage. Every server action,
 * route handler, upload authorization, export, and storage-link mint
 * therefore authorizes independently — see src/lib/permissions.
 *
 * Its real jobs: refresh expiring tokens so cookies stay fresh, and bounce
 * obviously-unauthenticated navigation to /login so we do not render an app
 * shell that is about to fail every query.
 */

/** Routes reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/s/"] as const;

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = publicEnv();
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() verifies the JWT signature rather than trusting the stored
  // session. Never getSession() here.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;

  if (!isSignedIn && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    // Round-trip the intended destination as a path only. A full URL here
    // would be an open-redirect vector; /login re-validates it regardless.
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Guest share pages must never be cached by a shared cache: the projection
  // is grant-specific and revocation must take effect immediately.
  if (pathname.startsWith("/s/")) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and metadata files.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$).*)",
  ],
};
