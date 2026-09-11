/**
 * Row shapes for the `public` API surface (migration 0005).
 *
 * Hand-written rather than generated: `supabase gen types` needs a reachable
 * database, and the schema is not applied yet. REGENERATE once it is:
 *
 *   npm run db:types | Out-File -Encoding utf8 src/lib/database.types.ts
 *
 * Until then these are the contract the app codes against, kept deliberately
 * narrow — only the columns the UI actually reads.
 */

export type WorkKind = "work" | "idea";

export type RequestSource =
  | "verbal"
  | "meeting"
  | "chat"
  | "email"
  | "ticket"
  | "self"
  | "other";

export type Priority = "low" | "normal" | "high" | "urgent";

export type MyProfile = {
  id: string;
  display_name: string;
  email: string;
  timezone: string;
  theme: "light" | "dark" | "system";
  department?: string | null;
};

export type MyWorkspace = {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: "owner" | "admin" | "member" | "guest";
  status: "active" | "invited" | "removed";
  joined_at: string | null;
};

export type Brand = {
  id: string;
  workspace_id: string;
  name: string;
  archived_at: string | null;
  version: number;
};

export type Project = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  name: string;
  brief: string | null;
  archived_at: string | null;
  created_at: string;
  version: number;
};

/** `public.work_items` — the list and detail view. */
export type WorkItemRow = {
  id: string;
  workspace_id: string;
  reference: string;
  project_id: string | null;
  brand_id: string | null;
  kind: WorkKind;
  status: string;
  title: string;
  priority: Priority;
  progress_note: string | null;
  state_reason: string | null;
  next_action: string | null;
  reviewer_id: string | null;
  deadline_date: string | null;
  deadline_at: string | null;
  archived_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  version: number;

  project_name: string | null;
  brand_name: string | null;
  author_name: string | null;

  current_revision_id: string | null;
  current_revision_no: number | null;
  request_summary: string | null;
  expected_outcome: string | null;
  acceptance_criteria: string | null;
  requester_label: string | null;
  requester_user_id: string | null;
  request_source: RequestSource | null;
  source_url: string | null;
  /** User-reported. Distinct from created_at, which is when we recorded it. */
  reported_request_date: string | null;

  is_confirmed: boolean;
  confirmed_at: string | null;
  has_revisions: boolean;

  latest_submission_no: number | null;
  latest_submitted_at: string | null;
  approved_submission_no: number | null;
  newer_submission_exists: boolean;
};

export type WorkItemRevisionRow = {
  id: string;
  workspace_id: string;
  work_item_id: string;
  revision_no: number;
  summary: string;
  rationale: string | null;
  expected_outcome: string | null;
  acceptance_criteria: string | null;
  requester_label: string | null;
  requester_user_id: string | null;
  source: RequestSource;
  source_url: string | null;
  reported_request_date: string | null;
  change_reason: string | null;
  created_at: string;
  created_by: string;
  author_name: string | null;
};

export type ActivityEventRow = {
  id: number;
  workspace_id: string;
  actor_id: string | null;
  event_type: string;
  work_item_id: string | null;
  project_id: string | null;
  submission_id: string | null;
  payload: Record<string, unknown>;
  is_redacted: boolean;
  created_at: string;
  actor_name: string | null;
};
