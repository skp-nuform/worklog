# Build checklist

**Live tracker:** https://claude.ai/code/artifact/de84bd9b-0df4-46fd-b4a8-b0721abd72b3

The tracker is the same data as this file, updated as each slice lands and
openable from any device. This file is the git-tracked mirror and the source of
truth in review.

Last updated: 2026-09-09.

---

## Blocked — needs you

A hosted Supabase project (`pkbpdswdzedlytplykau`, ap-south-1, Postgres 17) is
now in use, so **Docker is no longer required** — the earlier Docker blocker is
resolved. Two things remain:

| # | Blocker | Unblocks |
|---|---|---|
| 1 | **The Supabase CLI is authenticated to a different account** and cannot see `pkbpdswdzedlytplykau` (it lists only `qvlzhkfurudzihezkpkw` and `yuewkkicnufyvnzacbsv`, org `vsrswsswzdhjsbsyfwcf`). Run `npx supabase login`, then `npx supabase link --project-ref pkbpdswdzedlytplykau` — link asks for the database password in the terminal, which is the right place for it. | Applying migrations (`db push`) and running the pgTAP suite: AC-01, 02, 07, 09, 10, 11, 15, 16, 20, 32 |
| 2 | **The `service_role` key was exposed in a chat transcript** and is a JWT valid until ≈2036. Rotate it in Project Settings → API. | Nothing in M1. Needed for M2 upload finalize and M4 guest asset proxy. `SUPABASE_SECRET_KEY` is left blank until rotation. |

No GitHub remote or Vercel plan is needed until M5. A **separate production
Supabase project** is still required before real records exist — this one is
development only (`docs/decisions.md` D-22).

---

## M0 — Design and architecture

**Exit gate:** design and data/access decisions recorded before feature UI is
built. **Status: complete.**

- [x] Repo scaffold, exact version pins, one lockfile
- [x] `.gitattributes` (LF) committed before any SQL
- [x] `typecheck`, `lint`, `build` all pass
- [x] Security headers and pinned Turbopack root in `next.config.ts`
- [x] `.env.example` with names only; fail-loud config validation
- [x] Supabase server/browser clients on the `getAll`/`setAll` cookie interface
- [x] `src/proxy.ts` refreshing sessions via `getClaims()`
- [x] UI skill reviewed pre-install, installed project-scoped, revision pinned
      (`docs/skill-lock.md`)
- [x] Design system with **measured** contrast (`design-system/worklog/MASTER.md`)
- [x] OKLCH token system + shadcn compatibility layer (`globals.css`)
- [x] shadcn reconciled: tokens restored, fonts reverted, Button resized to
      meet the touch target
- [x] Page-level design exceptions: work detail, collections, guest share
- [x] `docs/ux-flows.md` — six journeys, states, keyboard behaviour
- [x] `docs/data-model.md` — schema, invariants, RLS, guest projection
- [x] `docs/threat-model.md` — actors, threats, controls, accepted risks
- [x] `docs/decisions.md` — 20 decisions, deviations included
- [x] Live tracker

Migration SQL is deliberately **not** in M0: it ships in M1 alongside the
pgTAP suite that executes it, so no statement is called done before it runs
(`docs/decisions.md` D-19).

---

## M1 — Foundation and capture

**Exit gate:** capture survives reload with trusted author and time;
cross-project access denied at the database boundary; keyboard-only capture and
navigation work. **Status: in progress — schema written, not yet applied.**

- [ ] Database reachable from the CLI — **blocked on `supabase login`**
- [x] Migrations `0001`–`0004` **written and syntax-validated** (207
      statements, parsed with `pglast`/libpg_query for PostgreSQL 17):
      schemas and types; core tables with composite FKs; delivery tables with
      the self-approval CHECK, submission numbering, and `emit_event`; `authz`
      helpers, RLS policies, and the indexes those policies need
- [ ] Migrations **applied** (`supabase db push`) — blocked
- [x] pgTAP suite **written** (5 files): `anon` has zero privileges anywhere,
      RLS on every `app` table, no client write grants or write policies,
      every `authz` function definer/stable/pinned-search_path, every
      `workspace_id` table tenant-pinned, 6 cross-tenant write cases, 5
      cross-tenant read cases, self-approval refused for a contributor **and
      for a workspace owner**, forged submitter refused, double approval
      refused, withdrawn submission number retired, approval not migrating,
      stale `expected_version` matching zero rows, removed member with a
      stale admin-claim token seeing nothing
- [ ] pgTAP suite **run** (`supabase test db --linked`) — blocked
- [ ] Email sign-in, `/auth/callback` with redirect validation, expired-link
      recovery, persistent sign-in rate limiting
- [ ] Onboarding: name, workspace, timezone, editable brands
      (Newform Tech / Newform Social as seed labels, never hard-coded)
- [ ] App shell: 232px sidebar, 64px header, light/dark/**system** theme
      resolution to an explicit class, skip nav, landmarks
- [ ] Quick capture: title + summary only, details progressively disclosed,
      "Unconfirmed understanding" labelling, `Saved` only after server ack
- [ ] Reported vs recorded dates kept distinct; date-only deadlines stored
      distinctly from timed ones
- [ ] Work list + detail: keyset pagination ≤50, URL-persisted filters, panel
      with real URL updates and Back restoring filters/scroll/focus, mobile
      full-screen route, all four list states
- [ ] Vitest domain and state-machine tests; Playwright + axe journeys

---

## M2–M5 — designed, not built

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M2 Context and delivery | Brief revisions, idea promotion, activity timeline, links and files, submission snapshots | Original context survives edits; failed uploads cannot enter submissions |
| M3 Feedback and review | Comment audiences, reviewer inbox, decisions, notifications, concurrency and idempotency | Version-specific approvals and private-thread isolation pass tests |
| M4 Collections and sharing | Curation, guest projections, email sign-in for guests, permissions, expiry and revocation, export | Guest and anonymous negative-access tests and pinned-publication tests pass |
| M5 Polish and release | Responsive themes, accessibility audit, visual QA, performance fixture, restore exercise, deployment runbooks | All launch acceptance tests accounted for; actual blockers documented |

Never built, per PRD section 4.2: AI summaries, transcription, Slack/WhatsApp
ingestion, GitHub/Figma sync, Kanban, calendars, time tracking, employee
rankings, native apps, billing, OCR, public indexed portfolios. Deferred
controls stay hidden rather than shipping as dead buttons.

---

## Acceptance criteria

Per-criterion evidence and blockers: `docs/acceptance-results.md`.

| Status | Count |
|---|---|
| Passing | 0 |
| In progress | 1 |
| Blocked | 7 |
| Not started | 26 |

Nothing is marked passing on the strength of a mock. A criterion that cannot be
tested yet is reported blocked with the exact missing prerequisite.
