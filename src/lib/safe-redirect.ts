/**
 * Auth-callback redirect validation.
 *
 * An attacker-supplied `next` value must never bounce a signed-in user to
 * another origin. Only same-site absolute paths are allowed, and
 * protocol-relative `//evil.com` is rejected explicitly — it looks like a
 * path but browsers treat it as an origin.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/sheet",
): string {
  if (!raw) return fallback;

  let value = raw.trim();
  if (value === "") return fallback;

  // Reject anything that is not a plain, same-site path.
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  if (value.includes("://")) return fallback;
  // Control characters and encoded newlines are header-splitting attempts.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  // Normalise away any attempt to escape via traversal.
  try {
    const url = new URL(value, "https://worklog.invalid");
    if (url.origin !== "https://worklog.invalid") return fallback;
    value = url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }

  // Never bounce back into the auth flow itself.
  if (value.startsWith("/auth")) return fallback;

  return value;
}
