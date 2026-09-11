import { describe, expect, it } from "vitest";
import { isTargetEntry, parseTargetFromEntry } from "@/lib/targets";

// Authorization policy rules matching application and RLS constraints
function canModifyEntry(viewer: { id: string; role: "owner" | "admin" | "member" | "guest" }, entry: { author_id: string }): boolean {
  if (viewer.role === "guest") return false;
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  return viewer.id === entry.author_id;
}

function canAssignTarget(
  viewer: { id: string; role: "owner" | "admin" | "member" | "guest" },
  targetAssigneeId: string,
): { allowed: boolean; reason?: string } {
  if (viewer.role === "guest") {
    return { allowed: false, reason: "Guests cannot assign targets." };
  }
  const isAdmin = viewer.role === "owner" || viewer.role === "admin";
  if (!isAdmin && targetAssigneeId !== viewer.id) {
    return { allowed: false, reason: "Non-admins can only assign targets to themselves." };
  }
  return { allowed: true };
}

function canModifyTargetStatus(
  viewer: { id: string; role: "owner" | "admin" | "member" | "guest" },
  target: { assigneeId: string },
): boolean {
  if (viewer.role === "guest") return false;
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  return viewer.id === target.assigneeId;
}

function canDeactivateMember(
  actor: { id: string; role: "owner" | "admin" | "member" | "guest" },
  targetMember: { id: string; role: "owner" | "admin" | "member" | "guest" },
): { allowed: boolean; reason?: string } {
  if (actor.role !== "owner" && actor.role !== "admin") {
    return { allowed: false, reason: "Only admins can deactivate members." };
  }
  if (actor.id === targetMember.id) {
    return { allowed: false, reason: "You cannot deactivate your own access." };
  }
  if (targetMember.role === "owner") {
    return { allowed: false, reason: "The workspace owner cannot be deactivated." };
  }
  return { allowed: true };
}

