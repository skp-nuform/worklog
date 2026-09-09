# Worklog — Product Requirements Document and AI Coding Agent Build Contract

**Version:** 1.0
**Prepared:** September 8, 2026

**Product owner:** The initiating employee; workspace ownership must be agreed
with the company before production use.

**Initial organization labels:** Newform Tech and Newform Social, supplied by
the user and editable in settings. These are not verified legal-entity names.

**Delivery:** A production-oriented web application, stored in GitHub and
deployed to Vercel, with persistent application data and private file storage
in Supabase.

**Default locale:** English; Asia/Kolkata display timezone, configurable per
user.

**Status:** Ready for implementation. Numerical limits below are proposed
product requirements, not measured results or provider guarantees.

> **Implementation note.** This file is the contract as delivered. Where
> implementation deviated from it — for reasons such as a measured contrast
> failure or an upstream incompatibility — the deviation is recorded in
> `docs/decisions.md` rather than edited into this document.

---

## 0. Start here: instructions to the coding agent

You are implementing this product, not merely describing it. Read this entire
PRD before making architectural decisions. Deliver working application flows,
migrations, authorization tests, browser tests, and deployment documentation.
Do not stop at a static dashboard, component gallery, or localStorage
prototype.

First inspect the existing repository. Preserve working code, existing
configuration, and unrelated user changes. Record assumptions in
`docs/decisions.md`; use the defaults in this PRD instead of asking the user to
make routine implementation choices. Request human action only when an actual
account, secret, paid service approval, or machine-level prerequisite is
required. Continue independent work when one integration is blocked.

Before designing screens, install and load the single selected external design
skill in Section 1. Use it for both UI decisions and interaction/accessibility
reviews. Generate a project-specific design system; do not blindly apply a
generic template or a marketing landing-page layout. This PRD's product
behavior, security requirements, and restrained visual direction take
precedence over conflicting aesthetic suggestions.

Implement the launch scope in vertical slices. Each slice must include
persistence, authorization, loading/error states, and tests before proceeding.
Never claim a command ran, a test passed, a skill loaded, or a deployment
succeeded unless it actually did. Distinguish production behavior from fixtures
and test mocks.

At handoff, provide the repository changes, runnable setup instructions,
completed acceptance matrix, test results, known limitations, and production
setup actions. Include a deployed URL only when deployment has actually
succeeded.

---

## 1. Required UI/UX skill

### 1.1 Selection

**Install and use:** UI UX Pro Max
**Repository:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

The repository showed approximately 125.9k GitHub stars during research on
September 8, 2026. It was the highest-starred dedicated UI/UX candidate among
those checked. It provides guidance spanning visual design, interaction,
accessibility, and implementation. [S1]

Comparison observed during the same research:

| Repository | Approximate stars | Selection interpretation |
|---|---|---|
| `nextlevelbuilder/ui-ux-pro-max-skill` | 125.9k | **Selected:** dedicated UI/UX design skill. |
| `pbakaus/impeccable` | 66k | Relevant design-focused alternative; do not additionally install for this build. |
| `google-labs-code/stitch-skills` | 8.3k | Design/build skill collection oriented around Stitch; unnecessary for this architecture. |
| `anthropics/skills` | 175.1k | Larger general-purpose collection. Its repository stars are not the star count of an individual UI or UX skill. |

These observations are not an exhaustive ranking of every repository on GitHub.
Stars indicate popularity, not proven design quality or security.
Sources: [S1–S4].

### 1.2 Installation contract

Use Claude Code, rather than assuming a Claude web conversation can install a
local coding plugin. Inspect the upstream README, license, plugin manifest, and
relevant executable scripts before installation. Do not run arbitrary hooks,
request production credentials, use sudo, or make unrelated global
configuration changes.

The upstream repository documents a Claude marketplace installation. Claude
Code supports project-scoped installation through its CLI. From the project
root, the normal commands are: [S1, S5]

```bash
claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
```
```bash
claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill --scope project
```

Record the resolved plugin version, upstream commit, source URL, installation
scope, and installation date in `docs/skill-lock.md`. Registration may update
Claude's marketplace registry; do not alter unrelated registry entries. Keep
this build on the reviewed revision. For reproducibility, use a supported
pinned Git ref or a reviewed fixed local checkout registered as a marketplace
when the installed Claude version requires that approach. Do not silently
update during implementation.

Read the install result. Reload plugins or start a fresh Claude Code session
only when required by the installed version. Verify that the actual UI UX Pro
Max skill is available, then explicitly load and apply it. Record the available
skill identifier rather than inventing a slash-command name.

Do not assume the plugin lives inside the application's `.claude/skills/`
directory. Resolve its real installed location from Claude's plugin
information. Claude's plugin-root substitution and a project-local installation
path are not interchangeable. [S6]

If the plugin route is unavailable, the upstream-maintained CLI package is
currently named `ui-ux-pro-max-cli`; the older `uipro-cli` package is
identified as stale by the upstream README. Inspect and pin the current
maintained package before using its documented project-local Claude
installation. Do not install both distribution methods. [S1]

The search tool requires Python 3. Check the existing runtime. If it is
missing, report the prerequisite; do not install system software without the
user's authorization. [S1]

### 1.3 Required skill-driven design work

Before screen implementation, use the installed skill to investigate these
product-specific concerns:

| Concern | Starting query intent | Required outcome |
|---|---|---|
| Overall design | Minimal work-management workspace | A coherent product interface, not a landing page. |
| Capture | Progressive-disclosure task forms | Fast capture with optional detail. |
| Navigation | Keyboard-accessible master-detail layout | Predictable focus, deep links, and Back behavior. |
| Reviews | Versioned approval workflow | Submission, feedback, and approval are visibly different. |
| Sharing | Permission controls and guest comments | Clear audience, scope, and revocation behavior. |
| Accessibility | Form errors, focus visibility, text reflow | Observable criteria and test cases. |
| Stack | Next.js and shadcn/ui | Guidance compatible with the versions actually selected. |

Invoke the skill's actual search script by its resolved absolute path. First
inspect its help and installed instructions. Generate recommendations, check
that they fit an internal workspace, and only then persist the accepted design.
Store outputs inside this repository, not inside the plugin cache. [S7]

**Required artifacts:**

- `design-system/worklog/MASTER.md`: tokens, typography, spacing, components,
  states, and anti-patterns.
- `design-system/worklog/pages/`: deliberate exceptions for work detail,
  collections, and guest sharing.
- `docs/ux-flows.md`: journeys, interaction states, and keyboard behavior.
- `docs/ux-audit.md`: findings, fixes, and remaining limitations from final
  visual/accessibility review.
- `docs/skill-lock.md`: provenance and the exact skill revision used.

Do not install additional design skill collections, paid design services, or
image-generation integrations for this build.

---

## 2. Product definition

### 2.1 The problem

