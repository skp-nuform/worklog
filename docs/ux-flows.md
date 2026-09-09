# UX flows

The six journeys from the PRD, with interaction states and keyboard behaviour.
Visual rules live in `design-system/worklog/MASTER.md`; this file is about
sequence, state, and what the interface must never imply.

The distinction every flow protects:

> a **recorded claim** → a **confirmed request** → a **submitted delivery** →
> an **approved version**

These are four different facts. No flow may let one read as another.

---

## Global keyboard model

| Key | Action | Constraint |
|---|---|---|
| `Cmd/Ctrl+K` | Command palette: search and navigate | Never the only route to anything |
| `Cmd/Ctrl+Enter` | Submit the focused form's primary action | Explicit; no implicit save |
| `Escape` | Close the topmost dismissible overlay | Warns first if there is unsaved input |
| `Tab` / `Shift+Tab` | Move focus in DOM order | Visible ring on every stop |
| `c` | New work | Disabled inside editable fields; user-disableable |

Dialogs trap focus and restore it to the invoking control on close. The 64px
sticky header would otherwise obscure a focused row on scroll, so the scroll
container sets `scroll-padding-top` (WCAG 2.2 AA 2.4.11, Minimum).

---

## Flow 1 — Capture a new request

**Entry.** Global **New work** button in the header, or `c`, or the empty-state
CTA on `/overview`.

**The form asks for two things.** Title, and Request summary. Everything else —
project, brand, requested by, request source, deadline, priority, reviewer,
acceptance criteria — sits behind **Add details**, collapsed by default and
keyboard-reachable as a normal disclosure button.

**Defaults applied server-side, never from the form:** author, creation time,
and Inbox destination.

**States**

| State | Behaviour |
|---|---|
| Editing | Required fields marked explicitly. Validation on blur, not on every keystroke. |
| Invalid submit | Focusable error summary at the top (`role="alert"`, `tabindex="-1"`) linking to each invalid field, **plus** inline messages wired with `aria-describedby`. Focus moves to the summary. |
| Saving | Button shows `Saving…` and is disabled. No success language yet. |
| Saved | `Saved` appears **only** after server acknowledgement, then the real work record opens. |
| Failed | Specific reason, retry available, typed input preserved in memory. Warn before navigating away. |
| Offline | Same as failed. Confidential work is **not** cached in `localStorage` by default. |

**Verbal requests.** A request the author entered on someone's behalf is
labelled **"Unconfirmed understanding"** and stays that way until the requester
acknowledges a specific revision. A requester label with no linked verified
account renders as unverified. The author cannot acknowledge on the requester's
behalf — there is no control for it.

**Copy request link** copies a URL. The confirmation says exactly that. It must
never imply a notification was sent, because none was.

Covers AC-01, AC-03. Reported-vs-recorded dates: AC-02.

---

## Flow 2 — Record changing instructions

**Entry.** **Record change** on the work detail.

**Captures** what changed, why, who communicated it, and the effect on scope,
deadline, or priority. Before/after values are shown for each changed field.

**On save.** A material change creates a **new revision** and resets current
acknowledgement to **Awaiting confirmation**, while every earlier
acknowledgement is preserved. The original request is never overwritten.
Clerical corrections are still attributed.

**States**

| State | Behaviour |
|---|---|
| Diff review | Original and current side by side. Not colour-only: `<ins>`/`<del>` semantics so the change is conveyed to assistive tech. |
| Conflict | If another tab changed the record, show what changed and **keep the user's draft**. Never last-write-wins. |
| Autosaved prose | Coalesced into meaningful revisions. A keystroke is not a business event. |

Covers AC-04, AC-11.

---

## Flow 3 — Deliver work

**Entry.** **Add delivery** on the work detail.

**Requires**, before **Submit for review** is enabled: a request summary,
defined acceptance criteria or expected outcome, and at least one deliverable.
A substantive text-only result counts as a deliverable when explicitly chosen.

**Upload states.** `Pending → Uploading → Processing → Ready`, plus failed and
cancelled. Per-file progress, retry, and cancel. A server finalize step
validates the actual stored object before `Ready`. **A failed upload can never
appear as submitted evidence** — only `Ready` artifacts are selectable.

**On submit.** A numbered, immutable snapshot: current brief revision, delivery
note, selected artifacts, submitter, server time.

The status reads **"Submitted — awaiting review"**, in the amber `submitted`
palette. Never green. Never the word "Approved". A reviewer may be assigned
later without blocking a truthful record of delivery.

Covers AC-06, AC-21, AC-22, AC-23.

---

## Flow 4 — Review a delivery

**Entry.** Work detail, or **Awaiting my review** on `/overview`.

**Reading order is deliberate.** Expected outcome, then submitted version, then
delivery note, then artifacts — *above* the longer history. A reviewer must not
have to read a chronological feed to find the current delivery.

