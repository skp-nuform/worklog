"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Briefcase, Pencil, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Composer } from "@/components/sheet/composer";
import { EditEntryDialog } from "@/components/sheet/edit-entry-dialog";
import { MonthGrid } from "@/components/sheet/month-grid";
import { SheetControls, type ActiveFilters, type Person } from "@/components/sheet/sheet-controls";
import { SheetView, type SheetDay, type SheetEntry } from "@/components/sheet/sheet-view";
import { ShareDialog } from "@/components/sheet/share-dialog";
import { TargetDialog } from "@/components/sheet/target-dialog";
import { WeekStrip } from "@/components/sheet/week-strip";
import { Button } from "@/components/ui/button";
import { deleteEntry } from "@/features/sheet/actions";
import { updateTargetStatus } from "@/features/target/actions";

export function SheetClient({
  workspaceId,
  workspaceName,
  viewerId,
  viewerRole = "member",
  days,
  people,
  tags = [],
  activeFilters = {},
}: {
  workspaceId: string;
  workspaceName: string;
  viewerId: string;
  viewerRole?: "owner" | "admin" | "member" | "guest";
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
  const showAuthors = true;

  const hasActiveFilters = Boolean(
    activeFilters.q ||
      activeFilters.tag ||
      activeFilters.from ||
      activeFilters.to ||
      activeFilters.who ||
      activeFilters.dept,
  );

  const filteredPerson = useMemo(() => {
    if (!activeFilters.who || activeFilters.who === "me") return null;
    return people.find((p) => p.user_id === activeFilters.who) ?? null;
  }, [activeFilters.who, people]);

  const isFilteringMyLogs = activeFilters.who === "me";

  function clearWhoFilter() {
    const params = new URLSearchParams(window.location.search);
    params.delete("who");
    const qs = params.toString();
    router.push((qs ? `/sheet?${qs}` : "/sheet") as never, { scroll: false });
  }

  function clearDeptFilter() {
    const params = new URLSearchParams(window.location.search);
    params.delete("dept");
    const qs = params.toString();
    router.push((qs ? `/sheet?${qs}` : "/sheet") as never, { scroll: false });
  }

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

  function handleTargetStatusChange(
    targetId: string,
    status: "upcoming" | "in_progress" | "done" | "missed",
  ) {
    startTransition(async () => {
      const result = await updateTargetStatus({ targetId, status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Target marked ${status.replace("_", " ")}`);
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
          {/* 1. Search & Filter Command Bar (TOP of calendar) */}
          <SheetControls
            tags={tags}
            people={people}
            viewerId={viewerId}
            activeFilters={activeFilters}
          />

          {/* 2. Active Search / Teammate Context Banners (Visual Anchor) */}
          {filteredPerson && (
            <div className="flex items-center justify-between rounded-lg border border-brand/40 bg-brand/10 px-4 py-2.5 text-text animate-in fade-in-0 slide-in-from-top-1 duration-150">
              <div className="flex items-center gap-2.5 text-xs">
                <div className="flex size-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white uppercase">
                  {filteredPerson.display_name.slice(0, 1)}
                </div>
                <span>
                  Viewing logs for <strong className="text-text font-semibold">{filteredPerson.display_name}</strong>
                  {filteredPerson.department ? (
                    <span className="text-brand ml-1 font-medium">({filteredPerson.department})</span>
                  ) : null}
                </span>
              </div>
              <button
                type="button"
                onClick={clearWhoFilter}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer"
              >
                <X className="size-3.5" />
                Show All Team
              </button>
            </div>
          )}

          {isFilteringMyLogs && (
            <div className="flex items-center justify-between rounded-lg border border-brand/30 bg-elevated/80 px-4 py-2 text-text animate-in fade-in-0 duration-150">
              <div className="flex items-center gap-2 text-xs">
                <User className="size-4 text-brand" />
                <span>
                  Viewing <strong>your own logs only</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={clearWhoFilter}
                className="flex items-center gap-1 text-xs font-medium text-brand hover:underline cursor-pointer"
              >
                <X className="size-3.5" />
                Show All Team
              </button>
            </div>
          )}

          {activeFilters.dept && (
            <div className="flex items-center justify-between rounded-lg border border-frame bg-elevated/70 px-4 py-2 text-text animate-in fade-in-0 duration-150">
              <div className="flex items-center gap-2 text-xs">
                <Briefcase className="size-3.5 text-text-muted" />
                <span>
                  Department filter: <strong className="text-brand">{activeFilters.dept}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={clearDeptFilter}
                className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text hover:underline cursor-pointer"
              >
                <X className="size-3.5" />
                Clear department
              </button>
            </div>
          )}

          {/* 3. Week strip calendar quick navigation */}
          <WeekStrip
            days={days}
            selectedDate={selectedWorkDate ?? undefined}
            onSelectDate={handleJumpToDate}
            onAddTarget={(dateKey) => setTargetDate(dateKey)}
          />

          {/* 4. Daily work composer */}
          <Composer
            key={selectedWorkDate ?? "composer"}
            workspaceId={workspaceId}
            initialDate={selectedWorkDate ?? undefined}
            onSaved={() => router.refresh()}
          />

          {/* 5. Day-by-Day Sheet View */}
          <SheetView
            days={days}
            showAuthors={showAuthors}
            allowDownload
            defaultAuthor="Abhishek"
            viewerId={viewerId}
            viewerRole={viewerRole}
            onEdit={(entry) =>
              setEditingEntry(
                entry as SheetEntry & { version: number; work_date?: string },
              )
            }
            onDelete={(entry) => remove(entry)}
            onStatusChange={handleTargetStatusChange}
            emptyState={
              hasActiveFilters ? (
                <div className="border-frame flex flex-col items-start gap-3 border border-dashed px-6 py-12">
                  <div className="flex flex-col gap-1">
                    <p className="text-text text-[17px] font-semibold">
                      No entries match your filters
                    </p>
                    <p className="text-text-muted prose-measure text-sm">
                      We couldn&apos;t find any logged work matching your current search or teammate criteria.
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
