"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Briefcase,
  Calendar,
  FilterX,
  Search,
  SlidersHorizontal,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ActiveFilters = {
  q?: string;
  tag?: string;
  from?: string;
  to?: string;
  who?: string;
  dept?: string;
};

export type Person = {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  department?: string | null;
};

const DEPARTMENTS = [
  "Design",
  "Engineering",
  "Social & Content",
  "Marketing",
  "Operations",
  "Strategy",
] as const;

export function SheetControls({
  tags,
  people = [],
  viewerId,
  activeFilters,
}: {
  tags: string[];
  people?: Person[];
  viewerId?: string;
  activeFilters: ActiveFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [prevQ, setPrevQ] = useState(activeFilters.q ?? "");
  const [searchTerm, setSearchTerm] = useState(activeFilters.q ?? "");
  const [showFilters, setShowFilters] = useState(
    Boolean(activeFilters.tag || activeFilters.from || activeFilters.to),
  );

  if ((activeFilters.q ?? "") !== prevQ) {
    setPrevQ(activeFilters.q ?? "");
    setSearchTerm(activeFilters.q ?? "");
  }

  // Keyboard shortcut: Cmd+K / Ctrl+K to focus search input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value.trim() === "") {
        params.delete(key);
      } else {
        params.set(key, value.trim());
      }
      const qs = params.toString();
      startTransition(() => {
        router.push((qs ? `${pathname}?${qs}` : pathname) as never, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  const clearAllFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("tag");
    params.delete("from");
    params.delete("to");
    params.delete("who");
    params.delete("dept");
    setSearchTerm("");
    const qs = params.toString();
    startTransition(() => {
      router.push((qs ? `${pathname}?${qs}` : pathname) as never, {
        scroll: false,
      });
    });
  }, [pathname, router, searchParams]);

  const hasFilters = Boolean(
    activeFilters.q ||
      activeFilters.tag ||
      activeFilters.from ||
      activeFilters.to ||
      activeFilters.who ||
      activeFilters.dept,
  );

  const activeFilterCount =
    (activeFilters.tag ? 1 : 0) +
    (activeFilters.from || activeFilters.to ? 1 : 0) +
    (activeFilters.who ? 1 : 0) +
    (activeFilters.dept ? 1 : 0);

  // Quick Month Jump handler
  const handleMonthChange = (monthStr: string) => {
    if (!monthStr) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("from");
      params.delete("to");
      const qs = params.toString();
      startTransition(() => {
        router.push((qs ? `${pathname}?${qs}` : pathname) as never, {
          scroll: false,
        });
      });
      return;
    }
    const [year, month] = monthStr.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const params = new URLSearchParams(searchParams.toString());
    params.set("from", startDate);
    params.set("to", endDate);
    const qs = params.toString();
    startTransition(() => {
      router.push((qs ? `${pathname}?${qs}` : pathname) as never, {
        scroll: false,
      });
    });
  };

  // Derive recent 8 months for jump dropdown
  const recentMonths: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    recentMonths.push({ value, label });
  }

  // Detect if current from/to corresponds to a whole month
  const activeMonthValue = (() => {
    if (activeFilters.from && activeFilters.to) {
      const fromM = activeFilters.from.slice(0, 7);
      const toM = activeFilters.to.slice(0, 7);
      if (fromM === toM && activeFilters.from.endsWith("-01")) {
        return fromM;
      }
    }
    return "";
  })();

  function handleSearchSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    updateParam("q", searchTerm || null);
  }

  const isAllTeam = !activeFilters.who;
  const isMyLogs =
    activeFilters.who === "me" ||
    (viewerId && activeFilters.who === viewerId);

  return (
    <div className="border-frame bg-surface flex flex-col gap-3 rounded-xl border p-3.5 shadow-xs">
      {/* Row 1: Unified Command Bar (Search Input + Search CTA + Filter Drawer Button) */}
      <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="text-text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search tasks, notes, proof links, or tags... (⌘K)"
            className="h-10 pl-9 pr-16 text-sm bg-elevated/30 border-frame focus:border-brand"
            aria-label="Search work"
          />
          <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5">
            {searchTerm ? (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  updateParam("q", null);
                }}
                aria-label="Clear search"
                className="text-text-muted hover:text-text focus-visible:ring-ring rounded p-1 focus-visible:ring-2 focus-visible:outline-none cursor-pointer"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : (
              <kbd className="border-frame bg-elevated hidden rounded border px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline-block">
                ⌘K
              </kbd>
            )}
          </div>
        </div>

        {/* Search button */}
        <Button
          type="submit"
          className="h-10 px-4 text-xs font-semibold bg-brand text-white hover:bg-brand-hover cursor-pointer"
        >
          Search
        </Button>

        {/* Advanced Filters toggle button */}
        <Button
          type="button"
          variant={showFilters ? "secondary" : "outline"}
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "h-10 gap-1.5 px-3.5 text-xs font-medium transition-all duration-150 active:scale-95 cursor-pointer border-frame",
            (showFilters || activeFilterCount > 0) &&
              "border-brand text-brand ring-1 ring-brand/30",
          )}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal
            className={cn(
              "size-3.5 transition-transform duration-200",
              showFilters && "rotate-90 text-brand",
            )}
          />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-brand text-white font-metadata ml-0.5 rounded-full px-1.5 py-0.2 text-[9px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="text-text-muted hover:text-text h-10 gap-1 px-2.5 text-xs transition-all duration-150 active:scale-95 cursor-pointer"
          >
            <FilterX aria-hidden="true" className="size-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        )}
      </form>

      {/* Row 2: Team Member & Department Quick Filters (Hick's Law - 1-click decisions) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-frame/50 pt-2.5">
        {/* Teammate Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-metadata text-text-muted mr-1 flex items-center gap-1 text-[10px] tracking-wider uppercase font-semibold">
            <Users className="size-3" />
            Team:
          </span>

          <button
            type="button"
            onClick={() => updateParam("who", null)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
              isAllTeam
                ? "bg-brand text-white font-semibold shadow-xs"
                : "bg-elevated/60 text-text-muted border border-frame hover:border-brand/40 hover:text-text",
            )}
          >
            All Team
          </button>

          <button
            type="button"
            onClick={() => updateParam("who", "me")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
              isMyLogs
                ? "bg-brand text-white font-semibold shadow-xs"
                : "bg-elevated/60 text-text-muted border border-frame hover:border-brand/40 hover:text-text",
            )}
          >
            My Logs
          </button>

          {/* Teammate Select Dropdown for specific people */}
          {people.length > 0 && (
            <div className="relative inline-flex items-center">
              <select
                aria-label="Filter by specific teammate"
                value={
                  activeFilters.who && activeFilters.who !== "me"
                    ? activeFilters.who
                    : ""
                }
                onChange={(e) => updateParam("who", e.target.value || null)}
                className="h-7 rounded-full border border-frame bg-elevated/60 px-2.5 text-xs text-text focus:border-brand focus:outline-none cursor-pointer"
              >
                <option value="">Teammates ({people.length})...</option>
                {people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.display_name} {p.department ? `(${p.department})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Department Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-metadata text-text-muted mr-1 flex items-center gap-1 text-[10px] tracking-wider uppercase font-semibold">
            <Briefcase className="size-3" />
            Dept:
          </span>

          <button
            type="button"
            onClick={() => updateParam("dept", null)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
              !activeFilters.dept
                ? "bg-text text-canvas font-semibold"
                : "bg-elevated/40 text-text-muted border border-frame/70 hover:text-text",
            )}
          >
            All
          </button>

          {DEPARTMENTS.map((dept) => {
            const isActive =
              activeFilters.dept?.toLowerCase() === dept.toLowerCase();
            return (
              <button
                key={dept}
                type="button"
                onClick={() => updateParam("dept", isActive ? null : dept)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
                  isActive
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "bg-elevated/40 text-text-muted border border-frame/70 hover:border-brand/40 hover:text-text",
                )}
              >
                {dept}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: Collapsible Drawer for Dates, Months, and Tags */}
      {showFilters && (
        <div className="border-frame bg-elevated/40 flex flex-col gap-3 rounded-lg border p-3 transition-all animate-in fade-in-0 slide-in-from-top-2 duration-200 ease-out fill-mode-both">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Jump to month */}
              <div className="flex items-center gap-1.5">
                <Calendar aria-hidden="true" className="text-text-muted size-3.5" />
                <select
                  value={activeMonthValue}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  aria-label="Jump to month"
                  className="border-frame bg-surface text-text font-metadata focus-visible:ring-ring h-9 rounded-md border px-2.5 text-xs uppercase tracking-[0.06em] focus-visible:ring-2 focus-visible:outline-none cursor-pointer"
                >
                  <option value="">Jump to Month</option>
                  {recentMonths.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date range inputs */}
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="filter-from"
                  className="font-metadata text-text-muted text-[10px] uppercase tracking-wider"
                >
                  From
                </label>
                <Input
                  id="filter-from"
                  type="date"
                  value={activeFilters.from ?? ""}
                  onChange={(e) => updateParam("from", e.target.value || null)}
                  className="font-metadata h-9 w-[9rem] text-xs px-2.5 bg-surface border-frame"
                  aria-label="From date"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="filter-to"
                  className="font-metadata text-text-muted text-[10px] uppercase tracking-wider"
                >
                  To
                </label>
                <Input
                  id="filter-to"
                  type="date"
                  value={activeFilters.to ?? ""}
                  onChange={(e) => updateParam("to", e.target.value || null)}
                  className="font-metadata h-9 w-[9rem] text-xs px-2.5 bg-surface border-frame"
                  aria-label="To date"
                />
              </div>
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="font-metadata text-text-muted hover:text-destructive text-xs uppercase tracking-wider underline underline-offset-4 cursor-pointer"
              >
                Reset all filters
              </button>
            )}
          </div>

          {/* Tag filter chips */}
          {tags.length > 0 && (
            <div className="border-frame/60 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
              <span className="font-metadata text-text-muted mr-1 text-[10px] tracking-[0.14em] uppercase">
                Tags:
              </span>
              <button
                type="button"
                onClick={() => updateParam("tag", null)}
                className={cn(
                  "font-metadata focus-visible:ring-ring rounded px-2.5 py-1 text-[11px] tracking-[0.06em] uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none cursor-pointer",
                  !activeFilters.tag
                    ? "bg-text text-canvas font-semibold"
                    : "border-frame text-text-muted hover:border-boundary hover:text-text border bg-surface",
                )}
              >
                All
              </button>
              {tags.map((t) => {
                const isActive = activeFilters.tag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateParam("tag", isActive ? null : t)}
                    className={cn(
                      "font-metadata focus-visible:ring-ring rounded px-2.5 py-1 text-[11px] tracking-[0.06em] uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none cursor-pointer",
                      isActive
                        ? "bg-brand text-white font-semibold shadow-xs"
                        : "border-frame text-text-muted hover:border-boundary hover:text-text border bg-surface",
                    )}
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
