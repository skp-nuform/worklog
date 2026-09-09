import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";

/**
 * Root is a router, not a page. A signed-in member goes to their overview;
 * everyone else signs in first. Both destinations enforce their own access.
 */
export default async function Home() {
  const viewer = await getViewer();
  redirect(viewer ? "/sheet" : "/login");
}
