import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

/**
 * Self-hosted at build time by next/font, so there is no runtime request to
 * Google and nothing render-blocking.
 *
 * Archivo is an industrial grotesque with real presence — deliberately not
 * Inter or Space Grotesk. JetBrains Mono carries the dates and frame
 * numbers, which is where the contact-sheet character lives.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Worklog", template: "%s · Worklog" },
  description: "A day-by-day sheet of what you actually did, with the proof.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${jetbrains.variable} h-full`}
    >
      <body className="bg-canvas text-text flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
