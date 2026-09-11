export const NUFORM_HOST = "nuformsocial.com";
export const NUFORM_DOMAIN = "@nuformsocial.com";

// Common typo domains to forgive and auto-correct
const COMMON_TYPO_DOMAINS = new Set([
  "nurformsocial.com",
  "nuformssocial.com",
  "nuformsocail.com",
  "nuformsocial.co",
  "nuformsocial.con",
  "nuformsocial.in",
  "nuformsocial.org",
  "nuformsocial.net",
  "nuform.social",
  "nuform-social.com",
  "nuformsociall.com",
  "nuformsocial.com.",
]);

export type EmailValidationResult = {
  valid: boolean;
  email: string;
  normalizedEmail: string;
  corrected: boolean;
  error?: string;
  username: string;
  domain?: string;
  isExternal?: boolean;
};

/**
 * Validates and normalizes work emails for the Nuform organization.
 *
 * Rules:
 * 1. Accepts full email: `user@nuformsocial.com`
 * 2. Accepts username only: `user` -> normalizes to `user@nuformsocial.com`
 * 3. Auto-corrects common typos: `user@nurformsocial.com` -> `user@nuformsocial.com`
 * 4. Strips zero-width unicode spaces, trailing/leading whitespace, and normalizes case
 * 5. Rejects non-company domains (e.g. `@gmail.com`) with clear error messaging
 */
export function validateAndNormalizeEmail(
  input?: string | null,
): EmailValidationResult {
  if (!input) {
    return {
      valid: false,
      email: "",
      normalizedEmail: "",
      corrected: false,
      error: "Please enter your work email.",
      username: "",
    };
  }

  // Strip invisible unicode spaces, zero-width chars, and whitespace
  const clean = input
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .trim()
    .toLowerCase();

  if (!clean) {
    return {
      valid: false,
      email: "",
      normalizedEmail: "",
      corrected: false,
      error: "Please enter your work email.",
      username: "",
    };
  }

  // Case 1: User typed just username (e.g., "asush", "sushant", "first.last")
  if (!clean.includes("@")) {
    const validUsernameRegex = /^[a-z0-9._%+-]+$/i;
    if (!validUsernameRegex.test(clean)) {
      return {
        valid: false,
        email: clean,
        normalizedEmail: clean,
        corrected: false,
        error: "Username contains invalid characters.",
        username: clean,
      };
    }

    const normalized = `${clean}@${NUFORM_HOST}`;
    return {
      valid: true,
      email: clean,
      normalizedEmail: normalized,
      corrected: true,
      username: clean,
      domain: NUFORM_HOST,
    };
  }

  // Case 2: User typed an email with @
  const atIndex = clean.lastIndexOf("@");
  const username = clean.slice(0, atIndex).trim();
  const domain = clean.slice(atIndex + 1).trim();

  if (!username) {
    return {
      valid: false,
      email: clean,
      normalizedEmail: clean,
      corrected: false,
      error: "Please enter your username before the @.",
      username: "",
      domain,
    };
  }

  // Exact match with nuformsocial.com
  if (domain === NUFORM_HOST) {
    const normalized = `${username}@${NUFORM_HOST}`;
    return {
      valid: true,
      email: clean,
      normalizedEmail: normalized,
      corrected: false,
      username,
      domain: NUFORM_HOST,
    };
  }

  // Auto-correct common typos (e.g. nurformsocial.com, nuformssocial.com, etc.)
  if (
    COMMON_TYPO_DOMAINS.has(domain) ||
    ((domain.includes("nuform") || domain.includes("nurform")) &&
      domain.includes("social"))
  ) {
    const normalized = `${username}@${NUFORM_HOST}`;
    return {
      valid: true,
      email: clean,
      normalizedEmail: normalized,
      corrected: true,
      username,
      domain: NUFORM_HOST,
    };
  }

  // Incomplete domain typing (e.g., user just typed "user@" or "user@nuform")
  if (NUFORM_HOST.startsWith(domain) && domain.length < NUFORM_HOST.length) {
    return {
      valid: false,
      email: clean,
      normalizedEmail: `${username}@${NUFORM_HOST}`,
      corrected: false,
      error: `Keep typing: @${NUFORM_HOST}`,
      username,
      domain,
      isExternal: false,
    };
  }

  // Reject external/personal email providers
  return {
    valid: false,
    email: clean,
    normalizedEmail: clean,
    corrected: false,
    error: `Only @${NUFORM_HOST} email addresses are allowed. (@${domain} is not permitted)`,
    username,
    domain,
    isExternal: true,
  };
}

/**
 * Validates if an email belongs or normalizes to the Nuform organization domain.
 */
export function isNuformEmail(email?: string | null): boolean {
  return validateAndNormalizeEmail(email).valid;
}

export function formatNuformEmailError(email?: string | null): string {
  const res = validateAndNormalizeEmail(email);
  return res.valid
    ? ""
    : res.error || `Only ${NUFORM_DOMAIN} email addresses are allowed.`;
}
