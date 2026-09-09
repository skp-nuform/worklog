# Worklog — Design System (MASTER)

Global source of truth. Page-specific deviations live in `pages/` and override
this file only for the sections they name.

Generated with the `ui-ux-pro-max` skill (v2.13.0, commit `4aad058` — see
`docs/skill-lock.md`), then **filtered for an internal work-management tool**.
Where the skill's output conflicted with the PRD, the PRD won; every such
override is recorded in "Skill output: accepted and rejected" below.

Every contrast figure here was **measured**, not asserted. See "Measured
contrast" for the full matrix and the token that changed as a result.

---

## 1. Product frame

Worklog is a **list-first internal application**, not a marketing site. The
default view is a dense, scannable work list. The interface should feel calm,
precise, and quiet enough to use for hours.

Four distinctions the visual language must never blur, because the product's
integrity depends on them:

| Concept | Meaning | Visual treatment |
|---|---|---|
| A recorded claim | Someone typed what they believe was asked | Neutral text plus an explicit "Unconfirmed understanding" label |
| A confirmed request | The requester acknowledged a specific revision | Confirmed badge naming the revision and actor |
| A submitted delivery | Work was submitted for review | "Submitted — awaiting review": neutral, never green |
| An approved version | A non-submitting reviewer approved that submission | Success badge bound to a version number |

A status colour alone is never the whole message: every status carries a text
label, and success styling is reserved for states that are genuinely approved.

---

## 2. Foundations

### 2.1 Layout

| Attribute | Value |
|---|---|
| Desktop sidebar | 232px fixed |
| Header | 64px fixed |
| Main padding | 24px below 1024px, 32px at 1024px and above |
| Content max-width | none for lists and tables; 72ch for prose |
| Breakpoints tested | 375, 768, 1024, 1440 px, plus 320px reflow |

Lists and tables expand to the available width. Do **not** constrain the work
list to a narrow centred column.

**Sticky-header focus rule** (WCAG 2.2 AA, 2.4.11 Focus Not Obscured —
Minimum): the 64px header would otherwise cover a focused row during keyboard
scrolling. Set `scroll-padding-top` to the header height on the scroll
container. This is an **AA** requirement; the fully-unobscured variant is AAA
and is not claimed here.

### 2.2 Spacing

4px base scale, and only these steps: `4, 8, 12, 16, 24, 32, 48`.

### 2.3 Radii and elevation

| Element | Radius |
|---|---|
| Controls (button, input, badge) | 8px |
| Cards, panels, dialogs | 12px |
| Large surfaces and sheets | 16px |

Not everything is a pill. Full rounding is reserved for avatars and dot
indicators.

Two shadow levels only:

- `--shadow-sm` — resting cards, subtle separation from canvas.
- `--shadow-md` — overlays: dialog, popover, dropdown, detail panel.

Anything heavier is a bug. Prefer a 1px border over a shadow for structure.

### 2.4 Typography

System UI stack. One family. No proprietary Apple font files are bundled;
Inter may be self-hosted later only with a verified licence.

    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
                 "Liberation Mono", monospace;

| Role | Size / line-height / weight |
|---|---|
| Page title | 28px / 1.2 / 600 (32px at 1024px and above) |
| Section heading | 18px / 1.35 / 600 |
| Body | 15px / 1.55 / 400 |
| Body strong | 15px / 1.55 / 500 |
| Secondary and meta | 13px / 1.45 / 400 |
| Micro (badge, tag) | 12px / 1.35 / 500 |
| Work reference (WL-0012) | 13px / 1.4 / 500, mono, tabular |

Body floor is 13px and only for genuine metadata; never below 12px anywhere.
Line height stays **unitless** so user spacing overrides reflow correctly.
Prose uses `inline-size: min(100%, 72ch)` with auto height — never a fixed
height with `overflow: hidden`, which clips text at 200% zoom.

### 2.5 Icons

Lucide only. 16px inline, 20px standalone, `currentColor`, stroke width 2.
Icons **supplement** labels. An icon-only control must carry an `aria-label`,
and destructive or ambiguous actions always show a text label. No emoji as
icons.

### 2.6 Motion

120–180ms for state transitions (hover, focus, selection, disclosure); 180ms
for overlay enter, 120ms for exit. Easing `cubic-bezier(0.2, 0, 0.38, 1)`.

Motion is never required to understand content. No scroll-reveal, no parallax,
no animated backgrounds. Animate `opacity` and `transform` only — never
`width`, `height`, `top`, or `left`.

