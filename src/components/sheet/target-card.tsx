"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  MoreVertical,
  Pencil,
  Target,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { updateTargetStatus, deleteTarget, type TargetStatus } from "@/features/target/actions";
import { parseTargetFromEntry, type ParsedTarget } from "@/lib/targets";
import type { SheetEntry } from "./sheet-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_CONFIG: Record<
  TargetStatus,
  { label: string; badgeClass: string; icon: typeof Clock }
> = {
  upcoming: {
    label: "Upcoming",
    badgeClass: "bg-brand/10 text-brand border-brand/30",
    icon: Clock,
  },
  in_progress: {
    label: "In Progress",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    icon: Clock,
  },
  done: {
    label: "Done",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: CheckCircle2,
  },
  missed: {
    label: "Missed",
    badgeClass: "bg-destructive/15 text-destructive border-destructive/30",
    icon: AlertCircle,
  },
};

export type TargetCardProps = {
  target?: ParsedTarget;
  entry?: SheetEntry;
  viewerId?: string;
  viewerRole?: "owner" | "admin" | "member" | "guest" | string;
  showAuthors?: boolean;
  token?: string;
  onEdit?: (entry: SheetEntry) => void;
  onDelete?: (entry: SheetEntry) => void;
  onStatusChange?: (targetId: string, status: TargetStatus) => void;
  className?: string;
};

export function TargetCard({
  target: directTarget,
  entry,
  viewerId,
  viewerRole,
  showAuthors = true,
  token,
  onEdit,
  onDelete,
  onStatusChange,
  className,
}: TargetCardProps) {
  const parsedTarget = directTarget ?? (entry ? parseTargetFromEntry(entry) : null);
  const [isPending, startTransition] = useTransition();
  const [currentStatus, setCurrentStatus] = useState<TargetStatus>(parsedTarget?.status ?? "upcoming");

  if (!parsedTarget) return null;
  const target = parsedTarget;

  const isAdmin = viewerRole === "owner" || viewerRole === "admin";
  const isAssignee = target.assigneeId === viewerId;
  const canModify = isAssignee || isAdmin;

  const config = STATUS_CONFIG[currentStatus];
  const StatusIcon = config.icon;

  function toggleDone() {
    if (!canModify) return;
    const nextStatus: TargetStatus = currentStatus === "done" ? "in_progress" : "done";
    startTransition(async () => {
      setCurrentStatus(nextStatus);
      const res = await updateTargetStatus({
        targetId: target.id,
        status: nextStatus,
      });
      if (!res.ok) {
        setCurrentStatus(currentStatus);
        toast.error(res.error);
        return;
      }
      toast.success(
        nextStatus === "done" ? "Target marked as completed!" : "Target reopened",
      );
    });
  }

  function handleSetStatus(s: TargetStatus) {
    if (!canModify) return;
    startTransition(async () => {
      setCurrentStatus(s);
      const res = await updateTargetStatus({ targetId: target.id, status: s });
      if (!res.ok) {
        setCurrentStatus(currentStatus);
        toast.error(res.error);
        return;
      }
      toast.success(`Target status: ${STATUS_CONFIG[s].label}`);
    });
  }

  function handleDelete() {
    if (!canModify) return;
    if (onDelete && entry) {
      onDelete(entry);
      return;
    }
    if (!window.confirm(`Delete target "${target.title}"?`)) return;

    startTransition(async () => {
      const res = await deleteTarget(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Target deleted");
    });
  }

  return (
    <article
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200",
        currentStatus === "done"
          ? "border-emerald-500/30 bg-surface/40 opacity-85"
          : currentStatus === "missed"
            ? "border-destructive/30 bg-surface/50"
            : "border-brand/40 bg-surface/80 hover:border-brand/70 hover:shadow-md",
        className,
      )}
    >
      {/* Top Header: Target Badge + Status Pill + Overflow Menu */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-brand text-white font-metadata inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[9.5px] font-bold tracking-[0.14em] uppercase shadow-xs">
            <Target className="size-3" />
            TARGET
          </span>

          <span
            className={cn(
              "font-metadata inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase",
              config.badgeClass,
            )}
          >
            <StatusIcon className="size-2.5" />
            {config.label}
          </span>
        </div>

        {/* Action Menu */}
        <div className="flex items-center gap-1">
          {canModify && (
            <button
              type="button"
              onClick={toggleDone}
              disabled={isPending}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                currentStatus === "done"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "border-frame bg-elevated text-text hover:border-brand/50 hover:bg-brand hover:text-white",
              )}
            >
              {currentStatus === "done" ? "✓ Completed" : "Mark Done"}
            </button>
          )}

          {canModify && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Target actions"
                  className="text-text-muted hover:text-text rounded-md p-1 hover:bg-elevated transition-colors cursor-pointer"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => handleSetStatus("upcoming")}
                  disabled={currentStatus === "upcoming"}
                >
                  Set as Upcoming
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSetStatus("in_progress")}
                  disabled={currentStatus === "in_progress"}
                >
                  Set as In Progress
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSetStatus("done")}
                  disabled={currentStatus === "done"}
                >
                  Set as Done
                </DropdownMenuItem>
                {onEdit && (
                  <DropdownMenuItem
                    onClick={() => {
                      if (entry) {
                        onEdit(entry);
                      } else {
                        onEdit({
                          id: target.id,
                          title: target.rawTitle,
                          note: target.note,
                          tags: ["target", `target:${target.targetDate}`],
                          author_id: target.assigneeId,
                          author_name: target.assigneeName,
                          author_department: target.assigneeDepartment,
                          assets: [],
                        });
                      }
                    }}
                  >
                    <Pencil className="size-3.5 mr-2" />
                    Edit Target
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-3.5 mr-2" />
                  Delete Target
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Target Title */}
      <h4
        className={cn(
          "text-[16px] font-semibold leading-snug tracking-[-0.01em]",
          currentStatus === "done" ? "text-text-muted line-through" : "text-text",
        )}
      >
        {target.title}
      </h4>

      {/* Optional Note */}
      {target.note && (
        <p className="text-text-muted text-[13px] leading-relaxed whitespace-pre-wrap">
          {target.note}
        </p>
      )}

      {/* Footer Attribution: Assignee, Due Date, and Creator */}
      <div className="border-frame/60 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          {/* Assignee */}
          <div className="flex items-center gap-1.5 font-medium text-text">
            <span className="bg-brand/20 text-brand flex size-5 items-center justify-center rounded-full text-[10px] font-bold">
              {target.assigneeName.charAt(0).toUpperCase()}
            </span>
            <span>{target.assigneeName}</span>
            {target.assigneeDepartment && (
              <span className="font-metadata text-text-dim text-[10px] uppercase font-mono">
                · {target.assigneeDepartment}
              </span>
            )}
          </div>

          {/* Admin Attribution if set by someone else */}
          {target.createdByName && target.createdBy !== target.assigneeId && (
            <span className="text-text-muted text-[11px]">
              (Set by <strong className="text-text-muted">{target.createdByName}</strong>)
            </span>
          )}
        </div>

        {/* Due date */}
        <div className="flex items-center gap-1 text-[11px] font-medium text-text-muted">
          <Calendar className="size-3 text-brand" />
          <span>Due {target.targetDate}</span>
        </div>
      </div>
    </article>
  );
}
