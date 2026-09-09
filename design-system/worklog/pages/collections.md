# Page exception — Collections (`/collections`, `/collections/[id]`)

Overrides MASTER only where stated.

## Why this page needs an exception

Collections are the one place in Worklog that is *presentational* — a curated
body of work, sometimes shown to someone outside the company. It earns more
visual generosity than the work list. It does **not** earn a landing page, and
it must never blur the line between a presentation excerpt and the
authoritative request record.

## Deviations from MASTER

| Item | MASTER | Here | Why |
|---|---|---|---|
| Density | comfortable list rows | gallery: 3 columns ≥1024px, 2 ≥768px, 1 below; 24px gap | Curated work is compared side by side |
| Card radius | 12px | 12px kept, but cards carry `--shadow-sm` and a hairline | These *are* objects, unlike work-detail blocks |
| Intro prose | 72ch | 68ch, 16px body | Slightly more generous for reading |
| Title | 28px | 32px on the collection page | It is the page's subject, not a row label |

Still forbidden, exactly as in MASTER: hero, KPI band, gradient, glass,
animated background, decorative chart.

## Two display modes

**List** — the default. One row per item: title, work type, status, delivery
date, excerpt. Dense and honest.

**Gallery** — opt-in per collection. Cards with an optional cover image.

## Card fallback when there is no image

Never invent a screenshot. A card without a cover shows, in this order: work
type eyebrow, title, presentation excerpt (3 lines, clamped with a visible
"more" affordance rather than a hard clip), then metadata. The fallback is a
designed state, not a grey box.

## Excerpt vs request — the rule that matters

A presentation excerpt is authored for an audience. The original request is a
record. On the collection page only the excerpt appears, and it is labelled as
a presentation excerpt wherever both could be confused. The excerpt never
overwrites, and never renders as, the request summary.

## Ordering

`Move up` / `Move down` buttons are always present and keyboard-operable, with
`aria-label`s naming the item ("Move Website redesign up"). Drag is an
additional affordance, never the only one. After a move, focus stays on the
moved item's button and the new position is announced via a live region.

## Pinned versions

Each item shows which submission version it presents. When newer internal work
exists, the collection **manager** sees a **Newer version available** chip on
that item — and the guest projection does not change until an explicit
preview-and-republish. A contributor may deliberately share a current draft,
clearly labelled as a draft, and that share is still pinned until republished.

## Archived and unavailable items

An item whose record was archived or whose access was withdrawn shows an
explicit unavailable indicator in the internal view, and is **omitted entirely**
from the guest projection. It never renders as an empty or broken card
externally.

## Empty states

- **No collections yet** — explains what a collection is for, offers
  **New collection**.
- **Empty collection** — offers **Add work**, and says nothing is shared yet.
- Distinct from a filtered no-results state, which preserves filters.
