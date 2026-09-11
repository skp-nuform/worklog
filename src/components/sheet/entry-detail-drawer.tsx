"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  FileText,
  Play,
  Pencil,
  Trash2,
  Share2,
  Check,
  Shield,
  Clock,
  Calendar,
  Tag,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { inspectLink, PROVIDER_TINT, type Provider } from "@/lib/links";
import { parseEntryContent } from "@/lib/comments";
import { isTargetEntry, parseTargetEntry } from "@/lib/targets";
import { EntryComments } from "./entry-comments";
import type { SheetAsset } from "./asset-tile";
import type { SheetEntry } from "./sheet-view";

export type EntryDetailDrawerProps = {
  entry: SheetEntry | null;
  open: boolean;
  onClose: () => void;
  viewerId?: string;
  viewerRole?: "owner" | "admin" | "member" | "guest";
  token?: string;
  defaultAuthor?: string;
  onEdit?: (entry: SheetEntry) => void;
  onDelete?: (entry: SheetEntry) => void;
  onOpenAsset?: (asset: SheetAsset) => void;
  onStatusChange?: (targetId: string, status: "upcoming" | "in_progress" | "done" | "missed") => void;
};

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EntryDetailDrawer({
  entry,
  open,
  onClose,
  viewerId,
  viewerRole = "member",
  token,
  defaultAuthor = "Abhishek",
  onEdit,
  onDelete,
  onOpenAsset,
  onStatusChange,
}: EntryDetailDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [activeAssetIndex, setActiveAssetIndex] = useState(0);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open || !entry) return null;

  const isTarget = isTargetEntry(entry);
  const targetData = isTarget ? parseTargetEntry(entry) : null;

  const isAuthor = Boolean(viewerId && entry.author_id === viewerId);
  const isAdmin = viewerRole === "owner" || viewerRole === "admin";
  const canModify = isAuthor || isAdmin;
  const isSupervisory = isAdmin && !isAuthor;

  const { note: cleanNote, comments } = parseEntryContent(entry.note);
  const assets = entry.assets ?? [];
  const activeAsset = assets[activeAssetIndex] ?? assets[0];

  async function handleCopyLink() {
    if (!entry) return;
    try {
      const url = token
        ? `${window.location.origin}/s/${token}#entry-${entry.id}`
        : `${window.location.origin}/sheet?entry=${entry.id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Direct link copied to clipboard");
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

  const activeLinkInfo = activeAsset?.url ? inspectLink(activeAsset.url) : null;
  const activeProvider = (activeAsset?.provider ?? activeLinkInfo?.provider ?? "website") as Provider;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-frame bg-surface shadow-2xl transition-transform duration-300 animate-in slide-in-from-right duration-250 ease-out"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-frame/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            {isTarget ? (
              <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold font-metadata uppercase tracking-wider text-brand">
                🎯 Target
              </span>
            ) : (
              <span className="rounded-md bg-elevated px-2 py-0.5 text-xs font-semibold font-metadata uppercase tracking-wider text-text-muted">
                Worklog Entry
              </span>
            )}

            {isSupervisory && (
              <span className="flex items-center gap-1 rounded-md border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                <Shield className="size-3" />
                Admin supervisory access
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              title="Copy deep link"
              className="flex size-8 items-center justify-center rounded-md border border-frame bg-surface text-text-muted hover:border-brand/40 hover:text-text transition-colors"
            >
              {copied ? <Check className="size-4 text-brand" /> : <Share2 className="size-4" />}
            </button>

            {canModify && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit?.(entry);
                  }}
                  title={isSupervisory ? `Edit ${entry.author_name}'s entry` : "Edit entry"}
                  className="flex size-8 items-center justify-center rounded-md border border-frame bg-surface text-text-muted hover:border-brand/40 hover:text-text transition-colors"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onDelete?.(entry);
                  }}
                  title={isSupervisory ? `Delete ${entry.author_name}'s entry` : "Delete entry"}
                  className="flex size-8 items-center justify-center rounded-md border border-frame bg-surface text-destructive/80 hover:border-destructive/40 hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="flex size-8 items-center justify-center rounded-md border border-frame bg-surface text-text-muted hover:text-text hover:bg-elevated transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Supervisory context banner */}
        {isSupervisory && (
          <div className="border-b border-brand/20 bg-brand/5 px-5 py-2 text-xs text-brand sm:px-6">
            Editing {entry.author_name}&apos;s entry · Admin supervisory access
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Header section: Title, Author, Date */}
          <div className="space-y-3">
            <h2 className="text-[22px] sm:text-[24px] font-bold text-text leading-tight tracking-[-0.01em]">
              {entry.title}
            </h2>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              {/* Author badge */}
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand">
                  {authorInitials}
                </div>
                <span className="font-semibold text-text">{entry.author_name ?? "Teammate"}</span>
                {entry.author_department && (
                  <span className="rounded-sm bg-elevated px-1.5 py-0.5 text-[10px] font-metadata uppercase text-text-muted font-medium">
                    {entry.author_department}
                  </span>
                )}
              </div>

              {entry.work_date && (
                <div className="flex items-center gap-1 text-text-muted">
                  <Calendar className="size-3.5" />
                  <span>{entry.work_date}</span>
                </div>
              )}
            </div>
          </div>

          {/* TARGET DETAILS (if target entry) */}
          {isTarget && targetData && (
            <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-brand font-metadata">
                  Target Status
                </span>
                <span className="rounded-md bg-surface px-2.5 py-1 text-xs font-bold uppercase text-brand border border-brand/30">
                  {targetData.status.replace("_", " ")}
                </span>
              </div>

              <div className="text-xs text-text-muted space-y-1">
                <div>Due Date: <strong className="text-text">{targetData.targetDate}</strong></div>
                {targetData.createdByName && (
                  <div>Set by: <strong className="text-text">{targetData.createdByName}</strong></div>
                )}
              </div>

              {canModify && onStatusChange && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-brand/10">
                  <span className="text-xs text-text-muted">Change status:</span>
                  {(["upcoming", "in_progress", "done", "missed"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => onStatusChange(entry.id, st)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium uppercase font-metadata transition-colors cursor-pointer",
                        targetData.status === st
                          ? "bg-brand text-white font-bold"
                          : "border border-frame bg-surface text-text hover:border-brand/40"
                      )}
                    >
                      {st.replace("_", " ")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ASSET PREVIEW STAGE */}
          {assets.length > 0 && activeAsset && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-frame bg-canvas/80">
                {/* Image Asset */}
                {activeAsset.kind === "image" && activeAsset.src && (
                  <div className="relative aspect-video w-full bg-canvas flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeAsset.src}
                      alt={activeAsset.label ?? entry.title}
                      className="max-h-[440px] w-full object-contain cursor-zoom-in"
                      onClick={() => onOpenAsset?.(activeAsset)}
                    />
                  </div>
                )}

                {/* Embed Video (YouTube / Loom / Vimeo) */}
                {(activeAsset.kind === "video" || activeLinkInfo?.embedUrl) && (
                  <div className="relative aspect-video w-full bg-black">
                    {activeLinkInfo?.embedUrl ? (
                      <iframe
                        src={activeLinkInfo.embedUrl}
                        title={activeAsset.label ?? entry.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="h-full w-full border-0"
                      />
                    ) : activeAsset.src ? (
                      <video
                        src={activeAsset.src}
                        controls
                        className="h-full w-full"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-text-muted">
                        <Play className="size-10 text-brand" />
                      </div>
                    )}
                  </div>
                )}

                {/* Figma Embed or Link */}
                {activeProvider === "figma" && (
                  <div className="p-6 flex flex-col items-center justify-center gap-4 bg-elevated/40 text-center">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-surface border border-frame shadow-sm">
                      <span className="text-2xl font-black text-[#F24E1E]">Fg</span>
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-base font-semibold text-text">Figma Design Canvas</h4>
                      <p className="text-xs text-text-muted max-w-sm">
                        {activeAsset.url}
                      </p>
                    </div>
                    {activeAsset.url && (
                      <a
                        href={activeAsset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg bg-[#F24E1E] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-90 transition-opacity"
                      >
                        <span>Open in Figma</span>
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                )}

                {/* Document File Asset */}
                {activeAsset.kind === "file" && (
                  <div className="p-6 flex items-center justify-between gap-4 bg-elevated/40">
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-xl bg-surface border border-frame text-brand">
                        <FileText className="size-6" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text">{activeAsset.label ?? "Document"}</p>
                        <p className="text-xs font-metadata text-text-muted">{formatBytes(activeAsset.byte_size)}</p>
                      </div>
                    </div>
                    {activeAsset.src && (
                      <a
                        href={activeAsset.src}
                        download
                        className="rounded-lg border border-frame bg-surface px-3 py-1.5 text-xs font-semibold text-text hover:border-brand hover:text-brand transition-colors"
                      >
                        Download
                      </a>
                    )}
                  </div>
                )}

                {/* General Link Asset */}
                {activeAsset.kind === "link" && activeProvider !== "figma" && !activeLinkInfo?.embedUrl && (
                  <div className="p-6 flex items-center justify-between gap-4 bg-elevated/40">
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-xl bg-surface border border-frame text-brand">
                        <Globe className="size-6" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text">{activeLinkInfo?.providerLabel ?? "External Link"}</p>
                        <p className="text-xs text-text-muted max-w-xs truncate">{activeAsset.url}</p>
                      </div>
                    </div>
                    {activeAsset.url && (
                      <a
                        href={activeAsset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 transition-colors"
                      >
                        <span>Launch</span>
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Multi-asset gallery selector */}
              {assets.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {assets.map((asset, idx) => (
                    <button
                      key={asset.id ?? idx}
                      type="button"
                      onClick={() => setActiveAssetIndex(idx)}
                      className={cn(
                        "relative size-14 shrink-0 rounded-lg border overflow-hidden transition-all",
                        activeAssetIndex === idx
                          ? "border-brand ring-2 ring-brand/30"
                          : "border-frame opacity-70 hover:opacity-100"
                      )}
                    >
                      {asset.kind === "image" && asset.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.src}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-elevated text-xs font-metadata text-text-muted uppercase">
                          {asset.kind}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* NOTES CONTENT */}
          {cleanNote && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted font-metadata">
                Context & Deliverables
              </h4>
              <div className="rounded-xl border border-frame/70 bg-elevated/30 p-4 text-[14px] leading-relaxed text-text whitespace-pre-wrap">
                {cleanNote}
              </div>
            </div>
          )}

          {/* TAGS */}
          {entry.tags && entry.tags.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted font-metadata flex items-center gap-1">
                <Tag className="size-3" />
                Tags
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {entry.tags
                  .filter((t) => t !== "target" && !t.startsWith("target:"))
                  .map((tag) => (
                    <Link
                      key={tag}
                      href={`/sheet?tag=${encodeURIComponent(tag)}` as never}
                      onClick={onClose}
                      className="rounded-md bg-elevated px-2 py-1 text-xs font-medium font-metadata text-text-muted uppercase hover:text-text hover:bg-brand/10 transition-colors"
                    >
                      #{tag}
                    </Link>
                  ))}
              </div>
            </div>
          )}

          {/* COMMENTS & DISCUSSION */}
          <div className="space-y-3 pt-4 border-t border-frame/70">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted font-metadata">
              Feedback & Comments ({comments.length})
            </h4>
            <EntryComments
              entryId={entry.id}
              initialComments={comments}
              token={token}
              defaultAuthor={defaultAuthor}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
