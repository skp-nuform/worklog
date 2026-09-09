/**
 * Maps a database error code to user-facing copy.
 *
 * P0404 covers both "missing" and "invisible to you" deliberately: telling
 * the two apart would confirm that a record exists in someone else's
 * workspace.
 */
export function messageForCode(code: string | undefined, fallback: string) {
  switch (code) {
    case "P0401":
      return "Your session has expired. Sign in again.";
    case "P0403":
      return "You do not have permission to do that.";
    case "P0404":
      return "That is not available.";
    case "P0409":
      return "This changed while you were editing. Reload and try again.";
    case "P0410":
      return "That action is not allowed right now.";
    case "P0400":
      return "Some of that input was not valid.";
    case "23514":
      return "That change is not permitted by the record's rules.";
    case "23505":
      return "That already exists.";
    case "23503":
      return "That reference points outside this workspace.";
    case "42501":
      return "You do not have permission to do that.";
    default:
      return fallback;
  }
}
