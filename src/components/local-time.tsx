"use client";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * A relative timestamp whose ABSOLUTE value is available to keyboard and
 * touch users, not only on pointer hover — the PRD is explicit about this.
 * The absolute value lives in the accessible name via <time title>, and the
 * element is focusable so a keyboard user can reach it.
 *
 * Rendered client-side because the viewer's timezone is only known there;
 * the server sends the raw instant. Until hydration it shows the absolute
 * date, which is never wrong — only less friendly.
 */
export function LocalTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const hydrated = useHydrated();

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const absolute = date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const label = hydrated ? relative(date) : absolute;

  return (
    <time
      dateTime={iso}
      title={absolute}
      aria-label={absolute}
      tabIndex={0}
      className={className}
    >
      {label}
    </time>
  );
}

function relative(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (abs < 60) return rtf.format(-Math.round(seconds), "second");
  if (abs < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  if (abs < 2592000) return rtf.format(-Math.round(seconds / 86400), "day");
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
