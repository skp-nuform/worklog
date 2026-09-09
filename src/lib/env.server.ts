import "server-only";

import { z } from "zod";

/**
 * Server-only configuration.
 *
 * `server-only` makes an accidental client import a build error rather than a
 * secret leak. Each secret is validated at its own accessor so a page that
 * does not need the service key still renders when it is absent.
 */

const secretKeySchema = z.string().min(1);
const pepperSchema = z.string().min(32);

function missing(name: string, why: string): never {
  throw new Error(
    `[worklog] Missing required server configuration: ${name}\n${why}\n` +
      `See .env.example.`,
  );
}

/**
 * Supabase secret (service-role) key. Bypasses RLS entirely.
 *
 * Only three call sites may use this: the guest-share asset proxy, upload
 * finalization, and scheduled cleanup. Every ordinary member operation goes
 * through a user-scoped client so RLS applies.
 */
export function supabaseSecretKey(): string {
  const parsed = secretKeySchema.safeParse(process.env.SUPABASE_SECRET_KEY);
  if (!parsed.success) {
    missing(
      "SUPABASE_SECRET_KEY",
      "Required for the guest-share asset proxy and upload finalization.",
    );
  }
  return parsed.data;
}

/**
 * Pepper for share-token HMACs. Deliberately outside the database: the
 * database stores only peppered hashes, so a dump cannot resolve or forge a
 * share link without this value.
 */
export function shareTokenPepper(): string {
  const parsed = pepperSchema.safeParse(process.env.SHARE_TOKEN_PEPPER);
  if (!parsed.success) {
    missing(
      "SHARE_TOKEN_PEPPER",
      "Must be at least 32 characters. Generate with: openssl rand -base64 48",
    );
  }
  return parsed.data;
}
