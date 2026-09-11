"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "cn";

import { type SheetAsset } from "./asset-tile";
import { EntryDetailDrawer } from "./entry-detail-drawer";
import { Lightbox } from "./lightbox";
import { WorkCard } from "./work-card";

export type SheetEntry = {
  id: string;
  title: string;
  note: string | null;
  tags: string[];
  author_id: string;
  author_name: string | null;
  author_department?: string | null;
  assets: SheetAsset[];
  version?: number;
  work_date?: string;
};

export type SheetDay = {
  workDate: string;
  entries: SheetEntry[];
};

export type SheetViewProps = {
  days: SheetDay[];
  showAuthors?: boolean;
  allowDownload?: boolean;
  emptyState?: React.ReactNode;
  /** Per-entry controls, rendered only where the viewer may act. */
  actions?: (entry: SheetEntry) => React.ReactNode;
  token?: string;
  defaultAuthor?: string;
  viewerId?: string;
  viewerRole?: "owner" | "admin" | "member" | "guest";
  onEdit?: (entry: SheetEntry) => void;
  onDelete?: (entry: SheetEntry) => void;
  onStatusChange?: (targetId: string, status: "upcoming" | "in_progress" | "done" | "missed") => void;
};

/**
 * Creative Studio Contact Sheet & Timeline
 *
 * Sticky date spine on the left, visual work cards in a dominant responsive grid
 * on the right. Clicking any card opens the EntryDetailDrawer.
 */
export function SheetView({
  days,
  showAuthors = false,
  allowDownload = true,
  emptyState,
  actions,
  token,
  defaultAuthor = "Abhishek",
  viewerId,
  viewerRole = "member",
  onEdit,
  onDelete,
  onStatusChange,
}: SheetViewProps) {
  const searchParams = useSearchParams();
  const deepLinkEntryId = searchParams.get("entry");

  // Selected entry for Detail Drawer
  const [selectedEntry, setSelectedEntry] = useState<SheetEntry | null>(null);

  // Lightbox flat list for direct full-screen media inspection
  const flat = useMemo(
    () =>
      days.flatMap((d) =>
        d.entries.flatMap((e) =>
          e.assets.map((a) => ({ asset: a, caption: `${e.title} · ${d.workDate}` })),
        ),
      ),
    [days],
  );

  const [openLightboxAssetId, setOpenLightboxAssetId] = useState<string | null>(null);
  const openIndex = flat.findIndex((f) => f.asset.id === openLightboxAssetId);
  const openLightbox = openIndex >= 0 ? flat[openIndex] : null;

  const onOpenAsset = useCallback((a: SheetAsset) => setOpenLightboxAssetId(a.id), []);

  // Deep-link resolution on initial load or URL change
  useEffect(() => {
    if (!deepLinkEntryId) return;
    for (const d of days) {
      const match = d.entries.find((e) => e.id === deepLinkEntryId);
      if (match) {
        setSelectedEntry(match);
        break;
      }
    }
  }, [deepLinkEntryId, days]);

  if (days.length === 0) return <>{emptyState}</>;

  return (
    <>
      <div className="flex flex-col gap-8 sm:gap-10">
        {days.map((day) => {
          const d = formatDayHeader(day.workDate);

          return (
            <section
              key={day.workDate}
              aria-labelledby={`day-${day.workDate}`}
              className="border-spine group/day flex flex-col sm:flex-row gap-4 border-t border-frame/70 pt-8 first:border-t-0 first:pt-0 sm:gap-6"
            >
              {/* ---- the spine rail ---- */}
              <div className="w-full sm:w-24 shrink-0">
                <div
                  className="sticky top-20 flex sm:flex-col items-baseline sm:items-start justify-between sm:justify-start gap-1 sm:gap-0"
                  id={`day-${day.workDate}`}
                >
                  <div className="flex sm:flex-col items-baseline sm:items-start gap-1.5 sm:gap-0">
                    <span
                      className={cn(
                        "font-metadata text-[10px] sm:text-[11px] tracking-[0.18em] uppercase font-bold",
                        d.isToday ? "text-brand" : "text-text-muted",
                      )}
                    >
                      {d.weekdayShort}
                    </span>
                    <span
                      className={cn(
                        "font-metadata text-[28px] sm:text-[36px] leading-none font-extrabold tabular-nums",
                        d.isToday ? "text-brand" : "text-text",
                      )}
                    >
                      {d.dayNum}
                    </span>
                    <span className="font-metadata text-text-muted text-[10px] tracking-[0.18em] uppercase">
                      {d.monthShort}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 sm:flex-col sm:items-start">
                    {d.isToday && (
                      <span className="bg-brand text-white font-metadata sm:mt-2.5 rounded-sm px-2 py-0.5 text-[9.5px] font-bold tracking-[0.12em] uppercase shadow-xs">
                        Today
                      </span>
                    )}

                    <span className="font-metadata text-text-muted sm:mt-2 text-[10px] tabular-nums">
                      {day.entries.length} {day.entries.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ---- the day's studio work grid ---- */}
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                {/* Visual day date label */}
                <div className="flex items-center gap-2 border-b border-frame/40 pb-2">
                  <span className="font-metadata text-xs font-bold uppercase tracking-wider text-brand">
                    {d.prefix}
                  </span>
                  <span className="text-xs font-medium text-text-muted">
                    {d.dateStr}
                  </span>
                </div>

                {/* Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5.5">
                  {day.entries.map((entry) => (
                    <WorkCard
                      key={entry.id}
                      entry={entry}
                      viewerId={viewerId}
                      viewerRole={viewerRole}
                      showAuthors={showAuthors}
                      token={token}
                      onOpenAsset={onOpenAsset}
                      onSelectEntry={(e) => setSelectedEntry(e)}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onStatusChange={onStatusChange}
                    />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Entry Detail Drawer */}
      <EntryDetailDrawer
        open={Boolean(selectedEntry)}
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        viewerId={viewerId}
        viewerRole={viewerRole}
        token={token}
        defaultAuthor={defaultAuthor}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpenAsset={onOpenAsset}
        onStatusChange={onStatusChange}
      />

      {/* Lightbox for direct zoom */}
      <Lightbox
        asset={openLightbox?.asset ?? null}
        caption={openLightbox?.caption}
        allowDownload={allowDownload}
        onClose={() => setOpenLightboxAssetId(null)}
        onPrev={
          openIndex > 0 ? () => setOpenLightboxAssetId(flat[openIndex - 1].asset.id) : undefined
        }
        onNext={
          openIndex >= 0 && openIndex < flat.length - 1
            ? () => setOpenLightboxAssetId(flat[openIndex + 1].asset.id)
            : undefined
        }
      />
    </>
  );
}

/**
 * Formats a `YYYY-MM-DD` calendar date cleanly and derives TODAY / YESTERDAY prefixes.
 */
function formatDayHeader(key: string) {
  const [y, m, dd] = key.split("-").map(Number);
  const local = new Date(y, (m ?? 1) - 1, dd ?? 1);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  let prefix = "";
  if (key === todayKey) prefix = "TODAY • ";
  else if (key === yesterdayKey) prefix = "YESTERDAY • ";

  const dateStr = local.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return {
    prefix,
    dateStr,
    weekdayShort: local.toLocaleDateString("en-US", { weekday: "short" }),
    dayNum: String(dd ?? 1).padStart(2, "0"),
    monthShort: local.toLocaleDateString("en-US", { month: "short" }),
    isToday: key === todayKey,
  };
}
