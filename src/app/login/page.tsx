import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/**
 * The form reads `?next=` and `?error=` with useSearchParams, which requires
 * a Suspense boundary so the shell can still be prerendered.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-20">
          <p className="text-text-muted font-mono text-[11px] tracking-[0.09em] uppercase">
            Worklog
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-text-muted">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
