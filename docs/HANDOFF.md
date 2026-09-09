# Worklog — handoff

Written 2026-09-09 for whoever picks this up next, human or agent.

---

## 1. What this product actually is

**A day-by-day visual log of work done, shareable by link.**

> I want a collection of work organised by calendar day, where I can post a
> Figma link, paste a screenshot, a video link or a website link — just to
> show what I did on that day. My boss, me, or anyone with the link can view,
> interact, or download it. Interactive, animated, good UI/UX, and scalable
> to a whole team so you can see what each person did on a given day.

That is the goal. Read it before adding anything.

### What it is not

An earlier pass built a request-to-delivery **approval system** from a long
PRD: submissions, designated reviewers, version-pinned approvals, brief
revisions with acknowledgement, guest review grants. That was faithful to the
document and wrong for the user. It is **decluttered out of the app** —
migrations `0002`–`0006` remain applied but inert, with no UI referencing
them (see `docs/decisions.md` D-25).

Do not reintroduce approvals, reviewers, or submission versioning unless the
user explicitly asks. If they ask for "sign-off", the smallest honest answer
is a boolean acknowledgement on an entry, not the old machinery.

---

## 2. What is built and verified

Verified means **it ran against the live database** (`pkbpdswdzedlytplykau`),
not that it compiles. 36/36 live assertions pass; see section 6.

### Data (`supabase/migrations/0007_worklog_sheet.sql`)

| Object | Purpose |
|---|---|
| `app.entries` | One thing done, on one day. `work_date` is a **DATE**. |
| `app.entry_assets` | The proof: `link` / `image` / `video` / `file`, discriminated by a CHECK. |
| `app.share_links` | Read-only public access, stored as a peppered HMAC of the token. |
| `work-assets` bucket | Private, 25 MB cap, image/PDF/text MIME allowlist. |

RPCs: `create_entry` (entry + assets in one transaction), `update_entry`,
`add_entry_asset`, `delete_entry_asset`, `delete_entry`,
`create_share_link`, `revoke_share_link`, `read_shared_sheet`,
`resolve_shared_asset`.

### App

| Route | What it does |
|---|---|
| `/login` | Email magic link. Server page wrapping a client form in Suspense. |
| `/auth/callback` | PKCE `?code=` exchange. |
| `/auth/confirm` | `?token_hash=` + `verifyOtp` — the documented SSR email pattern. |
| `/onboarding` | Workspace, timezone, editable brand labels. |
| `/sheet` | **The product.** Day-spine contact sheet, composer, share dialog. |
| `/s/[token]` | Public read-only sheet. |
| `/s/[token]/asset/[id]` | Streams shared files so revocation is immediate. |

Components in `src/components/sheet/`: `composer` (paste / drag / file
picker / link detection), `sheet-view` (day spine + framed strips),
`asset-tile`, `lightbox` (native `<dialog>`, arrow keys, download),
`share-dialog`.

### Design

Identity is a **darkroom contact sheet**: a sticky day rail, each day's work
as a strip of framed proofs with mono frame numbers. Archivo + JetBrains Mono
self-hosted via `next/font`. Graphite/paper neutrals, electric blue for
interaction, **amber used only for "today"**. Frames animate in with a
staggered `frame-in` keyframe, opacity+transform only, fully skipped under
`prefers-reduced-motion`. Full system: `design-system/worklog/MASTER.md`.

---

## 3. What is NOT built

Ordered roughly by how much the user will miss it.

| Gap | Notes |
|---|---|
| **Sheet filter controls** | `getSheet()` already accepts `q`, `tag`, `from`, `to`; only the "whose work" chips are wired to UI. |
| **Calendar views** | No month grid, no week strip. The sheet is a reverse-chronological day list. |
| **Team tracker grid** | "Who did what on which day" as a matrix (people × days). Only per-person filtering exists. |
| **Editing an entry in the UI** | `update_entry` RPC works and is tested; nothing calls it. |
| **Reordering assets** | `position` column exists; no drag or Move up/down controls. |
| **Video/PDF uploads** | Bucket allows PDF but the composer only accepts images. Video is link-only. |
| **Thumbnails** | Full-size images are served to the grid. Fine for a few, wasteful at scale. |
| **E2E and pgTAP for the sheet** | The old governance specs were deleted with their routes. **Nothing covers the new UI.** |
| **Rate limiting** | Share reads are unthrottled. Tokens are 256-bit so brute force is impractical, but a limiter is still wanted. |
| **Deployment** | No GitHub remote, no Vercel project, no separate production Supabase project. |

