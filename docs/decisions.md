# Decisions and assumptions

Every entry is a choice made during implementation that a reader could
reasonably have expected to go the other way. Deviations from the PRD are
called out as deviations, not quietly absorbed.

Dates are absolute. Recorded during M0, 2026-09-08 / 2026-09-09.

---

## D-01 — Project lives in a `worklog/` subdirectory

**Decision.** The application is at `Work Collection/worklog/`, not at
`Work Collection/` itself.

**Why.** The PRD's plan was to scaffold in place. `create-next-app` derives the
package name from the target directory and refused: `Work Collection` is not a
valid npm package name (capitals and a space). Rather than hand-patch a
generated `package.json`, the app was created in `worklog/`, which is both a
valid package name and the project slug the design system already uses.

**Consequence.** `worklog/` is the repository root for every purpose: git,
`supabase/`, `docs/`, `design-system/`, and the Vercel project root.

---

## D-02 — Pinned versions, and the three that are not the newest

**Decision.** All dependencies are pinned exactly and one lockfile is
committed. Three deliberately are not `latest`:

| Package | Pinned | Why not latest |
|---|---|---|
| `typescript` | 5.9.3 | `latest` is 7.0.2. `typescript-eslint@8.70.0` declares `typescript >=4.8.4 <6.1.0`, so TS 7 is excluded; TS 7.0 also shipped without the public programmatic compiler API that ESLint tooling needs. |
| `eslint` | 9.39.5 | See D-03. |
| `@types/node` | `^22` | `latest` is 26.x, which does not match the Node 22.23.1 runtime actually in use. |

`@supabase/supabase-js` stays on the 2.x line: the `next` tag is `3.0.0-next`,
which would break `@supabase/ssr`'s `^2.114.0` peer requirement.

**Assumption.** `@supabase/ssr` is still pre-1.0 (0.12.7). That is its current
stable channel, but minor-version churn should be expected and reviewed rather
than auto-accepted.

---

## D-03 — ESLint held at 9.x (deviation from the plan)

**Decision.** `eslint@9.39.5`, not `eslint@10.10.0` as planned.

