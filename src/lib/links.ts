/**
 * Link recognition.
 *
 * V1 never fetches the URL. Everything here is derived from the host and
 * path, so pasting a link cannot make the server issue a request to it —
 * no SSRF surface, and no waiting on someone else's server to render a card.
 */

export type Provider =
  | "figma"
  | "github"
  | "youtube"
  | "vimeo"
  | "loom"
  | "drive"
  | "notion"
  | "dribbble"
  | "behance"
  | "codepen"
  | "website"
  | "other";

export type LinkInfo = {
  provider: Provider;
  /** Display name for the provider chip. */
  providerLabel: string;
  /** Host, for the card's secondary line. */
  host: string;
  /** A short human label derived from the path, when one can be had. */
  suggestedLabel: string;
  /**
   * An embeddable URL, when the provider supports it and we can build one
   * without guessing. Null means "link out, do not embed".
   */
  embedUrl: string | null;
  /** Embeds render in an iframe, so aspect ratio matters for layout. */
  embedAspect: "16/9" | "4/3" | "1/1" | null;
};

const HOSTS: Array<[RegExp, Provider, string]> = [
  [/(^|\.)figma\.com$/i, "figma", "Figma"],
  [/(^|\.)github\.com$/i, "github", "GitHub"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "youtube", "YouTube"],
  [/(^|\.)vimeo\.com$/i, "vimeo", "Vimeo"],
  [/(^|\.)loom\.com$/i, "loom", "Loom"],
  [/(^|\.)(drive|docs)\.google\.com$/i, "drive", "Google"],
  [/(^|\.)notion\.(so|site)$/i, "notion", "Notion"],
  [/(^|\.)dribbble\.com$/i, "dribbble", "Dribbble"],
  [/(^|\.)behance\.net$/i, "behance", "Behance"],
  [/(^|\.)codepen\.io$/i, "codepen", "CodePen"],
];

/** Titleise the last meaningful path segment: a decent default label. */
function labelFromPath(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const cleaned = decodeURIComponent(last)
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (cleaned && !/^[0-9a-f]{8,}$/i.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return url.hostname.replace(/^www\./, "");
}

export function inspectLink(raw: string): LinkInfo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // Only http(s). A javascript: or data: URL is never a work link.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^www\./, "");
  const match = HOSTS.find(([re]) => re.test(url.hostname));
  const provider: Provider = match ? match[1] : "website";
  const providerLabel = match ? match[2] : host;

  let embedUrl: string | null = null;
  let embedAspect: LinkInfo["embedAspect"] = null;

  switch (provider) {
    case "youtube": {
      const id =
        url.hostname.includes("youtu.be")
          ? url.pathname.slice(1)
          : (url.searchParams.get("v") ??
            (url.pathname.startsWith("/embed/")
              ? url.pathname.split("/")[2]
              : null));
      if (id && /^[\w-]{6,20}$/.test(id)) {
        embedUrl = `https://www.youtube-nocookie.com/embed/${id}`;
        embedAspect = "16/9";
      }
      break;
    }
    case "vimeo": {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d{6,12}$/.test(id)) {
        embedUrl = `https://player.vimeo.com/video/${id}`;
        embedAspect = "16/9";
      }
      break;
    }
    case "loom": {
      const id = url.pathname.split("/").filter(Boolean)[1];
      if (id && /^[0-9a-f]{16,40}$/i.test(id)) {
        embedUrl = `https://www.loom.com/embed/${id}`;
        embedAspect = "16/9";
      }
      break;
    }
    case "figma": {
      // Figma's own embed host takes the file URL as a parameter.
      if (/\/(file|design|proto|board)\//.test(url.pathname)) {
        embedUrl = `https://www.figma.com/embed?embed_host=worklog&url=${encodeURIComponent(url.toString())}`;
        embedAspect = "16/9";
      }
      break;
    }
    default:
      break;
  }

  return {
    provider,
    providerLabel,
    host,
    suggestedLabel: labelFromPath(url),
    embedUrl,
    embedAspect,
  };
}

/** Provider chip colours. Deliberately muted: the media is the content. */
export const PROVIDER_TINT: Record<Provider, string> = {
  figma: "text-[#C86A3B]",
  github: "text-text",
  youtube: "text-[#C0392B]",
  vimeo: "text-[#2E86AB]",
  loom: "text-[#6C5CE7]",
  drive: "text-[#2E7D46]",
  notion: "text-text",
  dribbble: "text-[#C2427A]",
  behance: "text-[#2B5CE6]",
  codepen: "text-text",
  website: "text-text-muted",
  other: "text-text-muted",
};
