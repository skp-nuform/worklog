"use client";

import { useState, useTransition } from "react";
import { MessageSquare, Send, CheckCircle2, RefreshCw, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCommentToEntry } from "@/features/sheet/actions";
import type { EntryComment } from "@/lib/comments";

export function EntryComments({
  entryId,
  initialComments = [],
  token,
  defaultAuthor = "Abhishek",
  onCommentAdded,
}: {
  entryId: string;
  initialComments?: EntryComment[];
  token?: string;
  defaultAuthor?: string;
  onCommentAdded?: () => void;
}) {
  const [comments, setComments] = useState<EntryComment[]>(initialComments);
  const [open, setOpen] = useState(initialComments.length > 0);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(defaultAuthor);
  const [badge, setBadge] = useState<"feedback" | "approved" | "update">("feedback");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res = await addCommentToEntry({
        entryId,
        author: author.trim() || "Abhishek",
        text: trimmed,
        badge,
        token,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      setComments((prev) => [...prev, res.data.comment]);
      setText("");
      toast.success("Comment posted");
      if (onCommentAdded) onCommentAdded();
    });
  }

  return (
    <div className="border-frame/60 mt-2 flex flex-col gap-2 border-t pt-2">
      {/* Toggle button */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-text-muted hover:text-text focus-visible:ring-ring flex items-center gap-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none"
        >
          <MessageSquare className="size-3.5" />
          <span>
            {comments.length === 0
              ? "Leave a comment or update"
              : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
          </span>
        </button>

        {comments.some((c) => c.badge === "approved") && (
          <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-metadata inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            <CheckCircle2 className="size-3" /> Approved by Boss
          </span>
        )}
      </div>

      {open && (
        <div className="bg-surface/50 border-frame flex flex-col gap-2.5 rounded-sm border p-2.5 text-xs">
          {/* List of comments */}
          {comments.length > 0 && (
            <div className="flex flex-col gap-2">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="border-frame/40 bg-elevated/40 flex flex-col gap-1 rounded border p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-text">{c.author}</span>
                      {c.badge === "approved" && (
                        <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded px-1 py-0.2 text-[9px] font-semibold">
                          Approved
                        </span>
                      )}
                      {c.badge === "update" && (
                        <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded px-1 py-0.2 text-[9px] font-semibold">
                          Update
                        </span>
                      )}
                    </div>
                    <span className="font-metadata text-text-muted text-[10px]">
                      {new Date(c.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-text leading-relaxed whitespace-pre-wrap">{c.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Add comment form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted text-[11px]">As:</span>
              <button
                type="button"
                onClick={() => setAuthor("Abhishek")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  author === "Abhishek"
                    ? "bg-text text-canvas"
                    : "bg-elevated text-text-muted hover:text-text",
                )}
              >
                Abhishek
              </button>
              <button
                type="button"
                onClick={() => setAuthor("SKP")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  author === "SKP"
                    ? "bg-text text-canvas"
                    : "bg-elevated text-text-muted hover:text-text",
                )}
              >
                SKP
              </button>

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  title="Feedback"
                  onClick={() => setBadge("feedback")}
                  className={cn(
                    "rounded p-1 text-[10px]",
                    badge === "feedback"
                      ? "bg-brand/10 text-brand font-semibold"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  <MessageCircle className="size-3" />
                </button>
                <button
                  type="button"
                  title="Approve work"
                  onClick={() => setBadge("approved")}
                  className={cn(
                    "rounded p-1 text-[10px]",
                    badge === "approved"
                      ? "bg-emerald-500/10 text-emerald-600 font-semibold"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  <CheckCircle2 className="size-3" />
                </button>
                <button
                  type="button"
                  title="Request update"
                  onClick={() => setBadge("update")}
                  className={cn(
                    "rounded p-1 text-[10px]",
                    badge === "update"
                      ? "bg-indigo-500/10 text-indigo-600 font-semibold"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  <RefreshCw className="size-3" />
                </button>
              </div>
            </div>

            <div className="flex gap-1.5">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  author === "Abhishek"
                    ? "Leave a note or feedback for SKP..."
                    : "Add an update or response..."
                }
                className="h-8 text-xs"
              />
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !text.trim()}
                className="h-8 px-3"
              >
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
