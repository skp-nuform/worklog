"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bootstrapWorkspace } from "@/features/workspace/actions";

export function OnboardingForm({
  defaultDisplayName,
  defaultTimezone,
}: {
  defaultDisplayName: string;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const summaryRef = useRef<HTMLDivElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await bootstrapWorkspace(formData);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        // Move focus to the summary so a keyboard user is not stranded.
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      router.replace("/sheet");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error && (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className="border-destructive bg-status-blocked-bg text-status-blocked-fg rounded-card border p-3 text-sm"
        >
          <p className="font-medium">There is a problem</p>
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">
          Workspace name <span aria-hidden="true">*</span>
          <span className="sr-only">(required)</span>
        </Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue=""
          placeholder="Newform"
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
        />
        {fieldErrors.name && (
          <p id="name-error" className="text-destructive text-sm">
            {fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Your name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={defaultDisplayName}
          placeholder="How your name appears on records"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          name="timezone"
          defaultValue={defaultTimezone}
          placeholder="Asia/Kolkata"
        />
        <p className="text-text-muted text-sm">
          Used to group the timeline by calendar date. Times are always stored
          in UTC.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brands">Brands</Label>
        <Input
          id="brands"
          name="brands"
          defaultValue="Newform Tech, Newform Social"
          placeholder="Comma separated"
        />
        <p className="text-text-muted text-sm">
          Comma separated. Editable later — these are just labels, not
          verified company names.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Creating…" : "Create workspace"}
        </Button>
        <span className="text-text-muted text-sm">
          You can skip projects and invitations for now.
        </span>
      </div>
    </form>
  );
}
