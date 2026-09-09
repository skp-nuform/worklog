"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Link2, Plus, Target } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import type { SheetDay, SheetEntry } from "./sheet-view";
import type { SheetAsset } from "./asset-tile";

function formatKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function MonthGrid({
  days,
  onSelectDay,
  onAddTarget,
}: {
  days: SheetDay[];
  onSelectDay?: (dateKey: string) => void;
  onAddTarget?: (dateKey: string) => void;
}) {
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1); // 1-indexed

  const todayKey = useMemo(() => {
    const d = new Date();
    return formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }, []);

  // Map entries by date key
  const dayMap = useMemo(() => {
    const map = new Map<string, SheetEntry[]>();
    for (const d of days) {
      map.set(d.workDate, d.entries);
    }
    return map;
  }, [days]);

  // Map future target entries by their target date (from target:YYYY-MM-DD tag or workDate)
  const targetsByDate = useMemo(() => {
    const map = new Map<string, SheetEntry[]>();
    for (const d of days) {
      for (const e of d.entries) {
        if (e.tags?.includes("target")) {
          const targetTag = e.tags.find((t) => t.startsWith("target:"));
          const targetDate = targetTag ? targetTag.replace("target:", "") : d.workDate;
          const list = map.get(targetDate) ?? [];
          list.push(e);
          map.set(targetDate, list);
        }
      }
    }
    return map;
  }, [days]);

  function prevMonth() {
    if (currentMonth === 1) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (currentMonth === 12) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  function jumpToToday() {
    const d = new Date();
    setCurrentYear(d.getFullYear());
    setCurrentMonth(d.getMonth() + 1);
  }

  // Month calculations
  const monthName = useMemo(() => {
    const d = new Date(currentYear, currentMonth - 1, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [currentYear, currentMonth]);

  const calendarDays = useMemo(() => {
    // 1st of the month
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    // Day of week: 0 is Sunday, convert to Monday=0
    const startOffset = (firstDay.getDay() + 6) % 7;
    // Total days in month
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const cells: { key: string; dayNum: number; inMonth: boolean }[] = [];

    // Empty lead cells
    for (let i = 0; i < startOffset; i++) {
      cells.push({ key: `lead-${i}`, dayNum: 0, inMonth: false });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      const key = formatKey(currentYear, currentMonth, d);
      cells.push({ key, dayNum: d, inMonth: true });
    }

    return cells;
  }, [currentYear, currentMonth]);

  return (
    <div className="border-frame bg-surface flex flex-col gap-3 border p-4">
      {/* Month header & navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-frame border-b pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{monthName}</h2>
          <span className="font-metadata text-text-muted text-[11px] tracking-[0.1em] uppercase">
            Month Grid
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={jumpToToday}
            className="font-metadata h-8 px-2.5 text-[11px] uppercase tracking-wider transition-all duration-150 active:scale-95 cursor-pointer"
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={prevMonth}
            aria-label="Previous month"
            className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 cursor-pointer"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={nextMonth}
            aria-label="Next month"
            className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 cursor-pointer"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <span
            key={w}
            className="font-metadata text-text-muted py-1 text-[10px] tracking-[0.14em] uppercase"
          >
            {w}
          </span>
        ))}
      </div>

      {/* 7-column Calendar grid */}
      <div
        key={`${currentYear}-${currentMonth}`}
        className="grid grid-cols-7 gap-1.5 animate-in fade-in-50 duration-200 fill-mode-both"
      >
        {calendarDays.map((cell) => {
          if (!cell.inMonth) {
            return (
              <div
                key={cell.key}
                className="border-frame/40 bg-surface/30 min-h-[96px] rounded-sm border border-dashed"
              />
            );
          }

          const entries = dayMap.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          const isFuture = cell.key > todayKey;
          const targetEntries = targetsByDate.get(cell.key) ?? entries.filter((e) => e.tags?.includes("target"));
          const workEntries = entries.filter((e) => !e.tags?.includes("target"));
          const totalAssets: SheetAsset[] = workEntries.flatMap((e) => e.assets);
          const previewAssets = totalAssets.slice(0, 3);

          return (
            <div
              key={cell.key}
              onClick={() => {
                if (isFuture) {
                  onAddTarget?.(cell.key);
                } else {
                  onSelectDay?.(cell.key);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={
                isFuture
                  ? `Set target for ${cell.key}`
                  : `View work for ${cell.key}`
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (isFuture) {
                    onAddTarget?.(cell.key);
                  } else {
                    onSelectDay?.(cell.key);
                  }
                }
              }}
              className={cn(
                "border-frame bg-surface hover:border-boundary hover:bg-elevated flex min-h-[110px] flex-col justify-between rounded-sm border p-2 text-left transition-colors cursor-pointer focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none group",
                isToday && "border-brand bg-brand/10 ring-2 ring-brand/60 shadow-sm",
                isFuture && "border-dashed bg-canvas/30 hover:border-brand/70 hover:bg-brand/5",
                entries.length > 0 && "bg-surface",
              )}
            >
              {/* Day number, today badge, and target add button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "font-metadata text-[13px] font-extrabold tabular-nums",
                      isToday ? "text-brand" : isFuture ? "text-text-muted" : "text-text",
                    )}
                  >
                    {String(cell.dayNum).padStart(2, "0")}
                  </span>

                  {isToday && (
                    <span className="font-metadata bg-brand text-white rounded-xs px-1.5 py-0.2 text-[8.5px] font-bold uppercase tracking-wider shadow-xs">
                      Today
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTarget?.(cell.key);
                  }}
                  title={`Set target for ${cell.key}`}
                  aria-label={`Set target for ${cell.key}`}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border transition-all cursor-pointer",
                    isFuture
                      ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand hover:text-white"
                      : "text-text-muted hover:text-white hover:bg-brand border-frame bg-surface",
                  )}
                >
                  <Plus className="size-3" />
                </button>
              </div>

              {/* Targets set for this day */}
              {targetEntries.length > 0 && (
                <div className="my-1 flex flex-col gap-0.5">
                  {targetEntries.map((t) => (
                    <div
                      key={t.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddTarget?.(cell.key);
                      }}
                      title={`Target: ${t.title.replace(/^🎯\s*Target:\s*/i, "")}`}
                      className="bg-brand/10 text-brand border-brand/30 hover:bg-brand/20 flex items-center gap-1 truncate rounded-xs border px-1 py-0.5 text-[9.5px] font-semibold transition-colors cursor-pointer"
                    >
                      <Target className="size-2.5 shrink-0" />
                      <span className="truncate">{t.title.replace(/^🎯\s*Target:\s*/i, "")}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Subtle prompt for empty future days */}
              {isFuture && targetEntries.length === 0 && (
                <div className="flex flex-1 items-center justify-center py-1">
                  <span className="text-[10px] text-text-muted/40 group-hover:text-brand/80 font-metadata transition-colors">
                    + Set Target
                  </span>
                </div>
              )}

              {/* Thumbnails of work */}
              {previewAssets.length > 0 ? (
                <div className="flex items-center gap-1 my-1 overflow-hidden">
                  {previewAssets.map((asset, i) => (
                    <div
                      key={asset.id || i}
                      className="border-frame bg-elevated relative size-7 shrink-0 overflow-hidden rounded-xs border"
                    >
                      {asset.kind === "image" && asset.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.src}
                          alt={asset.label || "Proof"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          {asset.kind === "link" ? (
                            <Link2 aria-hidden="true" className="text-text-muted size-3" />
                          ) : (
                            <ImageIcon aria-hidden="true" className="text-text-muted size-3" />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {totalAssets.length > 3 && (
                    <span className="font-metadata text-text-muted text-[9px] tabular-nums">
                      +{totalAssets.length - 3}
                    </span>
                  )}
                </div>
              ) : (
                <div className="min-h-7" />
              )}

              {/* Entry title snippet */}
              {entries.length > 0 ? (
                <p className="text-text line-clamp-1 text-[10.5px] font-medium leading-tight">
                  {entries[0].title}
                </p>
              ) : (
                <span className="text-text-muted/40 text-[9px] select-none">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