Reduced motion is honoured globally by neutralising animation and transition
durations and disabling smooth scrolling.

### 2.7 Density

One comfortable default: work rows are 44px minimum height on pointer, 48px on
touch. No density switcher in V1 — the PRD requires evidence of need first.

---

## 3. Colour tokens

Authored as OKLCH semantic variables consumed through Tailwind v4
`@theme inline`. **No raw hex in components**; every surface token is paired
with its foreground token.

### 3.1 Light

| Token | Hex (source) | OKLCH |
|---|---|---|
| `--canvas` | `#F8FAFC` | `oklch(0.9842 0.0034 247.86)` |
| `--surface` | `#FFFFFF` | `oklch(1 0 0)` |
| `--elevated` | `#F1F5F9` | `oklch(0.9683 0.0069 247.90)` |
| `--text` | `#0F172A` | `oklch(0.2077 0.0398 265.75)` |
| `--text-muted` | `#475569` | `oklch(0.4455 0.0374 257.28)` |
| `--border` (decorative) | `#E2E8F0` | `oklch(0.9288 0.0126 255.51)` |
| `--boundary` (interactive) | `#64748B` | `oklch(0.5544 0.0407 257.42)` |
| `--accent` | `#2563EB` | `oklch(0.5461 0.2152 262.88)` |
| `--accent-foreground` | `#FFFFFF` | `oklch(1 0 0)` |

### 3.2 Dark

| Token | Hex (source) | OKLCH |
|---|---|---|
| `--canvas` | `#0B0F14` | `oklch(0.1665 0.0124 254.17)` |
| `--surface` | `#111827` | `oklch(0.2101 0.0318 264.66)` |
| `--elevated` | `#1E293B` | `oklch(0.2795 0.0368 260.03)` |
| `--text` | `#F8FAFC` | `oklch(0.9842 0.0034 247.86)` |
| `--text-muted` | `#94A3B8` | `oklch(0.7107 0.0351 256.79)` |
| `--border` (decorative) | `#334155` | `oklch(0.3717 0.0392 257.29)` |
| `--boundary` (interactive) | **`#748499`** (changed) | `oklch(0.6079 0.0371 255.29)` |
| `--accent` | `#60A5FA` | `oklch(0.7137 0.1434 254.62)` |
| `--accent-foreground` | `#0B0F14` | `oklch(0.1665 0.0124 254.17)` |

### 3.3 Measured contrast

Computed with the WCAG 2.2 relative-luminance formula. Body text requires
4.5:1 (1.4.3); non-text UI boundaries require 3:1 (1.4.11). Purely decorative
borders carry no contrast requirement and are listed as exempt — which is
exactly why `--border` and `--boundary` are **separate tokens** rather than
one shared value.

**Light**

| Pair | Ratio | Needs | Result |
|---|---|---|---|
| text on canvas | 17.06:1 | 4.5 | pass |
| text on surface | 17.85:1 | 4.5 | pass |
| text on elevated | 16.30:1 | 4.5 | pass |
| text-muted on canvas | 7.24:1 | 4.5 | pass |
| text-muted on surface | 7.58:1 | 4.5 | pass |
| text-muted on elevated | 6.92:1 | 4.5 | pass |
| boundary on canvas | 4.55:1 | 3.0 | pass |
| boundary on surface | 4.76:1 | 3.0 | pass |
| boundary on elevated | 4.34:1 | 3.0 | pass |
| accent as link text on elevated | 4.72:1 | 4.5 | pass (thin — do not darken surfaces further) |
| accent-foreground on accent | 5.17:1 | 4.5 | pass |
| border on any surface | 1.13–1.23:1 | — | exempt (decorative) |

**Dark**

| Pair | Ratio | Needs | Result |
|---|---|---|---|
| text on canvas | 18.37:1 | 4.5 | pass |
| text on surface | 16.96:1 | 4.5 | pass |
| text on elevated | 13.98:1 | 4.5 | pass |
| text-muted on canvas | 7.50:1 | 4.5 | pass |
| text-muted on surface | 6.92:1 | 4.5 | pass |
| text-muted on elevated | 5.71:1 | 4.5 | pass |
| boundary `#748499` on canvas | 5.04:1 | 3.0 | pass |
| boundary `#748499` on surface | 4.65:1 | 3.0 | pass |
| boundary `#748499` on elevated | 3.83:1 | 3.0 | pass |
| accent as link text on elevated | 5.75:1 | 4.5 | pass |
| accent-foreground on accent | 7.56:1 | 4.5 | pass |
| border on any surface | 1.41–1.86:1 | — | exempt (decorative) |