Requests arrive through conversations, messages, and meetings. Priorities
change and the original context is forgotten. Finished work is distributed
across Figma, GitHub, deployed sites, documents, and local files. The employee
needs one organized place to explain what was requested, what changed, what was
delivered, and what feedback or approval followed.

### 2.2 Product promise

> Capture a request once. Preserve its context. Attach the work. Share the same
> record.

Worklog is a request-to-delivery work library. It combines project
organization, a dated activity timeline, and curated portfolio-style
collections without creating three separate sources of truth.

### 2.3 Goals and proposed success measures

| Goal | Target | Verification |
|---|---|---|
| Low-friction capture | A new user records a basic request in 60 seconds or less. | Moderated usability test. |
| Fast retrieval | Find a known deliverable in 30 seconds or less using search/filters. | Task-based test with realistic seeded data. |
| Context preservation | Every submitted item has a brief revision and a submission snapshot. | Database constraints and integration tests. |
| Review clarity | A reviewer can identify the requested outcome and current delivery without reading the entire timeline. | Usability test on work detail. |
| Controlled sharing | No out-of-scope data appears in guest responses. | Automated negative authorization tests. |
| Portability | An authorized user can export permitted records and an attachment manifest. | Export/restore validation. |

Pilot with the initiating employee and two or three reviewers. Ask them to
capture a request, find an older delivery, review a changed brief, and comment
on a shared collection. Log completion, confusion, and failures; do not invent
favorable results.

### 2.4 Boundaries

This is not an employee-monitoring system, time tracker, payroll system, CRM,
chat replacement, or guarantee against workplace disputes. It records actions
and acknowledgements; it does not prove that every underlying statement is
true.

A server timestamp proves when the application recorded an action, not when
work objectively occurred. A self-recorded verbal request is not requester
confirmation. A link to a live external document is not an immutable copy of
that document. The UI must preserve these distinctions.

---

## 3. Users, ownership, and access model

### 3.1 Initial scale and organization

Start with one private workspace and one primary contributor. Allow up to 60
workspace members in the launch design without making team administration the
default experience. Use two editable brand labels, Newform Tech and Newform
Social. Add other brands through settings; do not hard-code company names into
business logic.

Hierarchy:

```
Workspace
  Brand
    Project
      Work item
        Request revisions
        Updates and delivery submissions
        Links and uploaded artifacts
        Comments and review decisions

Collections reference existing work items/submissions.
Timeline is a view of existing activity events.
```

A work item may initially be unassigned to a project and appear in its author's
Inbox. Collections do not duplicate authoritative work records.

### 3.2 Roles and capabilities

Use workspace roles for administration and project/resource grants for work
access. Do not encode company-wide access merely because someone can sign in.

| Actor | Read | Create/edit | Review | Share/manage |
|---|---|---|---|---|
| Workspace owner/admin | Workspace records, including unassigned items. | Workspace administration; editing remains attributed. | Only when explicitly designated; cannot approve own submission. | Manage members, exports, retention, and publication policy. |
| Project contributor | Assigned projects and own unassigned items. | Work in assigned projects and own Inbox. | Only when explicitly designated and not the submitter. | Create invited shares for resources they can manage; unlisted shares follow publication policy. |
| Project reviewer | Granted project records. | Comments and review actions, not arbitrary author edits. | Assigned submissions only. | No publication rights by default. |
| Project viewer | Granted project records. | No edits; comments only when separately allowed. | No. | No. |
| External guest | Exact share projection only. | Comments when enabled after verified email sign-in. | Only via an explicit invited review grant for a designated submission. | No workspace/project discovery, export, or onward permission management. |
| Anonymous visitor | Valid unlisted share projection. | None. | None. | Can copy the bearer link, not grant additional rights. |

An admin's ability to manage access must not let them impersonate another user
or manufacture their approval. Project editors may edit permitted current
fields, but the event history identifies the actual editor.

When a member is removed, deny new protected requests immediately based on
database membership, rather than relying only on an older token claim. Retain
historical attribution subject to authorized retention/redaction policy.

---

## 4. Release scope

### 4.1 Required for launch

Email-based sign-in and invitations; workspace/brand/project organization;
rapid request capture; idea capture and promotion; original brief and revision
history; work statuses; links and private file uploads; image/PDF previews;
versioned submissions; attributed comments and decisions; reviewer inbox;
global search and filters; dated timeline; curated collections; invited and
unlisted sharing; explicit permissions; notification inbox; archive/restore;
authorized metadata export; light/dark/system themes; responsive and accessible
UI; deployment and backup runbooks.

### 4.2 Deferred, not silently implemented

AI-generated summaries, meeting transcription, Slack/WhatsApp ingestion,
automatic GitHub/Figma synchronization, Kanban, calendars, dependency graphs,
granular time tracking, employee rankings, native mobile apps, billing,
full-text OCR, media transcoding, and public search-engine-indexed portfolios.

Email digests and non-authentication notification emails are optional later
additions. The launch notification inbox works without them. Hide deferred
controls instead of shipping buttons that do nothing.

---

## 5. Core journeys

### 5.1 Capture a new request

Use a global **New work** button and an optional keyboard shortcut. Initially
ask for only Title and Request summary. Default the author, creation time, and
Inbox destination. Reveal project, brand, requested by, request source,
deadline, priority, reviewer, and acceptance criteria under **Add details**.

Allow a verbal request to be entered as the author's understanding. Label it
**Unconfirmed understanding** until the requester explicitly acknowledges the
relevant brief revision. Requester labels without a linked verified account
remain unverified.

After saving, open the real work record and show **Saved** only after server
acknowledgement. Offer **Copy request link**. Do not imply that copying a link
sent a notification.

### 5.2 Record changing instructions

Select **Record change**. Capture what changed, why, who communicated it, and
the effect on scope/deadline/priority. Show before/after values. A material
brief change creates a new revision and resets current acknowledgement to
**Awaiting confirmation** while preserving earlier acknowledgements.

Do not silently overwrite the original request. Clerical corrections must still
be attributable. If another tab updated the record, show a conflict resolution
view rather than last-write-wins replacement.

### 5.3 Deliver work

Attach labeled URLs or files, write a delivery note, and select **Submit for
review**. Require a request summary, defined acceptance criteria or expected
outcome, and at least one deliverable. A substantive text-only result is a
valid deliverable when explicitly selected.

Create a numbered, immutable submission snapshot containing the current brief
revision, delivery note, selected artifacts, submitter, and server time. Show
**Submitted – awaiting review**, never **Approved**. A reviewer may be assigned
later without blocking truthful recording of delivery.

### 5.4 Review a delivery

Open the work item or assigned-review inbox. Show the expected outcome,
submitted version, delivery note, and artifacts before the longer history. An
authorized designated reviewer chooses **Approve this version** or **Request
changes**. Changes require an explanatory comment.

