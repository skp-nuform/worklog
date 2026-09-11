"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { instantSignIn, sendMagicLink } from "@/features/auth/actions";
import { isNuformEmail, NUFORM_DOMAIN } from "@/features/auth/domain";
import { safeNextPath } from "@/lib/safe-redirect";
import { CreateAccountDialog } from "./create-account-dialog";

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEmailOtp, setShowEmailOtp] = useState(false);
  const [isPending, startTransition] = useTransition();

  const linkError = params.get("error");
  const next = safeNextPath(params.get("next"));

  const trimmedEmail = email.trim().toLowerCase();
  const hasDomainError =
    trimmedEmail.length > 0 &&
    trimmedEmail.includes("@") &&
    !isNuformEmail(trimmedEmail);
  const isValidNuform = isNuformEmail(trimmedEmail);

  function handleAuth(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!isValidNuform) return;

    startTransition(async () => {
      setState({ kind: "sending" });
      const res = await instantSignIn(trimmedEmail);
      if (res && !res.ok) {
        setState({ kind: "error", message: res.error });
      }
    });
  }

  async function onOtpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValidNuform) {
      setState({
        kind: "error",
        message: `Only ${NUFORM_DOMAIN} email addresses are allowed.`,
      });
      return;
    }

    startTransition(async () => {
      setState({ kind: "sending" });
      const res = await sendMagicLink(trimmedEmail, next);
      if (!res.ok) {
        setState({
          kind: "error",
          message: res.error || "Failed to send magic link email.",
        });
        return;
      }
      setState({ kind: "sent", email: trimmedEmail });
    });
  }

  if (state.kind === "sent") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-20">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Check your email
        </h1>
        <p className="text-text-muted">
          A secure sign-in link has been sent to{" "}
          <span className="text-text font-medium">{state.email}</span>. Click
          the link in that email to proceed.
        </p>
        <p className="text-text-muted text-sm">
          Didn't receive it?{" "}
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
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-16">
      {/* Brand & Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-brand/15 text-brand">
            <Building2 className="size-4" />
          </div>
          <span className="text-text-muted font-mono text-xs tracking-wider uppercase font-semibold">
            Nuform Social • Team Journal
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-text">
          Sign In
        </h1>
        <p className="text-text-muted text-sm leading-relaxed">
          Internal workspace access for authorized team members. Returning
          users land on their sheet; new members enter onboarding.
        </p>
      </div>

      {/* Error alert */}
      {showError && (
        <div
          role="alert"
          tabIndex={-1}
          className="border-destructive/60 bg-status-blocked-bg text-status-blocked-fg flex items-start gap-2.5 rounded-lg border p-3.5 text-sm"
        >
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-status-blocked-fg" />
          <span>{errorText}</span>
        </div>
      )}

      {/* Sign-in Card */}
      <div className="border-frame bg-surface flex flex-col gap-4 rounded-xl border p-5 shadow-xs">
        <form onSubmit={handleAuth} className="flex flex-col gap-3.5" noValidate>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="login-email"
                className="text-xs font-medium text-text flex items-center gap-1.5"
              >
                <Mail className="size-3.5 text-text-muted" />
                Work Email
              </Label>
              <span className="font-mono text-[10px] text-brand tracking-wider font-semibold">
                {NUFORM_DOMAIN}
              </span>
            </div>

            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
              placeholder="yourname@nuformsocial.com"
              className={`bg-elevated/50 text-text focus:border-brand ${
                hasDomainError ? "border-destructive focus:border-destructive" : "border-frame"
              }`}
            />

            {/* Validation helper text */}
            {hasDomainError ? (
              <p className="text-[11px] text-status-blocked-fg flex items-center gap-1 mt-0.5">
                <AlertCircle className="size-3 shrink-0" />
                Only emails ending with <strong>{NUFORM_DOMAIN}</strong> can sign in.
              </p>
            ) : isValidNuform ? (
              <p className="text-[11px] text-brand flex items-center gap-1 mt-0.5 font-medium">
                <CheckCircle2 className="size-3 shrink-0" />
                Verified Nuform domain · Ready to proceed
              </p>
            ) : (
              <p className="text-[11px] text-text-muted">
                Enter your company email to sign in or start onboarding.
              </p>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={isPending || state.kind === "sending" || !isValidNuform}
            className="w-full gap-2 font-medium bg-brand text-white hover:bg-brand-hover cursor-pointer"
          >
            {isPending || state.kind === "sending" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                Continue with Work Email
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>

        {/* Divider */}
        <div className="relative my-1 flex items-center justify-center">
          <div className="border-frame w-full border-t" />
          <span className="bg-surface text-text-muted px-2.5 text-[11px] font-medium uppercase tracking-wider">
            First time joining?
          </span>
        </div>

        {/* Start Onboarding CTA */}
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={isPending || state.kind === "sending"}
          onClick={() => {
            if (isValidNuform) {
              handleAuth();
            } else {
              setShowCreateModal(true);
            }
          }}
          className="w-full gap-2 border-frame bg-elevated/40 text-text hover:bg-elevated hover:border-brand/50 cursor-pointer font-medium"
        >
          <UserPlus className="size-4 text-brand" />
          {isValidNuform ? "Start Onboarding with This Email" : "New User? Create Account"}
        </Button>
      </div>

      {/* Security & Access Notice */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-text-muted">
        <Lock className="size-3 text-text-muted/80" />
        <span>Restricted to verified @nuformsocial.com team accounts</span>
      </div>

      {/* Alternative magic link email delivery (optional fallback) */}
      <div className="border-frame border-t pt-3">
        <button
          type="button"
          onClick={() => setShowEmailOtp((v) => !v)}
          className="text-text-muted hover:text-text flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
        >
          <Mail className="size-3.5" />
          {showEmailOtp
            ? "Hide email magic link option"
            : "Alternative: Send email magic link"}
        </button>

        {showEmailOtp && (
          <form onSubmit={onOtpSubmit} className="mt-3 flex flex-col gap-2.5" noValidate>
            <p className="text-text-muted text-xs">
              Sends an email with a secure link to your inbox.
            </p>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={state.kind === "sending" || !isValidNuform}
              className="w-full"
            >
              {state.kind === "sending" ? "Sending…" : "Send Magic Link Email"}
            </Button>
          </form>
        )}
      </div>

      {/* Modal Dialog for New User Registration */}
      <CreateAccountDialog
        open={showCreateModal}
        initialEmail={isValidNuform ? trimmedEmail : ""}
        onClose={() => setShowCreateModal(false)}
      />
    </main>
  );
}
