@AGENTS.md

# Worklog — execution guidance

`WORKLOG_PRD.md` is the product and acceptance contract. Read it before making
architectural decisions. It wins over any conflicting suggestion from a design
skill, a component library default, or a tutorial.

## Non-negotiables

**Preserve the four facts.** A *recorded claim*, a *confirmed request*, a
*submitted delivery*, and an *approved version* are four different things. No
UI, copy, colour, or database column may let one read as another. "Submitted"
is never styled as success. "Approved" always names its submission version.

**Never claim unverified work.** Do not report a command as run, a test as
passing, a skill as loaded, or a deployment as succeeded unless it actually
happened. A missing credential or prerequisite is a **blocked** integration, to
be reported as blocked — never replaced with a plausible-looking success.
`docs/acceptance-results.md` and the live tracker carry either real evidence or
a named blocker for every criterion.

**Authorize every operation independently.** Next.js handles Server Functions
as POST requests to the route that uses them, so `src/proxy.ts` coverage can
disappear with a matcher change or a moved action. The proxy refreshes sessions
and redirects navigation; it is not a security boundary. Every server action,
route handler, upload authorization, export, and storage-link mint checks
permissions itself.

**Push each check to the innermost layer that can express it.** Prefer a
CHECK constraint or composite FK over a trigger, a trigger over a policy, a
policy over application code. The further a check sits from the data, the more
code paths bypass it.

**Verified identity only.** `supabase.auth.getClaims()` in server code. Never
`getSession()`. Membership and capabilities are read live from the database,
never from JWT claims — a removed member must be denied immediately, and a
token can be an hour stale.

**Secrets stay server-side.** `src/lib/env.server.ts` is `server-only`. The
Supabase secret key has exactly three permitted call sites: the guest asset
proxy, upload finalization, and scheduled cleanup. Never `NEXT_PUBLIC_*`.

**No fixtures as production data.** No `localStorage` as a data source. No
demo rows presented as real work. No dead buttons for deferred features — hide
them.

## Working agreement

- Build in **functional vertical slices**. Each slice includes persistence,
  authorization, loading and error states, and tests before the next begins.
  Do not build screens as static mocks and postpone the backend.
- Record every non-obvious choice in `docs/decisions.md`, especially
  deviations from the PRD, with the reason.
- Use PRD defaults for ordinary decisions rather than asking. Ask only when a
  real account, secret, billing approval, or machine prerequisite is needed —
  and continue independent work meanwhile.

## Where things live

| Path | Contents |
|---|---|
| `WORKLOG_PRD.md` | The contract |
| `docs/decisions.md` | Assumptions and deviations, with reasons |
| `docs/data-model.md` | Schema, invariants, RLS, guest projection design |
| `docs/threat-model.md` | Actors, threats, controls, accepted risks |
| `docs/ux-flows.md` | The six journeys, states, keyboard behaviour |
| `docs/skill-lock.md` | UI skill provenance and pre-install review |
| `docs/acceptance-results.md` | AC-01–AC-34 evidence or blocker |
| `design-system/worklog/MASTER.md` | Tokens (measured), type, components, anti-patterns |
| `design-system/worklog/pages/` | Deliberate per-page exceptions |
| `supabase/migrations/` | Schema, policies, functions |
| `supabase/tests/database/` | pgTAP authorization and invariant tests |
| `src/lib/permissions/` | Central capability checks |
| `src/lib/data/` | Server-only data access |

## Stack facts that break older tutorials

- This is **Next.js 16**. `middleware.ts` does not exist — it is `src/proxy.ts`
  exporting `proxy`. `next lint` was removed; lint is its own script.
  Turbopack is the default. Read `node_modules/next/dist/docs/` when unsure.
- **Tailwind v4** with `@theme inline`, not v3. No `tailwind.config.js`.
- **shadcn 4**: `cn` comes from the `cn` package, primitives come from the
  unified `radix-ui` package, and components carry `data-slot` attributes.
- shadcn's `--accent` is a hover surface. The brand colour is `--brand`. A
  compatibility layer in `globals.css` aliases shadcn's names onto Worklog
  tokens — extend that layer rather than renaming tokens.
- Pinned deliberately: `typescript@5.9.3` (not 7.x — `typescript-eslint`
  excludes it), `eslint@9.39.5` (10.x crashes `eslint-config-next@16.3.4`),
  `@types/node@^22` (matches the Node 22 runtime). See `docs/decisions.md`
  D-02, D-03.
- `vite` must be installed explicitly: it is a non-optional peer of `vitest@5`
  that vitest itself does not depend on.
- Vitest cannot render `async` Server Components. Those are covered by
  Playwright.

## Commands

```bash
npm run verify
```

Typecheck, lint, unit tests, and production build in one pass.

```bash
npm run db:start
```

Local Supabase (requires Docker Desktop).

```bash
npm run db:reset
```

Rebuild the local database from all migrations.

```bash
npm run db:test
```

pgTAP authorization and invariant tests.

```bash
npm run test:e2e
```

Playwright journeys with axe, at 375/768/1024/1440 and 320px reflow.

## Windows notes

PowerShell 5.1 has no `&&` or `||`. Redirect with `| Out-File -Encoding utf8`,
never bare `>` — a BOM breaks `tsc` and `psql`. `.gitattributes` pins LF,
which matters for dollar-quoted PL/pgSQL blocks.
