"use client";

import { useMemo } from "react";
import { Plus, Target } from "lucide-react";
import { cn } from "cn";

import type { SheetDay } from "./sheet-view";

function formatKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function WeekStrip({
  days,
  selectedDate,
  onSelectDate,
  onAddTarget,
}: {
  days: SheetDay[];
  selectedDate?: string;
  onSelectDate?: (dateKey: string) => void;
  onAddTarget?: (dateKey: string) => void;
}) {
  const today = useMemo(() => {
    const d = new Date();
    return formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }, []);

  const countsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      map.set(d.workDate, d.entries.length);
    }
    return map;
  }, [days]);

  // Target counts by target date
  const targetsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      for (const e of d.entries) {
        if (e.tags?.includes("target")) {
          const targetTag = e.tags.find((t) => t.startsWith("target:"));
          const targetDate = targetTag ? targetTag.replace("target:", "") : d.workDate;
          map.set(targetDate, (map.get(targetDate) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [days]);

  // Generate the current week (Monday to Sunday)
  const weekDays = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);

    const result = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const key = formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
      result.push({
        key,
        dayNum: String(d.getDate()).padStart(2, "0"),
        weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
        isToday: key === today,
        isFuture: key > today,
        count: countsByDay.get(key) ?? 0,
        targetCount: targetsByDay.get(key) ?? 0,
      });
    }
    return result;
  }, [today, countsByDay, targetsByDay]);

  function handleClick(d: (typeof weekDays)[0]) {
    if (d.isFuture && onAddTarget) {
      onAddTarget(d.key);
      return;
    }
    if (onSelectDate) {
      onSelectDate(d.key);
      return;
    }
    const el = document.getElementById(`day-${d.key}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="border-frame bg-surface flex flex-col gap-2 border p-2.5">
      <div className="flex items-center justify-between px-1">
        <p className="font-metadata text-text-muted text-[10px] tracking-[0.16em] uppercase">
          This Week
        </p>
        <span className="font-metadata text-text-muted text-[10px] tracking-wider uppercase">
          Mon – Sun · Click + on future days to set targets
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {weekDays.map((d) => {
          const isSelected = selectedDate === d.key;
          return (
            <div
              key={d.key}
              onClick={() => handleClick(d)}
              className={cn(
                "border-frame relative flex flex-col items-center gap-1 rounded-sm border p-1.5 transition-all text-center cursor-pointer",
                d.isToday && "border-brand bg-brand/10 ring-2 ring-brand/60 shadow-sm",
                isSelected && "border-brand bg-elevated ring-2 ring-brand",
                d.isFuture && "border-dashed bg-canvas/30 hover:border-brand/70 hover:bg-brand/5",
                !d.isToday && !isSelected && !d.isFuture && "hover:border-boundary hover:bg-elevated",
              )}
              title={d.isFuture ? `Click to set target for ${d.weekday}, ${d.dayNum}` : undefined}
            >
              <span
                className={cn(
                  "font-metadata text-[10px] tracking-[0.12em] uppercase font-bold",
                  d.isToday ? "text-brand" : "text-text-muted",
                )}
              >
                {d.weekday}
              </span>

              <span
                className={cn(
                  "font-metadata text-[16px] font-extrabold tabular-nums sm:text-[18px]",
                  d.isToday ? "text-brand" : d.isFuture ? "text-text-muted" : "text-text",
                )}
              >
                {d.dayNum}
              </span>

              <div className="flex h-4 items-center justify-center">
                {d.isFuture ? (
                  d.targetCount > 0 ? (
                    <span className="font-metadata bg-brand text-white inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[8.5px] font-bold tabular-nums shadow-xs">
                      <Target className="size-2" /> {d.targetCount}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onAddTarget) onAddTarget(d.key);
                      }}
                      title="Set target for this date"
                      aria-label={`Set target for ${d.weekday}, ${d.dayNum}`}
                      className="text-brand hover:bg-brand hover:text-white border-brand/30 bg-brand/5 flex size-4.5 items-center justify-center rounded-full border transition-all cursor-pointer"
                    >
                      <Plus className="size-2.5" />
                    </button>
                  )
                ) : d.count > 0 ? (
                  <span className="font-metadata bg-text text-canvas min-w-3.5 px-1 py-0.2 rounded-full text-[9px] font-bold tabular-nums">
                    {d.count}
                  </span>
                ) : (
                  <span className="bg-frame size-1 rounded-full" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
