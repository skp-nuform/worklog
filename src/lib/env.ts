import { z } from "zod";

/**
 * Startup configuration validation.
 *
 * Config is validated where it is read, not at module load of the whole app,
 * so a missing server-only secret cannot crash a page that does not need it.
 * Each accessor fails loudly and specifically instead of letting `undefined`
 * reach the Supabase client and surface as an opaque auth error.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export type PublicEnv = z.infer<typeof publicSchema>;

function fail(scope: string, issues: string): never {
  throw new Error(
    `[worklog] Invalid ${scope} configuration:\n${issues}\n` +
      `Copy .env.example to .env.local and fill in the missing values.`,
  );
}

let cachedPublic: PublicEnv | undefined;

/** Browser-safe configuration. Available in both client and server code. */
export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;

  // Referenced statically so Next.js can inline them into the client bundle.
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    fail("public", z.prettifyError(parsed.error));
  }

  cachedPublic = parsed.data;
  return cachedPublic;
}
