"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown,
  LogOut,
  Settings,
  Shield,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { createClient } from "@/lib/supabase/client";

export type ProfileMenuProps = {
  profile: {
    id: string;
    display_name: string;
    email: string;
    department?: string | null;
  } | null;
  workspaceRole?: "owner" | "admin" | "member" | "guest";
};

export function ProfileMenu({ profile, workspaceRole = "member" }: ProfileMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const name = profile?.display_name || "Abhishek";
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isAdmin = workspaceRole === "owner" || workspaceRole === "admin";

  async function handleSignOut() {
    try {
      setSigningOut(true);
      const supabase = createClient();
      await supabase.auth.signOut();

      // Clear local caches
      if (typeof window !== "undefined") {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("worklog:")) {
            localStorage.removeItem(key);
          }
        }
      }

      toast.success("Signed out successfully");
      window.location.href = "/login";
    } catch {
      toast.error("Failed to sign out");
      setSigningOut(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-frame bg-surface py-1 pl-1 pr-2.5 text-xs text-text hover:border-brand/40 hover:bg-elevated transition-colors cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
      >
        <div className="flex size-6 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand">
          {initials}
        </div>
        <span className="max-w-[120px] truncate font-medium text-text">
          {name}
        </span>
        <ChevronDown className={cn("size-3 text-text-muted transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="absolute right-0 top-10 z-50 flex w-60 flex-col rounded-xl border border-frame bg-surface p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95 duration-150"
          >
            {/* User Header */}
            <div className="border-b border-frame/70 px-3 py-2.5">
              <p className="text-sm font-semibold text-text truncate">{name}</p>
              <p className="text-xs text-text-muted truncate">{profile?.email}</p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-xs bg-brand/10 px-1.5 py-0.5 text-[9.5px] font-bold font-metadata uppercase text-brand">
                  {workspaceRole}
                </span>
                {profile?.department && (
                  <span className="rounded-xs bg-elevated px-1.5 py-0.5 text-[9.5px] font-metadata uppercase text-text-muted">
                    {profile.department}
                  </span>
                )}
              </div>
            </div>

            {/* Menu Items */}
            <div className="py-1">
              <Link
                href={"/sheet?who=me" as never}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-text hover:bg-elevated transition-colors"
              >
                <User className="size-3.5 text-text-muted" />
                <span>My Work</span>
              </Link>

              {isAdmin && (
                <Link
                  href={"/settings/team" as never}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-text hover:bg-elevated transition-colors"
                >
                  <Users className="size-3.5 text-brand" />
                  <span className="flex-1">Team Management</span>
                  <span className="rounded-xs bg-brand/10 px-1 text-[9px] font-bold text-brand uppercase font-metadata">Admin</span>
                </Link>
              )}
            </div>

            <div className="border-t border-frame/70 pt-1">
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer text-left"
              >
                <LogOut className="size-3.5" />
                <span>{signingOut ? "Signing out…" : "Sign out"}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