---

## 4. The plan ahead

Each step below is independently shippable and states how to know it is done.

### S1 — Regression safety (do this first)

Nothing tests the new UI. Every later step risks silent breakage until this
exists.

- Playwright spec: sign in via `admin/generate_link` → `/auth/confirm`, log an
  entry with a pasted image and a Figma link, assert it lands under today's
  date, open the lightbox, download, publish a share link, open it in a fresh
  incognito context, revoke it, assert the shared page 404s.
- pgTAP in `supabase/tests/database/`: `anon` has no privileges on the new
  tables; a non-member cannot read another workspace's entries; a future
  `work_date` is refused; `read_shared_sheet` returns identical output for
  wrong / revoked / expired tokens; `object_path` never appears in its output.
- Run at 375/768/1024/1440 and 320 with axe.

**Done when** `npm run verify` plus `npx playwright test` are green and the
pgTAP suite runs (needs CLI auth — see section 7).

### S2 — Sheet controls

- Search box (title + note), tag chips, date-range, and a "jump to month".
- All state in URL params, exactly as the old work list did — so a filtered
  sheet is shareable and Back restores it.
- Keep the two empty states distinct: **no entries yet** vs **no matches, and
  here are your filters**.

**Done when** a filtered URL survives a reload and Back restores scroll.

### S3 — Edit and curate

- Inline edit of title/note/date/tags via `update_entry`, passing
  `expected_version` and surfacing `P0409` as "this changed elsewhere".
- Add/remove assets on an existing entry (`add_entry_asset`,
  `delete_entry_asset`).
- Reorder with keyboard-operable Move up / Move down **as well as** drag —
  drag alone is not accessible.

### S4 — Calendar views

- Month grid: each cell a day, showing a count and up to three thumbnails;
  click a day to scroll the sheet to it.
- Week strip along the top of `/sheet` for quick navigation.
- **Critical:** `work_date` is a `DATE`. Never build a `Date` from it and read
  local parts — `new Date("2026-09-09")` is UTC midnight and renders as the
  8th west of Greenwich. `parseDay()` in `sheet-view.tsx` shows the correct
  pattern.

### S5 — Team tracker

- A matrix: people down, days across, cell = entry count with a hover
  preview. This is the "what did this employee do on this day" view.
- Reuse `read_shared_sheet`'s shape so the same view can be shared.
- Respect that everyone in a workspace can already read everyone's entries —
  that is deliberate (a shared tracker). If per-person privacy is ever
  wanted, it is an RLS change, not a UI one.

### S6 — Richer media

- Allow PDF in the composer (the bucket already permits it); render via a
  maintained viewer with active content disabled, plus a download fallback.
- Video: accept `video/mp4` uploads, or keep link-only and embed Loom/YouTube
  (already working).
- Generate thumbnails on upload — a small server route or a Supabase Edge
  Function — and serve those in the grid, full-size only in the lightbox.

### S7 — Ship it

- Push to a company GitHub repo, connect Vercel, protected `main`.
- **Create a separate production Supabase project.** The current one is
  development and holds test fixtures.
- Set `NEXT_PUBLIC_SITE_URL` to the real domain and add
  `https://<domain>/**` to Supabase → Authentication → URL Configuration.
- Vercel's Hobby plan is described as personal/non-commercial; pick a
  commercial plan for company use.
- Storage bytes are **not** in Supabase database backups. Add a separate
  object backup before real data accumulates.

### S8 — Polish

Persistent rate limiting on share reads and sign-in; unsaved-draft recovery
in the composer; a per-workspace storage quota indicator; 200% zoom pass.

---

## 5. Constraints another agent must not break

These were each learned by something failing. Ignore them and the same bug
returns.

1. **Never grant `USAGE` on schema `app` to `authenticated`.** The public API
   takes `text` and casts to enums internally. An `app.*` enum in an RPC
   signature makes the function uncallable with `42501 permission denied for
   schema app`, and it only fails when that parameter is actually supplied
   (D-26).
