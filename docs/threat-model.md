# Threat model

Scope: Worklog as specified — a private workspace holding internal work
records, with external guest sharing. Written in M0, before feature UI.

What Worklog is **not**, because it bounds the model: not an
employee-monitoring system, not a tamper-proof ledger against a database
administrator, and not a guarantee that recorded statements are true. It
records actions and acknowledgements. A server timestamp proves when the
application recorded an action, not when work objectively happened.

---

## 1. Actors and what each is trusted with

| Actor | Trusted with | Explicitly not trusted with |
|---|---|---|
| Workspace owner/admin | Membership, export policy, retention, publication policy | Impersonating a member, or manufacturing another user's approval |
| Project contributor | Work in assigned projects and own Inbox | Reviewing their own submission; reading other projects |
| Project reviewer | Review decisions on assigned submissions | Arbitrary author edits; publication |
| Project viewer | Reading granted records | Any write beyond permitted comments |
| External guest (verified email, invited) | Exactly the share projection; comments when enabled | Workspace discovery, export, onward permission granting |
| Anonymous visitor (unlisted link) | Reading a valid share projection | Any write; any identity claim |
| The application server | Minting scoped storage links, finalizing uploads | Being the only place a rule is enforced |

The last row is the load-bearing one. Every rule that can be expressed in the
database is expressed there, because the server is the component most likely to
have a bug.

---

## 2. Trust boundaries

```
Browser (untrusted input, incl. all IDs and version numbers)
  ↓
Next.js server  — authorizes EVERY operation independently
  ↓ user-scoped client (RLS applies)          ↓ secret key (RLS bypassed)
Postgres: app / authz / api / share      Storage finalize, guest asset proxy,
                                          cleanup worker — 3 call sites only
  ↓
Private Storage bucket (no anon policy; no UPDATE/DELETE for anon or authenticated)
```

Guest requests cross an extra boundary: they never reach `app` tables at all,
only `share.resolve_and_project` executed by `worklog_share_reader`.

---

## 3. Threats and controls

### T-01 Horizontal privilege escalation by ID substitution
**Attack.** A member of workspace B submits a work-item, project, submission,
or artifact ID belonging to workspace A, in a URL or a server-action payload.

**Controls.** `workspace_id` on every row plus composite FKs, so a
cross-tenant reference fails as `23503`. RLS filters reads. Client-supplied
workspace IDs, roles, author IDs, and actor IDs are never treated as
authority. Read, mutate, upload, export, and download paths each authorize
separately.

**Residual.** A missing policy on a newly added table. Mitigated by a pgTAP
test that fails if any `app` table lacks RLS.

### T-02 Stale-token privilege retention
**Attack.** A removed member keeps using an access token issued before removal.

**Control.** Membership is read live from the database in RLS, never from JWT
claims (D-06). A pgTAP test constructs a token whose claims still say `admin`,
deletes the membership row in the same transaction, and asserts denial.

**Residual.** Sessions are not proactively destroyed, so a removed member's
token remains *syntactically* valid until refresh. It authorizes nothing.

### T-03 Manufactured approval
**Attack.** A contributor — or an admin — approves their own submission, or
forges the submitter's identity to slip past the check.

**Controls.** `CHECK (decided_by <> submission_submitted_by)`, which binds
every role including `service_role` and definer functions. The denormalized
submitter is pinned truthful by composite FK, and `submitted_by` is immutable.
`decided_by` comes from `auth.uid()`, not the request body. One approval per
submission via partial unique index.

### T-04 Approval laundering across versions
**Attack.** Get version 2 approved, then swap the artifacts or add version 3
so the approval appears to cover the new work.

**Controls.** No cached `approved_submission_id`. The decision pins
`submission_content_hash` by composite FK. Artifact replacement is a new
version; referenced versions are `ON DELETE RESTRICT`. Submissions are
append-only.

### T-05 Guest data leak
**Attack.** A guest reads internal comments, other projects, requester
contacts, internal brief history, or private source URLs — through HTML, a
JSON endpoint, notification payloads, metadata, or an export path.

**Controls.** No `anon` policy on any `app` table. A dedicated
`worklog_share_reader` role with EXECUTE-only privileges. A field allowlist
registry that **defaults to deny**, so a column added later is invisible until
published. A `zod.strict()` DTO at the single import choke point for
`app/s/**`. Guest export disabled.

**Test.** The internal-comment assertion runs over the whole serialized
projection, so a leak at any nesting depth fails, not just a known column.

### T-06 Share-link enumeration or forgery
**Attack.** Guess or brute-force a token; or steal the database and mint
tokens.

**Controls.** ≥256 bits of randomness. Only a peppered HMAC is stored, with
the pepper outside the database (D-11). Persistent rate limiting on share
reads. Wrong, revoked, and expired tokens return **identical** results, so
there is no oracle. Tokens are redacted from logs and analytics;
`Referrer-Policy: no-referrer` and `no-store` on share routes.

**Honest limit.** An unlisted link is not confidential once forwarded.
`noindex` is discoverability hygiene, not access control. Both are stated in
the share UI rather than implied away.

### T-07 Revocation that does not revoke
**Attack.** Keep reading a revoked share using a previously issued signed
storage URL.

**Control.** Assets under ~10 MB are proxied through a route handler, making
revocation immediate. Larger files fall back to a 60-second signed URL, and
that bound is disclosed in the share UI (D-10).