Approval applies to that submission, not all future work. Review and state
change occur in one transaction. An outdated review attempt must identify that
a newer submission exists. Viewing, commenting, or being named as requester
does not constitute approval.

### 5.5 Share selected work

Choose one work item, one project, or a curated collection. Select invited
access or an unlisted bearer link. Explicitly select included records,
submission versions, artifacts, fields, and comment permission. Preview the
exact guest projection before activating access.

Guests can view an unlisted link without an account. Commenting requires
verified email sign-in, returns the guest to the same content, and does not
create workspace membership. New records added to a project are not
automatically included in existing external shares.

### 5.6 Present a body of work

Create a collection such as "September deliveries" or "Website redesign". Add
existing work, reorder it, and optionally write a short introduction and
per-item presentation excerpt. Choose a clean list or gallery. Keep these
excerpts separate from the authoritative original request. Share the collection
using the same access controls.

---

## 6. Work-item information and lifecycle

### 6.1 Fields

| Group | Fields and rules |
|---|---|
| Identity | UUID, human-readable reference such as `WL-0012`, title of 3–180 characters, author, workspace. |
| Organization | Brand, optional project, type, tags, priority; keep optional detail out of the quick-capture form. |
| Request | Summary, rationale, expected outcome/acceptance criteria, requester label and optional verified user ID, source type, optional source link. |
| Dates | Server creation/update times; optional user-reported request date and work date; optional deadline; submission/review times derived from immutable events. |
| Execution | Current status, progress note, blocker/pause reason, next action, designated reviewer. |
| Evidence | Versioned submissions, artifact references, link labels, file metadata, optional commit/version identifiers. |
| Governance | Brief acknowledgement, edit version, archive state, visibility/grants, append-only activity references. |

Require no detailed timesheet. If a user reports that work occurred earlier,
show both **Reported work date** and **Recorded on**. Do not allow editing
server timestamps through the UI or normal application API.

Store event times as UTC `timestamptz`. Render absolute date/time with the
viewer's timezone. A relative label must expose the absolute value to keyboard
and touch users as well as pointer users. Date-range filters use the selected
user's calendar-day boundaries converted to UTC. Store date-only deadlines
distinctly from timed deadlines to avoid timezone shifts.

### 6.2 State machine

| Current state | Allowed action | Result and guard |
|---|---|---|
| Planned | Start | In progress. |
| Planned / In progress | Submit | Submitted; validate required delivery fields and create snapshot. |
| Submitted | Approve | Approved; designated non-submitting reviewer, current submission only. |
| Submitted | Request changes | In progress; review decision and comment required. |
| Submitted | Withdraw | In progress; contributor explains withdrawal; submission remains historical. |
| Approved | Reopen | In progress; reason required; original approval remains tied to its version. |
| Planned / In progress | Block or pause | Blocked / Paused; reason required; preserve prior execution state. |
| Blocked / Paused | Resume | Restore prior execution state; append event. |
| Planned / In progress / Blocked / Paused | Cancel | Cancelled; reason required. |
| Submitted | Cancel | Withdraw first, then cancel; do not discard a pending review silently. |
| Cancelled | Reopen | Planned; reason required. |

Archive is separate from work status. Archiving does not imply completion or
delete history. Blocked/paused items cannot be submitted without resuming.
Approved items cannot be silently modified into a different approved
deliverable.

Store ideas as the same base record type with an idea-specific state:
**Captured** or **Shelved**. Ideas have dates, links, and comments, but no
submitted/approved status. **Convert to work** changes the same record into a
planned work item and appends an event; it preserves its ID, discussion, and
origin.

---

## 7. Functional requirements

### 7.1 Requests, acknowledgements, and history

Save material field edits in a new brief revision. Show the original and
current versions with an accessible diff. Acknowledgement identifies actor,
revision, and time; users cannot acknowledge on someone else's behalf. The
requester and reviewer may be different people.

Activity events cover creation, material edits, assignments, status changes,
submissions, reviews, artifact changes, comment edits/removals, sharing,
archive, restoration, and privileged redaction. Normal UI/API roles cannot edit
or delete these events. This is an application-level audit history, not a claim
of tamper-proof storage against database administrators.

Autosaved prose does not generate a separate business event for every
keystroke. Coalesce editing activity into meaningful saved revisions while
preserving the last committed value and explicit material-change actions.

### 7.2 Links and files

Accept labeled HTTP/HTTPS links to Figma, GitHub, deployed sites, documents,
and arbitrary work resources. Store provider/domain, label, URL, and optional
version/commit identifier. Do not assume external content is publicly
accessible or immutable. Offer an optional screenshot/document snapshot upload.

Launch link cards do not crawl arbitrary URLs for metadata. Use user-supplied
labels and locally defined provider icons. This avoids introducing a
server-side URL-fetching system in the first release. Only implement
allowlisted, user-activated embeds later; always retain an ordinary **Open
link** fallback.

Launch uploads support PNG, JPEG, WebP, PDF, plain text, Markdown, CSV, and
non-macro DOCX/XLSX/PPTX. Default maximum file size: 25 MB, configurable
downward to match the storage plan. Reject executables, HTML, SVG, macros,
archives, and unsupported formats with an explicit explanation. Offer a link
alternative.

Only trusted, invited contributors upload files in V1; guests cannot upload.
Validate authorization, quota, declared MIME, detected format, and size
server-side. Re-encode supported raster previews; strip unnecessary metadata.
Treat text as escaped text and never execute uploaded content. Render PDF
through a maintained viewer with active behavior disabled where supported;
provide a download fallback. Office files are download-only. Do not claim type
checking proves a file is malware-free. Add malware scanning before enabling
uploads by untrusted external users.

Use private storage, random object keys, no overwrite of referenced versions,
and explicit read policies. The browser uploads directly to storage through a
narrowly authorized upload flow; avoid routing 25 MB bodies through a Vercel
function. Vercel currently documents a 4.5 MB function request/response payload
limit. [S8, S9]

Use upload state `Pending → Uploading → Processing → Ready`, with
failed/cancelled alternatives. A server finalization step validates the actual
stored object before marking it Ready. Failed uploads must not appear as
submitted evidence. Show per-file progress, retry/cancel, and useful errors.
Clean up abandoned uploads with an idempotent scheduled job.

Keep a submission's artifact set stable. A replacement is a new
artifact/version, never an overwritten file. If a legal/security redaction
removes a referenced file, show a tombstone and retain the authorized redaction
event.

### 7.3 Comments and review feedback

Support item-level threads and one level of replies. Record author and server
timestamps. Mark edits and preserve previous versions for authorized internal
history. Allow users to edit/remove their own comments; moderators may remove
content with a reason. Show a removed-comment tombstone rather than silently
rewriting a discussion.

