export type EntryComment = {
  id: string;
  author: string;
  text: string;
  badge?: "feedback" | "approved" | "update";
  createdAt: string;
};

const COMMENTS_DELIMITER = "\n\n<!-- worklog:comments -->\n";

export function parseEntryContent(rawNote: string | null | undefined): {
  note: string;
  comments: EntryComment[];
} {
  if (!rawNote) return { note: "", comments: [] };
  const idx = rawNote.indexOf(COMMENTS_DELIMITER);
  if (idx === -1) {
    return { note: rawNote.trim(), comments: [] };
  }
  const note = rawNote.slice(0, idx).trim();
  const jsonStr = rawNote.slice(idx + COMMENTS_DELIMITER.length).trim();
  try {
    const comments = JSON.parse(jsonStr);
    return { note, comments: Array.isArray(comments) ? comments : [] };
  } catch {
    return { note: rawNote.trim(), comments: [] };
  }
}

export function serializeEntryContent(
  note: string,
  comments: EntryComment[],
): string {
  const cleanNote = note.trim();
  if (comments.length === 0) return cleanNote;
  return `${cleanNote}${COMMENTS_DELIMITER}${JSON.stringify(comments)}`;
}