**Actions**, visible only to an authorized designated reviewer who is not the
submitter: **Approve this version** or **Request changes**. Requesting changes
requires an explanatory comment.

**Guarantees the UI must express**

- Approval applies to **that submission**, and the badge names its version.
- The review decision and the state change commit together.
- An outdated review attempt says a newer submission exists, and does not
  silently apply to it.
- Viewing, commenting, or being named as requester is never approval.
- If the viewer is the submitter, the approve control is **absent**, not
  disabled-with-a-tooltip — and the database refuses it regardless.

Covers AC-07, AC-08, AC-09, AC-10, AC-12.

---

## Flow 5 — Share selected work

**Entry.** **Share** on a work item, project, or collection.

**Steps.** Choose the audience → choose exactly what is included (records,
submission versions, artifacts, fields, comment permission) → **preview the
exact guest projection** → activate.

**Audience.** New shares default to **Invited**. Publishing an **Unlisted
link** requires publishing capability and a confidentiality confirmation, and
the dialog states plainly that an unlisted link is not confidential once
forwarded. Default expiry is 30 days, with the exact date shown; the publisher
may pick another date or explicitly choose no expiry.

**Defaults excluded** unless an authorized publisher deliberately includes
them: requester contacts, internal brief history, other projects, internal
comments, private source URLs.

**The token is shown once.** If lost, it can be rotated, not recovered.

**Guest side.** An unlisted link is readable without an account. Commenting
requires verified email sign-in, returns the guest to the same content, and
creates **no** workspace membership. Comment permission is not review
permission — external approval exists only through an invited, explicitly
designated review grant bound to one submission.

**New records are not auto-shared.** Adding a work item to a shared project
does not reveal it. The share manager sees **"Newer version available"** and
must preview and republish explicitly.

**Revocation.** Revoking denies new reads and new file links immediately. The
UI discloses that large-file links already issued remain valid for up to 60
seconds, and that downloaded content cannot be recalled.

**Unavailable states** — expired, revoked, wrong token — are **identical**
generic messages, with a safe request-access option where configured. Nothing
distinguishes them, because that would be an enumeration oracle.

Covers AC-13, AC-14, AC-16, AC-17, AC-18, AC-19.

---

## Flow 6 — Present a body of work

**Entry.** `/collections` → **New collection**.

**Compose.** Title, optional introduction, optional cover, then add existing
work. Ordering is available through keyboard-operable **Move up / Move down**
controls as well as drag — drag is never the only way.

**Presentation excerpts** are per-item and clearly separate from the
authoritative original request. Gallery cards without an image fall back to
title, work type, short excerpt, and metadata. Screenshots, results, client
quotes, and accomplishments are never invented.

Shares use the same controls as Flow 5, pinned to chosen submission versions.

Covers AC-24, AC-29, AC-30.

---

## Navigation, deep links, and Back

- A work row on desktop opens a **detail panel** while updating the URL.
  Direct navigation to that URL renders a **complete page**.
- Browser **Back** closes the panel and restores the previous filters, scroll
  position, and focus.
- Filters live in URL parameters, so any view is shareable and reloadable.
- Mobile opens a **full-screen route**, not a cramped drawer. The comment
  composer stays visible above the on-screen keyboard.
- The active navigation item is visually indicated.

---

## Required UI states

Every list and detail surface implements all of these, and they must be
distinguishable from one another:

| Situation | Requirement |
|---|---|
| Loading | Layout-matched skeleton or localized progress. Never placeholder data that could read as real work. |
| Empty account | Explains the next action; offers **Create first work item**. |
| No results | **Preserves** the filters and offers **Clear filters**. Must not look like an empty account or imply records were deleted. |
| Save pending | `Saving…`; no premature success. |
| Save failed / offline | Retry, input preserved, warn before navigation. |
| Concurrent edit | Explain what changed; preserve the draft. |
| Permission denied | Safe message that does not disclose hidden titles, people, or whether a resource exists. |
| Upload failure | Per-file reason; other successful uploads stay usable. |
| Expired / revoked share | Generic unavailable message, identical across causes. |
| Destructive action | Plain-language impact, confirmation, and archive/undo where reversible. |
| Unsaved close | **Save / Discard / Keep editing.** Typed text is never lost silently. |

Covers AC-27.

---

## Verification

Manual, recorded in `docs/ux-audit.md`:

- Keyboard-only pass through capture → filter → open → back, checking focus
  visibility and restoration at every step.
- Light, dark, and system themes at 100% and 200% zoom, plus the 320px reflow
  case, with no whole-page horizontal scroll.
- Relative timestamps expose their absolute value to keyboard and touch, not
  only pointer hover.
- Screen-reader pass over the error summary, status badges, and the revision
  diff, confirming nothing depends on colour alone.

Automated: Playwright journeys at 375/768/1024/1440 and 320, with axe on each
primary screen. A zero-violation scan is **not** a complete accessibility
audit and is never reported as one.
