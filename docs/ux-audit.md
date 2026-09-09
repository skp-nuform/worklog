# UX and accessibility audit

**Status: partial.** Only the design-system layer exists so far, so only the
design-system layer has been audited. The full visual and accessibility review
runs in M5 against real screens; this file will grow rather than be replaced.

A zero-violation automated scan is **not** a complete accessibility audit, and
is never reported as one here.

Last updated: 2026-09-09.

---

## 1. What has actually been audited

### 1.1 Colour contrast — measured, all pairs

Computed with the WCAG 2.2 relative-luminance formula over every token pair the
design system defines, in both themes. Body text threshold 4.5:1 (SC 1.4.3);
non-text UI boundaries 3:1 (SC 1.4.11).

**Result: all pairs pass.** Full matrix in
`design-system/worklog/MASTER.md` sections 3.3 and 3.4.

Worst cases, worth knowing before anyone adjusts a surface:

| Pair | Ratio | Threshold | Note |
|---|---|---|---|
| Dark interactive boundary on dark elevated | 3.83:1 | 3.0 | After the fix below |
| Light accent as link text on light elevated | 4.72:1 | 4.5 | Thin. Do not darken light surfaces further without re-measuring |
| Dark `cancelled` status text on its fill | 5.52:1 | 4.5 | Lowest of the 14 status pairs |

### 1.2 Finding A-01 — dark interactive boundary had no margin (**fixed**)

The PRD proposed `#64748B` as the interactive boundary in both themes.
Measured against the dark elevated surface `#1E293B` it gives **3.07:1** —
above the 3:1 minimum, but with effectively no headroom, so any future surface
adjustment would silently drop it below conformance.

**Fix applied.** Dark mode uses `#748499` (3.83:1 on elevated, 4.65:1 on
surface, 5.04:1 on canvas). Light mode keeps the PRD value, whose worst case is
4.34:1. Recorded as `docs/decisions.md` D-15.

### 1.3 Finding A-02 — decorative and interactive borders were one token (**fixed**)

A single border token would have forced either a contrast failure on control
edges or a heavy, noisy hairline everywhere.

**Fix applied.** `--border` (decorative, contrast-exempt, 1.13–1.86:1) and
`--boundary` (interactive control edges, must hold 3:1) are separate tokens.
The shadcn compatibility layer maps `--input` to `--boundary`, not `--border`,
so form control edges inherit the accessible value.

### 1.4 Finding A-03 — shadcn Button failed the touch target (**fixed**)

The generated primitive shipped `h-8` (32px) as its default size with a 12px
radius.

**Fix applied.** Default raised to 40px, `lg` to 44px, and every size gains
`pointer-coarse:h-11` so touch devices get ≥44px without inflating dense
desktop toolbars. Radius corrected to the 8px control value. Recorded as
`docs/decisions.md` D-16.

Note the honest framing carried into `MASTER.md`: ~44×44px is a **product
target**. WCAG 2.2's target-size minimum (SC 2.5.8) is 24×24 with exceptions,
which is a different and weaker claim, and the two are not conflated.

### 1.5 Finding A-04 — sticky header would obscure focus (**fixed by design**)

The 64px sticky header would cover a focused row scrolled into view, failing
WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum), an **AA** criterion.

**Fix applied.** `scroll-padding-top: var(--header-height)` on `html`.

The skill's guidance was explicit that the fully-unobscured variant is AAA
(SC 2.4.12) and must not be presented as an AA requirement. That distinction is
preserved in `MASTER.md` and is not overclaimed.

### 1.6 Finding A-05 — system dark would desynchronise from `dark:` (**fixed**)

Tokens resolve system dark via `prefers-color-scheme`, but shadcn's `dark:`
utilities key off the `.dark` class only. Under system-dark-with-no-class the
tokens would be dark while any `dark:` utility stayed light.

**Fix applied.** Tokens are declared for all three states, and the theme
provider (M1) will always resolve system preference to an explicit class so the
two mechanisms cannot disagree. Until that lands, `dark:` utilities must not be
relied on — noted in `src/app/layout.tsx`. Recorded as D-17.

### 1.7 Reduced motion

Implemented globally in `globals.css`: animation and transition durations
neutralised and smooth scrolling disabled under
`prefers-reduced-motion: reduce`. The skill's GSAP scroll-reveal recommendation
was rejected outright, so there is no decorative motion to suppress in the
first place.

### 1.8 Text reflow provisions

In place at the token and base-layer level, not yet verified against screens:
unitless line height, `inline-size: min(100%, 72ch)` with auto height for
prose, `-webkit-text-size-adjust: 100%`, and a documented rule that wide
content scrolls inside its own `overflow-x: auto` container. No fixed-height
text boxes exist.

---

## 2. Not yet audited — requires real screens

These cannot be checked before M1 delivers the app shell and capture flow.
Listed so the gap is explicit rather than implied:

| Item | Criterion | Runs in |
|---|---|---|
| 200% text zoom | SC 1.4.4 | M1 partial, M5 full |
| 320px reflow | SC 1.4.10 | M1 partial, M5 full |
| Keyboard-only primary journeys | SC 2.1.1 | M1 partial, M5 full |
| Focus order and visible focus on every real control | SC 2.4.3, 2.4.7 | M1 |
| Dialog focus trap and restoration | SC 2.4.3 | M1 |
| Error summary and inline error wiring in a real form | SC 3.3.1, 3.3.3 | M1 |
| Heading structure and landmarks | SC 1.3.1, 2.4.1 | M1 |
| Relative timestamps exposing absolute values to keyboard and touch | SC 1.3.1 | M1 |
| Status conveyed without colour, on real badges | SC 1.4.1 | M1 |
| Revision diff without colour dependence | SC 1.4.1 | M2 |
| Guest share page at 375px | SC 1.4.10 | M4 |
| Screen-reader pass over review actions and audience labels | — | M5 |
| axe-core scan on every primary screen | — | M1 onward |

---

## 3. Known limitations

- Contrast was computed from token values. It has **not** been verified on a
  real display with real anti-aliasing, or against a browser's rendered output.
- No assistive technology has been used yet. No screen reader, no voice
  control, no switch access.
- No testing with users who rely on assistive technology. Automated checks and
  a careful implementer are not a substitute for that, and nothing here should
  be read as claiming conformance — only that the specified criteria are being
  designed and tested against.

---

## 4. Method

Contrast and OKLCH conversions were computed with a short script over the token
set (sRGB → linear → relative luminance → ratio; sRGB → linear → LMS → OKLab →
OKLCH). Every figure in `MASTER.md` sections 3.3–3.4 is script output, not an
estimate. Automated per-screen checks use `@axe-core/playwright` at 375, 768,
1024, and 1440 px plus the 320px reflow viewport, configured in
`playwright.config.ts`.
