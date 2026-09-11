export const NUFORM_DOMAIN = "@nuformsocial.com";

/**
 * Validates if an email strictly belongs to the Nuform organization domain.
 */
export function isNuformEmail(email?: string | null): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  return trimmed.endsWith(NUFORM_DOMAIN) && trimmed.length > NUFORM_DOMAIN.length;
}

export function formatNuformEmailError(email?: string | null): string {
  if (!email || !email.trim()) {
    return "Enter your work email address.";
  }
  if (!isNuformEmail(email)) {
    return "Access restricted: Only @nuformsocial.com email addresses are allowed.";
  }
  return "";
}