> **Change forced by measurement.** The PRD proposed `#64748B` as the
> interactive boundary in *both* themes. Measured against the dark elevated
> surface it reaches only **3.07:1** — technically above 3:1, but with no
> margin for any future surface adjustment. Dark mode therefore uses
> **`#748499`** (3.83:1 on elevated, 5.04:1 on canvas). Light mode keeps
> `#64748B`, whose worst case is 4.34:1.

### 3.4 Status colours

Status is communicated by **label first**, colour second, and never by colour
alone. Approved is the only state permitted to read as success.

| Status | Light fg / bg | Dark fg / bg | Reads as |
|---|---|---|---|
| Planned | `#475569` / `#F1F5F9` | `#94A3B8` / `#1E293B` | neutral |
| In progress | `#1E4FC4` / `#EFF4FE` | `#93BBFD` / `#17233A` | active, not done |
| Submitted | `#8A5300` / `#FDF6E7` | `#F0C070` / `#2A2113` | awaiting — never success |
| Approved | `#116043` / `#EAF7F0` | `#6FD3A3` / `#10271D` | success, version-bound |
| Blocked | `#A32020` / `#FDEEEE` | `#F49C9C` / `#2E1616` | needs attention |
| Paused | `#475569` / `#F1F5F9` | `#94A3B8` / `#1E293B` | neutral, reversible |
| Cancelled | `#475569` / `#F8FAFC` | `#8494A8` / `#161C26` | closed, muted |
| Idea | `#5B4396` / `#F4F1FD` | `#BEA9F5` / `#231C36` | pre-work |

Measured badge text-on-fill contrast (needs 4.5:1, since badge labels are
12–13px):

| Status | Light | Dark |
|---|---|---|
| Planned | 6.92:1 | 5.71:1 |
| In progress | 6.41:1 | 8.05:1 |
| Submitted | 5.88:1 | 9.42:1 |
| Approved | 6.86:1 | 8.66:1 |
| Blocked | 6.69:1 | 8.11:1 |
| Cancelled | 7.24:1 | 5.52:1 |
| Idea | 7.01:1 | 7.89:1 |

All pass, worst case 5.52:1. The badge *fill* against the page surface is
deliberately low-contrast (1.00–1.09:1) and carries no requirement: the fill
is decorative, and the meaning is carried by the text label. This is the
reason a status is never communicated by colour alone.

---

## 4. Components

Built on shadcn/ui primitives (Radix base) with Worklog spacing, type scale,
density, and tokens applied. **Shipping untouched shadcn defaults is not a
design** — every primitive is reviewed against this file before use.

| Component | Notes |
|---|---|
| App shell | 232px sidebar, 64px header, skip link, `main` landmark, `scroll-padding-top` |
| Page header | Breadcrumb, title, primary action. No hero |
| Work row | Reference, title, status, project/brand, updated-at; 44px min height; the whole row is one link |
| Work card | Mobile equivalent of the row |
| Filter bar | Filters plus an explicit "Clear filters"; state mirrored in the URL |
| Status badge | Label plus colour, and shape where useful; never colour-only |
| Request panel | Outcome, acceptance criteria, requester, confirmation state |
| Revision diff | Before and after, not colour-only: uses `ins`/`del` semantics |
| Submission block | Version number, delivery note, artifacts, submitted time |
| Artifact card and viewer | Provider icon, label, and an always-present "Open link" fallback |
| Threaded comment | Author, server time, audience label, edited and removed tombstones |
| Activity event | Actor, verb, target, absolute time available on demand |
| Share dialog | Audience, scope, expiry, and a projection preview before activation |
| Permission preview | Exactly what a guest will see |
| Empty state | Explains the next action; visually distinct from no-results |
| Form error | Inline, `aria-describedby`, plus a focusable summary (section 5) |
| Toast | Confirmations only; never the sole record of an outcome |
| Confirm dialog | Plain-language consequence; focus trapped and restored |

---

## 5. Forms and errors

Adopted from the skill's UX guidelines — all of these were rated High or
Critical severity, and all are accepted:

- Every input has a real `label for`. **Never** placeholder-as-label.
- Each invalid field shows an inline message below it, wired with
  `aria-describedby`. A red border alone is not an error message.
- On failed submit, render a **focusable error summary** at the top of the
  form: `role="alert"`, `tabindex="-1"`, a heading, and links to each invalid
  field. Move focus to it. Keep the inline errors as well — the summary
  complements them, it does not replace them.
