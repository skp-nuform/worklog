"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Link2, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addAsset, deleteAsset, reorderAssets, updateEntry } from "@/features/sheet/actions";
import { inspectLink } from "@/lib/links";
import { createClient } from "@/lib/supabase/client";
import type { SheetAsset } from "./asset-tile";
import type { SheetEntry } from "./sheet-view";

const MAX_BYTES = 25 * 1024 * 1024;
const OK_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function EditEntryDialog({
  entry,
  workspaceId,
  open,
  onClose,
  onUpdated,
}: {
  entry: (SheetEntry & { version: number; work_date?: string }) | null;
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [assets, setAssets] = useState<SheetAsset[]>([]);
  const [newLink, setNewLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const [prevId, setPrevId] = useState(entry?.id);
  if (entry && entry.id !== prevId) {
    setPrevId(entry.id);
    setTitle(entry.title);
    setNote(entry.note ?? "");
    setWorkDate(entry.work_date ?? todayKey());
    setTags(entry.tags ?? []);
    setAssets(entry.assets ?? []);
  }

  if (!entry) return null;

  function close() {
    onClose();
  }

  function addTagChip() {
    const trimmed = newTag.trim().replace(/^#/, "").toLowerCase();
    if (!trimmed) return;
    if (!tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setNewTag("");
  }

  function removeTagChip(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  async function handleAddLink() {
    const trimmed = newLink.trim();
    if (!trimmed) return;
    const info = inspectLink(trimmed);
    if (!info) {
      toast.error("That does not look like a valid web link.");
      return;
    }

    startTransition(async () => {
      const result = await addAsset({
        entryId: entry!.id,
        asset: {
          kind: "link",
          url: trimmed,
          provider: info.provider,
          label: info.suggestedLabel,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Link added");
      setNewLink("");
      onUpdated?.();
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    setUploading(true);
    const supabase = createClient();

    for (const file of files) {
      if (!OK_TYPES.includes(file.type)) {
        toast.error(`${file.name} is not a supported file type.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} exceeds the 25 MB limit.`);
        continue;
      }

      const ext = file.name.split(".").pop() || "bin";
      const objectPath = `${workspaceId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("work-assets")
        .upload(objectPath, file, { contentType: file.type });

      if (upErr) {
        toast.error(`Upload failed: ${upErr.message}`);
        continue;
      }

      const res = await addAsset({
        entryId: entry!.id,
        asset: {
          kind: file.type === "application/pdf" ? "file" : "image",
          object_path: objectPath,
          mime_type: file.type,
          byte_size: file.size,
          label: file.name,
        },
      });

      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(`Attached ${file.name}`);
        onUpdated?.();
      }
    }
    setUploading(false);
  }

  async function handleRemoveAsset(assetId: string) {
    if (!window.confirm("Remove this attachment?")) return;
    startTransition(async () => {
      const res = await deleteAsset(assetId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      toast.success("Attachment removed");
      onUpdated?.();
    });
  }

  async function moveAsset(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= assets.length) return;

    const newOrder = [...assets];
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(targetIndex, 0, moved);
    setAssets(newOrder);

    startTransition(async () => {
      const res = await reorderAssets(
        entry!.id,
        newOrder.map((a) => a.id),
      );
      if (!res.ok) {
        // Still keep client state even if migration 0008 is not yet applied
        console.warn(res.error);
      }
      onUpdated?.();
    });
  }

  function handleSave() {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      toast.error("Title must be at least 3 characters.");
      return;
    }

    startTransition(async () => {
      const result = await updateEntry({
        entryId: entry!.id,
        expectedVersion: entry!.version,
        title: trimmedTitle,
        note,
        workDate: workDate || undefined,
        tags,
      });

      if (!result.ok) {
        if (result.error.includes("P0409") || result.error.includes("conflict")) {
          toast.error("This entry changed elsewhere. Please reload to review the latest changes.");
        } else {
          toast.error(result.error);
        }
        return;
      }

      toast.success("Entry updated");
      close();
      onUpdated?.();
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="edit-entry-title"
      className="bg-surface text-text border-border shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm fixed inset-0 m-auto w-[min(94vw,36rem)] rounded-2xl border p-0 open:animate-in open:fade-in-0 open:zoom-in-95 focus:outline-none overflow-hidden"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between border-frame border-b pb-3">
          <div>
            <p className="font-metadata text-text-muted text-[10px] tracking-[0.2em] uppercase">
              Curate
            </p>
            <h2 id="edit-entry-title" className="text-lg font-semibold tracking-tight">
              Edit Entry
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close dialog"
            className="text-text-muted hover:text-text focus-visible:ring-ring rounded p-1 focus-visible:ring-2 focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What was done?"
            className="font-sans text-[14px] font-medium"
          />
        </div>

        {/* Date & Tags row */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-date">Work Date</Label>
            <Input
              id="edit-date"
              type="date"
              max={todayKey()}
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="font-metadata h-9 text-[13px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-tag">Add Tag</Label>
            <div className="flex gap-1.5">
              <Input
                id="new-tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTagChip();
                  }
                }}
                placeholder="tag name"
                className="font-metadata h-9 text-[12px]"
              />
              <Button type="button" variant="outline" size="sm" onClick={addTagChip}>
                Add
              </Button>
            </div>
          </div>
        </div>

        {/* Tag chips */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="border-frame bg-elevated font-metadata text-text flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] uppercase tracking-wider"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => removeTagChip(t)}
                  aria-label={`Remove tag ${t}`}
                  className="text-text-muted hover:text-destructive rounded"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Note */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-note">Detail / Notes</Label>
          <Textarea
            id="edit-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Additional context or notes..."
            className="text-[13px]"
          />
        </div>

        {/* Attachments Section */}
        <div className="flex flex-col gap-2 border-frame border-t pt-3">
          <div className="flex items-center justify-between">
            <p className="font-metadata text-text-muted text-[10px] tracking-[0.14em] uppercase">
              Attachments ({assets.length})
            </p>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={OK_TYPES.join(",")}
                hidden
                onChange={handleFileUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="h-7 text-xs"
              >
                {uploading ? (
                  <Loader2 aria-hidden="true" className="mr-1 size-3 animate-spin" />
                ) : (
                  <Plus aria-hidden="true" className="mr-1 size-3" />
                )}
                Upload file
              </Button>
            </div>
          </div>

          {/* Existing Asset List */}
          {assets.length > 0 ? (
            <ul className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
              {assets.map((asset, idx) => (
                <li
                  key={asset.id}
                  className="border-frame bg-elevated flex items-center justify-between border p-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-metadata text-text-muted text-[10px] tabular-nums">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    {asset.kind === "link" ? (
                      <Link2 aria-hidden="true" className="text-text-muted size-3.5 shrink-0" />
                    ) : (
                      <span className="font-metadata text-brand text-[9px] uppercase tracking-wider">
                        [{asset.kind}]
                      </span>
                    )}
                    <span className="text-text truncate">{asset.label || asset.url || "Asset"}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveAsset(idx, "up")}
                      aria-label="Move attachment up"
                      className="text-text-muted hover:text-text disabled:opacity-30 p-1 rounded"
                    >
                      <ArrowUp aria-hidden="true" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === assets.length - 1}
                      onClick={() => moveAsset(idx, "down")}
                      aria-label="Move attachment down"
                      className="text-text-muted hover:text-text disabled:opacity-30 p-1 rounded"
                    >
                      <ArrowDown aria-hidden="true" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveAsset(asset.id)}
                      aria-label="Remove attachment"
                      className="text-text-muted hover:text-destructive p-1 rounded ml-1"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-muted text-xs italic py-2">No attachments on this entry.</p>
          )}

          {/* Quick link attach */}
          <div className="flex gap-2 pt-1">
            <Input
              value={newLink}
              onChange={(e) => setNewLink(e.target.value)}
              placeholder="Paste a link to attach..."
              className="text-[12px] h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddLink();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddLink}
              disabled={!newLink.trim() || pending}
              className="h-8 text-xs"
            >
              Attach Link
            </Button>
          </div>
        </div>

        {/* Dialog Actions */}
        <div className="flex justify-end gap-2 border-frame border-t pt-3">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="mr-1.5 size-3.5 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    </dialog>
  );
}
