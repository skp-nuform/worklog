"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Globe,
  Loader2,
  Mail,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeOnboarding } from "@/features/workspace/actions";

const DEPARTMENTS = [
  "Design",
  "Engineering",
  "Social & Content",
  "Marketing",
  "Operations",
  "Strategy",
] as const;

export function OnboardingForm({
  userEmail,
  defaultDisplayName,
  defaultDepartment = "Design",
  defaultTimezone = "Asia/Kolkata",
}: {
  userEmail: string;
  defaultDisplayName: string;
  defaultDepartment?: string;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [department, setDepartment] = useState(defaultDepartment);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const summaryRef = useRef<HTMLDivElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = displayName.trim();
    const trimmedDept = department.trim();

    if (trimmedName.length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }

    if (!trimmedDept) {
      setError("Please select or enter your department.");
      return;
    }

    const formData = new FormData();
    formData.set("displayName", trimmedName);
    formData.set("department", trimmedDept);
    formData.set("timezone", timezone.trim() || "Asia/Kolkata");
    formData.set("name", "Nuform Social");

    startTransition(async () => {
      const result = await completeOnboarding(formData);
      if (!result.ok) {
        setError(result.error);
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      router.replace("/sheet");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Building2 className="size-4" />
          </div>
          <span className="text-text-muted font-mono text-xs tracking-wider uppercase font-semibold">
            Nuform Social • Onboarding
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-text">
          Set up your profile
        </h1>
        <p className="text-text-muted text-sm leading-relaxed">
          Welcome to the team journal! Complete your details below to join the
          shared daily workspace.
        </p>
      </div>

      {/* Error alert */}
      {error && (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className="border-destructive/60 bg-status-blocked-bg text-status-blocked-fg flex items-start gap-2.5 rounded-lg border p-3.5 text-sm"
        >
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-status-blocked-fg" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Setup Card */}
      <div className="border-frame bg-surface flex flex-col gap-5 rounded-xl border p-6 shadow-xs">
        {/* Verified Email Banner */}
        {userEmail && (
          <div className="flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-brand" />
              <span className="font-mono text-xs text-text">{userEmail}</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-brand">
              <CheckCircle2 className="size-3.5" />
              <span>Verified Nuform Email</span>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          {/* Full Name */}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="displayName"
              className="text-xs font-medium text-text flex items-center gap-1.5"
            >
              <User className="size-3.5 text-text-muted" />
              Full Name <span className="text-brand">*</span>
            </Label>
            <Input
              id="displayName"
              name="displayName"
              required
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Abhishek Kumar"
              className="bg-elevated/40 border-frame text-text focus:border-brand"
            />
            <p className="text-[11px] text-text-muted">
              This is how your name will appear across daily work entries and team filters.
            </p>
          </div>

          {/* Department */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-medium text-text flex items-center gap-1.5">
              <Briefcase className="size-3.5 text-text-muted" />
              Department <span className="text-brand">*</span>
            </Label>

            {/* Quick Pills */}
            <div className="flex flex-wrap gap-1.5">
              {DEPARTMENTS.map((dept) => {
                const isSelected = department === dept;
                return (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => setDepartment(dept)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? "bg-brand text-white shadow-xs font-semibold"
                        : "bg-elevated/70 text-text-muted border border-frame/70 hover:border-brand/40 hover:text-text"
                    }`}
                  >
                    {dept}
                  </button>
                );
              })}
            </div>

            {/* Custom Department Input */}
            <Input
              id="department"
              name="department"
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Or enter custom department..."
              className="bg-elevated/30 border-frame/60 text-xs text-text h-8 mt-0.5"
            />
          </div>

          {/* Timezone */}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="timezone"
              className="text-xs font-medium text-text flex items-center gap-1.5"
            >
              <Globe className="size-3.5 text-text-muted" />
              Timezone
            </Label>
            <Input
              id="timezone"
              name="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Kolkata"
              className="bg-elevated/40 border-frame text-text focus:border-brand"
            />
            <p className="text-[11px] text-text-muted">
              Used to group daily logs by your local calendar date.
            </p>
          </div>

          {/* Connected Company Workspace Card */}
          <div className="rounded-lg border border-frame bg-elevated/30 p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Building2 className="size-3.5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-text">Nuform Social</p>
                <p className="text-[11px] text-text-muted">
                  Company Daily Sheet & Projects
                </p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium">
              Shared Workspace
            </span>
          </div>

          {/* Action CTA */}
          <div className="pt-2">
            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="w-full gap-2 font-medium bg-brand text-white hover:bg-brand-hover cursor-pointer"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Setting up workspace…
                </>
              ) : (
                <>
                  Complete Setup & Enter Worklog
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

