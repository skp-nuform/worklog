import { redirect } from "next/navigation";

import { OnboardingForm } from "./onboarding-form";
import { requireViewer } from "@/lib/auth/session";
import { getCurrentWorkspace, getProfile } from "@/lib/data/workspace";

export const metadata = { title: "Welcome to Nuform Social · Profile Setup" };

export default async function OnboardingPage() {
  const viewer = await requireViewer("/onboarding");

  // Already set up: nothing to do here.
  const existing = await getCurrentWorkspace();
  if (existing) redirect("/sheet");

  const profile = await getProfile();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-14">
      <OnboardingForm
        userEmail={viewer.email ?? ""}
        defaultDisplayName={profile?.display_name ?? ""}
        defaultDepartment={profile?.department ?? "Design"}
        defaultTimezone={profile?.timezone ?? "Asia/Kolkata"}
      />
    </main>
  );
}

