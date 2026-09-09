# Worklog

A request-to-delivery work library.

> Capture a request once. Preserve its context. Attach the work. Share the same
> record.

Requests arrive in conversations, messages, and meetings. Priorities change and
the original context is forgotten. Finished work ends up scattered across
Figma, GitHub, deployed sites, documents, and local files. Worklog is one place
that records what was requested, what changed, what was delivered, and what
feedback or approval followed.

It combines project organisation, a dated activity timeline, and curated
portfolio-style collections without creating three competing sources of truth.

**Status: M0 complete, M1 in progress.** See `docs/acceptance-results.md` for
what is verified and what is blocked. The live build tracker is linked in
`docs/BUILD-CHECKLIST.md`.

---

## What it deliberately is not

Not an employee-monitoring system, time tracker, CRM, or chat replacement, and
not a guarantee against workplace disputes. It records actions and
acknowledgements; it does not prove that every underlying statement is true.

Three distinctions the product preserves everywhere:

- A **server timestamp** proves when the application recorded an action, not
  when work objectively happened.
- A **self-recorded verbal request** is not requester confirmation. It is
  labelled "Unconfirmed understanding" until the requester acknowledges a
  specific revision.
- A **link to a live external document** is not an immutable copy of it.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.9 strict |
| Styling | Tailwind CSS v4, shadcn/ui on the Radix base, Lucide icons |
| Data | Supabase Postgres with RLS, Supabase Auth, private Supabase Storage |
| Validation | Zod 4 with react-hook-form |
| Tests | Vitest + Testing Library, Playwright + axe-core, pgTAP |

Versions are pinned exactly with one committed lockfile. Three pins are
deliberately not the newest available — see `docs/decisions.md` D-02 and D-03
before "upgrading" them.

---

## Prerequisites

- **Node.js 22.12+** (developed on 22.23.1)
- **Docker Desktop** with the WSL2 backend — required by `supabase start`.
  Docker's file sharing must cover the drive holding this repository, or
  `supabase test db` silently mounts nothing.
- **Python 3** — required by the UI design skill's search script only, not by
  the application.

---

## Local setup

```bash
npm install
```

```bash
cp .env.example .env.local
```

Then start the local Supabase stack. It prints the URL and keys to paste into
`.env.local`:

```bash
npm run db:start
```

```bash
npm run db:status
```

Apply the schema and seed:

```bash
npm run db:reset
```

Generate database types (note `Out-File`, not `>`, on PowerShell):

```bash
npm run db:types | Out-File -Encoding utf8 src/lib/database.types.ts
```

Run the app:

```bash
npm run dev
```

### Environment variables

`.env.example` lists every name with no values. Summary:

| Variable | Exposure |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe (safe only because RLS is enabled and `anon` holds no privileges) |
| `NEXT_PUBLIC_SITE_URL` | Browser-safe; validates auth callback redirects |
| `SUPABASE_SECRET_KEY` | **Server only.** Bypasses RLS. Never `NEXT_PUBLIC_*` |
| `SHARE_TOKEN_PEPPER` | **Server only.** Kept out of the database so a dump cannot forge share links |
| `CRON_SECRET` | **Server only.** Needed once cleanup jobs exist (M2+) |

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run verify` | Typecheck, lint, unit tests, production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`next build` no longer lints) |
| `npm run test` | Vitest |
| `npm run test:e2e` | Playwright + axe at 375/768/1024/1440 and 320px |
| `npm run db:start` / `db:stop` / `db:status` | Local Supabase stack |
| `npm run db:reset` | Rebuild local DB from migrations |
| `npm run db:test` | pgTAP authorization and invariant tests |
| `npm run db:types` | Regenerate database types |

---

## Architecture

A modular monolith, not microservices.

```
Browser
  → Next.js UI + server-only application layer
      → Supabase Auth
      → Postgres (explicit grants + row-level security)
      → Private Storage
Browser → authorized direct upload → private Storage
Server  → validated, expiring artifact link → authorized viewer
```

Four database schemas with separate privilege tiers: `app` (base tables, not
exposed), `authz` (RLS helpers, not exposed), `api` (the only PostgREST-exposed
schema), `share` (guest projection, executed by a dedicated role). Design and
rationale: `docs/data-model.md`.

Two consequences worth knowing before reading the code:

- **Uploads never pass through a server function.** Vercel caps a function's
  request *and* response body at 4.5 MB, so a 25 MB attachment goes
  browser → signed URL → Storage, and a server finalize step validates the
  stored object before the artifact becomes usable.
- **`src/proxy.ts` is not a security boundary.** It refreshes sessions and
  redirects navigation. Authorization lives in every individual operation.

This repository holds code, migrations, and configuration — never uploaded
business files or live records. Saving a work entry never requires a commit or
a redeploy.

---

## Repository layout

```
src/app/                  Routes and page composition
src/components/ui/        Primitives (shadcn, customized — see MASTER.md)
src/features/             work, projects, reviews, comments, collections,
                          sharing, notifications
src/lib/auth/             Verified identity helpers
src/lib/permissions/      Central capability checks
src/lib/data/             Server-only data access
src/lib/storage/          Upload, finalize, download authorization
src/lib/validation/       Shared Zod schemas
src/proxy.ts              Session refresh (NOT authorization)
supabase/migrations/      Schema, policies, functions
supabase/tests/database/  pgTAP authorization and invariant tests
tests/e2e/                Playwright journeys
design-system/worklog/    Accepted design system and page exceptions
docs/                     Decisions, data model, threat model, UX, results
```

---

## Documentation

| File | Contents |
|---|---|
| `WORKLOG_PRD.md` | The product and acceptance contract |
| `CLAUDE.md` | Execution guidance and non-negotiables |
| `docs/decisions.md` | Assumptions and deviations, with reasons |
| `docs/data-model.md` | Schema, invariants, RLS, guest projection |
| `docs/threat-model.md` | Actors, threats, controls, accepted risks |
| `docs/ux-flows.md` | The six journeys, states, keyboard behaviour |
| `docs/skill-lock.md` | UI skill provenance and security review |
| `docs/acceptance-results.md` | AC-01–AC-34: evidence or blocker |
| `docs/BUILD-CHECKLIST.md` | Milestone status and the live tracker link |
| `design-system/worklog/MASTER.md` | Design system, with measured contrast |

---

## Contributing conventions

- Work in functional vertical slices: persistence, authorization, loading and
  error states, and tests, before starting the next slice.
- Record non-obvious choices in `docs/decisions.md`.
- Never report a command, test, or deployment as succeeding unless it did. A
  missing prerequisite is a blocker, not a failure to paper over.
- No dead buttons for deferred features — hide them.

---

## Not yet done

No Supabase cloud project, GitHub remote, or Vercel project exists. Those need
account ownership and billing approval; Vercel's Hobby plan is described as
personal and non-commercial, so a commercial plan must be chosen deliberately
for company use. Deployment and backup runbooks land in M5
(`docs/deployment.md`, `docs/operations.md`).

Database backups do not include Storage object bytes, so a database restore
alone cannot recover deleted files. Storage needs its own backup story before
production.
