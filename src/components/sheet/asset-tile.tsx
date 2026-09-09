"use client";

import { Download, ExternalLink, FileText, Film, Play } from "lucide-react";
import { cn } from "cn";

import { inspectLink, PROVIDER_TINT, type Provider } from "@/lib/links";

export type SheetAsset = {
  id: string;
  kind: "link" | "image" | "video" | "file";
  url: string | null;
  provider: string | null;
  label: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  /** Resolved by the server: signed URL, or the share proxy route. */
  src?: string | null;
};

/**
 * One frame on the contact sheet.
 *
 * Every asset gets the same frame: a hairline border, a fixed-ratio window,
 * and a mono caption strip underneath carrying the frame number. That
 * repetition is the identity — a sheet of proofs, not a pile of cards.
 */
export function AssetTile({
  asset,
  index,
  onOpen,
  allowDownload = true,
  className,
}: {
  asset: SheetAsset;
  index: number;
  onOpen?: (asset: SheetAsset) => void;
  allowDownload?: boolean;
  className?: string;
}) {
  const frameNo = String(index + 1).padStart(2, "0");
  const info = asset.url ? inspectLink(asset.url) : null;
  const provider = (asset.provider ?? info?.provider ?? "other") as Provider;
  const isImage = asset.kind === "image" && Boolean(asset.src);
  const canOpenInline = isImage || Boolean(info?.embedUrl);

  const label =
    asset.label ?? info?.suggestedLabel ?? (isImage ? "Screenshot" : "File");

  return (
    <figure
      className={cn(
        "group border-frame bg-surface relative flex flex-col overflow-hidden border rounded-sm transition-all duration-200 hover:border-brand/50 hover:shadow-xs",
        // The snappy stagger: each frame animates in smoothly without lag
        "animate-frame-in",
        className,
      )}
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
    >
      <div className="bg-elevated relative aspect-[4/3] w-full overflow-hidden">
        {isImage ? (
          <button
            type="button"
            onClick={() => onOpen?.(asset)}
            className="focus-visible:ring-ring block h-full w-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
            aria-label={`Open ${label} full size`}
          >
            {/* Deliberately a plain img: these are user uploads at unknown
                sizes served from signed URLs, which next/image cannot
                optimise without proxying every one. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.src ?? ""}
              alt={label}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          </button>
        ) : canOpenInline ? (
          <button
            type="button"
            onClick={() => onOpen?.(asset)}
            className="focus-visible:ring-ring flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={`Play ${label}`}
          >
            <span className="border-boundary text-text flex size-11 items-center justify-center rounded-full border transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <Play aria-hidden="true" className="size-4 translate-x-px" />
            </span>
            <span
              className={cn(
                "font-metadata text-[10px] tracking-[0.14em] uppercase",
                PROVIDER_TINT[provider],
              )}
            >
              {info?.providerLabel ?? provider}
            </span>
          </button>
        ) : (
          <a
            href={asset.url ?? asset.src ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:ring-ring flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-3 text-center focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="text-text-muted">
              {asset.kind === "video" ? (
                <Film aria-hidden="true" className="size-6" />
              ) : asset.kind === "link" ? (
                <ExternalLink aria-hidden="true" className="size-6" />
              ) : (
                <FileText aria-hidden="true" className="size-6" />
              )}
            </span>
            <span
              className={cn(
                "font-metadata text-[10px] tracking-[0.14em] uppercase",
                PROVIDER_TINT[provider],
              )}
            >
              {info?.providerLabel ?? asset.kind}
            </span>
            {info?.host && (
              <span className="text-text-muted line-clamp-1 text-[11px]">
                {info.host}
              </span>
            )}
          </a>
        )}

        {/* Download sits on the frame, revealed on hover or keyboard focus. */}
        {allowDownload && asset.src && asset.kind !== "link" && (
          <a
            href={asset.src}
            download={label}
            className="bg-surface/90 text-text border-frame focus-visible:ring-ring absolute top-1.5 right-1.5 rounded-sm border p-1.5 opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
            aria-label={`Download ${label}`}
            onClick={(e) => e.stopPropagation()}
          >
            <Download aria-hidden="true" className="size-3.5" />
          </a>
        )}
      </div>

      {/* Caption strip: frame number left, label right. The sheet's spine. */}
      <figcaption className="border-frame flex items-center gap-2 border-t px-2 py-1.5">
        <span className="font-metadata text-text-muted shrink-0 text-[10px] tabular-nums">
          {frameNo}
        </span>
        <span className="text-text line-clamp-1 text-[11.5px]">{label}</span>
        {asset.url && (
          <a
            href={asset.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted hover:text-brand focus-visible:ring-ring ml-auto shrink-0 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={`Open ${label} in a new tab`}
          >
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
      </figcaption>
    </figure>
  );
}

export function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
