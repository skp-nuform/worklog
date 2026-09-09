"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Target, X, Calendar, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createFutureTarget } from "@/features/sheet/actions";
import type { SheetEntry } from "@/components/sheet/sheet-view";

export function TargetDialog({
  open,
  targetDate,
  workspaceId,
  existingTargets = [],
  onDeleteTarget,
  onClose,
  onSaved,
}: {
  open: boolean;
  targetDate: string | null;
  workspaceId: string;
  existingTargets?: SheetEntry[];
  onDeleteTarget?: (id: string) => void;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  if (!targetDate) return null;

  // Format date nicely: "Friday, Sep 12"
  const [y, m, d] = targetDate.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a target title.");
      return;
    }

    startTransition(async () => {
      const res = await createFutureTarget({
        workspaceId,
        targetDate: targetDate!,
        title: title.trim(),
        note: note.trim() || undefined,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(`Target set for ${formattedDate}`);
      setTitle("");
      setNote("");
      onClose();
      if (onSaved) onSaved();
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Dismiss if clicking directly on the backdrop
        if (e.target === ref.current) {
          onClose();
        }
      }}
      aria-labelledby="target-dialog-title"
      className="bg-surface text-text border-border shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm fixed inset-0 m-auto w-[min(94vw,30rem)] rounded-2xl border p-0 open:animate-in open:fade-in-0 open:zoom-in-95 focus:outline-none overflow-hidden"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="bg-surface/90 border-border/60 flex items-start justify-between border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-brand/10 text-brand ring-brand/25 flex size-10 items-center justify-center rounded-xl ring-1 shadow-xs">
              <Target className="size-5" />
            </div>
            <div>
              <h2 id="target-dialog-title" className="text-base font-bold tracking-tight text-text">
                Set Target / Goal
              </h2>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand border border-brand/20">
                <Calendar className="size-3 text-brand" />
                <span>{formattedDate}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-text-muted hover:text-text hover:bg-elevated rounded-lg p-2 transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none cursor-pointer"
          >
            <X className="size-4.5" />
          </button>
        </div>

        {/* Existing targets for this date */}
        {existingTargets.length > 0 && (
          <div className="border-border/40 bg-elevated/40 border-b px-6 py-3.5">
            <p className="font-metadata text-text-muted mb-2 text-[10.5px] font-bold tracking-wider uppercase">
              Targets Planned for this day ({existingTargets.length})
            </p>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1">
              {existingTargets.map((t) => {
                const cleanTitle = t.title.replace(/^🎯\s*Target:\s*/i, "");
                const cleanNote = t.note?.replace(/^Target (for [^:]+|to be achieved by [^:]+):\s*/i, "");
                return (
                  <div
                    key={t.id}
                    className="bg-surface border-border/80 flex items-start justify-between gap-3 rounded-lg border p-2.5 text-xs shadow-xs"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Target className="size-3.5 text-brand shrink-0 mt-0.5" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-text truncate">{cleanTitle}</span>
                        {cleanNote && (
                          <span className="text-text-muted text-[11px] line-clamp-2 mt-0.5">
                            {cleanNote}
                          </span>
                        )}
                      </div>
                    </div>
                    {onDeleteTarget && (
                      <button
                        type="button"
                        onClick={() => onDeleteTarget(t.id)}
                        title="Delete target"
                        aria-label={`Delete target ${cleanTitle}`}
                        className="text-text-muted hover:text-destructive hover:bg-destructive/10 rounded p-1 transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* New Target Form */}
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="flex flex-col gap-4.5 px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="target-title"
                className="text-xs font-semibold text-text tracking-wide flex items-center justify-between"
              >
                <span>
                  Target to achieve till this date <span className="text-brand font-bold">*</span>
                </span>
                <span className="text-[10px] text-text-muted font-normal">Required</span>
              </Label>
              <Input
                id="target-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Complete mobile checkout prototype & export assets"
                required
                autoFocus
                className="h-11 px-3.5 py-2.5 rounded-lg border border-border bg-canvas/60 text-text placeholder:text-text-muted/60 text-sm font-medium focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="target-note"
                className="text-xs font-semibold text-text tracking-wide flex items-center justify-between"
              >
                <span>Notes, links, or criteria</span>
                <span className="text-[10px] text-text-muted font-normal">Optional</span>
              </Label>
              <Textarea
                id="target-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Include interactive Figma link, acceptance criteria, or specific deliverables..."
                rows={3}
                className="px-3.5 py-2.5 rounded-lg border border-border bg-canvas/60 text-text placeholder:text-text-muted/60 text-sm focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 transition-all leading-relaxed"
              />
            </div>
          </div>

          {/* Footer actions */}
          <div className="border-border/50 bg-elevated/40 flex items-center justify-between border-t px-6 py-4">
            <span className="font-metadata text-text-muted text-[11px]">
              Press Esc to close
            </span>
            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={isPending}
                className="h-9 px-4 rounded-lg text-xs font-medium border-border hover:bg-elevated cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !title.trim()}
                className="h-9 px-5 rounded-lg text-xs font-semibold bg-brand text-white hover:bg-brand/90 active:scale-[0.98] shadow-sm transition-all gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Target className="size-3.5" />
                    <span>Save Target</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </dialog>
  );
}
