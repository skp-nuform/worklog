"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Briefcase,
  Check,
  MoreVertical,
  Search,
  Shield,
  ShieldAlert,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setMemberStatus,
  updateMemberDepartment,
  updateMemberRole,
} from "@/features/workspace/actions";

const DEPARTMENTS = [
  "Design",
  "Engineering",
  "Social & Content",
  "Marketing",
  "Operations",
  "Strategy",
] as const;

export type MemberRow = {
  user_id: string;
  display_name: string;
  email: string;
  role: "owner" | "admin" | "member" | "guest";
  department?: string | null;
  status: "active" | "invited" | "removed";
  joined_at?: string | null;
};

export function TeamClient({
  workspaceId,
  viewerId,
  viewerRole,
  initialMembers,
}: {
  workspaceId: string;
  viewerId: string;
  viewerRole: "owner" | "admin" | "member" | "guest";
  initialMembers: MemberRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "removed">("all");
  const [isPending, startTransition] = useTransition();
  const [editingDeptUser, setEditingDeptUser] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string>("");

  const filteredMembers = useMemo(() => {
    return initialMembers.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        m.display_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.department && m.department.toLowerCase().includes(q))
      );
    });
  }, [initialMembers, search, statusFilter]);

  function handleRoleChange(userId: string, role: "admin" | "member" | "guest") {
    startTransition(async () => {
      const res = await updateMemberRole({ workspaceId, userId, role });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Member role updated");
      router.refresh();
    });
  }

  function handleStatusToggle(userId: string, currentStatus: "active" | "invited" | "removed", name: string) {
    const nextStatus = currentStatus === "removed" ? "active" : "removed";
    const actionName = nextStatus === "active" ? "reactivate" : "deactivate";

    if (!window.confirm(`Are you sure you want to ${actionName} ${name}'s access?`)) {
      return;
    }

    startTransition(async () => {
      const res = await setMemberStatus({ workspaceId, userId, status: nextStatus });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(nextStatus === "active" ? "Member access reactivated" : "Member access deactivated");
      router.refresh();
    });
  }

  function handleSaveDepartment(userId: string) {
    if (!selectedDept.trim()) return;
    startTransition(async () => {
      const res = await updateMemberDepartment({ workspaceId, userId, department: selectedDept.trim() });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Department updated");
      setEditingDeptUser(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Controls: Search + Status Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or department…"
            className="pl-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-frame bg-surface p-1 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
              statusFilter === "all"
                ? "bg-brand text-white font-semibold"
                : "text-text-muted hover:text-text"
            )}
          >
            All ({initialMembers.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("active")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
              statusFilter === "active"
                ? "bg-brand text-white font-semibold"
                : "text-text-muted hover:text-text"
            )}
          >
            Active ({initialMembers.filter((m) => m.status === "active").length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("removed")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
              statusFilter === "removed"
                ? "bg-brand text-white font-semibold"
                : "text-text-muted hover:text-text"
            )}
          >
            Deactivated ({initialMembers.filter((m) => m.status === "removed").length})
          </button>
        </div>
      </div>

      {/* Members List */}
      <div className="overflow-hidden rounded-xl border border-frame bg-surface shadow-xs">
        <div className="divide-y divide-frame">
          {filteredMembers.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-xs">
              No team members found matching your search.
            </div>
          ) : (
            filteredMembers.map((member) => {
              const isOwner = member.role === "owner";
              const isSelf = member.user_id === viewerId;
              const isDeactivated = member.status === "removed";
              const initials = member.display_name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <div
                  key={member.user_id}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 transition-colors",
                    isDeactivated ? "bg-elevated/30 opacity-70" : "hover:bg-elevated/20"
                  )}
                >
                  {/* Left: Avatar & Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "flex size-10 items-center justify-center rounded-full text-xs font-bold shrink-0",
                        isDeactivated
                          ? "bg-text-muted/20 text-text-muted"
                          : "bg-brand/15 text-brand"
                      )}
                    >
                      {initials}
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text text-sm truncate">
                          {member.display_name}
                        </span>
                        {isSelf && (
                          <span className="rounded-xs bg-brand/10 px-1.5 py-0.5 text-[9px] font-bold text-brand uppercase font-metadata">
                            You
                          </span>
                        )}
                        {isDeactivated && (
                          <span className="rounded-xs bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold text-destructive uppercase font-metadata">
                            Suspended
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-text-muted truncate">
                        {member.email}
                      </span>
                    </div>
                  </div>

                  {/* Middle & Right: Department, Role & Status Actions */}
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 ml-13 sm:ml-0">
                    {/* Department badge / editor */}
                    {editingDeptUser === member.user_id ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={selectedDept}
                          onChange={(e) => setSelectedDept(e.target.value)}
                          className="h-8 rounded-md border border-frame bg-surface px-2 text-xs text-text focus:outline-none focus:ring-1 focus:ring-brand"
                        >
                          {DEPARTMENTS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          onClick={() => handleSaveDepartment(member.user_id)}
                          disabled={isPending}
                          className="h-8 px-2.5 text-xs font-semibold"
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <button
                          type="button"
                          onClick={() => setEditingDeptUser(null)}
                          className="text-xs text-text-muted hover:text-text px-1"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDept(member.department || "Design");
                          setEditingDeptUser(member.user_id);
                        }}
                        title="Click to change department"
                        className="group/dept flex items-center gap-1 rounded-md border border-frame/70 bg-elevated/40 px-2 py-1 text-xs text-text-muted hover:border-brand/40 hover:text-text transition-colors cursor-pointer"
                      >
                        <Briefcase className="size-3 text-text-muted group-hover/dept:text-brand" />
                        <span>{member.department || "No department"}</span>
                      </button>
                    )}

                    {/* Role selector */}
                    {isOwner ? (
                      <span className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-bold text-brand uppercase font-metadata">
                        Owner
                      </span>
                    ) : (
                      <select
                        value={member.role}
                        onChange={(e) =>
                          handleRoleChange(
                            member.user_id,
                            e.target.value as "admin" | "member" | "guest",
                          )
                        }
                        disabled={isPending || isSelf}
                        className="h-8 rounded-md border border-frame bg-surface px-2 text-xs font-medium text-text focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer disabled:opacity-50"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="guest">Guest</option>
                      </select>
                    )}

                    {/* Deactivate / Reactivate button */}
                    {!isOwner && !isSelf && (
                      <Button
                        type="button"
                        variant={isDeactivated ? "outline" : "ghost"}
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          handleStatusToggle(member.user_id, member.status, member.display_name)
                        }
                        className={cn(
                          "h-8 text-xs font-medium cursor-pointer transition-colors",
                          isDeactivated
                            ? "border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                            : "text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                        )}
                      >
                        {isDeactivated ? (
                          <>
                            <UserCheck className="size-3.5 mr-1" />
                            Reactivate
                          </>
                        ) : (
                          <>
                            <UserX className="size-3.5 mr-1" />
                            Deactivate
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