**Honest limit.** Already-downloaded content cannot be recalled.

### T-08 Malicious upload
**Attack.** Upload HTML, SVG, an executable, a macro document, or an archive
and get it served or executed; or lie about type and size.

**Controls.** Allowlist of PNG, JPEG, WebP, PDF, plain text, Markdown, CSV,
and non-macro DOCX/XLSX/PPTX. Server-side validation of authorization, quota,
declared MIME, **detected** format, and size. Supported rasters are
re-encoded and metadata stripped. Text is escaped, never executed. PDFs render
through a maintained viewer with active content disabled, with a download
fallback. Office files are download-only. Only invited contributors may upload;
guests cannot.

**Honest limit.** Type checking does not prove a file is malware-free. Malware
scanning is a prerequisite before ever allowing uploads from untrusted external
users.

### T-09 Payload-size denial and function abuse
**Attack.** Push large bodies through server functions.

**Control.** Uploads never traverse a function (Vercel caps request and
response at 4.5 MB — D-09). Exports are paginated or chunked to private
temporary objects. Persistent, configurable rate limits on sign-in, share
reads, comments, uploads, and exports — an in-memory limiter is worthless
across serverless instances.

### T-10 Injection and XSS
**Attack.** Store markup or a `javascript:` URL in a title, comment, link
label, or presentation excerpt and have it execute for another viewer.

**Controls.** User content is escaped; arbitrary HTML rendering is disabled;
any supported Markdown is sanitized. URL schemes are restricted to
HTTP/HTTPS. Link cards do not crawl arbitrary URLs, so there is no
server-side request-forgery surface in V1. Safe link targets; secure headers;
CSRF/origin protection on mutations.

### T-11 Open redirect via auth callback
**Attack.** Send a crafted `next` parameter to the auth callback to bounce a
signed-in user to an attacker origin.

**Control.** The callback validates redirects against the configured
canonical origin. The proxy round-trips only a path, never a full URL, and
`/login` re-validates it regardless.

### T-12 Cache mixing between users or past revocation
**Attack.** A shared cache serves one user's protected page, or a guest
projection, to someone else — or serves it after revocation.

**Control.** Protected pages and guest projections carry cache policies that
cannot outlive a grant; share routes are `no-store`. Both JSON responses and
rendered HTML are tested for hidden data, not just screenshots.

### T-13 Audit-history tampering
**Attack.** Rewrite or delete activity events to change the record.

**Controls.** `activity_events` privileges revoked from normal roles;
append-only trigger; `FORCE ROW LEVEL SECURITY`; `app.emit_event` is the only
writer. Redaction is a definer function restricted to `worklog_compliance`,
non-destructive, and emits its own event.

**Honest limit — stated because the PRD requires it.** This is an
application-level audit history. It is not a claim of tamper-proof storage
against someone with direct database or backup access.

### T-14 Secret exposure
**Attack.** The secret key, share pepper, or a token reaches a client bundle,
a log, or the repository.

**Controls.** `src/lib/env.server.ts` is `server-only`, so a client import is
a build error. `.env.example` carries names and no values. Config is validated
at its accessor and fails loudly. The secret key has exactly three call sites.
Tokens are redacted from logs. Preview deployments must not point at
production data. A secret scan is part of the release gate (AC-33).

### T-15 Supply chain
**Attack.** A malicious dependency, or a design skill that exfiltrates project
data.

**Controls.** Exact version pins and one committed lockfile. Dependency
vulnerability checks with a documented upgrade process; critical or high
findings on deployed paths block release unless a reviewed mitigation is
recorded. The UI skill was reviewed before installation — MIT, no hooks, no
network or subprocess use in the scripts actually used — and pinned to a
reviewed commit (`docs/skill-lock.md`). No private project data is put into
skill queries, and no company records are sent to any AI provider as a hidden
feature.

---

## 4. Deliberately accepted risks

| Risk | Why accepted |
|---|---|
| Unlisted links are forwardable | The PRD wants frictionless external review. Mitigated by default-Invited, 30-day default expiry, confidentiality confirmation before publishing unlisted, and explicit UI language. |
| Large guest assets stay readable ≤60s after revocation | Signed URLs have no revocation primitive. Bounded, disclosed, and tested as a bound rather than hidden. |
| DB administrators can alter history | Out of scope for an application-level control. Stated plainly rather than overclaimed. |
| No malware scanning in V1 | Uploads are restricted to invited internal contributors. Scanning is a hard prerequisite before untrusted external upload. |
| A self-recorded verbal request is unverified | This is a product truth, not a bug: it is labelled "Unconfirmed understanding" until the requester acknowledges a specific revision. |

---

## 5. What must be verified, not assumed

Enabling RLS, installing a component library, or passing an automated
accessibility scan proves nothing on its own. The following are verified by
test, and reported as blocked until they actually run:

- `anon` holds zero privileges on every schema.
- Every `app` table has RLS; every `api` view is `security_invoker`.
- Cross-workspace substitution denies on read, mutate, upload, export, and
  download.
- A removed member with a stale admin-claim token is denied.
- Self-approval is denied for an admin submitter.
- Guest projections leak nothing internal in HTML **and** JSON.
- Revoked and expired shares are indistinguishable from wrong tokens.