describe("Nuform Worklog Studio Authorization Engine", () => {
  const employeeA = { id: "user-emp-a", role: "member" as const };
  const employeeB = { id: "user-emp-b", role: "member" as const };
  const admin = { id: "user-admin", role: "admin" as const };
  const owner = { id: "user-owner", role: "owner" as const };
  const guest = { id: "user-guest", role: "guest" as const };

  const entryA = { id: "entry-1", author_id: employeeA.id, title: "Figma wireframes" };
  const entryB = { id: "entry-2", author_id: employeeB.id, title: "API endpoints" };

  describe("Entry Edit & Delete Permissions", () => {
    it("allows Employee A to edit and delete their own entry", () => {
      expect(canModifyEntry(employeeA, entryA)).toBe(true);
    });

    it("prevents Employee A from editing or deleting Employee B's entry", () => {
      expect(canModifyEntry(employeeA, entryB)).toBe(false);
    });

    it("prevents Employee B from editing or deleting Employee A's entry", () => {
      expect(canModifyEntry(employeeB, entryA)).toBe(false);
    });

    it("allows Admin to edit and delete Employee A's entry (supervisory access)", () => {
      expect(canModifyEntry(admin, entryA)).toBe(true);
    });

    it("allows Admin to edit and delete Employee B's entry (supervisory access)", () => {
      expect(canModifyEntry(admin, entryB)).toBe(true);
    });

    it("allows Owner to edit and delete any entry", () => {
      expect(canModifyEntry(owner, entryA)).toBe(true);
      expect(canModifyEntry(owner, entryB)).toBe(true);
    });

    it("strictly prevents guest viewers from modifying any entry", () => {
      expect(canModifyEntry(guest, entryA)).toBe(false);
      expect(canModifyEntry(guest, entryB)).toBe(false);
    });
  });

  describe("Target Assignment Permissions", () => {
    it("allows Employee A to set a target for themselves", () => {
      const result = canAssignTarget(employeeA, employeeA.id);
      expect(result.allowed).toBe(true);
    });

    it("prevents Employee A from assigning a target to Employee B", () => {
      const result = canAssignTarget(employeeA, employeeB.id);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Non-admins can only assign targets to themselves");
    });

    it("allows Admin to assign a target to Employee A with admin attribution", () => {
      const result = canAssignTarget(admin, employeeA.id);
      expect(result.allowed).toBe(true);
    });

    it("allows Admin to assign a target to Employee B", () => {
      const result = canAssignTarget(admin, employeeB.id);
      expect(result.allowed).toBe(true);
    });

    it("prevents guests from creating targets", () => {
      const result = canAssignTarget(guest, employeeA.id);
      expect(result.allowed).toBe(false);
    });
  });

  describe("Target Status Transition Permissions", () => {
    const targetA = { id: "tgt-1", assigneeId: employeeA.id };
    const targetB = { id: "tgt-2", assigneeId: employeeB.id };

    it("allows assignee Employee A to transition status on their own target", () => {
      expect(canModifyTargetStatus(employeeA, targetA)).toBe(true);
    });

    it("prevents Employee A from changing status on Employee B's target", () => {
      expect(canModifyTargetStatus(employeeA, targetB)).toBe(false);
    });

    it("allows Admin to change status on any employee's target", () => {
      expect(canModifyTargetStatus(admin, targetA)).toBe(true);
      expect(canModifyTargetStatus(admin, targetB)).toBe(true);
    });
  });

  describe("Team Member Deactivation Policies", () => {
    it("allows Admin to deactivate Employee A or Employee B", () => {
      expect(canDeactivateMember(admin, employeeA).allowed).toBe(true);
      expect(canDeactivateMember(admin, employeeB).allowed).toBe(true);
    });

    it("prevents non-admins from deactivating teammates", () => {
      const res = canDeactivateMember(employeeA, employeeB);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Only admins");
    });

    it("prevents an admin from deactivating themselves", () => {
      const res = canDeactivateMember(admin, admin);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("cannot deactivate your own access");
    });

    it("prevents anyone from deactivating the workspace owner", () => {
      const res = canDeactivateMember(admin, owner);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("owner cannot be deactivated");
    });
  });

  describe("Target Parsing & Overdue State Derivation", () => {
    it("recognizes target entries correctly", () => {
      expect(isTargetEntry(["target", "target:2026-10-01"])).toBe(true);
      expect(isTargetEntry(["design", "sprint-1"])).toBe(false);
      expect(isTargetEntry({ tags: ["target"] })).toBe(true);
      expect(isTargetEntry(undefined)).toBe(false);
    });

    it("correctly derives overdue status as missed for past upcoming targets", () => {
      const pastEntry = {
        id: "past-target-1",
        title: "🎯 Target: Deliver prototype",
        note: "Need high-fidelity Figma",
        tags: [
          "target",
          "target:2020-01-01", // Clearly in the past
          "target-status:upcoming",
          "target-creator:user-admin",
          "target-creator-name:Abhishek",
        ],
        author_id: "user-emp-a",
        author_name: "Rohan",
      };

      const parsed = parseTargetFromEntry(pastEntry);
      expect(parsed).not.toBeNull();
      expect(parsed?.title).toBe("Deliver prototype");
      expect(parsed?.status).toBe("missed");
      expect(parsed?.isOverdue).toBe(true);
      expect(parsed?.createdByName).toBe("Abhishek");
    });

    it("preserves done status even if target date has passed", () => {
      const completedPastEntry = {
        id: "past-done-1",
        title: "🎯 Target: Launch MVP",
        note: null,
        tags: [
          "target",
          "target:2020-01-01",
          "target-status:done",
          "target-done:2020-01-01T12:00:00Z",
        ],
        author_id: "user-emp-a",
        author_name: "Rohan",
      };

      const parsed = parseTargetFromEntry(completedPastEntry);
      expect(parsed?.status).toBe("done");
      expect(parsed?.isOverdue).toBe(false);
    });
  });
});
