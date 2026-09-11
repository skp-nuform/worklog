"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Briefcase, Building2, Loader2, Mail, User, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerNuformUser } from "@/features/auth/actions";
import { isNuformEmail, NUFORM_DOMAIN } from "@/features/auth/domain";

const DEPARTMENTS = [
  "Design",
  "Engineering",
  "Social & Content",
  "Marketing",
  "Operations",
  "Strategy",
] as const;

export function CreateAccountDialog({
  open,
  initialEmail = "",
  onClose,
}: {
  open: boolean;
  initialEmail?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [department, setDepartment] = useState("Design");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedDept = department.trim();

    if (trimmedName.length < 2) {
      toast.error("Please enter your full name (at least 2 characters).");
      return;
    }

    if (!isNuformEmail(trimmedEmail)) {
      toast.error(`Only ${NUFORM_DOMAIN} email addresses are allowed.`);
      return;
    }

    if (!trimmedDept) {
      toast.error("Please select or enter your department.");
      return;
    }

    startTransition(async () => {
      const res = await registerNuformUser({
        name: trimmedName,
        email: trimmedEmail,
        department: trimmedDept,
      });

      if (res && !res.ok) {
        toast.error(res.error || "Failed to create account.");
      }
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[92vw] max-w-md rounded-xl border border-frame bg-surface p-0 text-text shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-frame px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Building2 className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-text">
                Create Nuform Account
              </h2>
              <p className="text-xs text-text-muted">
                Join the team journal with your company credentials
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-muted hover:text-text rounded-md p-1 transition-colors hover:bg-elevated cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          {/* Full Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-name" className="text-xs font-medium text-text flex items-center gap-1.5">
              <User className="size-3.5 text-text-muted" />
              Full Name
            </Label>
            <Input
              id="reg-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Abhishek Kumar"
              className="bg-elevated/40 border-frame text-text focus:border-brand"
            />
          </div>

          {/* Work Email */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="reg-email" className="text-xs font-medium text-text flex items-center gap-1.5">
                <Mail className="size-3.5 text-text-muted" />
                Work Email
              </Label>
              <span className="font-mono text-[10px] text-brand tracking-wider font-semibold">
                REQUIRED: {NUFORM_DOMAIN}
              </span>
            </div>
            <Input
              id="reg-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="yourname@nuformsocial.com"
              className="bg-elevated/40 border-frame text-text focus:border-brand"
            />
            <p className="text-[11px] text-text-muted">
              Must end with <code className="text-brand font-medium">@nuformsocial.com</code>
            </p>
          </div>

          {/* Department */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-medium text-text flex items-center gap-1.5">
              <Briefcase className="size-3.5 text-text-muted" />
              Department
            </Label>

            {/* Quick Pills */}
            <div className="flex flex-wrap gap-1.5">
              {DEPARTMENTS.map((dept) => {
                const isSelected = department === dept;
                return (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => setDepartment(dept)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? "bg-brand text-white shadow-xs font-semibold"
                        : "bg-elevated/70 text-text-muted border border-frame/70 hover:border-brand/40 hover:text-text"
                    }`}
                  >
                    {dept}
                  </button>
                );
              })}
            </div>

            {/* Custom Department Input */}
            <Input
              id="reg-dept"
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Or enter custom department..."
              className="bg-elevated/30 border-frame/60 text-xs text-text h-8 mt-0.5"
            />
          </div>

          {/* Action Buttons */}
          <div className="mt-2 flex items-center justify-end gap-2.5 pt-2 border-t border-frame/50">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="gap-2 font-medium bg-brand text-white hover:bg-brand-hover"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Creating Account…
                </>
              ) : (
                "Create Account & Enter"
              )}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
