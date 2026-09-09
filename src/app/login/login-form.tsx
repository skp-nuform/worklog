"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Mail, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { instantSignIn } from "@/features/auth/actions";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/client";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

const ERRORS: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Request a new one below.",
  expired_link:
    "That sign-in link has expired or was already used. Request a new one below.",
};

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [showEmailOtp, setShowEmailOtp] = useState(false);
  const [isPending, startTransition] = useTransition();

  const linkError = params.get("error");
  const next = safeNextPath(params.get("next"));

  function handleInstantLogin(targetEmail?: string) {
    startTransition(async () => {
      setState({ kind: "sending" });
      const res = await instantSignIn(targetEmail || email);
      if (res && !res.ok) {
        setState({ kind: "error", message: res.error });
      }
    });
  }

  async function onOtpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = email.trim();
    if (!trimmed) {
      setState({ kind: "error", message: "Enter your work email address." });
      return;
    }

    setState({ kind: "sending" });

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo:
          `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback` +
          `?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setState({ kind: "error", message: error.message });
      return;
    }
    setState({ kind: "sent", email: trimmed });
  }

  // Confirmation, not a promise that mail has arrived.
  if (state.kind === "sent") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-20">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-text-muted">
          If <span className="text-text font-medium">{state.email}</span> has
          access, a sign-in link is on its way. The link can be used once and
          expires shortly.
        </p>
        <p className="text-text-muted text-sm">
          Nothing arrived?{" "}
          <button
            type="button"
            className="text-brand cursor-pointer underline underline-offset-4"
            onClick={() => setState({ kind: "idle" })}
          >
            Try a different address
          </button>
          .
        </p>
      </main>
    );
  }

  const showError = state.kind === "error" || Boolean(linkError);
  const errorText =
    state.kind === "error"
      ? state.message
      : linkError
        ? (ERRORS[linkError] ?? "That sign-in link did not work.")
        : "";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-20">
      <div className="flex flex-col gap-2">
        <p className="text-text-muted font-mono text-[11px] tracking-[0.09em] uppercase">
          SKP Worklog
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-text-muted">
          Direct single-user access enabled. No waiting for email confirmation.
        </p>
      </div>

      {/* Focusable error summary */}
      {showError && (
        <div
          role="alert"
          tabIndex={-1}
          className="border-destructive bg-status-blocked-bg text-status-blocked-fg rounded-card border p-3 text-sm"
        >
          {errorText}
        </div>
      )}

      {/* Instant 1-click login for SKP */}
      <div className="border-frame bg-surface flex flex-col gap-3 rounded-md border p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <Sparkles className="text-brand size-4" />
          <p className="text-text text-sm font-semibold">1-Click Sign In</p>
        </div>
        <p className="text-text-muted text-xs">
          Skip email confirmation link and enter directly into the daily work sheet.
        </p>
        <Button
          type="button"
          size="lg"
          disabled={isPending || state.kind === "sending"}
          onClick={() => handleInstantLogin("skponpurpose@gmail.com")}
          className="w-full gap-2 font-medium"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Enter SKP Worklog
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </div>

      {/* Or enter custom email with instant sign-in */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) handleInstantLogin(email.trim());
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">
            Sign in with another email
          </Label>
          <div className="flex gap-2">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={isPending || !email.trim()}
            >
              Sign in
            </Button>
          </div>
        </div>
      </form>

      {/* Parked for later team implementation: Email magic link */}
      <div className="border-frame border-t pt-4">
        <button
          type="button"
          onClick={() => setShowEmailOtp((v) => !v)}
          className="text-text-muted hover:text-text flex items-center gap-1.5 text-xs transition-colors"
        >
          <Mail className="size-3.5" />
          {showEmailOtp
            ? "Hide standard email link option"
            : "Team rollout option: Send magic link email (parked)"}
        </button>

        {showEmailOtp && (
          <form onSubmit={onOtpSubmit} className="mt-3 flex flex-col gap-3" noValidate>
            <p className="text-text-muted text-xs">
              This triggers Supabase Auth email delivery. Parked for team rollout.
            </p>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={state.kind === "sending" || !email.trim()}
            >
              {state.kind === "sending" ? "Sending…" : "Send test magic link"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
