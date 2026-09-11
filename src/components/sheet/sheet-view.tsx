"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { cn } from "cn";

import { AssetTile, type SheetAsset } from "./asset-tile";
import { EntryComments } from "./entry-comments";
import { Lightbox } from "./lightbox";
import { parseEntryContent } from "@/lib/comments";

export type SheetEntry = {
  id: string;
  title: string;
  note: string | null;
  tags: string[];
  author_id: string;
  author_name: string | null;
  author_department?: string | null;
  assets: SheetAsset[];
};

export type SheetDay = {
  workDate: string;
  entries: SheetEntry[];
};

/**
 * The contact sheet.
 *
 * A sticky day spine on the left, and each day's work as a strip of framed
 * proofs to its right. The spine is the product's whole organising idea:
 * you scan down days, not through a feed.
 */
export function SheetView({
  days,
  showAuthors = false,
  allowDownload = true,
  emptyState,
  actions,
  token,
  defaultAuthor = "Abhishek",
}: {
  days: SheetDay[];
  showAuthors?: boolean;
  allowDownload?: boolean;
  emptyState?: React.ReactNode;
  /** Per-entry controls, rendered only where the viewer may act. */
  actions?: (entry: SheetEntry) => React.ReactNode;
  token?: string;
  defaultAuthor?: string;
}) {
  // The lightbox walks a flat list, so arrow keys cross entry boundaries
  // the way they would on a real sheet.
  const flat = useMemo(
    () =>
      days.flatMap((d) =>
        d.entries.flatMap((e) =>
          e.assets.map((a) => ({ asset: a, caption: `${e.title} · ${d.workDate}` })),
        ),
      ),
    [days],
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = flat.findIndex((f) => f.asset.id === openId);
  const open = openIndex >= 0 ? flat[openIndex] : null;

  const onOpen = useCallback((a: SheetAsset) => setOpenId(a.id), []);

  if (days.length === 0) return <>{emptyState}</>;

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="flex flex-col">
        {days.map((day, dayIndex) => {
          const d = parseDay(day.workDate);
          const isToday = day.workDate === todayKey;

          return (
            <section
              key={day.workDate}
              aria-labelledby={`day-${day.workDate}`}
              className="border-spine group/day flex gap-4 border-t py-6 first:border-t-0 first:pt-0 sm:gap-6"
            >
              {/* ---- the spine ---- */}
              <div className="w-14 shrink-0 sm:w-20">
                <div
                  className="sticky top-20 flex flex-col items-start"
                  id={`day-${day.workDate}`}
                >
                  <span
                    className={cn(
                      "font-metadata text-[10px] tracking-[0.18em] uppercase font-bold",
                      isToday ? "text-brand" : "text-text-muted",
                    )}
                  >
                    {d.weekday}
                  </span>
                  <span
                    className={cn(
                      "font-metadata text-[30px] leading-none font-bold tabular-nums sm:text-[38px]",
                      isToday ? "text-brand" : "text-text",
                    )}
                  >
                    {d.day}
                  </span>
                  <span className="font-metadata text-text-muted text-[10px] tracking-[0.18em] uppercase">
                    {d.month}
                  </span>

                  {isToday && (
                    <span className="bg-brand text-white font-metadata mt-2 rounded-xs px-2 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase shadow-xs">
                      Today
                    </span>
                  )}

                  <span className="font-metadata text-text-muted mt-2 text-[10px] tabular-nums">
                    {day.entries.length}
                    <span className="sr-only"> entries</span>
                  </span>
                </div>
              </div>

              {/* ---- the day's work ---- */}
              <div className="flex min-w-0 flex-1 flex-col gap-6">
                {day.entries.map((entry) => {
                  const { note: cleanNote, comments } = parseEntryContent(entry.note);
                  const isTarget = entry.tags?.includes("target");
                  const targetDateTag = entry.tags?.find((t) => t.startsWith("target:"));
                  const targetDateStr = targetDateTag ? targetDateTag.replace("target:", "") : null;

                  return (
                    <article key={entry.id} className="flex flex-col gap-2.5">
                      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <div className="flex items-center gap-2">
                          {isTarget && (
                            <span className="bg-brand/10 text-brand font-metadata rounded-sm px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.1em] uppercase">
                              🎯 Target {targetDateStr ? `due ${targetDateStr}` : ""}
                            </span>
                          )}
                          <h3 className="text-text text-[17px] leading-snug font-semibold tracking-[-0.01em]">
                            {entry.title}
                          </h3>
                        </div>

                        {showAuthors && (entry.author_name || entry.author_department) && (
                          token ? (
                            <span className="border-frame/80 bg-elevated/40 text-text-muted font-metadata inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[10px] tracking-[0.04em]">
                              <span className="size-1.5 rounded-full bg-brand/70 shrink-0" />
                              <span className="font-medium text-text/90">
                                {entry.author_name ?? "Teammate"}
                              </span>
                              {entry.author_department && (
                                <span className="text-text-dim text-[9px] uppercase tracking-wider font-mono">
                                  · {entry.author_department}
                                </span>
                              )}
                            </span>
                          ) : (
                            <Link
                              href={`/sheet?who=${encodeURIComponent(entry.author_id)}` as never}
                              title={`Filter logs by ${entry.author_name ?? "this teammate"}`}
                              className="border-frame/80 hover:border-brand/60 bg-elevated/40 hover:bg-elevated text-text-muted hover:text-text font-metadata inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[10px] tracking-[0.04em] transition-colors focus-visible:ring-1 focus-visible:ring-brand focus-visible:outline-none cursor-pointer"
                            >
                              <span className="size-1.5 rounded-full bg-brand/70 shrink-0" />
                              <span className="font-medium text-text/90">
                                {entry.author_name ?? "Teammate"}
                              </span>
                              {entry.author_department && (
                                <span className="text-text-dim text-[9px] uppercase tracking-wider font-mono">
                                  · {entry.author_department}
                                </span>
                              )}
                            </Link>
                          )
                        )}

                        {entry.tags
                          .filter((t) => t !== "target" && !t.startsWith("target:"))
                          .map((t) => (
                            <Link
                              key={t}
                              href={`/sheet?tag=${encodeURIComponent(t)}` as never}
                              className="text-text-muted hover:text-text focus-visible:ring-ring font-metadata rounded-sm text-[10px] tracking-[0.08em] uppercase transition-colors focus-visible:ring-1 focus-visible:outline-none"
                            >
                              #{t}
                            </Link>
                          ))}

                        {actions && (
                          <span className="ml-auto opacity-0 transition-opacity group-hover/day:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
                            {actions(entry)}
                          </span>
                        )}
                      </header>

                      {cleanNote && (
                        <p className="text-text-muted prose-measure text-[13.5px] leading-relaxed whitespace-pre-wrap">
                          {cleanNote}
                        </p>
                      )}

                      {entry.assets.length > 0 && (
                        <div className="mt-0.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                          {entry.assets.map((asset, i) => (
                            <AssetTile
                              key={asset.id}
                              asset={asset}
                              index={i + dayIndex * 0}
                              onOpen={onOpen}
                              allowDownload={allowDownload}
                            />
                          ))}
                        </div>
                      )}

                      {/* Comments & updates for boss and author */}
                      <EntryComments
                        entryId={entry.id}
                        initialComments={comments}
                        token={token}
                        defaultAuthor={defaultAuthor}
                      />
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <Lightbox
        asset={open?.asset ?? null}
        caption={open?.caption}
        allowDownload={allowDownload}
        onClose={() => setOpenId(null)}
        onPrev={
          openIndex > 0 ? () => setOpenId(flat[openIndex - 1].asset.id) : undefined
        }
        onNext={
          openIndex >= 0 && openIndex < flat.length - 1
            ? () => setOpenId(flat[openIndex + 1].asset.id)
            : undefined
        }
      />
    </>
  );
}

/**
 * Formats a `YYYY-MM-DD` calendar date without going through a timezone.
 * `new Date("2026-09-09")` is parsed as UTC midnight and can render as the
 * 8th west of Greenwich — which would put work on the wrong day.
 */
function parseDay(key: string) {
  const [y, m, dd] = key.split("-").map(Number);
  const local = new Date(y, (m ?? 1) - 1, dd ?? 1);
  return {
    weekday: local.toLocaleDateString(undefined, { weekday: "short" }),
    day: String(dd ?? 1).padStart(2, "0"),
    month: local.toLocaleDateString(undefined, { month: "short" }),
    year: String(y),
  };
}
