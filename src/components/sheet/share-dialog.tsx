"use client";

import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createShareLink, revokeShareLink } from "@/features/sheet/actions";
import { createClient } from "@/lib/supabase/client";

type Person = { user_id: string; display_name: string };

/**
 * Publish a read-only link.
 *
 * The scope is chosen explicitly — whose work, which dates, downloads or
 * not — and the resulting URL is shown ONCE, because only its hash is
 * stored. Lose it and you rotate rather than recover it.
 */
type ActiveLink = {
  id: string;
  label: string | null;
  created_at: string;
  is_active: boolean;
  view_count: number;
};

export function ShareDialog({
  open,
  onClose,
  workspaceId,
  people,
  viewerId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  people: Person[];
  viewerId: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresOn, setExpiresOn] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<ActiveLink[]>([]);

  const [who, setWho] = useState<string>("me");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [allowDownload, setAllowDownload] = useState(true);
  const [expiry, setExpiry] = useState<"30" | "90" | "never">("30");
  const [label, setLabel] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    void supabase
      .from("share_links")
      .select("id, label, created_at, is_active, view_count")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setLinks(data as ActiveLink[]);
      });
  }, [open, workspaceId]);

  function handleRevoke(id: string) {
    if (!window.confirm("Revoke this link? Anyone with it will immediately lose access.")) return;
    startTransition(async () => {
      const res = await revokeShareLink(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Link revoked");
      setLinks((prev) => prev.filter((l) => l.id !== id));
    });
  }

  // Reset here rather than in an effect: setState inside an effect causes a
  // cascading render, and this is a user action, not a synchronisation.
  function close() {
    setUrl(null);
    setCopied(false);
    onClose();
  }

  function create() {
    startTransition(async () => {
      const result = await createShareLink({
        workspaceId,
        label: label.trim() || undefined,
        authorId: who === "all" ? undefined : who === "me" ? viewerId : who,
        fromDate: from || undefined,
        toDate: to || undefined,
        allowDownload,
        expiresInDays: expiry === "never" ? null : Number(expiry),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(result.data.url);
      setExpiresOn(
        expiry === "never"
          ? null
          : new Date(Date.now() + Number(expiry) * 86_400_000),
      );
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it manually.");
    }
  }

  const selectClass =
    "border-boundary bg-surface text-text focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

  return (
    <dialog
      ref={ref}
      onClose={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="share-title"
      className="bg-surface text-text border-border shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm fixed inset-0 m-auto w-[min(92vw,32rem)] rounded-2xl border p-0 open:animate-in open:fade-in-0 open:zoom-in-95 focus:outline-none overflow-hidden"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <p className="font-metadata text-text-muted text-[10px] tracking-[0.2em] uppercase">
            Share
          </p>
          <h2 id="share-title" className="text-xl font-semibold tracking-tight">
            Publish a read-only link
          </h2>
        </div>

        {url ? (
          <div className="flex flex-col gap-3">
            <p className="text-text-muted text-sm">
              Anyone with this link can view the sheet
              {allowDownload ? " and download the files" : ""}. It is shown
              once — only a hash is stored, so it cannot be recovered later.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-metadata text-[12px]"
                aria-label="Share link"
              />
              <Button type="button" onClick={copy}>
                {copied ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {expiresOn && (
              <p className="font-metadata text-text-muted text-[11px]">
                Expires{" "}
                {expiresOn.toLocaleDateString(undefined, {
                  dateStyle: "long",
                })}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-who">Whose work</Label>
                <select
                  id="share-who"
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  className={selectClass}
                >
                  <option value="me">Just mine</option>
                  <option value="all">Everyone in the workspace</option>
                  {people
                    .filter((p) => p.user_id !== viewerId)
                    .map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.display_name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-expiry">Access ends</Label>
                <select
                  id="share-expiry"
                  value={expiry}
                  onChange={(e) =>
                    setExpiry(e.target.value as "30" | "90" | "never")
                  }
                  className={selectClass}
                >
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="never">Never</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-from">From (optional)</Label>
                <Input
                  id="share-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="font-metadata h-9 text-[13px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-to">To (optional)</Label>
                <Input
                  id="share-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="font-metadata h-9 text-[13px]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-label">Label (optional)</Label>
              <Input
                id="share-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. September review for Ravi"
              />
            </div>

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
                className="accent-brand mt-0.5 size-4"
              />
              <span>
                Allow downloads
                <span className="text-text-muted block text-[12.5px]">
                  Off means view-only. Anyone can still screenshot what they
                  can see.
                </span>
              </span>
            </label>

            <p className="text-text-muted border-frame border-t pt-3 text-[12.5px]">
              A link is not confidential once forwarded. Choose the narrowest
              scope that does the job.
            </p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="button" onClick={create} disabled={pending}>
                {pending && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                Create link
              </Button>
            </div>
          </div>
        )}

        {/* Active links list */}
        {links.length > 0 && (
          <div className="border-frame flex flex-col gap-2 border-t pt-3">
            <p className="font-metadata text-text-muted text-[10px] tracking-[0.14em] uppercase">
              Active share links ({links.length})
            </p>
            <ul className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {links.map((link) => (
                <li
                  key={link.id}
                  className="border-frame bg-elevated flex items-center justify-between border p-2 text-xs"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-text font-medium truncate">
                      {link.label || "Workspace share link"}
                    </span>
                    <span className="font-metadata text-text-muted text-[10px]">
                      {new Date(link.created_at).toLocaleDateString()} · {link.view_count} view{link.view_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(link.id)}
                    aria-label={`Revoke ${link.label || "link"}`}
                    className="text-text-muted hover:text-destructive h-7 px-2 text-xs"
                  >
                    <Trash2 aria-hidden="true" className="mr-1 size-3" />
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </dialog>
  );
}