- Validate on blur, not only on submit. Never move focus on every blur.
- Required fields are marked explicitly; optional detail hides behind an
  *Add details* progressive disclosure.
- Submission shows `Saving…` and then an explicit success or a specific
  failure. **Never** a success toast before the server acknowledges.

## 6. Interaction and accessibility contract

Target **WCAG 2.2 AA**, verified by behaviour. Installing a skill or a
component library establishes nothing.

- Every primary journey is keyboard-operable, with a visible focus ring on all
  interactive controls including inside dialogs. Never `outline: none` without
  an equivalent replacement.
- Touch targets around 44×44px. This is a **product target**; WCAG 2.2's
  target-size minimum is 24×24 with exceptions, which is a different claim and
  is not conflated with this one.
- Dialogs trap focus and restore it to the invoking control on close.
- `Cmd/Ctrl+K` opens the command palette, `Cmd/Ctrl+Enter` submits, `Escape`
  closes a dismissible overlay. Single-key shortcuts are disabled inside
  editable fields and are never the only path to an action.
- 200% zoom and 320px reflow both stay readable, with no whole-page horizontal
  scroll. Genuinely two-dimensional content (wide tables, diagrams) scrolls
  inside its own `overflow-x: auto` container.
- Relative timestamps ("2 days ago") expose the absolute value to keyboard and
  touch users, not only on pointer hover.
- Essential controls are never hover-only.

## 7. Anti-patterns — do not ship

- A hero section, landing-page layout, or marketing CTA anywhere in the app.
- A wall of decorative KPI cards on `/overview`.
- Neon gradients, glassmorphism, floating blobs, animated backgrounds.
- Charts added for decoration rather than to answer a question someone asked.
- A different visual system per screen.
- Colour as the only carrier of status meaning.
- Emoji used as icons.
- Success styling on a merely *submitted* delivery.
- Fake or placeholder data presented as real work.
- A success toast fired before the server confirms.
- Density or settings panels for features that do not exist yet.
- Dead buttons for deferred features — **hide** them instead.

## 8. Skill output: accepted and rejected

Recorded so the deviation is auditable rather than silent.

**Accepted**

- Style family **Minimalism / Swiss** — clean, spacious, grid-based, high
  contrast. The skill rates it best for enterprise apps, dashboards, and
  professional tools, which matches this product.
- Accessibility requirements: 4.5:1 text contrast, keyboard operability,
  visible focus, reduced-motion support.
- The Forms and Accessibility guidelines in section 5, verbatim in substance,
  including the focusable error summary and `aria-describedby` wiring.
- WCAG 2.2 Focus Not Obscured (Minimum) with the `scroll-padding-top` remedy,
  and its warning not to present the AAA variant as an AA requirement.
- Text reflow: fluid sizing, content-driven height, unitless line height.
- shadcn and Tailwind v4 theming: semantic OKLCH variables under `:root` and
  `.dark`, exposed via `@theme inline`; paired surface/foreground tokens; no
  hardcoded palette colours in components.
- Deep linking, predictable Back, and a visible active nav state.
- Pre-delivery checks: no emoji icons, visible focus, reduced motion,
  responsive at 375/768/1024/1440.

**Rejected**

- **Pattern "Real-Time / Operations Landing"** — hero with live preview, key
  metrics band, "How it works", and a "Start trial / Contact" CTA. This is a
  marketing landing page. The PRD explicitly forbids it, and Worklog's entry
  point is an authenticated list view.
- **Palette** — indigo `#6366F1` primary on violet `#F5F3FF` canvas with a
  green `#059669` accent. The PRD specifies its own slate and blue token
  table, and the skill's `on-primary: #000000` over `#6366F1` fails 4.5:1 for
  body text.
- **Typography** — Outfit / Work Sans via Google Fonts. Two extra display
  families and a third-party font fetch on every page load, for a dense
  internal tool that should use the system stack.
- **Motion** — GSAP scroll-reveal at 300–400ms with `ScrollTrigger`. Adds an
  animation dependency for decorative motion, while the PRD caps state
  transitions at 120–180ms and requires that no motion be needed to understand
  content.
- **`cursor-pointer` on all clickable elements.** Native buttons keep the
  default cursor; `cursor: pointer` applies to links and to non-button
  clickable rows only.
- **Sitewide `scroll-behavior: smooth`** — reduced-motion users must not be
  scroll-animated, and it is unhelpful in a list application.

Skill results are recommendations. They do not override the PRD, the security
requirements, or this file.
