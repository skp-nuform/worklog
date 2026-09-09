import { notFound } from "next/navigation";

import { SheetView, type SheetDay } from "@/components/sheet/sheet-view";
import { hashShareToken } from "@/lib/share-token";
import { createClient } from "@/lib/supabase/server";

// Never cached and never indexed: the projection is grant-specific, and
// revocation has to take effect immediately.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Shared work",
  robots: { index: false, follow: false },
};

type SharedDoc = {
  label: string | null;
  allow_download: boolean;
  expires_at: string | null;
  scope: { from_date: string | null; to_date: string | null; single_author: boolean };
  people: { id: string; name: string }[];
  days: {
    work_date: string;
    entries: {
      id: string;
      title: string;
      note: string | null;
      tags: string[];
      author_id: string;
      author_name: string | null;
      assets: {
        id: string;
        kind: "link" | "image" | "video" | "file";
        url: string | null;
        provider: string | null;
        label: string | null;
        mime_type: string | null;
        byte_size: number | null;
        width: number | null;
        height: number | null;
        has_file: boolean;
      }[];
    }[];
  }[];
};

export default async function SharedSheetPage({
  params,
}: PageProps<"/s/[token]">) {
  const { token } = await params;

  let tokenHash: string;
  try {
    tokenHash = hashShareToken(token);
  } catch {
    notFound();
  }

  // No session: this runs as `anon`, which may call exactly this function
  // and one other, both of which require the token hash.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_shared_sheet", {
    p_token_hash: tokenHash,
  });

  // Wrong token, revoked, and expired are deliberately indistinguishable —
  // otherwise a share URL becomes an enumeration oracle.
  if (error || !data) notFound();

  const doc = data as SharedDoc;

  const days: SheetDay[] = doc.days.map((d) => ({
    workDate: d.work_date,
    entries: d.entries.map((e) => ({
      id: e.id,
      title: e.title,
      note: e.note,
      tags: e.tags,
      author_id: e.author_id,
      author_name: e.author_name,
      assets: e.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.url,
        provider: a.provider,
        label: a.label,
        mime_type: a.mime_type,
        byte_size: a.byte_size,
        width: a.width,
        height: a.height,
        // Files stream through the proxy so revocation is immediate; the
        // object path is never sent to the guest.
        src: a.has_file ? `/s/${token}/asset/${a.id}` : a.url,
      })),
    })),
  }));

  const total = days.reduce((n, d) => n + d.entries.length, 0);
  const people = doc.people.map((p) => p.name).filter(Boolean);
  const expires = doc.expires_at ? new Date(doc.expires_at) : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
      <header className="border-frame flex flex-col gap-2 border-b pb-5">
        <p className="font-metadata text-text-muted text-[10px] tracking-[0.2em] uppercase">
          Welcome Abhishek 👋 · Shared Work Log
        </p>

        <h1 className="text-[30px] leading-none font-bold tracking-[-0.02em] lg:text-[38px]">
          {doc.label ?? "SKP Work Log"}
        </h1>
        <p className="text-text-muted text-xs">
          Daily progress, deliverables & feedback. View high-res photos, download attachments, or leave comments and updates below.
        </p>

        <div className="text-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] pt-1">
          <span className="font-metadata tabular-nums">
            {total} {total === 1 ? "entry" : "entries"} · {days.length}{" "}
            {days.length === 1 ? "day" : "days"}
          </span>

          {people.length > 0 && (
            <span>{people.length === 1 ? people[0] : `${people.length} people`}</span>
          )}

          {(doc.scope.from_date || doc.scope.to_date) && (
            <span className="font-metadata">
              {doc.scope.from_date ?? "start"} → {doc.scope.to_date ?? "now"}
            </span>
          )}

          {/* State the terms plainly rather than implying them. */}
          <span className="font-metadata">
            {doc.allow_download ? "downloads on" : "view only"}
          </span>

          {expires && (
            <span className="font-metadata">
              access ends{" "}
              {expires.toLocaleDateString(undefined, { dateStyle: "medium" })}
            </span>
          )}
        </div>
      </header>

      <SheetView
        days={days}
        showAuthors={false}
        allowDownload={doc.allow_download}
        token={token}
        defaultAuthor="Abhishek"
        emptyState={
          <div className="border-frame border border-dashed px-6 py-12">
            <p className="text-text font-semibold">Nothing here yet</p>
            <p className="text-text-muted mt-1 text-sm">
              This link is live, but no work has been logged in its range.
            </p>
          </div>
        }
      />

      <footer className="border-frame text-text-muted border-t pt-4 text-[12px]">
        Shared with you as read-only. Anyone with this link can open it, so
        treat it as you would a forwarded email.
      </footer>
    </main>
  );
}
