# Acceptance results — AC-01 to AC-34

Every row carries **real evidence or a named blocker**. Nothing is marked
passing on the strength of a mock, a fixture, or a design intention. Mocked
browser data alone cannot prove authorization, so authorization rows require a
real database and real test identities.

Last updated: 2026-09-09. Live view:
https://claude.ai/code/artifact/de84bd9b-0df4-46fd-b4a8-b0721abd72b3

## Legend

| Status | Meaning |
|---|---|
| **PASS** | The test ran and passed. Evidence names the command or the recorded check. |
| **PROGRESS** | Partially satisfied; the remainder is named. |
| **BLOCKED** | Cannot be tested yet. The exact missing prerequisite is named. |
| **TODO** | Not started; the milestone that will deliver it is named. |

## Summary

| Status | Count |
|---|---|
| PASS | 0 |
| PROGRESS | 1 |
| BLOCKED | 7 |
| TODO | 26 |

The single active blocker is **Docker Desktop is not installed**, so the local
Supabase stack cannot start. It gates every database and authorization test.

---

| ID | Scenario | Status | Milestone | Evidence / blocker |
|---|---|---|---|---|
| AC-01 | Capture with only title and summary | BLOCKED | M1 | Needs local Supabase to prove the record persists with a trusted author and time across a reload. Docker Desktop not installed. |
| AC-02 | User reports a past request date | BLOCKED | M1 | Reported vs recorded columns are designed as distinct fields; needs a database to verify both survive a round trip. |
| AC-03 | Requester has not acknowledged | TODO | M2 | Acknowledgement model designed (`docs/data-model.md` 3.5). No UI yet. |
| AC-04 | Scope or deadline changes | TODO | M2 | Revision + digest-bound acknowledgement designed. |
| AC-05 | Idea becomes assigned work | TODO | M2 | Same base record with an idea-specific state; no implementation yet. |
| AC-06 | Submit Figma link, GitHub link and PDF | TODO | M2 | Submission snapshot and artifact model designed. |
| AC-07 | Reviewer does nothing | TODO | M3 | Status stays Submitted by construction (no auto-transition exists). Untested. |
| AC-08 | Request changes | TODO | M3 | Append-only `review_decisions` designed. |
| AC-09 | Approve, reopen, resubmit | TODO | M3 | Guaranteed by having **no** cached `approved_submission_id` (`data-model.md` 3.3). Untested. |
| AC-10 | Submitter tries to approve own work | BLOCKED | M1 | `CHECK (decided_by <> submission_submitted_by)` plus composite-FK submitter pinning is designed and specified; the pgTAP test — including the admin-submitter case — needs a running database. |
| AC-11 | Two tabs edit concurrently | BLOCKED | M1 | `expected_version` CAS plus bump trigger designed; conflict test needs a running database. |
| AC-12 | Network retry or double click | TODO | M3 | Idempotency-key primary key with payload-digest mismatch → `P0409` designed. |
| AC-13 | Internal comment on externally shared item | TODO | M4 | Guest projection excludes internal rows structurally; the whole-document substring assertion is specified. |
| AC-14 | Anonymous guest comments | TODO | M4 | Verified-email-sign-in flow specified in `ux-flows.md` and `pages/guest-share.md`. |
| AC-15 | Cross-project / cross-workspace ID substitution | BLOCKED | M1 | Composite-FK tenant pinning designed, plus a structural test that fails if any `workspace_id` table lacks one. Needs a running database. |
| AC-16 | Share links to one project | TODO | M4 | Allowlist-defaults-to-deny registry designed; guest page forbids counts and member enumeration. |
| AC-17 | Project gains another work item | TODO | M4 | Shares enumerate explicit items; no implicit inclusion by design. |
| AC-18 | Shared delivery gets internal updates | TODO | M4 | Pinned publication with explicit republish designed. |
| AC-19 | Share revoked or expired | TODO | M4 | Proxied assets under ~10 MB for immediate revocation; 60s signed-URL bound for large files, disclosed in the UI (`decisions.md` D-10). |
| AC-20 | Removed member reuses old session | BLOCKED | M1 | Live-membership RLS (never JWT claims) designed; the stale-admin-claim test needs a running database. |
| AC-21 | 25 MB authorized upload | TODO | M2 | Direct-to-storage path required by Vercel's 4.5 MB function payload cap (`decisions.md` D-09). |
| AC-22 | Oversized, wrong-type or interrupted upload | TODO | M2 | Server-side finalize validating actual object size and detected MIME designed. |
| AC-23 | External Figma resource is private | TODO | M2 | Always-present "Open link" fallback specified; no URL crawling in V1. |
| AC-24 | Mobile guest reviews a collection | TODO | M4 | 375px requirements specified in `pages/guest-share.md`. |
| AC-25 | Keyboard-only primary journeys | TODO | M1 (partial), M5 (full) | Global keyboard model specified in `ux-flows.md`. No journeys exist to walk yet. |
| AC-26 | Light/dark, zoom, reduced motion | PROGRESS | M5 | **Done:** full light/dark/system token set implemented; contrast **measured** for every token and status pair, worst case 5.52:1 for status text, 3.83:1 for the dark interactive boundary (`MASTER.md` 3.3–3.4); reduced-motion block implemented. **Remaining:** 200% zoom and 320px reflow cannot be checked until screens exist. |
| AC-27 | Empty, loading, error, no-results states | TODO | M1 | All eleven required states enumerated in `ux-flows.md`. |
| AC-28 | Search and timeline across midnight | TODO | M2 | UTC `timestamptz` storage with viewer-timezone rendering, and date-only deadlines stored distinctly. |
| AC-29 | Archive and restore | TODO | M4 | Archive is separate from work status by design. |
| AC-30 | Authorized export | TODO | M4 | Chunked delivery required; guest export disabled. |
| AC-31 | Backup recovery exercise | TODO | M5 | Confirmed from Supabase docs that database backups exclude Storage object bytes, so Storage needs its own backup path. Recorded in README. |
| AC-32 | Refresh and redeploy | BLOCKED | M1 | Requires persisted data. Docker Desktop not installed. |
| AC-33 | Production build and secret scan | PROGRESS | M0 → M5 | **Done and verified:** `tsc --noEmit` exits 0; `eslint .` exits 0; `next build` compiles successfully with the Proxy registered and no warnings. **Remaining:** no test suite exists yet, and no dependency-vulnerability or secret scan has been run. |
| AC-34 | Performance fixture | TODO | M5 | Fixture defined (60 members, 100 projects, 10k work items, 50k comments, 100k events). Not built. |

---

## Verified commands

These actually ran, on 2026-09-08 / 2026-09-09:

```bash
npx tsc --noEmit
```
Exit 0.

```bash
npx eslint .
```
Exit 0 on `eslint@9.39.5`. **Note:** exit 2 with a `TypeError` on
`eslint@10.10.0` — `eslint-config-next@16.3.4` bundles an
`eslint-plugin-react` incompatible with ESLint 10 (`docs/decisions.md` D-03).

```bash
npm run build
```
Compiled successfully. Routes `/` and `/_not-found` prerendered static; Proxy
registered. No warnings after pinning `turbopack.root`.

## Not yet run

```bash
npm run test
```
No test files exist yet.

```bash
npm run db:reset
```
```bash
npm run db:test
```
```bash
npm run test:e2e
```
All blocked or empty: the first two need Docker Desktop; the Playwright suite
has no journeys to run until M1 screens exist.
