"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ExternalLink,
  FileText,
  Film,
  Globe,
  MoreHorizontal,
  Pencil,
  Play,
  Share2,
  Trash2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { inspectLink, PROVIDER_TINT, type Provider } from "@/lib/links";
import { parseEntryContent } from "@/lib/comments";
import { isTargetEntry } from "@/lib/targets";
import { TargetCard } from "./target-card";
import type { SheetAsset } from "./asset-tile";
import type { SheetEntry } from "./sheet-view";

export type WorkCardProps = {
  entry: SheetEntry;
  viewerId?: string;
  viewerRole?: "owner" | "admin" | "member" | "guest";
  showAuthors?: boolean;
  token?: string;
  onOpenAsset?: (asset: SheetAsset) => void;
  onSelectEntry?: (entry: SheetEntry) => void;
  onEdit?: (entry: SheetEntry) => void;
  onDelete?: (entry: SheetEntry) => void;
  onStatusChange?: (targetId: string, status: "upcoming" | "in_progress" | "done" | "missed") => void;
  className?: string;
};

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkCard({
  entry,
  viewerId,
  viewerRole = "member",
  showAuthors = true,
  token,
  onOpenAsset,
  onSelectEntry,
  onEdit,
  onDelete,
  onStatusChange,
  className,
}: WorkCardProps) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // If this entry is a Target, delegate to TargetCard
  if (isTargetEntry(entry)) {
    return (
      <TargetCard
        entry={entry}
        viewerId={viewerId}
        viewerRole={viewerRole}
        showAuthors={showAuthors}
        token={token}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
        onDelete={onDelete}
        className={className}
      />
    );
  }

  const { note: cleanNote, comments } = parseEntryContent(entry.note);
  const isAuthor = Boolean(viewerId && entry.author_id === viewerId);
  const isAdmin = viewerRole === "owner" || viewerRole === "admin";
  const canModify = isAuthor || isAdmin;

  // Classify entry presentation
  const assets = entry.assets ?? [];
  const primaryImage = assets.find((a) => a.kind === "image" && Boolean(a.src));
  const primaryVideo = assets.find((a) => a.kind === "video" || (a.kind === "link" && a.provider === "loom"));
  const primaryLink = assets.find((a) => a.kind === "link" && a.provider !== "loom");
  const primaryFile = assets.find((a) => a.kind === "file");

  const hasVisual = Boolean(primaryImage || primaryVideo);
  const hasLink = Boolean(primaryLink);
  const hasFile = Boolean(primaryFile);

  const linkInfo = primaryLink?.url ? inspectLink(primaryLink.url) : null;
  const provider = (primaryLink?.provider ?? linkInfo?.provider ?? "website") as Provider;

  async function handleCopyLink(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const url = token
        ? `${window.location.origin}/s/${token}#entry-${entry.id}`
        : `${window.location.origin}/sheet?entry=${entry.id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Entry link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  }

  const authorInitials = (entry.author_name || "T")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      id={`entry-${entry.id}`}
      onClick={() => onSelectEntry?.(entry)}
      className={cn(
        "group relative flex flex-col rounded-xl border border-frame bg-surface shadow-xs transition-all duration-200",
        "hover:border-brand/40 hover:shadow-md cursor-pointer overflow-hidden",
        className,
      )}
    >
      {/* 1. VISUAL WORK PRESENTATION: Large preview-led */}
      {hasVisual && (
        <div className="relative aspect-video w-full overflow-hidden bg-elevated/70">
          {primaryImage ? (
            <div className="relative h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={primaryImage.src ?? ""}
                alt={primaryImage.label ?? entry.title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAsset?.(primaryImage);
                }}
                className="absolute inset-0 bg-transparent cursor-zoom-in"
                aria-label="View image full size"
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-canvas/80">
              <div className="flex size-14 items-center justify-center rounded-full border border-boundary bg-surface/90 shadow-md transition-transform duration-300 group-hover:scale-110">
                <Play className="size-6 text-brand translate-x-0.5" />
              </div>
              <span className="absolute bottom-3 left-3 rounded-md bg-canvas/90 px-2 py-1 text-[11px] font-medium font-metadata uppercase tracking-wider text-text-muted backdrop-blur-xs">
                {primaryVideo?.provider ?? "Video Preview"}
              </span>
            </div>
          )}

          {assets.length > 1 && (
            <span className="absolute top-3 left-3 rounded-full bg-canvas/90 px-2.5 py-0.5 text-[11px] font-semibold text-text shadow-sm backdrop-blur-xs">
              +{assets.length - 1} more
            </span>
          )}

          {/* Direct Launch / Preview button */}
          {primaryVideo?.url && (
            <a
              href={primaryVideo.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="absolute top-3 right-3 flex items-center gap-1.5 rounded-md border border-frame/70 bg-canvas/90 px-2.5 py-1 text-[11px] font-medium text-text shadow-xs backdrop-blur-xs hover:border-brand hover:text-brand transition-colors"
            >
              <span>Watch</span>
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {/* 2. LINK-BASED WORK PRESENTATION: Figma / Loom / Web preview banner */}
      {!hasVisual && hasLink && (
        <div className="relative border-b border-frame/80 bg-linear-to-r from-elevated/80 to-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg border border-frame bg-surface text-brand shadow-xs">
                {provider === "figma" ? (
                  <span className="text-[13px] font-black text-[#F24E1E]">Fg</span>
                ) : provider === "github" ? (
                  <span className="text-[13px] font-bold text-text">Gh</span>
                ) : (
                  <Globe className="size-4 text-brand" />
                )}
              </span>
              <div className="flex flex-col">
                <span className={cn("text-[11px] font-bold font-metadata uppercase tracking-wider", PROVIDER_TINT[provider] ?? "text-brand")}>
                  {linkInfo?.providerLabel ?? provider}
                </span>
                <span className="text-[12px] text-text-muted truncate max-w-[240px]">
                  {linkInfo?.host ?? "External Resource"}
                </span>
              </div>
            </div>

            {primaryLink?.url && (
              <a
                href={primaryLink.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/20 transition-colors"
              >
                <span>Open {linkInfo?.providerLabel ?? "Link"}</span>
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* 3. FILE / DOCUMENT WORK PRESENTATION: Document badge */}
      {!hasVisual && !hasLink && hasFile && (
        <div className="relative border-b border-frame/80 bg-elevated/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg border border-frame bg-surface text-brand shadow-xs">
                <FileText className="size-4 text-brand" />
              </span>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-text truncate max-w-[240px]">
                  {primaryFile?.label ?? "Attached Document"}
                </span>
                <span className="text-[11px] font-metadata text-text-muted">
                  {formatBytes(primaryFile?.byte_size)}
                </span>
              </div>
            </div>

            {primaryFile?.src && (
              <a
                href={primaryFile.src}
                download
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md border border-frame bg-surface px-2.5 py-1 text-xs font-medium text-text hover:border-brand hover:text-brand transition-colors"
              >
                <span>Download</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* CARD BODY */}
      <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
        <div className="flex flex-col gap-2">
          {/* Header row: Title + Actions */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[16px] sm:text-[17px] font-semibold text-text leading-snug tracking-[-0.01em]">
              {entry.title}
            </h3>

            {/* Actions Menu */}
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy deep link"
                className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text transition-colors"
              >
                {copied ? <Check className="size-3.5 text-brand" /> : <Share2 className="size-3.5" />}
              </button>

              {canModify && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen(!menuOpen)}
                    aria-label="More actions"
                    className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text transition-colors"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>

                  {menuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-8 z-30 flex min-w-[140px] flex-col rounded-lg border border-frame bg-surface p-1 shadow-lg animate-in fade-in-0 zoom-in-95">
                        {isAdmin && !isAuthor && (
                          <div className="border-b border-frame px-2 py-1 text-[10px] font-semibold uppercase text-brand font-metadata">
                            Admin Access
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onEdit?.(entry);
                          }}
                          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-text hover:bg-elevated text-left transition-colors"
                        >
                          <Pencil className="size-3.5 text-text-muted" />
                          <span>Edit entry</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onDelete?.(entry);
                          }}
                          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 text-left transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                          <span>Delete entry</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 4. TEXT-ONLY WORK PRESENTATION: Accent bar + note content */}
          {cleanNote && (
            <p className={cn(
              "text-[13.5px] leading-relaxed text-text-muted line-clamp-3 whitespace-pre-wrap",
              !hasVisual && !hasLink && !hasFile && "border-l-2 border-brand/60 pl-3 italic text-text/90"
            )}>
              {cleanNote}
            </p>
          )}

          {/* Tags list */}
          {entry.tags && entry.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {entry.tags
                .filter((t) => t !== "target" && !t.startsWith("target:"))
                .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-sm bg-elevated/70 px-1.5 py-0.5 text-[10.5px] font-medium font-metadata text-text-muted uppercase tracking-wider"
                  >
                    #{tag}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* Footer: Author chip + Comments indicator */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-frame/50 pt-3 text-xs">
          {showAuthors && (entry.author_name || entry.author_department) && (
            <div onClick={(e) => e.stopPropagation()}>
              {token ? (
                <div className="flex items-center gap-2">
                  <div className="flex size-5 items-center justify-center rounded-full bg-brand/15 text-[10px] font-bold text-brand">
                    {authorInitials}
                  </div>
                  <span className="font-medium text-text">{entry.author_name ?? "Teammate"}</span>
                  {entry.author_department && (
                    <span className="text-[10px] font-metadata uppercase text-text-muted">
                      · {entry.author_department}
                    </span>
                  )}
                </div>
              ) : (
                <Link
                  href={`/sheet?who=${encodeURIComponent(entry.author_id)}` as never}
                  title={`Filter by ${entry.author_name ?? "teammate"}`}
                  className="group/author flex items-center gap-2 rounded-full py-0.5 pr-2 transition-colors hover:bg-elevated"
                >
                  <div className="flex size-5 items-center justify-center rounded-full bg-brand/15 text-[10px] font-bold text-brand group-hover/author:bg-brand group-hover/author:text-white transition-colors">
                    {authorInitials}
                  </div>
                  <span className="font-medium text-text group-hover/author:text-brand transition-colors">
                    {entry.author_name ?? "Teammate"}
                  </span>
                  {entry.author_department && (
                    <span className="text-[10px] font-metadata uppercase text-text-muted">
                      · {entry.author_department}
                    </span>
                  )}
                </Link>
              )}
            </div>
          )}

          {comments.length > 0 && (
            <span className="font-metadata text-[11px] text-brand font-medium">
              {comments.length} {comments.length === 1 ? "comment" : "comments"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
