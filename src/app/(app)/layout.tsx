import Link from "next/link";
import { redirect } from "next/navigation";
import { Shield } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { requireViewer } from "@/lib/auth/session";
import { getCurrentWorkspace, getProfile } from "@/lib/data/workspace";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireViewer();

  const [workspace, profile] = await Promise.all([
    getCurrentWorkspace(),
    getProfile(),
  ]);

  // No workspace yet: onboarding is the only sensible destination.
  if (!workspace) redirect("/onboarding");

  // Deactivated member check
  if (workspace.status === "removed") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-canvas p-6 text-center animate-page-in">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
          <Shield className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-text">Access Suspended</h1>
        <p className="mt-2 text-sm text-text-muted max-w-sm">
          Your Nuform Worklog access is no longer active. Please contact your workspace administrator to restore access.
        </p>
        <div className="mt-6">
          <ProfileMenu profile={profile} workspaceRole={workspace.role} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-canvas flex min-h-full flex-col">
      {/* Skip link: first focusable element on the page. */}
      <a
        href="#main"
        className="bg-surface text-text focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:ring-2"
      >
        Skip to content
      </a>

      {/* Sleek top navigation bar */}
      <header className="border-border bg-surface/90 sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 backdrop-blur-md md:px-8">
        <div className="flex items-center gap-3">
          <Link href="/sheet" className="group flex items-center gap-2">
            <span className="bg-brand text-canvas flex size-7 items-center justify-center rounded-md text-xs font-bold tracking-tight shadow-xs transition-opacity group-hover:opacity-90">
              SKP
            </span>
            <span className="text-text text-sm font-semibold tracking-tight">
              Worklog
            </span>
          </Link>
          <span className="text-text-muted/40 text-xs">/</span>
          <span className="font-metadata text-text-muted text-[11px] tracking-wide uppercase">
            Daily Journal
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-elevated/70 border-border hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-metadata text-[11px] text-text-muted sm:flex">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span>Active Sheet</span>
          </div>

          <ThemeToggle />

          <div className="border-border flex items-center border-l pl-3">
            <ProfileMenu profile={profile} workspaceRole={workspace.role} />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-8 animate-page-in">
        {children}
      </main>
    </div>
  );
}
