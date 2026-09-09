import { redirect } from "next/navigation";

import { OnboardingForm } from "./onboarding-form";
import { requireViewer } from "@/lib/auth/session";
import { getCurrentWorkspace, getProfile } from "@/lib/data/workspace";

export const metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  await requireViewer("/onboarding");

  // Already set up: nothing to do here.
  const existing = await getCurrentWorkspace();
  if (existing) redirect("/sheet");

  const profile = await getProfile();

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <p className="text-text-muted font-mono text-[11px] tracking-[0.09em] uppercase">
          Worklog · Setup
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Create your workspace
        </h1>
        <p className="text-text-muted">
          This holds your projects and work records. You can rename it and edit
          brands later in Settings.
        </p>
      </div>

      <OnboardingForm
        defaultDisplayName={profile?.display_name ?? ""}
        defaultTimezone={profile?.timezone ?? "Asia/Kolkata"}
      />
    </main>
  );
}
