import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/data/workspace";
import { getAllWorkspaceMembers } from "@/lib/data/sheet";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Team Management · Nuform Worklog",
};

export default async function TeamSettingsPage() {
  const viewer = await requireViewer();
  const workspace = await getCurrentWorkspace();

  if (!workspace) redirect("/onboarding");

  // Only admins and owners have access
  if (workspace.role !== "owner" && workspace.role !== "admin") {
    redirect("/sheet");
  }

  const members = await getAllWorkspaceMembers(workspace.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-page-in">
      <div className="flex flex-col gap-1 border-b border-frame/70 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
          Team Management
        </h1>
        <p className="text-sm text-text-muted">
          Manage member roles, assign departments, and administer access permissions for {workspace.name}.
        </p>
      </div>

      <TeamClient
        workspaceId={workspace.id}
        viewerId={viewer.id}
        viewerRole={workspace.role}
        initialMembers={members}
      />
    </div>
  );
}