2. **Inside a `SECURITY DEFINER` function, a `security_invoker` view does not
   filter** — it resolves as the definer. Check visibility with the `authz`
   helpers. Getting this wrong produced an existence oracle: a non-member got
   `P0403` instead of `P0404`, which confirms a record exists.
3. **`work_date` is a calendar date, not an instant.** No timezone conversion,
   ever.
4. **Uploads go browser → Storage directly.** Vercel caps a function body at
   4.5 MB in both directions.
5. **`object_path` is never sent to a guest.** Files stream through
   `/s/[token]/asset/[id]` so revocation is immediate; a signed URL would
   stay valid past revocation.
6. **Wrong, revoked and expired tokens must return identical output.** Any
   difference makes a share URL an enumeration oracle.
7. **`FormData.get()` returns `null`, not `undefined`.** Read fields through
   the `field()` helper; a bare `null` into an optional Zod string fails
   validation for a field the form may not even render.
8. **Append-only tables reject DELETE.** `activity_events`,
   `work_item_revisions` and four others. A workspace cascade therefore needs
   `supabase/maintenance/remove-test-fixtures.sql`, which lifts the guards and
   restores them.
9. **Pinned deliberately:** `typescript@5.9.3` (not 7 —
   `typescript-eslint` excludes it), `eslint@9.39.5` (10 crashes
   `eslint-config-next@16.3.4`), `@types/node@^22`. `vite` must be installed
   explicitly as a `vitest` peer.
10. **Next 16:** it is `src/proxy.ts`, not `middleware.ts`. `typedRoutes` is
    on — dynamic hrefs use a `UrlObject`, not a cast. Vitest cannot render
    async Server Components; those need Playwright.

---

## 6. How to verify

```bash
npm run verify
```

Typecheck, lint, unit tests, production build.

```bash
node <scratch>/verify-sheet.mjs
```

36 live assertions against the real database: direct-to-storage upload,
cross-tenant upload refusal, entry + asset creation, future-date refusal,
tenant isolation on read/write/delete, share projection, `object_path`
withholding, and immediate revocation. Needs `SB_URL`, `SB_PUBLISHABLE`,
`SB_SECRET`, `SHARE_TOKEN_PEPPER`. **Port this into `tests/e2e/` in S1** —
right now it lives in a scratch directory and will be lost.

```bash
npm run dev
```

http://localhost:3000 — sign in, and the sheet is at `/sheet`.

---

## 7. Environment and open items

- **Project:** `pkbpdswdzedlytplykau`, ap-south-1, Postgres 17. Migrations
  `0001`–`0007` are applied.
- **Supabase CLI is logged into a different account** and cannot see this
  project, so `supabase db push` and `supabase test db` do not work. SQL has
  been applied by pasting `supabase/apply-*.sql` into the SQL Editor. Fixing
  this unlocks pgTAP; until then use
  `supabase/maintenance/prove-invariants.sql`, which runs the same assertions
  from the editor.
- **The `service_role` key was pasted into a chat transcript** and is a JWT
  valid to ~2036. It is currently in `.env.local` because the guest asset
  proxy needs it. **Rotate it** in Project Settings → API and update
  `.env.local`.
- **~16 throwaway test users** and their workspaces are in the project from
  automated verification. Clear with
  `supabase/maintenance/remove-test-fixtures.sql` (patterns:
  `worklog-verify-*`, `worklog-e2e-*`, `worklog-demo-*`, `worklog-sheet-*`).
- **`snapshot-20260909-131546/`** (2.6 MB, with a `figma-export.mjs`) appeared
  in the repo during this session and was **not created by this work**. It is
  untracked and unreferenced; identify it before committing.
- **Nothing is committed.** The whole build is an uncommitted working tree.

---

## 8. Where to read next

| File | Why |
|---|---|
| `docs/decisions.md` | 26 decisions with reasons, including every deviation. Read D-21 through D-26 first. |
| `design-system/worklog/MASTER.md` | Tokens with measured contrast, type scale, anti-patterns. |
| `docs/data-model.md` | Invariants and where each is enforced. Describes the governance schema; section 5 (RLS) still applies. |
| `docs/threat-model.md` | Actors, controls, accepted risks. |
| `CLAUDE.md` | Execution rules. Update the "preserve the four facts" section — it describes the old product. |
| `WORKLOG_PRD.md` | The original contract. **Historical**: it specifies the approval system, not this one. |
