import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { shareTokenPepper } from "@/lib/env.server";

/**
 * Share-link tokens.
 *
 * 256 bits of randomness. The database only ever sees an HMAC computed with
 * a pepper held OUTSIDE it, so a database dump cannot resolve or forge a
 * link, and the raw token never appears in a query or a log.
 *
 * Deliberately not in the actions file: everything exported from a
 * "use server" module must be an async Server Action, and these are plain
 * synchronous helpers.
 */
export function newShareToken(): { token: string; hashHex: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hashHex: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  const mac = createHmac("sha256", shareTokenPepper()).update(token).digest("hex");
  // PostgREST parses a bytea argument with Postgres' own input function,
  // which expects the `\xDEADBEEF` hex form.
  return `\\x${mac}`;
}
