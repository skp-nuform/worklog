"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Resolves the viewer's preference to an EXPLICIT class on <html>.
 *
 * This matters: the design tokens handle system dark via
 * `prefers-color-scheme`, but shadcn's `dark:` utilities key off the `.dark`
 * class. Without an explicit class, a system-dark viewer would get dark
 * tokens and light `dark:` utilities. `enableSystem` + `value` mapping keeps
 * the two mechanisms in agreement. See docs/decisions.md D-17.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      value={{ light: "light", dark: "dark" }}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