**Why.** ESLint 10 was installed first and **failed at runtime**, not merely
with a warning:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
```

`eslint-config-next@16.3.4` bundles an `eslint-plugin-react` that relies on a
context shim ESLint 10 removed. `eslint-config-next` is versioned in lockstep
with Next.js, so there is no newer config to move to. Compatibility beat
currency: with 9.39.5, `eslint .` exits 0.

**Known cost.** ESLint 9.x is past its own support window, so npm prints a
deprecation warning on install. Revisit when `eslint-config-next` supports
ESLint 10.

---

## D-04 — `src/proxy.ts`, and why it is not a security boundary

**Decision.** Session refresh lives in `src/proxy.ts` (Next 16 renamed the
`middleware` convention to `proxy`; the exported function is `proxy`).
Identity is verified with `supabase.auth.getClaims()`.

**Why `getClaims()`.** It verifies the JWT signature rather than trusting a
stored session object. Supabase's guidance is explicit that `getSession()` must
not be trusted in server code such as Proxy.

**Why it is not a boundary.** Next.js handles Server Functions as POST requests
to the route that uses them, so a matcher change or a moved action can silently
remove proxy coverage — Next's own data-security guide says to verify
authorization inside each Server Function rather than relying on Proxy. The
proxy therefore only refreshes cookies and redirects obviously-unauthenticated
navigation. **Every** server action, route handler, upload authorization,
export, and storage-link mint authorizes independently.

---

## D-05 — Four database schemas, and no `anon` privileges anywhere

**Decision.** `app` (base tables), `authz` (RLS helper functions), `api`
(the only PostgREST-exposed schema), `share` (guest projection). `anon` gets
no privileges on any of them.

**Why.** Supabase's RLS guide warns never to place `SECURITY DEFINER`
functions in an exposed schema, since they become callable with elevated
privileges through the Data API. Keeping `authz` and `share` unexposed is what
makes them safe to write as definer functions.

**Consequence.** Guests never issue SQL against internal tables. The guest path
is a server-validated projection executed by a dedicated `worklog_share_reader`
role. A pgTAP test asserts `anon` holds zero privileges — the single most
valuable assertion in the suite.

---

## D-06 — Membership is read live from the database, never from the JWT

**Decision.** RLS policies resolve membership by querying membership tables
through `authz` helpers. Capabilities are **not** carried as custom JWT claims.

**Why.** Supabase access tokens default to a 1-hour lifetime, and sessions are
not proactively destroyed when access changes — the check happens at the next
refresh. The custom-claims hook runs *before* a token is issued. A removed
member would therefore keep a valid capability claim for up to an hour, which
directly contradicts the PRD's requirement to deny new protected requests
immediately on removal (AC-20).

**Consequence.** The RLS performance work is mandatory, not optional: helper
functions are `SECURITY DEFINER STABLE` with a pinned `search_path`, calls are
wrapped as `(select authz…)` so Postgres caches them as an InitPlan, policies
always name `TO <role>`, and every column a policy filters on is indexed.

---

## D-07 — Cross-tenant safety by composite foreign key, not triggers

**Decision.** `workspace_id` is denormalized onto every `app` row. Every parent
carries `UNIQUE (id, workspace_id)`, and every child foreign key is composite.

**Why.** It is declarative and race-free, applies uniformly to bulk paths a
trigger might miss, and is enumerable by a test — a pgTAP check walks
`information_schema` and fails if any table with a `workspace_id` lacks a
tenant-pinning composite FK, which keeps the rule true as the schema grows. A
cross-workspace reference then fails as `23503` (foreign key violation), not as
a policy error.

---

## D-08 — Self-approval is a CHECK constraint, not a trigger or policy

**Decision.** The submitter's identity is imported onto the review-decision row
via a composite FK, and a `CHECK` constraint forbids reviewer = submitter.

**Why.** A `CHECK` is enforced for every write by every role — including
`service_role`, `postgres`, and `SECURITY DEFINER` functions. A trigger or an
RLS policy would be bypassable by exactly the break-glass paths this invariant
most needs to survive. This is what makes AC-10 hold even when the submitter is
a workspace admin.

**Related.** Approval is never denormalized onto the work item. There is no
`approved_submission_id` column; current approval is derived through a
`security_invoker` view. You cannot enforce that a cache stays correct — so the
cache is declined (AC-09).

---

## D-09 — Uploads bypass the application server entirely

**Decision.** Browser → signed upload URL → Supabase Storage directly. A
server finalize step then verifies the stored object before an artifact becomes
`Ready`.

**Why.** Vercel documents a **4.5 MB** limit on a function's request *and*
response body, returning `413 FUNCTION_PAYLOAD_TOO_LARGE` beyond it. The PRD's
25 MB attachment cannot pass through a route handler or server action.

**Consequence.** Possession of an object key is never authorization. Finalize
checks size and MIME against `storage.objects.metadata` before the artifact is
referenceable, so a failed or interrupted upload cannot enter a submission
(AC-21, AC-22).

---

## D-10 — Guest asset bytes are proxied, not signed, below ~10 MB

**Decision.** Guest-visible assets under roughly 10 MB stream through a route
handler. Larger files fall back to a signed URL capped at 60 seconds, and the
share UI discloses that bound.

**Why.** Supabase signed URLs remain valid until expiry regardless of any
auth-key change; there is no revocation primitive. Proxying makes revocation
genuinely immediate and adds per-view access logging. The trade-off is egress
through compute and no CDN, which is acceptable for review traffic that is
mostly images and PDFs.

**Honest limit.** Already-downloaded content cannot be recalled, and a
large-file signed URL stays live for up to its 60-second window after
revocation. AC-19 is written against that bound rather than against a claim of
instant universal revocation.

---

## D-11 — Share tokens are peppered outside the database

**Decision.** At least 256 bits of randomness. The database stores only an
HMAC of the token, computed with a pepper held in `SHARE_TOKEN_PEPPER` — an
environment variable, never a database row.

**Why.** A database dump alone must not be enough to resolve or forge a share
link. Keeping the pepper out of the database achieves that, and hashing in the
application means the raw token never appears in a SQL string or query log.

**Consequence.** Wrong, revoked, and expired tokens must return results
**indistinguishable from one another**, so a share URL cannot be used as an
enumeration oracle.

---

## D-12 — Guest field allowlist defaults to deny

**Decision.** The set of fields a share may expose is a registry table that
defaults to deny, applied by the projection function, with a `zod.strict()`
DTO at a single choke point that `app/s/**` is the only importer of.

**Why.** RLS filters rows, not columns per grant. A new column must be
invisible to guests until someone deliberately publishes it — the failure mode
of an allowlist that defaults to allow is a silent leak on the next migration
(AC-13, AC-16).

---

## D-13 — UI skill installed from a pinned local checkout

**Decision.** `ui-ux-pro-max` v2.13.0 at commit `4aad058`, registered as a
project-scoped marketplace from `~/.claude/vendor/ui-ux-pro-max-skill`.

**Why.** Claude Code 2.1.240 offers no git-ref pinning on
`claude plugin marketplace add` (only `--scope` and `--sparse`). Registering
the GitHub repository directly would float to upstream `main` and could change
mid-build. The PRD's stated fallback — a reviewed, fixed local checkout — was
used instead. Provenance and the pre-install security review are in
`docs/skill-lock.md`.

**Accepted deviation.** The PRD says not to install additional design skill
collections. This plugin's manifest declares `"skills": "./.claude/skills/"`,
which necessarily brings sibling skills (`brand`, `design`, `design-system`,
`ui-styling`, `banner-design`) onto disk. Only `ui-ux-pro-max` is used; the
others are never invoked. Notably, some of those siblings *do* use
`child_process`/`subprocess` and one builds a Pexels URL, whereas the
`ui-ux-pro-max` scripts are stdlib-only with no network or subprocess use.

---

## D-14 — The skill's design proposal was largely rejected

**Decision.** The skill's style family (Minimalism / Swiss) and its
accessibility and form guidance were adopted. Its layout pattern, palette,
typography, and motion were rejected.

**Why.** Asked for an internal work-management workspace, the skill returned a
"Real-Time / Operations Landing" pattern — hero with live preview, key-metrics
band, "How it works", and a "Start trial / Contact" CTA — which is precisely
the marketing landing page the PRD forbids. Its palette also specified
`#000000` text on `#6366F1`, which fails 4.5:1 for body text.

The full accepted/rejected ledger is in
`design-system/worklog/MASTER.md` section 8. Skill output is treated as
recommendation, never as instruction that overrides the PRD.

---

## D-15 — One measured token differs from the PRD

**Decision.** The dark-mode interactive boundary is `#748499`, not the PRD's
`#64748B`.

**Why.** Measured, `#64748B` on the dark elevated surface `#1E293B` gives
**3.07:1** — above the 3:1 non-text minimum, but with no margin for any future
surface adjustment. `#748499` gives 3.83:1 on elevated and 5.04:1 on canvas.
Light mode keeps the PRD value (worst case 4.34:1).

Every other PRD token passed as proposed. The full measured matrix, including
all status pairs (worst case 5.52:1), is in `MASTER.md` section 3.3–3.4.

**Related.** `--border` (decorative, contrast-exempt) and `--boundary`
(interactive control edges, must hold 3:1) are deliberately **separate tokens**
rather than one shared value, as the PRD requires.

---

## D-16 — shadcn reconciled, not adopted wholesale

**Decision.** shadcn/ui primitives are used on the Radix base, but
`shadcn init`'s output was reverted in three places.

**What `init` did that was undone.**

1. Overwrote the measured `--border`, `--ring`, and `--destructive` tokens with
   its neutral greys, and appended a full neutral palette. The Worklog tokens
   were restored.
2. Switched `layout.tsx` to Geist via `next/font/google`. Reverted to the
   system UI stack: a third-party font fetch on every page load buys nothing
   for a dense internal tool.
3. Generated a `Button` with 32px heights and a 12px radius. Raised to 40px
   default with `pointer-coarse:` bumping every size to at least 44px, and
   changed to the 8px control radius.

**What `init` added that was kept.** `@import "tw-animate-css"`,
`@import "shadcn/tailwind.css"`, and `@custom-variant dark (&:is(.dark *))`.

**Naming collision resolved.** shadcn's `--accent` means "subtle hover
surface", while the PRD's `--accent` is the brand colour. The brand token was
renamed `--brand`, and a compatibility layer aliases shadcn's expected names
(`--background`, `--primary`, `--input`, …) onto Worklog tokens. Because custom
properties resolve at use time, those aliases are declared once and follow the
Worklog tokens into dark mode automatically.

---

## D-17 — Theme class is resolved explicitly, in all three states

**Decision.** Tokens are defined for `:root` (light),
`@media (prefers-color-scheme: dark) :root:not(.light)` (system dark), and
`.dark` (explicit dark).

**Why.** The PRD requires light/dark/**system**. shadcn's `dark:` utilities key
off the `.dark` class only, so under system-dark-without-a-class the tokens
would be dark while `dark:` utilities stayed light.

**Consequence.** The theme provider (M1) always resolves system preference to
an explicit class on `<html>`, so the two mechanisms cannot disagree. Until
that lands, `dark:` utilities must not be relied on — the token blocks cover
system dark on their own. This is noted in `layout.tsx`.

---

## D-18 — Charts have no tokens

**Decision.** `shadcn init`'s `--chart-1…5` tokens were dropped; sidebar tokens
were kept and remapped onto Worklog tokens.

**Why.** The PRD forbids decorative charts and defers data visualisation.
Shipping chart tokens invites a chart nobody asked for. They can be added
deliberately if a chart is ever justified by a real question.

---

## D-19 — Migration SQL is authored in M1, not M0

**Decision.** M0 records the data model, invariant placement, and RLS strategy
as design. The SQL lands in M1, immediately alongside the pgTAP suite that
exercises it.

**Why.** Docker Desktop is not installed, so nothing SQL can be executed yet.
Writing several hundred lines of unverifiable SQL and reporting the milestone
complete would be exactly the unverified claim the PRD prohibits. Authoring
migrations and their tests together means every statement is executed before it
is called done.

**Current blocker.** Docker Desktop with the WSL2 backend, with file sharing
covering the repository drive. Until then, every database-dependent acceptance
criterion is reported **blocked**, never passing.

---

## D-20 — Local-first database, with no cloud project yet

**Decision.** Development targets a local Supabase stack. No Supabase cloud
project, GitHub remote, or Vercel project has been created.

**Why.** Those require account ownership and billing approval, which the PRD
reserves to the account owner. Vercel additionally describes Hobby as personal
and non-commercial, so a commercial plan has to be chosen deliberately rather
than assumed. None of it is needed for M0 or M1.

---

## Environment assumptions

- Windows 11, PowerShell 5.1 as the primary shell: no `&&`/`||` chaining, and
  redirection uses `| Out-File -Encoding utf8` because bare `>` can emit a BOM
  that breaks `tsc` and `psql`.
- `.gitattributes` normalises to LF and was committed **before** any SQL, so
  CRLF cannot corrupt a dollar-quoted PL/pgSQL block.
- `Desktop` is **not** OneDrive-redirected on this machine, so `node_modules/`
  and `.next/` are not being sync-scanned. Verified, not assumed — Turbopack
  filesystem caching is on by default in Next 16 and writes constantly.
- Repo-scoped `core.longpaths=true` is set for `node_modules` and Playwright
  browser bundles.
- Python 3.13.6 is present, satisfying the UI skill's Python 3 requirement.
  Nothing was installed to satisfy it.

---

## D-21 — `public` is the exposed API schema, not `api`

**Decision.** Base tables live in `app`, RLS helpers in `authz`, and the
client-facing surface (views and RPCs) in `public`. The PRD names the exposed
schema `api`.

**Why.** PostgREST's exposed-schema list is project configuration, not
something a migration can set. Using `api` would require a dashboard change
that is easy to forget and fails silently — every client call 404s with no
indication why. `public` is exposed by default.

**What is unchanged.** `app` and `authz` are not in the exposed list, so base
tables and definer helpers remain unreachable from the Data API. `public` is
stripped: `revoke all on schema public from public`, then narrow explicit
grants. The security property the PRD is after — base tables not directly
callable, definer helpers not callable at all — holds either way.

---

## D-22 — Hosted Supabase project instead of a local stack

**Decision.** Development targets the hosted project
`pkbpdswdzedlytplykau` (region ap-south-1, Postgres 17). Docker Desktop is no
longer a prerequisite, and D-19's Docker blocker is resolved.

**Why.** The user supplied a live project. `supabase link` plus
`supabase db push` applies migrations without a container runtime, and
`supabase test db --linked` runs pgTAP against it.

**Consequences and cautions.**

- This project must be treated as **development**, not production. The PRD
  requires separate local, preview, and production data. A separate
  production project is still required before real business records exist.
- **Never run `supabase db reset --linked`** against it: that is destructive.
  Hosted schema changes go through `db push` only.
- The pgTAP suite is written so every file runs inside a transaction that
  rolls back (`begin; … rollback;`), so it does not leave fixture rows
  behind. It still must not be pointed at a database holding real records.
- Migration SQL is validated offline with `pglast` (libpg_query, PostgreSQL
  17) before push. That catches syntax, not semantics — "parses" is reported
  as parses, never as passes.

---

## D-23 — The service_role key was exposed and must be rotated

**What happened.** The project's `service_role` secret key was pasted into a
chat transcript on 2026-09-09. It is a JWT with `exp` 2104502921
(≈ 2036), so it does not expire meaningfully on its own.

**Action required by the account owner.** Rotate the `service_role` key in
Project Settings → API. Until then `SUPABASE_SECRET_KEY` is deliberately left
**blank** in `.env.local`.

**Why this is survivable right now.** Nothing in M1 uses the secret key. It is
first needed by upload finalization (M2) and the guest asset proxy (M4), and
it has exactly three permitted call sites (`docs/threat-model.md` T-14).

**What was set up instead.** `.env.local` holds the project URL and the
publishable key — browser-safe by design, and safe only because `anon` holds
zero privileges and RLS is on every table, which `supabase/tests/database/
010-structure.sql` asserts. `SHARE_TOKEN_PEPPER` was generated locally and
never transmitted.

---

## D-24 — M1 app decisions

**Capture is a route, not a modal.** `/work/new` is deep-linkable, restorable
by Back, and full-screen on mobile rather than a cramped drawer. It also
sidesteps the shadcn `dialog` component, whose install kept prompting to
overwrite the customised Button.

**Nav shows only routes that exist.** Projects, Timeline, Collections, and
Settings are later milestones and are **absent** from the sidebar, not present
and dead. The PRD is explicit: hide deferred controls.

**Approve and Request changes are absent from the state-action bar.** Both
require a review decision bound to a submission, which is where the
`rd_no_self_review` CHECK lives. `transition_work_state` refuses them
explicitly (P0403) rather than offering a path that bypasses the constraint.
The TS state machine marks them `needsReviewDecision`, and a unit test asserts
nothing else claims that flag.

**`typedRoutes: true` is kept.** It caught every hand-written link at build
time. Dynamic hrefs use a `UrlObject` (`{pathname, query}`) or `Link`'s own
prop type rather than a cast; the single genuine runtime redirect in
`requireViewer` carries a documented, narrow cast.

**Hydration detection uses `useSyncExternalStore`, not an effect.** React's
`react-hooks/set-state-in-effect` rule correctly rejects
`useState(false)` + `useEffect(() => setMounted(true))` — it causes a
cascading render. `src/lib/use-hydrated.ts` expresses the same thing as what
it is: a value that differs between server and client. Used by the theme
toggle and by `LocalTime`.

**`/login` is a server page wrapping a client form in Suspense.** The form
reads `?next=` and `?error=` with `useSearchParams`, which Next requires be
Suspense-bounded or the static shell cannot be prerendered. The build failed
loudly on this rather than silently degrading.

**Relative timestamps expose their absolute value to keyboard and touch.**
`LocalTime` renders a `<time>` with `title`, `aria-label`, and `tabIndex={0}`,
and falls back to the absolute string before hydration — never wrong, only
less friendly. The PRD requires this not be pointer-hover-only.

**`vite-tsconfig-paths` removed.** Vite 8 resolves tsconfig `paths` natively
via `resolve.tsconfigPaths`, and the plugin warns when present.

---

## D-25 — Pivot: the product is a work sheet, not an approval system

**What changed.** On 2026-09-09 the user read back what had been built and
said it was not what they wanted. Their actual goal:

> a collection of work organised by calendar day, where I can post a Figma
> link, paste a screenshot, a video or website link — just to show what I did
> that day; anyone with the link can view, interact or download; interactive,
> animated, good UI/UX, and scalable to a whole team like a tracker.

**Why the miss happened.** The PRD specified a request-to-delivery governance
system in detail — submissions, designated reviewers, version-pinned
approvals, acknowledged brief revisions — and it was implemented faithfully.
The document was followed instead of being checked against what the user
would actually use. The parts they cared about (attach a link, paste a
screenshot, group by day) were scheduled as "M2" and therefore did not exist,
while the parts they never asked for were complete and tested.

**What was kept.** Auth, workspaces and members, live-read RLS, definer RPCs
for writes, tenant pinning by composite FK, the append-only audit trail,
idempotency, and the error-code contract. All of that was right and is reused
unchanged by the new schema.

**What was dropped from the app.** The `/overview` and `/work` routes, the
work-item state machine, submissions, review decisions, brief revisions and
acknowledgements, and their components.

**What was NOT dropped.** Migrations `0002`–`0006` stay applied. Dropping
tables is destructive, and the governance model may be wanted later. They are
inert: no view, RPC or component in the app references them. `docs/
data-model.md` and `WORKLOG_PRD.md` still describe them and are now
historical for that half.

---

## D-26 — Enum parameters never appear in the public API signature

**Decision.** Every RPC in `public` takes `text` for what is stored as an
`app.*` enum, and casts internally after validating.

**Why.** `authenticated` deliberately has no `USAGE` on schema `app`, so base
tables stay unreachable. But naming an `app.*` type in a function signature
forces the caller to resolve that type, which fails with
`42501 permission denied for schema app`.

**Why it was hard to see.** Every affected parameter had a default, so calls
that omitted them worked. It surfaced only when live verification supplied
`p_reported_request_date` and `p_source` together. Granting `USAGE` on `app`
would have been the one-line fix and the wrong one — it would also expose the
definer helpers living in that schema.

---

## D-27 — Contact sheet as the visual identity

**Decision.** The sheet is laid out as a darkroom contact sheet: a sticky day
rail (weekday, date, month, mono frame counts) with each day's work as a
strip of framed proofs, each carrying a mono frame number.

**Why.** A photographer's contact sheet is already a dated grid of proofs,
which is exactly what "what I did that day" is. It gives the product a strong
repeating structure that comes from the subject rather than from a template,
and it is nowhere near the current AI-generated design cluster (warm cream and
serif, near-black with an acid pop, purple-blue gradient hero, Inter or Space
Grotesk, emoji section markers, everything centred and rounded).

**Type.** Archivo for UI, JetBrains Mono for dates and frame numbers, both
self-hosted by `next/font` — no runtime request to Google, and no
render-blocking `@import`. The earlier system-stack decision (D-16) is
superseded for this product: the fonts now carry identity rather than being
decoration.

**Colour.** Graphite and cool paper neutrals; electric blue for interaction;
**amber used for exactly one thing — "today" on the spine.** A colour that
means one thing keeps meaning it.

**Motion.** A `frame-in` keyframe staggered by index, so a day's strip
resolves left to right like a sheet coming out of the fixer. `opacity` and
`transform` only, and fully skipped under `prefers-reduced-motion`. The
design skill's GSAP grid-stagger recommendation was adopted in substance and
implemented in CSS instead — no animation dependency for one effect.

**Rejected from the skill, again.** It returned a "Scroll-Triggered
Storytelling" landing pattern with an intro hook and a climax CTA, plus
Caveat/Quicksand handwritten display faces. Wrong twice over: this is an
authenticated tool, not a story page, and a work tracker a manager reviews
should not be set in a handwriting font.
