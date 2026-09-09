"use client";

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { cn } from "cn";

import type { SheetDay, SheetEntry } from "./sheet-view";

type Person = {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
};

function formatKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function TeamTracker({
  people,
  days,
  onSelectCell,
}: {
  people: Person[];
  days: SheetDay[];
  onSelectCell?: (userId: string, dateKey: string) => void;
}) {
  const [hoveredCell, setHoveredCell] = useState<{
    userId: string;
    dateKey: string;
    entries: SheetEntry[];
  } | null>(null);

  // Derive unique past 14 days or use the dates present in the sheet
  const trackerDays = useMemo(() => {
    // If days has records, get the date range; otherwise generate the last 14 days
    const now = new Date();
    const result: { key: string; weekday: string; dayNum: string; isToday: boolean }[] = [];
    const today = formatKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = formatKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
      result.push({
        key,
        weekday: d.toLocaleDateString("en-US", { weekday: "narrow" }),
        dayNum: String(d.getDate()).padStart(2, "0"),
        isToday: key === today,
      });
    }
    return result;
  }, []);

  // Map entries by person and date: personId -> dateKey -> entries
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, SheetEntry[]>>();
    for (const d of days) {
      for (const e of d.entries) {
        if (!map.has(e.author_id)) {
          map.set(e.author_id, new Map());
        }
        const userDateMap = map.get(e.author_id)!;
        const list = userDateMap.get(d.workDate) ?? [];
        list.push(e);
        userDateMap.set(d.workDate, list);
      }
    }
    return map;
  }, [days]);

  return (
    <div className="border-frame bg-surface flex flex-col gap-3 border p-4">
      <div className="flex items-center justify-between border-frame border-b pb-3">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="text-text-muted size-4" />
          <h2 className="text-lg font-semibold tracking-tight">Team Tracker</h2>
          <span className="font-metadata text-text-muted text-[11px] tracking-wider uppercase">
            People × Days
          </span>
        </div>
        <p className="font-metadata text-text-muted text-[11px] tracking-wider uppercase">
          Past 14 days
        </p>
      </div>

      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-frame border-b">
              <th className="font-metadata text-text-muted sticky left-0 z-10 bg-surface min-w-[140px] py-2 text-[10px] tracking-wider uppercase">
                Member
              </th>
              {trackerDays.map((d) => (
                <th
                  key={d.key}
                  className={cn(
                    "font-metadata min-w-[40px] px-1 py-2 text-center text-[10px] tabular-nums tracking-wider uppercase",
                    d.isToday ? "text-brand font-bold" : "text-text-muted",
                  )}
                >
                  <div>{d.weekday}</div>
                  <div className="text-[12px]">{d.dayNum}</div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-frame divide-y">
            {people.map((person) => {
              const userDateMap = matrix.get(person.user_id);
              return (
                <tr key={person.user_id} className="hover:bg-elevated/40">
                  <td className="sticky left-0 z-10 bg-surface py-2.5 pr-3 text-xs font-medium">
                    <div className="flex flex-col">
                      <span className="text-text truncate">{person.display_name}</span>
                      <span className="font-metadata text-text-muted text-[9.5px] uppercase tracking-wider">
                        {person.role}
                      </span>
                    </div>
                  </td>

                  {trackerDays.map((d) => {
                    const entries = userDateMap?.get(d.key) ?? [];
                    const count = entries.length;

                    return (
                      <td
                        key={d.key}
                        className="px-1 py-2 text-center"
                        onMouseEnter={() => {
                          if (count > 0) {
                            setHoveredCell({
                              userId: person.user_id,
                              dateKey: d.key,
                              entries,
                            });
                          }
                        }}
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        <button
                          type="button"
                          disabled={count === 0}
                          onClick={() => onSelectCell?.(person.user_id, d.key)}
                          className={cn(
                            "font-metadata focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-xs text-[11px] font-bold tabular-nums transition-colors focus-visible:ring-1 focus-visible:outline-none",
                            count > 0
                              ? "bg-text text-canvas hover:bg-brand cursor-pointer"
                              : "text-text-muted/30 cursor-default",
                            d.isToday && count === 0 && "bg-brand/10 text-brand",
                          )}
                        >
                          {count > 0 ? count : "·"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Hover preview tooltip card */}
      {hoveredCell && hoveredCell.entries.length > 0 && (
        <div className="border-frame bg-elevated/95 flex flex-col gap-1.5 rounded-sm border p-3 text-xs shadow-md">
          <div className="flex items-center justify-between border-frame border-b pb-1.5">
            <span className="font-metadata text-text-muted text-[10px] tracking-wider uppercase">
              {hoveredCell.dateKey} · {hoveredCell.entries.length} logged
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {hoveredCell.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="bg-brand size-1.5 rounded-full shrink-0" />
                <span className="text-text font-medium truncate">{e.title}</span>
                {e.assets.length > 0 && (
                  <span className="font-metadata text-text-muted text-[10px] tabular-nums">
                    ({e.assets.length} proof{e.assets.length === 1 ? "" : "s"})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
