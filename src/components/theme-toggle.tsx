"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

const ORDER = ["light", "dark", "system"] as const;
const LABEL = { light: "Light", dark: "Dark", system: "System" } as const;
const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Cycles light -> dark -> system. All three states the PRD requires.
 * Renders a stable placeholder until mounted, because the resolved theme is
 * not known during SSR and a mismatch would flash.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  const current = (hydrated ? theme : "system") as keyof typeof LABEL;
  const Icon = ICON[current] ?? Monitor;
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      // Icon-only control: the label carries the meaning, per MASTER.md 2.5.
      aria-label={`Theme: ${LABEL[current] ?? "System"}. Switch to ${LABEL[next]}.`}
      title={`Theme: ${LABEL[current] ?? "System"}`}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