Comments have an explicit audience: **Internal** or a particular share grant.
Internal comments never appear in guest APIs, HTML, metadata, notification
payloads, or exports for that share. A guest sees only the thread for their own
share grant. Internal authorized users may see all threads on an item, clearly
labeled by audience. No automatic copying of internal discussion into a share.

Mentions autocomplete only people the commenter is allowed to discover and
notify. Guest mention controls must not enumerate workspace members. Add
persistent rate limiting to comments and sign-in attempts. An anonymous visitor
cannot impersonate a named commenter by entering a display name.

### 7.4 Search, filtering, and timeline

Search accessible titles, references, current request text, tags, and delivery
notes using a permission-filtered database index. Attachment names can be
searched; OCR, full file-content search, and semantic search are not required.

Filters: brand, project, author, status, type, date range, and tags. Choose the
date basis explicitly: **Created**, **Submitted**, or **Updated**. Persist
filters in URL parameters. Support stable sorting and an explicit clear-filters
action. Empty results must not look like an empty account.

Use server pagination/keyset cursors; return at most 50 list records per page.
A timeline groups meaningful events by local calendar date and links back to
the originating record. Do not treat every autosave as a separate activity
entry or convert activity volume into employee productivity scores.

### 7.5 Collections and external presentation

A collection contains a title, optional introduction, optional cover, selected
records/submissions, ordering, and presentation-only excerpts. Manual order
must be available through keyboard-operable **Move up**/**Move down** controls
as well as any drag interaction.

The default external share is a pinned selection of submission versions.
Editing internal work does not automatically change the external package. Show
**Newer version available** to the manager of the share and offer an explicit
preview-and-republish action. A contributor may choose to share a clearly
labeled current draft, but that share is also pinned to a revision until
republished.

Gallery cards need meaningful fallbacks when no image exists: title, work type,
short excerpt, and metadata. Never invent screenshots, results, client quotes,
or accomplishments.

### 7.6 Sharing and revocation

Support three access states: **Private**, **Invited**, and **Unlisted link**.
Private routes respect existing membership. Invited shares require
authenticated verified email matching an active invitation or account grant.
Unlisted shares permit anonymous reading with an unguessable bearer token. They
are not confidential once forwarded.

Default new shares to Invited. Unlisted publication requires a user with
publishing capability and a confidentiality confirmation. Default expiry is 30
days; show the exact expiry and allow the publisher to choose another date or
explicitly choose no expiry.

A share defines exact resources and field/artifact allowlists. Default external
fields: title, approved presentation excerpt, displayed status, delivery date,
selected artifact links, and selected submission. Exclude requester contacts,
internal brief/history, other projects, internal comments, and private source
URLs unless deliberately included by an authorized publisher.

Use at least 256 bits of cryptographic randomness for bearer tokens. Store
token hashes, not raw tokens. Show the generated URL once and let the owner
rotate it if lost. Redact tokens from application logs and analytics, apply
`Referrer-Policy: no-referrer`, avoid third-party trackers on share pages, and
send `noindex` plus `no-store` headers. **Noindex is not access control.**

Validate the grant, expiry, active resource permissions, and projection on
every request. Revoking a share denies subsequent application reads and new
signed-file links immediately. Previously issued storage URLs may remain valid
for their short lifetime; choose a maximum of 60 seconds for guest file links
and disclose this bound. Already downloaded content cannot be recalled.

Comment permission does not grant review permission. External approval is
available only through an invited, explicitly designated review grant bound to
a submission. Ordinary unlisted links never grant approval rights.

### 7.7 Notifications

Provide an in-app inbox for assignments, mentions, comments on owned/reviewed
work, submission requests, decisions, and access invitations. Clicking a
notification opens the exact item/version/thread, with access rechecked. Do not
expose restricted content after membership removal.

Deduplicate notifications by source event and recipient. Do not notify users
about their own actions. Keep unread counts accurate across reloads.
Authentication emails require a properly configured provider; non-authentication
email notifications remain off until separately configured and tested.

### 7.8 Archive, export, and retention

Archive/restore projects and items without changing their substantive work
status. Collections show an appropriate archived/unavailable indicator, and
external shares must not reveal deleted or access-restricted records.

Authorized exports include JSON records, readable Markdown, and an artifact
manifest with stable IDs and filenames, not permanently public storage URLs.
Preserve timezone metadata and revision/submission attribution. Allow a
date/project/item selection and explain the scope before export. Guest export
is disabled.

Use paginated or chunked export delivery and private temporary objects when
needed; do not return an unbounded archive through a function response. Binary
downloads require fresh authorization. A metadata export is not a complete
binary backup.

Workspace administrators control export capability and retention. Default to no
automatic deletion of business history. Do not encourage employees to move
company information to personal accounts. Document offboarding, ownership
transfer, and authorized redaction separately from routine archiving.

---

## 8. Information architecture and screens

Primary sidebar: Overview, Work, Projects, Timeline, Collections. Ideas are a
saved Work view; assigned reviews are prominent on Overview and accessible
through its review filter. Put notifications in the header and Settings at the
bottom of the sidebar. Avoid a long sidebar for optional features.

| Screen / route | Required content and behavior |
|---|---|
| `/login` and `/auth/callback` | Email authentication, verified invitation return, safe redirect handling, expired-link recovery. |
| `/onboarding` | Name, workspace name, timezone, optional brands. Project creation and teammate invitation may be skipped. |
| `/overview` | My active work, awaiting my review, my submissions awaiting review, recently delivered, and New work. No decorative metric wall. |
| `/work` | Dense but readable list, search, filters, saved views for All/My work/Ideas/Archived, URL state, pagination. |
| `/work/[id]` | Canonical deep-linkable detail view; current request and latest delivery above history; role-aware actions. |
| `/projects` | Searchable projects with brand, state, last activity, and concise context. |
| `/projects/[id]` | Project brief, work list, scoped timeline, project membership controls for authorized users. |
| `/timeline` | Dated activity grouped by timezone and filtered by permitted project/author/type. |
| `/collections` and `/collections/[id]` | Curated list/gallery, selection, accessible ordering, presentation excerpts, preview, sharing. |
| `/s/[token]` | Minimal guest layout, permitted content, artifact viewer, guest comment sign-in, unavailable/expired states. |
| `/settings` | Profile, theme/timezone, brands, members, sharing policy, storage usage, export/retention permissions. |

Clicking a work row on desktop may open a detail panel while updating the URL;
direct navigation renders a complete page. Browser Back closes the
panel/restores filters, scroll position, and focus. Mobile opens a full-screen
detail route instead of a cramped drawer.

### Work-detail structure

```
Breadcrumb / Work reference                    Share / More
Title
Status / Project / Brand

CURRENT REQUEST
  Outcome, acceptance criteria, requester and confirmation
  Original request / revision history link

LATEST DELIVERY
  Submission version, delivery note, artifacts, submitted time
  Approve this version / Request changes [authorized reviewer]

Updates and discussion
  Internal / Shared thread selector [only when permitted]

Activity history [collapsed initially]
```

On wide screens, secondary metadata may sit in a right rail. On smaller screens
it becomes an inline **Details** disclosure. The user must not have to read a
long chronological feed to find the current delivery.

---

## 9. Visual design specification

### 9.1 Direction

Build a calm, precise working environment: generous spacing, restrained color,
legible typography, consistent controls, and quick navigation. Use the user's
Apple/Linear references as inspiration for restraint, not copied logos,
proprietary assets, or exact screen reproductions.

The default view is a list-based application, not a landing page. Do not add a
giant hero, oversized KPI cards, neon gradients, decorative charts, excessive
glass effects, floating blobs, or animated backgrounds. Avoid a different
visual system for every screen.

### 9.2 Foundations

| Attribute | Requirement |
|---|---|
| Layout | Approximately 232 px desktop sidebar, 64 px header, and 24–32 px main padding. Let content expand naturally; do not squeeze tables into a narrow marketing column. |
| Typography | System UI stack with optional properly licensed/self-hosted Inter. One main family. Body 14–16 px with comfortable line height; page titles 28–32 px. Do not bundle proprietary Apple font files. |
| Spacing | Shared 4 px base scale: 4, 8, 12, 16, 24, 32, 48. |
| Corners | Controls about 8 px; cards/panels 12–16 px. Avoid making every component a pill. |
| Elevation | Thin boundaries and at most two meaningful shadow levels. Stronger elevation reserved for overlays. |
| Icons | One consistent icon family, such as Lucide; generally 16–20 px. Icons supplement labels rather than replace essential words. |
| Motion | Subtle 120–180 ms state transitions. No motion needed to understand content. Respect reduced-motion preferences. |
| Density | Default comfortable list; do not expose a density configuration panel in V1 unless testing demonstrates a need. |

Starting tokens, subject to measured contrast verification:

| Token | Light | Dark |
|---|---|---|
| Canvas | `#F8FAFC` | `#0B0F14` |
| Surface | `#FFFFFF` | `#111827` |
| Elevated/subtle fill | `#F1F5F9` | `#1E293B` |
| Primary text | `#0F172A` | `#F8FAFC` |
| Secondary text | `#475569` | `#94A3B8` |
| Decorative border | `#E2E8F0` | `#334155` |
| Interactive boundary | `#64748B` | `#64748B` |
| Accent | `#2563EB` | `#60A5FA` |
| Text on accent | `#FFFFFF` | `#0B0F14` |

Implement semantic CSS variables rather than scattered hex values. Status
colors need visible text labels and icons/shapes where useful. Treat subtle
decorative borders separately from the contrast requirements of essential
control boundaries. Verify hover, focus, disabled, selected, and error states
in both themes.

### 9.3 Components

Create reusable components for app shell, page header, work row/card, filter
bar, status badge, request panel, revision diff, submission block, artifact
card/viewer, threaded comment, activity event, share dialog, permission
preview, empty state, form errors, toast, and confirmation dialog.

Use a consistent component foundation, but do not ship untouched generic
shadcn defaults as the entire design. Customize spacing, type hierarchy,
density, interaction details, and tokens through the master system.

---

## 10. Interaction quality and accessibility

Target WCAG 2.2 AA and test actual behavior; installing a skill or component
library does not establish conformance. Normal text needs at least 4.5:1
contrast, with the applicable large-text exception at 3:1. Design touch hit
areas around 44 × 44 CSS pixels; this is a product target, not a claim that
WCAG 2.2 AA universally requires 44 pixels. Its minimum-target criterion is
different and includes exceptions. [S10, S11]

All primary journeys must work with a keyboard. Provide visible focus, labeled
icon buttons, semantic headings/landmarks, skip navigation, correctly
associated labels/errors, focus trapping in modal dialogs, and focus
restoration on close. Do not hide essential controls behind hover.

Support 200% text zoom and narrow-screen reflow; additionally check the 320
CSS-pixel reflow scenario associated with high browser zoom. No whole-page
horizontal scrolling for ordinary workflows. Use an accessible overflow
strategy for genuinely two-dimensional information.

Keyboard conveniences: `Cmd/Ctrl+K` opens search/command navigation;
`Cmd/Ctrl+Enter` submits an explicit form action; `Escape` closes a dismissible
overlay. Single-key shortcuts must be disabled in editable fields and
user-disableable. Never make shortcuts the only path.

| Situation | Required UX |
|---|---|
| Loading | Layout-matched skeleton or localized progress; no fake data presented as live work. |
| Empty account | Explain the next action and offer **Create first work item**. |
| No results | Preserve filters and offer **Clear filters**; do not imply records were deleted. |
| Save pending | Show **Saving**; prevent false success messages. |
| Save failed/offline | Keep unsaved input in memory, show retry, and warn before navigation. Do not cache confidential work in localStorage by default. |
| Concurrent edit | Explain that the record changed; show relevant differences and preserve the user's draft. |
| Permission denied | Safe message without disclosing hidden titles, people, or resource existence. |
| Upload failure | File-specific reason and retry/remove; successful other uploads remain usable. |
| Expired/revoked share | Generic unavailable message with a safe contact/request-access option where configured. |
| Destructive action | Plain-language impact, confirmation, and archive/undo where reversible. |
| Unsaved close | Explicit **Save**/**Discard**/**Keep editing**; do not lose typed text. |

Verify at 375, 768, 1024, and 1440 px, plus the reflow test. Mobile uses a
compact menu and a full-screen work detail; the comment composer must remain
visible above the keyboard.

---

## 11. Technical architecture

### 11.1 Selected stack

Use Next.js App Router, React, TypeScript strict mode, Tailwind CSS,
shadcn/ui-compatible components, and one icon library. Use Supabase Postgres,
Auth, and private Storage. Use Zod for shared validation, an accessible form
approach, and a single consistent data-fetching strategy. Use Vitest/Testing
Library, Playwright, and an accessibility test integration such as axe-core.
These are implementation choices, not a requirement to add every available
package.

Resolve mutually compatible maintained stable versions at implementation time
from official documentation. Pin package versions and commit one lockfile. Do
not mix instructions from different framework major versions or install
multiple package managers.

Use a modular monolith, not microservices. Keep authentication, authorization,
data access, sharing projections, and domain transitions in clearly separated
server-side modules. Add a dedicated worker only when measured workloads
require one.

```
Browser
  → Next.js UI and server-only application layer on Vercel
       → Supabase Auth
       → Postgres with explicit grants and row-level security
       → Private Storage

Browser → authorized direct upload → private Storage
Server  → validated, expiring artifact link → authorized viewer
```

GitHub holds code/migrations/configuration, not uploaded business files or live
records. Saving a work entry never requires a Git commit or redeploy.

### 11.2 Authentication and authorization

Use supported Supabase server-side authentication patterns. Validate identity
with the appropriate verified-claims or fresh-user method; do not authorize
requests from an unverified session object alone. Then check current
workspace/project/resource permissions. [S12]

Every server action, route handler, upload authorization, export, and
storage-link minting operation must authorize independently. A page-level
redirect is not protection for a directly callable mutation. Keep sensitive
modules server-only and return narrow response objects. [S13]

Enable RLS and minimal SQL grants on exposed tables; review views and functions
as well. Do not rely on hidden UI buttons. Supabase secret/service-role
credentials bypass normal RLS protections and must remain server-side. Use
user-scoped database calls for normal member operations. [S14]

For guest bearer shares, use a narrowly scoped server access path that
validates the grant and emits an explicit safe projection. Do not grant
anonymous SELECT access to internal work tables or reuse a general admin client
in client components. Never treat a client-supplied workspace ID, role, author
ID, or actor ID as authority.

### 11.3 Suggested repository layout

```
src/app/                  Routes and page composition
src/components/ui/        Primitive components
src/features/work/        Capture, detail, revisions, submissions
src/features/projects/
src/features/reviews/
src/features/comments/
src/features/collections/
src/features/sharing/
src/features/notifications/
src/lib/auth/             Verified identity and session helpers
src/lib/permissions/      Central capability checks
src/lib/data/             Server-only data access
src/lib/storage/          Upload/finalize/download authorization
src/lib/validation/       Shared schemas
supabase/migrations/
supabase/tests/
tests/e2e/
design-system/worklog/
docs/
```

Adapt an existing codebase rather than imposing this tree mechanically.

---

## 12. Data model and invariants

Use UUID identifiers, explicit workspace ownership, appropriate foreign keys,
and migration-managed indexes. Record `created_at` using database defaults and
protect immutable actor/time fields. Use composite constraints or equivalent
checks to prevent cross-workspace references.

| Entity | Essential information |
|---|---|
| `profiles` | Auth user ID, display name, timezone, theme. |
| `workspaces`, `workspace_members` | Workspace settings; current role, status, membership timestamps. |
| `brands`, `projects`, `project_members` | Organization hierarchy, project brief, archive state, project capabilities. |
| `work_items` | Identity, author, organization, kind, current status, current revision/submission IDs, edit version, deadline, archive state. |
| `work_item_revisions` | Numbered snapshot of request/criteria/source/material metadata; actor and creation time. |
| `request_acknowledgements` | Revision ID, acknowledging verified user, decision, time. |
| `artifacts` | URL or private object key, owner item, metadata, processing state, version, created by/time. |
| `submissions`, `submission_artifacts` | Number, immutable request snapshot reference and delivery note, selected artifacts, submitter/time. |
| `review_decisions` | Submission, designated reviewer, approve/changes-requested, comment, time. |
| `comments`, `comment_versions` | Work item, optional submission, parent, author, audience/share grant, current text, edit/removal history. |
| `activity_events` | Actor, event type, resource, safe change payload, server timestamp. |
| `collections`, `collection_items` | Presentation data, stable item/submission reference, ordering, optional excerpt. |
| `share_grants`, `share_grant_items` | Hashed token/invite identity, capabilities, field/artifact projection, pinned revisions, expiry/revocation. |
| `notifications` | Recipient, source event, target, unread state; only permitted metadata. |
| `idempotency_keys` | Actor/action/request key, request hash, committed result, expiration. |

Private operational tables need not be exposed through the public Data API.
Additional tables for processing/export jobs are allowed when justified and
documented.

**Invariants:**

- Submission numbers are unique per item, monotonically increasing, and never
  reused after withdrawal.
- A review decision references one immutable submission; a submitter cannot
  approve that same submission.
- Current approval never migrates automatically to a newer submission or edited
  artifact.
- Artifact changes cannot rewrite an earlier submission's stored bytes or
  metadata snapshot.
- Material brief changes invalidate current acknowledgement but preserve
  historical acknowledgements.
- A collection/share reference cannot bypass project/workspace boundaries or
  expand scope automatically.
- State changes and their events commit atomically; duplicate retries create
  only one submission/comment/review.
- Updates include `expected_version`; stale updates produce a conflict rather
  than overwrite.
- Generated timestamps and actor identity are assigned from trusted execution
  context, not the request body.
- Normal application roles cannot rewrite audit rows; authorized redaction
  follows an explicit audited procedure.

Index common workspace/project/status/author/time filters, permission lookups,
and search text. Validate query plans against the performance fixture rather
than assuming indexes are sufficient.

---

## 13. Domain/API contract

Use server actions or route handlers consistently. These are logical
operations, not a requirement to build a public third-party API.

| Operation | Required input / behavior |
|---|---|
| Create work | Title, request summary, optional destination; derive author/workspace permissions. |
| Update request | Item ID, expected version, changed fields, material-change reason where applicable. |
| Acknowledge request | Revision ID and current verified requester; never proxy acknowledgement. |
| Transition state | Item ID, expected version, allowed target, reason when required. |
| Authorize upload | Item ID, filename, size, content type; quota and capability checks. |
| Finalize upload | Upload/artifact ID; inspect actual object, mark ready or reject. |
| Submit | Item ID, expected version, delivery note, selected ready artifacts, idempotency key. |
| Review | Submission ID, expected current submission, decision, reviewer identity from session. |
| Comment | Item/submission, audience, text, optional parent; bound share validation when applicable. |
| Publish share | Exact records/versions/fields/artifacts, access mode, expiry, permissions. |
| Read share | Resolve active grant and return safe projection only. |
| Revoke share | Authorized actor; record revocation, deny new reads/links. |
| Export | Authorized selection and fields; bounded/chunked delivery. |

Return a predictable typed envelope: data or error with stable code, user-safe
message, and optional field errors. Distinguish validation, unauthenticated,
forbidden/not-found, conflict, quota, rate-limit, and service failure. Avoid
leaking whether a hidden record exists.

Apply persistent, configurable rate limits to sign-in, share reads, comments,
uploads, and exports; do not use an in-memory limiter as the sole protection
across serverless instances. Retries must not duplicate business actions.

---

## 14. Security, privacy, and reliability

No production secrets, personal tokens, uploaded files, or private work content
in Git, client bundles, console logs, error reports, or sample fixtures. Keep
`.env.example` descriptive but empty. Validate configuration on startup and
fail safely when required credentials are absent.

Escape user content; sanitize any supported rich text/Markdown. Reject
dangerous URL schemes. Disable arbitrary HTML rendering. Use safe link targets,
secure headers, CSRF/origin protection for mutations, and strict validation of
auth callback redirects. Do not automatically embed private links or fetch
arbitrary metadata.

Serve protected pages and guest projections with cache policies that cannot mix
users or outlive grant restrictions. Test both JSON/API responses and rendered
HTML for hidden-data leaks, not only visible screenshots.

Use private storage policies for reads and writes. Restrict signed upload paths
and expiry, verify finalized objects, and never treat possession of an object
key as authorization. Storage access rules and signed URL behavior must follow
Supabase's private-bucket model. [S8]

Separate local, preview, and production data. Preview deployments must not
point to production databases by default. Use synthetic examples clearly marked
**Demo**. No default public admin account and no hard-coded production
credentials.

Require dependency vulnerability checks and a documented upgrade process.
Critical/high findings affecting deployed paths block release unless a
documented mitigation is reviewed. Do not install unrelated agents or send
company records to an AI provider as a hidden feature.

---

## 15. Performance and operational targets

Proposed launch fixture: 60 members, 100 projects, 10,000 work items, 50,000
comments, and 100,000 activity events. These are test targets, not a claim that
unbounded scale is solved.

Target p95 list/search application response below 1 second on a documented
staging dataset, excluding file transfer. Use pagination and lazy-loaded
previews. Avoid loading every event/file into a detail page initially.

Aim for Core Web Vitals in the good range at the 75th percentile: LCP ≤ 2.5
seconds, INP ≤ 200 ms, and CLS ≤ 0.1. Record lab measurements before launch and
real-user measurements after sufficient traffic; do not report lab results as
field INP. [S15]

Keep saves and review submissions explicit and idempotent. Preserve unsaved
drafts during transient failures, but do not promise offline-first
synchronization. Handle provider downtime with truthful retry states.

Track error rates, upload failures, failed auth callbacks, denied share
accesses, export failures, and slow queries without recording confidential
payloads. Set storage/bandwidth budget alerts and a user-visible quota warning.
Do not promise a fixed monthly bill without checking actual plans and usage.

---

## 16. Acceptance tests and definition of done

Every row below requires recorded evidence. Use real test identities and a
local/staging database; mocked browser data alone cannot prove authorization.

| ID | Scenario | Passing behavior |
|---|---|---|
| AC-01 | Capture with only title and summary | Saved record has trusted author/time and is visible in the author's Inbox after reload. |
| AC-02 | User reports a past request date | Reported date and server recording time remain distinct. |
| AC-03 | Requester has not acknowledged | UI says unconfirmed; author cannot impersonate acknowledgement. |
| AC-04 | Scope/deadline changes | Original/current revisions, actor, reason, and confirmation state are preserved. |
| AC-05 | Idea becomes assigned work | Same ID and discussion survive; lifecycle changes to Planned. |
| AC-06 | Submit Figma link, GitHub link, and PDF | One numbered submission stores the selected ready artifacts and delivery note. |
| AC-07 | Reviewer does nothing | Item remains Submitted, not Approved. |
| AC-08 | Request changes | Decision/comment recorded; item becomes In progress; previous delivery still exists. |
| AC-09 | Approve, reopen, resubmit | Prior approval remains on old version; new version awaits its own review. |
| AC-10 | Submitter tries to approve own work | Denied at domain/database authorization boundary, including an admin submitter. |
| AC-11 | Two tabs edit concurrently | Second stale save reports conflict and preserves typed work. |
| AC-12 | Network retry/double click | Exactly one submission, review decision, or comment is created. |
| AC-13 | Internal comment on externally shared item | Comment absent from guest HTML, APIs, notifications, metadata, and guest export paths. |
| AC-14 | Anonymous guest comments | Verified email sign-in required; guest returns to same share and gains no workspace membership. |
| AC-15 | Cross-project/cross-workspace ID substitution | Read, mutate, upload, export, and download paths deny access. |
| AC-16 | Share links to one project | Other projects and their titles, counts, people, and files remain undiscoverable. |
| AC-17 | Project gains another work item | Existing external share does not automatically reveal it. |
| AC-18 | Shared delivery gets internal updates | Guest sees pinned version until an authorized republish. |
| AC-19 | Share revoked/expired | New application reads fail; no new file URL issued; existing guest URLs expire within the configured 60-second bound. |
| AC-20 | Removed member reuses old session | Current membership checks deny protected actions. |
| AC-21 | 25 MB authorized upload | Direct-storage path works without function-payload failure; finalize validates actual object. |
| AC-22 | Oversized/wrong-type/interrupted upload | Explicit error; no Ready artifact or corrupted submission; retry/cancel works. |
| AC-23 | External Figma resource is private | Open link fallback works; UI does not promise access or bypass upstream permissions. |
| AC-24 | Mobile guest reviews a collection | Readable at 375 px, no page overflow, viewer and comment controls usable. |
| AC-25 | Keyboard-only primary journeys | Capture, filter, open, submit, review, comment, reorder, and share are operable with correct focus. |
| AC-26 | Light/dark/zoom/reduced motion | Verified contrast, readable reflow, visible focus, and no essential motion dependency. |
| AC-27 | Empty, loading, error, no-results states | Distinct states with truthful messages and recovery controls. |
| AC-28 | Search and timeline across midnight | Filters/grouping respect the selected timezone and exact event times remain available. |
| AC-29 | Archive and restore | History/submissions retained; status not falsely changed to complete. |
| AC-30 | Authorized export | Selected permitted records, revisions, attribution, and manifest are complete; hidden records excluded. |
| AC-31 | Backup recovery exercise | Database plus separately backed-up file samples are restored and opened successfully. |
| AC-32 | Refresh/redeploy | Persisted work, comments, shares, permissions, and settings remain intact. |
| AC-33 | Production build and secret scan | Typecheck, lint, tests, build, and secret checks pass; no fixture-only production flows. |
| AC-34 | Performance fixture | Documented dataset tests and measured results satisfy agreed budgets or list specific remediation. |

Automated coverage must include domain state-machine tests, database policy
tests, API integration tests, browser journeys, accessibility checks, and
visual snapshots for core screens. Manual review must include actual keyboard
use, mobile interactions, file viewing, contrast, and share-audience clarity. A
zero-violation automated accessibility scan is not a complete accessibility
audit.

No launch-critical TODOs, dead buttons, misleading success toasts, test-only
storage, publicly exposed buckets, or unverified claims of passing tests. A
missing external credential must be reported as a blocked integration, not
replaced with fake production success.

---

## 17. Implementation milestones

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0: Design and architecture | Repository inspection, reviewed skill installation, design system, UX flows, threat model, version choices. | Design and data/access decisions recorded before full UI construction. |
| M1: Foundation and capture | Auth, memberships, brands/projects, app shell, quick capture, persistent work list/detail, basic RLS. | Capture survives reload; cross-project access denied. |
| M2: Context and delivery | Brief revisions, idea promotion, activity timeline, links/files, submission snapshots. | Original context survives edits; failed uploads cannot enter submissions. |
| M3: Feedback and review | Comments/audiences, reviewer inbox, decisions, notifications, concurrency/idempotency. | Version-specific approvals and private-thread isolation pass tests. |
| M4: Collections and sharing | Curation, guest projections, email sign-in, permissions, expiry/revocation, export. | Guest/anonymous negative-access tests and pinned-publication tests pass. |
| M5: Polish and release | Responsive themes, accessibility, visual QA, performance, restore exercise, deployment/runbooks. | All launch acceptance tests accounted for; actual blockers documented. |

Do not build all screens as static mocks first and postpone the backend until
the end. Build functional vertical slices using the same design system.

---

## 18. Deployment, backup, and handoff

Use a company-authorized GitHub repository and managed accounts. Connect the
repository to Vercel, establish a protected production branch and preview
deployments, and configure a separate Supabase production project. Apply
migrations through a reviewed process and run database tests before deploying
dependent code.

Vercel describes Hobby as personal, non-commercial use. For this company tool,
verify and select an appropriate commercial plan rather than assuming Hobby is
suitable. Do not provision paid services without account-owner approval. [S16]

Required configuration categories:

| Configuration | Exposure and handling |
|---|---|
| Supabase project URL and publishable key | Browser-safe only with correct grants/RLS; verify current official names. |
| Supabase secret/service-role credential | Server-only, narrowly used for controlled operations; never `NEXT_PUBLIC_*`. |
| Auth email provider and callback URLs | Configure actual production domain and approved preview/local callbacks; test delivery and expiry. |
| Storage bucket, size/quota limits | Private bucket and explicit policies; match real provider plan limits. |
| Scheduled-job secret and endpoints | Required only for implemented cleanup/export jobs; protect and monitor them. |
| Error reporting | Optional provider, scrubbed data; application must work without leaking private content. |

An account owner must supply actual secrets and approve billing. The agent must
never fabricate credentials, use production data as demo data, or pretend
deployment is complete without those steps.

Maintain separate database and file-object backups. Supabase states that
database backups do not include Storage API object bytes. A database restore
alone cannot recover deleted files. [S17]

Set an initial operational target of at most 24 hours of data loss under the
configured backup strategy, and a recovery runbook targeting restoration within
one business day. Verify those targets through a restore exercise; revise the
target or purchase appropriate backup capabilities when needed. Encrypt backup
destinations and restrict access.

The runbook must explain migrations, rollback without destructive schema
reversal, membership removal, share revocation, storage cleanup, failed upload
recovery, export handling, backup/restore, dependency updates, and ownership
transfer.

Required final handoff files:

```
README.md                     Local setup, commands, and architecture
.env.example                  Required variable names, no secrets
WORKLOG_PRD.md                This product/build contract
CLAUDE.md                     Project execution guidance referencing this PRD
supabase/migrations/          Versioned schema, policies, functions
supabase/tests/               Database authorization/invariant tests
design-system/worklog/        Accepted design system and page exceptions
docs/skill-lock.md            Reviewed skill provenance and revision
docs/decisions.md             Assumptions and architecture choices
docs/ux-flows.md              Journeys and interaction behavior
docs/ux-audit.md              Actual visual/accessibility findings
docs/acceptance-results.md    Test evidence for AC-01 through AC-34
docs/deployment.md            Production and preview configuration
docs/operations.md            Backup, restore, offboarding, incident steps
```

---

## 19. Ready-to-paste implementation prompt

```
Build Worklog according to WORKLOG_PRD.md. Treat the document as the product
and acceptance contract, not as optional inspiration.

Inspect the existing repository first and preserve unrelated user changes.

Install and verify the reviewed UI UX Pro Max skill from:
https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Use the documented Claude Code project-scoped installation. Record the exact
revision and installation method. Do not install extra design skill packs.
Read and apply the installed skill before writing the design system and again
when auditing implemented screens. Do not claim installation or use without
verification.

Create the calm, modern list-first interface described in the PRD. Use one
coherent design system, strong typography, restrained color, generous spacing,
role-aware actions, mobile layouts, keyboard access, and complete UI states.
Do not create a marketing landing page or a static dashboard prototype.

Use the specified Next.js/TypeScript/Supabase architecture with compatible
pinned versions. Implement real persistence, RLS, private file storage,
versioned briefs and deliveries, attributed comments, non-self approvals,
collections, and scoped sharing. Preserve the difference between a recorded
claim, a confirmed request, a submitted delivery, and an approved version.

Work through M0-M5 in functional vertical slices. Run the relevant tests after
each slice and maintain docs/acceptance-results.md. Verify guest isolation,
revocation, concurrency, idempotency, file permissions, and mobile behavior.

Never use localStorage or fixtures as the production data source. Never expose
server secrets or make internal records public for convenience.

Use PRD defaults for ordinary decisions and document them. When a real secret,
account, billing approval, or unavailable system prerequisite is required,
report the exact blocked step and continue independent work. Do not fabricate
successful integrations, test results, or a deployed URL.

Finish with code, migrations, tests, design documentation, setup/deployment
runbooks, actual test results, and an honest list of remaining blockers.
```

---

## 20. Research and implementation references

External facts were checked on September 8, 2026. Repository counts are
approximate and change. All product flows, visual tokens, numerical product
limits, role policies, and acceptance criteria above are proposed requirements
for Worklog unless specifically attributed below.

- **[S1]** UI UX Pro Max repository and maintained installation instructions: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- **[S2]** Impeccable repository: https://github.com/pbakaus/impeccable
- **[S3]** Stitch Skills repository: https://github.com/google-labs-code/stitch-skills
- **[S4]** Anthropic's general skills collection: https://github.com/anthropics/skills
- **[S5]** Claude Code plugin installation and scopes: https://code.claude.com/docs/en/discover-plugins
- **[S6]** Claude Code skills and plugin-path substitutions: https://code.claude.com/docs/en/skills
- **[S7]** Selected skill's current instructions; agent must use its locked installed revision: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md
- **[S8]** Supabase private/public storage access model: https://supabase.com/docs/guides/storage/buckets/fundamentals
- **[S9]** Vercel function payload limits: https://vercel.com/docs/functions/limitations
- **[S10]** W3C WCAG 2.2 contrast criterion: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **[S11]** W3C WCAG 2.2 target-size criterion: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- **[S12]** Supabase server-side client/authentication guidance: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- **[S13]** Next.js data security and mutation authorization: https://nextjs.org/docs/app/guides/data-security
- **[S14]** Supabase row-level security and privileged keys: https://supabase.com/docs/guides/database/postgres/row-level-security
- **[S15]** Web Vitals definitions and thresholds: https://web.dev/articles/vitals
- **[S16]** Vercel Hobby plan usage scope: https://vercel.com/docs/plans/hobby
- **[S17]** Supabase backup coverage and Storage exclusion: https://supabase.com/docs/guides/platform/backups

---

> **Product principle.** Make the work easy to capture, easy to understand, and
> safe to share. Preserve context without turning the product into bureaucracy.
