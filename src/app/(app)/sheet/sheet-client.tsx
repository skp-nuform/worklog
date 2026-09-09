"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Composer } from "@/components/sheet/composer";
import { EditEntryDialog } from "@/components/sheet/edit-entry-dialog";
import { MonthGrid } from "@/components/sheet/month-grid";
import { SheetControls, type ActiveFilters } from "@/components/sheet/sheet-controls";
import { SheetView, type SheetDay, type SheetEntry } from "@/components/sheet/sheet-view";
import { ShareDialog } from "@/components/sheet/share-dialog";
import { TargetDialog } from "@/components/sheet/target-dialog";
import { WeekStrip } from "@/components/sheet/week-strip";
import { Button } from "@/components/ui/button";
import { deleteEntry } from "@/features/sheet/actions";

type Person = {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
};

export function SheetClient({
  workspaceId,
  workspaceName,
  viewerId,
  days,
  people,
  tags = [],
  activeFilters = {},
}: {
  workspaceId: string;
  workspaceName: string;
  viewerId: string;
  days: (SheetDay & { entries: (SheetEntry & { version: number })[] })[];
  people: Person[];
  tags?: string[];
  activeWho?: string | null;
  activeFilters?: ActiveFilters;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<"sheet" | "month">("sheet");
  const [share, setShare] = useState(false);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [selectedWorkDate, setSelectedWorkDate] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<
    (SheetEntry & { version: number; work_date?: string }) | null
  >(null);

  const total = days.reduce((n, d) => n + d.entries.length, 0);
  const showAuthors = false;

  const hasActiveFilters = Boolean(
    activeFilters.q ||
      activeFilters.tag ||
      activeFilters.from ||
      activeFilters.to,
  );

  function remove(entry: SheetEntry) {
    if (
      !window.confirm(
        `Delete "${entry.title}"? Its attachments go with it. This cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteEntry(entry.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
      router.refresh();
    });
  }

  function handleJumpToDate(dateKey: string) {
    const today = new Date().toISOString().slice(0, 10);
    if (dateKey > today) {
      setTargetDate(dateKey);
      return;
    }
    setViewMode("sheet");
    setSelectedWorkDate(dateKey);
    setTimeout(() => {
      const el = document.getElementById(`day-${dateKey}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        const composerEl = document.getElementById("daily-composer");
        if (composerEl) {
          composerEl.scrollIntoView({ behavior: "smooth", block: "center" });
          const titleInput = document.getElementById("entry-title");
          if (titleInput) titleInput.focus();
        }
      }
    }, 50);
  }

  // Targets scheduled for the currently selected target date
  const existingTargetsForDate = useMemo(() => {
    if (!targetDate) return [];
    const list: SheetEntry[] = [];
    for (const d of days) {
      for (const e of d.entries) {
        if (e.tags?.includes("target")) {
          const targetTag = e.tags.find((t) => t.startsWith("target:"));
          const tDate = targetTag ? targetTag.replace("target:", "") : d.workDate;
          if (tDate === targetDate) {
            list.push(e);
          }
        }
      }
    }
    return list;
  }, [days, targetDate]);

  function handleDeleteTarget(entryId: string) {
    startTransition(async () => {
      const result = await deleteEntry(entryId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Target removed");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* ---- masthead ---- */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="font-metadata text-text-muted text-[10px] tracking-[0.2em] uppercase">
              Welcome Abhishek 👋 · {workspaceName}
            </p>
            <h1 className="text-[30px] leading-none font-bold tracking-[-0.02em] lg:text-[38px]">
              SKP Work Log
            </h1>
            <p className="text-text-muted text-xs">
              Daily visual work log, deliverables, feedback & upcoming targets
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* View mode switcher */}
            <div
              role="radiogroup"
              aria-label="View mode"
              className="border-frame bg-surface flex items-center rounded-sm border p-0.5"
            >
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === "sheet"}
                onClick={() => setViewMode("sheet")}
                className={cn(
                  "font-metadata focus-visible:ring-ring rounded-xs px-2.5 py-1 text-[11px] tracking-[0.08em] uppercase transition-all duration-150 ease-out active:scale-95 cursor-pointer focus-visible:ring-2 focus-visible:outline-none",
                  viewMode === "sheet"
                    ? "bg-text text-canvas font-semibold shadow-xs"
                    : "text-text-muted hover:text-text",
                )}
              >
                Sheet
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === "month"}
                onClick={() => setViewMode("month")}
                className={cn(
                  "font-metadata focus-visible:ring-ring rounded-xs px-2.5 py-1 text-[11px] tracking-[0.08em] uppercase transition-all duration-150 ease-out active:scale-95 cursor-pointer focus-visible:ring-2 focus-visible:outline-none",
                  viewMode === "month"
                    ? "bg-text text-canvas font-semibold shadow-xs"
                    : "text-text-muted hover:text-text",
                )}
              >
                Month
              </button>
            </div>

            <span className="font-metadata text-text-muted text-[10px] tracking-[0.14em] uppercase tabular-nums">
              {total} {total === 1 ? "entry" : "entries"} · {days.length}{" "}
              {days.length === 1 ? "day" : "days"}
            </span>
            <Button type="button" variant="outline" onClick={() => setShare(true)}>
              Share
            </Button>
          </div>
        </div>
      </header>

      {viewMode === "sheet" && (
        <div className="flex flex-col gap-6 animate-view-in">
          {/* Week strip quick navigation with future dates target overlay */}
          <WeekStrip
            days={days}
            selectedDate={selectedWorkDate ?? undefined}
            onSelectDate={handleJumpToDate}
            onAddTarget={(dateKey) => setTargetDate(dateKey)}
          />

          {/* Search, tag and date controls */}
          <SheetControls tags={tags} activeFilters={activeFilters} />

          <Composer
            key={selectedWorkDate ?? "composer"}
            workspaceId={workspaceId}
            initialDate={selectedWorkDate ?? undefined}
            onSaved={() => router.refresh()}
          />

          <SheetView
            days={days}
            showAuthors={showAuthors}
            allowDownload
            defaultAuthor="Abhishek"
            actions={(entry) =>
              entry.author_id === viewerId ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingEntry(
                        entry as SheetEntry & { version: number; work_date?: string },
                      )
                    }
                    aria-label={`Edit ${entry.title}`}
                    className="text-text-muted hover:text-text focus-visible:ring-ring rounded p-1 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Pencil aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(entry)}
                    aria-label={`Delete ${entry.title}`}
                    className="text-text-muted hover:text-destructive focus-visible:ring-ring rounded p-1 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              ) : null
            }
            emptyState={
              hasActiveFilters ? (
                <div className="border-frame flex flex-col items-start gap-3 border border-dashed px-6 py-12">
                  <div className="flex flex-col gap-1">
                    <p className="text-text text-[17px] font-semibold">
                      No entries match your filters
                    </p>
                    <p className="text-text-muted prose-measure text-sm">
                      We couldn&apos;t find any logged work matching your current search or date criteria.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => router.push("/sheet", { scroll: false })}
                    className="text-xs"
                  >
                    Clear all filters
                  </Button>
                </div>
              ) : (
                <div className="border-frame flex flex-col items-start gap-2 border border-dashed px-6 py-12">
                  <p className="text-text text-[17px] font-semibold">
                    Nothing on the sheet yet
                  </p>
                  <p className="text-text-muted prose-measure text-sm">
                    Log the first thing you did today. Paste a screenshot, drop in a
                    Figma or Loom link, and it lands under today&apos;s date.
                  </p>
                </div>
              )
            }
          />
        </div>
      )}

      {viewMode === "month" && (
        <div className="animate-view-in">
          <MonthGrid
            days={days}
            onSelectDay={handleJumpToDate}
            onAddTarget={(dateKey) => setTargetDate(dateKey)}
          />
        </div>
      )}

      <ShareDialog
        open={share}
        onClose={() => setShare(false)}
        workspaceId={workspaceId}
        people={people}
        viewerId={viewerId}
      />

      <EditEntryDialog
        open={Boolean(editingEntry)}
        entry={editingEntry}
        workspaceId={workspaceId}
        onClose={() => setEditingEntry(null)}
        onUpdated={() => router.refresh()}
      />

      <TargetDialog
        open={Boolean(targetDate)}
        targetDate={targetDate}
        workspaceId={workspaceId}
        existingTargets={existingTargetsForDate}
        onDeleteTarget={handleDeleteTarget}
        onClose={() => setTargetDate(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
