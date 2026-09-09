"use client";

import { FileText, Film, ImagePlus, Link2, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createEntry } from "@/features/sheet/actions";
import { inspectLink } from "@/lib/links";
import { createClient } from "@/lib/supabase/client";

type Draft =
  | {
      key: string;
      kind: "image" | "video" | "file";
      status: "uploading" | "ready" | "failed";
      previewUrl?: string;
      objectPath?: string;
      mimeType: string;
      byteSize: number;
      width?: number;
      height?: number;
      label: string;
      error?: string;
    }
  | {
      key: string;
      kind: "link";
      status: "ready";
      url: string;
      provider: string;
      label: string;
    };

const MAX_BYTES = 25 * 1024 * 1024;
const OK_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
  "video/mp4",
  "video/webm",
];

/**
 * Log what you did.
 *
 * Two things make this fast enough to actually use every day: you can PASTE
 * a screenshot straight in (Cmd/Ctrl+V anywhere on the page), and pasting a
 * URL recognises the provider without a round trip. Everything else is one
 * title field.
 */
export function Composer({
  workspaceId,
  initialDate,
  onSaved,
}: {
  workspaceId: string;
  initialDate?: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem(`worklog:draft:${workspaceId}`);
      return saved ? (JSON.parse(saved).title || "") : "";
    } catch {
      return "";
    }
  });
  const [note, setNote] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem(`worklog:draft:${workspaceId}`);
      return saved ? (JSON.parse(saved).note || "") : "";
    } catch {
      return "";
    }
  });
  const [workDate, setWorkDate] = useState(() => {
    if (initialDate) return initialDate;
    if (typeof window === "undefined") return todayKey();
    try {
      const saved = localStorage.getItem(`worklog:draft:${workspaceId}`);
      return saved ? (JSON.parse(saved).workDate || todayKey()) : todayKey();
    } catch {
      return todayKey();
    }
  });
  const [linkInput, setLinkInput] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Unsaved draft recovery persistence
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (title || note) {
        localStorage.setItem(
          `worklog:draft:${workspaceId}`,
          JSON.stringify({ title, note, workDate }),
        );
      }
    } catch {
      // Ignored
    }
  }, [title, note, workDate, workspaceId]);

  // Paste a screenshot anywhere on the page. This is the whole point.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));

      if (files.length > 0) {
        event.preventDefault();
        setOpen(true);
        void addFiles(files);
        return;
      }

      // A pasted URL becomes a link card, but only when not typing in a field.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!typing && text && inspectLink(text)) {
        event.preventDefault();
        setOpen(true);
        addLink(text);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  function addLink(raw: string) {
    const info = inspectLink(raw);
    if (!info) {
      toast.error("That does not look like a web link.");
      return;
    }
    setDrafts((d) => [
      ...d,
      {
        key: crypto.randomUUID(),
        kind: "link",
        status: "ready",
        url: raw.trim(),
        provider: info.provider,
        label: info.suggestedLabel,
      },
    ]);
    setLinkInput("");
  }

  async function addFiles(files: File[]) {
    const supabase = createClient();

    for (const file of files) {
      if (!OK_TYPES.includes(file.type)) {
        toast.error(`${file.name || "That file"} is not a supported file type.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name || "That file"} is over 25 MB.`);
        continue;
      }

      const fileKind = file.type.startsWith("image/")
        ? ("image" as const)
        : file.type.startsWith("video/")
        ? ("video" as const)
        : ("file" as const);
      const isImg = fileKind === "image";

      const key = crypto.randomUUID();
      const previewUrl = isImg ? URL.createObjectURL(file) : undefined;
      const dims = isImg && previewUrl ? await imageSize(previewUrl) : undefined;

      setDrafts((d) => [
        ...d,
        {
          key,
          kind: fileKind,
          status: "uploading",
          previewUrl,
          mimeType: file.type,
          byteSize: file.size,
          width: dims?.width,
          height: dims?.height,
          label:
            file.name?.replace(/\.[^.]+$/, "") ||
            (isImg ? "Screenshot" : fileKind === "video" ? "Video" : "Document"),
        },
      ]);

      // Straight to storage from the browser. Never through a server
      // function: Vercel caps a function body at 4.5 MB.
      const ext =
        file.name.split(".").pop() ||
        (file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin");
      const objectPath = `${workspaceId}/${key}.${ext}`;

      const { error } = await supabase.storage
        .from("work-assets")
        .upload(objectPath, file, {
          contentType: file.type,
          upsert: false,
        });

      setDrafts((d) =>
        d.map((x) =>
          x.key === key && x.kind !== "link"
            ? error
              ? { ...x, status: "failed", error: error.message }
              : { ...x, status: "ready", objectPath }
            : x,
        ),
      );

      if (error) toast.error(`Upload failed: ${error.message}`);
    }
  }

  function removeDraft(key: string) {
    setDrafts((d) => d.filter((x) => x.key !== key));
  }

  const uploading = drafts.some(
    (d) => d.kind !== "link" && d.status === "uploading",
  );
  const canSave = title.trim().length >= 3 && !uploading && !pending;

  function save() {
    const assets = drafts
      .filter((d) => d.status === "ready")
      .map((d) =>
        d.kind === "link"
          ? { kind: "link" as const, url: d.url, provider: d.provider, label: d.label }
          : {
              kind: d.kind,
              object_path: d.objectPath,
              mime_type: d.mimeType,
              byte_size: d.byteSize,
              width: d.width,
              height: d.height,
              label: d.label,
            },
      );

    startTransition(async () => {
      const result = await createEntry({
        workspaceId,
        title,
        workDate,
        note,
        assets,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Logged");
      try {
        localStorage.removeItem(`worklog:draft:${workspaceId}`);
      } catch {
        // Ignored
      }
      setTitle("");
      setNote("");
      setDrafts([]);
      setWorkDate(todayKey());
      setOpen(true);
      onSaved?.();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-frame text-text-muted hover:border-boundary hover:text-text focus-visible:ring-ring group flex w-full cursor-pointer items-center gap-3 border border-dashed rounded-md bg-surface px-4 py-3.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
      >
        <ImagePlus aria-hidden="true" className="size-4 shrink-0 text-brand" />
        <span className="text-text font-medium">What did you accomplish today?</span>
        <span className="font-metadata text-text-muted ml-auto hidden text-[10px] tracking-[0.12em] uppercase sm:inline">
          Paste screenshot (Ctrl+V) or click to open
        </span>
      </button>
    );
  }

  return (
    <div
      id="daily-composer"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void addFiles(files);
        const text = e.dataTransfer.getData("text/plain");
        if (!files.length && text) addLink(text);
      }}
      className={cn(
        "border-frame bg-surface flex flex-col gap-4 border p-4 transition-colors shadow-xs",
        dragging && "border-brand bg-elevated",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label htmlFor="entry-title" className="sr-only">
            What did you work on?
          </Label>
          <Input
            id="entry-title"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What did you work on today?"
            className="h-11 w-full rounded-md border border-border bg-surface px-4 py-2.5 text-base font-semibold text-text placeholder:text-text-muted focus-visible:border-brand focus-visible:ring-1 focus-visible:ring-brand shadow-xs"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSave) save();
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-text-muted hover:text-text focus-visible:ring-ring rounded p-1.5 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSave) save();
        }}
        rows={2}
        placeholder="Any details, context or notes (Ctrl + Enter to save)"
        aria-label="Detail"
        className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted leading-relaxed focus-visible:border-brand focus-visible:ring-1 focus-visible:ring-brand resize-none min-h-[72px] shadow-xs"
      />

      {/* Attachments in flight and ready */}
      {drafts.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {drafts.map((d) => (
            <li
              key={d.key}
              className="border-frame bg-elevated relative aspect-[4/3] overflow-hidden border rounded-xs animate-in fade-in-0 zoom-in-95 duration-200 ease-out fill-mode-both"
            >
              {d.kind === "link" ? (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <Link2 aria-hidden="true" className="text-text-muted size-4" />
                  <span className="font-metadata text-text-muted text-[9px] tracking-[0.12em] uppercase">
                    {d.provider}
                  </span>
                  <span className="text-text line-clamp-2 text-[10px]">
                    {d.label}
                  </span>
                </span>
              ) : d.kind === "image" ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={d.previewUrl}
                    alt={d.label}
                    className="h-full w-full object-cover"
                  />
                  {d.status === "uploading" && (
                    <span className="bg-canvas/70 absolute inset-0 flex items-center justify-center">
                      <Loader2
                        aria-hidden="true"
                        className="text-text size-4 animate-spin"
                      />
                      <span className="sr-only">Uploading</span>
                    </span>
                  )}
                  {d.status === "failed" && (
                    <span className="bg-status-blocked-bg text-status-blocked-fg absolute inset-0 flex items-center justify-center p-2 text-center text-[10px]">
                      Upload failed
                    </span>
                  )}
                </>
              ) : d.kind === "video" ? (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <Film aria-hidden="true" className="text-text-muted size-4" />
                  <span className="font-metadata text-text-muted text-[9px] tracking-[0.12em] uppercase">
                    Video
                  </span>
                  <span className="text-text line-clamp-2 text-[10px]">
                    {d.label}
                  </span>
                </span>
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <FileText aria-hidden="true" className="text-text-muted size-4" />
                  <span className="font-metadata text-text-muted text-[9px] tracking-[0.12em] uppercase">
                    Document
                  </span>
                  <span className="text-text line-clamp-2 text-[10px]">
                    {d.label}
                  </span>
                </span>
              )}

              <button
                type="button"
                onClick={() => removeDraft(d.key)}
                aria-label={`Remove ${d.label}`}
                className="bg-surface/90 text-text border-frame focus-visible:ring-ring absolute top-1 right-1 rounded-sm border p-1 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add a link */}
      <div className="flex gap-2">
        <Input
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (linkInput.trim()) addLink(linkInput);
            }
          }}
          placeholder="Paste a Figma, Loom, YouTube or website link"
          aria-label="Add a link"
          className="h-10 px-4 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => linkInput.trim() && addLink(linkInput)}
          disabled={!linkInput.trim()}
          className="h-10 px-4 text-xs font-semibold cursor-pointer"
        >
          Add link
        </Button>
      </div>

      <div className="border-frame flex flex-wrap items-end gap-3 border-t pt-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Label
              htmlFor="entry-date"
              className="font-metadata text-text-muted text-[10px] tracking-[0.12em] uppercase"
            >
              Day
            </Label>
            {workDate === todayKey() && (
              <span className="bg-brand text-white font-metadata rounded-xs px-1.5 py-0.2 text-[8.5px] font-bold uppercase tracking-wider shadow-xs">
                Today
              </span>
            )}
          </div>
          <Input
            id="entry-date"
            type="date"
            value={workDate}
            max={todayKey()}
            onChange={(e) => setWorkDate(e.target.value)}
            className="font-metadata h-10 w-[9.5rem] text-[13px] px-3"
          />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={OK_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void addFiles(files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          className="h-10 gap-1.5 px-3.5 text-xs font-medium cursor-pointer transition-all duration-150 active:scale-95"
        >
          <ImagePlus aria-hidden="true" className="size-4 text-brand" />
          <span>Add files</span>
        </Button>

        <span className="font-metadata text-text-muted/70 hidden text-[10px] tracking-[0.08em] uppercase md:inline">
          Tip: Ctrl+V anywhere pastes screenshots
        </span>

        <div className="ml-auto flex items-center gap-3">
          <span className="font-metadata text-text-muted hidden text-[10px] tracking-[0.12em] uppercase sm:inline">
            {uploading ? "uploading…" : "⌘/Ctrl + Enter"}
          </span>
          <Button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="h-10 px-6 text-sm font-semibold cursor-pointer shadow-sm transition-all duration-150 active:scale-[0.98]"
          >
            {pending ? "Saving…" : "Log it"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
