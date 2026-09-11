export type TargetStatus = "upcoming" | "in_progress" | "done" | "missed";

export type ParsedTarget = {
  id: string;
  title: string;
  rawTitle: string;
  note: string | null;
  targetDate: string;
  status: TargetStatus;
  assigneeId: string;
  assigneeName: string;
  assigneeDepartment?: string | null;
  createdBy: string;
  createdByName?: string | null;
  completedAt?: string | null;
  isOverdue: boolean;
};

export function isTargetEntry(input?: string[] | { tags?: string[] }): boolean {
  if (!input) return false;
  if (Array.isArray(input)) return input.includes("target");
  return Boolean(input.tags?.includes("target"));
}

export function parseTargetFromEntry(entry: {
  id: string;
  title: string;
  note: string | null;
  tags: string[];
  author_id: string;
  author_name: string | null;
  author_department?: string | null;
  work_date?: string;
}): ParsedTarget | null {
  if (!isTargetEntry(entry.tags)) return null;

  const targetDateTag = entry.tags.find((t) => t.startsWith("target:"));
  const targetDate = targetDateTag
    ? targetDateTag.replace("target:", "")
    : entry.work_date || new Date().toISOString().slice(0, 10);

  const statusTag = entry.tags.find((t) => t.startsWith("target-status:"));
  let status: TargetStatus = statusTag
    ? (statusTag.replace("target-status:", "") as TargetStatus)
    : "upcoming";

  const doneTag = entry.tags.find((t) => t.startsWith("target-done:"));
  const completedAt = doneTag ? doneTag.replace("target-done:", "") : null;

  const creatorTag = entry.tags.find((t) => t.startsWith("target-creator:"));
  const createdBy = creatorTag ? creatorTag.replace("target-creator:", "") : entry.author_id;

  const creatorNameTag = entry.tags.find((t) => t.startsWith("target-creator-name:"));
  let createdByName: string | null = null;
  if (creatorNameTag) {
    try {
      createdByName = decodeURIComponent(creatorNameTag.replace("target-creator-name:", ""));
    } catch {
      createdByName = creatorNameTag.replace("target-creator-name:", "");
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = status !== "done" && targetDate < today;
  if (isOverdue && status === "upcoming") {
    status = "missed";
  }

  // Clean title
  const cleanTitle = entry.title
    .replace(/^🎯\s*Target:\s*/i, "")
    .replace(/^Target:\s*/i, "")
    .trim();

  return {
    id: entry.id,
    title: cleanTitle,
    rawTitle: entry.title,
    note: entry.note,
    targetDate,
    status,
    assigneeId: entry.author_id,
    assigneeName: entry.author_name || "Teammate",
    assigneeDepartment: entry.author_department,
    createdBy,
    createdByName,
    completedAt,
    isOverdue,
  };
}

export const parseTargetEntry = parseTargetFromEntry;
