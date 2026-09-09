"use client";

import { Download, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { inspectLink } from "@/lib/links";
import { formatBytes, type SheetAsset } from "./asset-tile";

/**
 * Full-size viewer.
 *
 * A native <dialog> so focus trapping, Escape, and the top layer come from
 * the platform rather than being re-implemented. Arrow keys move between
 * frames, which is what anyone reviewing a sheet of work expects.
 */
export function Lightbox({
  asset,
  onClose,
  onPrev,
  onNext,
  allowDownload = true,
  caption,
}: {
  asset: SheetAsset | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  allowDownload?: boolean;
  caption?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (asset && !el.open) el.showModal();
    if (!asset && el.open) el.close();
  }, [asset]);

  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev?.();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext?.();
      }
    },
    [onPrev, onNext],
  );

  if (!asset) return null;

  const info = asset.url ? inspectLink(asset.url) : null;
  const label = asset.label ?? info?.suggestedLabel ?? "Attachment";
  const isImage = (asset.kind === "image" || asset.mime_type?.startsWith("image/")) && Boolean(asset.src);
  const isVideo = (asset.kind === "video" || asset.mime_type?.startsWith("video/")) && Boolean(asset.src);
  const isPdf = (asset.kind === "file" || asset.mime_type === "application/pdf") && Boolean(asset.src);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onKeyDown={onKey}
      aria-label={label}
      className="bg-canvas/95 text-text animate-lightbox-in m-0 h-full max-h-none w-full max-w-none backdrop-blur-sm backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <header className="border-frame flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{label}</p>
            <p className="font-metadata text-text-muted truncate text-[11px]">
              {[
                caption,
                info?.host,
                asset.mime_type,
                formatBytes(asset.byte_size),
                asset.width && asset.height
                  ? `${asset.width}×${asset.height}`
                  : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
          </div>

          {asset.url && (
            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-boundary hover:bg-elevated focus-visible:ring-ring flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Open original
            </a>
          )}

          {allowDownload && asset.src && asset.kind !== "link" && (
            <a
              href={asset.src}
              download={label}
              className="border-boundary hover:bg-elevated focus-visible:ring-ring flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <Download aria-hidden="true" className="size-3.5" />
              Download
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="border-boundary hover:bg-elevated focus-visible:ring-ring rounded-md border p-1.5 focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Close"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={asset.src ?? ""}
              alt={label}
              className="max-h-full max-w-full object-contain"
            />
          ) : isVideo ? (
            <video
              src={asset.src ?? ""}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-sm"
            />
          ) : isPdf ? (
            <iframe
              src={asset.src ?? ""}
              title={label}
              className="border-frame h-full w-full max-w-5xl border bg-white"
            />
          ) : info?.embedUrl ? (
            <iframe
              src={info.embedUrl}
              title={label}
              allow="fullscreen; picture-in-picture"
              // A third-party frame gets no same-origin access and no top
              // navigation: it is someone else's page inside ours.
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer"
              className="border-frame aspect-video h-auto w-full max-w-5xl border"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-text-muted text-sm">
                This one opens on its own site.
              </p>
              {asset.url && (
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand text-sm underline underline-offset-4"
                >
                  {asset.url}
                </a>
              )}
            </div>
          )}
        </div>

        {(onPrev || onNext) && (
          <footer className="border-frame text-text-muted flex shrink-0 items-center justify-between border-t px-4 py-2 text-xs">
            <button
              type="button"
              onClick={onPrev}
              disabled={!onPrev}
              className="hover:text-text focus-visible:ring-ring rounded px-2 py-1 disabled:opacity-40 focus-visible:ring-2 focus-visible:outline-none"
            >
              ← Previous
            </button>
            <span className="font-metadata text-[10px] tracking-[0.14em] uppercase">
              Arrow keys to move · Esc to close
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              className="hover:text-text focus-visible:ring-ring rounded px-2 py-1 disabled:opacity-40 focus-visible:ring-2 focus-visible:outline-none"
            >
              Next →
            </button>
          </footer>
        )}
      </div>
    </dialog>
  );
}
