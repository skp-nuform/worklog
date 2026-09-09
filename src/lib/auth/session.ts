import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Verified identity for server code.
 *
 * getClaims() verifies the JWT signature rather than trusting the stored
 * session. Supabase's guidance is explicit: never trust getSession() in
 * server code.
 *
 * This is a convenience for rendering, NOT the authorization boundary. Every
 * mutation authorizes itself in the database (RLS + definer RPCs), because a
 * page-level redirect protects nothing that is callable directly.
 */
export async function getViewer() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    id: data.claims.sub as string,
    email: (data.claims.email as string | undefined) ?? null,
  };
}

export async function requireViewer(nextPath?: string) {
  const viewer = await getViewer();
  if (!viewer) {
    if (nextPath) {
      // Built at runtime, so typedRoutes cannot verify it statically. The
      // path itself is re-validated by safeNextPath on the way back.
      redirect(
        `/login?next=${encodeURIComponent(nextPath)}` as Parameters<
          typeof redirect
        >[0],
      );
    }
    redirect("/login");
  }
  return viewer;
}
