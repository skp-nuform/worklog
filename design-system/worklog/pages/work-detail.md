# Page exception — Work detail (`/work/[id]`)

Overrides MASTER only where stated. Everything else inherits.

## Why this page needs an exception

This is the page that carries the product's integrity. It must let a reviewer
answer "what was asked, and what was delivered?" without reading a
chronological feed. MASTER's comfortable list density is wrong here: this page
is a document with an action bar, not a row.

## Structure (fixed order — not negotiable)

```
Breadcrumb / WL-0012                              Share   ⋯ More
Title
Status · Project · Brand

CURRENT REQUEST
  Outcome, acceptance criteria
  Requester + confirmation state
  Original request / revision history link

LATEST DELIVERY
  Submission version, delivery note, artifacts, submitted time
  [Approve this version]  [Request changes]      ← authorized reviewer only

Updates and discussion
  Internal / Shared thread selector               ← only when permitted

Activity history                                  ← collapsed initially
```

**Current request and latest delivery sit above history. Always.** The whole
point of the page is that the current state is reachable without scrolling
through events.

## Deviations from MASTER

| Item | MASTER | Here | Why |
|---|---|---|---|
| Content width | unbounded for lists | 72ch for brief and note prose; artifacts and actions full width | This is reading material |
| Section labels | 18px section heading | 11px mono uppercase eyebrow with letter-spacing | Three peer sections need labelling without competing with the title |
| Elevation | cards get `--shadow-sm` | request and delivery blocks are **bordered, unshadowed** | Not everything is a card. Shadow is reserved for the detail panel overlay itself |
| Activity events | — | 13px, mono actor, no card, hairline separators only | A dense log, not a feed of cards |

## Right rail / details disclosure

On ≥1280px, secondary metadata (type, tags, priority, deadline, reviewer,
reported vs recorded dates) sits in a 280px right rail. Below that it collapses
into an inline **Details** disclosure directly under the status line. The rail
is never the only home for an essential control.

## Status treatment

The status badge names the state in words, always. Two rules specific to this
page:

- **Submitted** uses the amber `submitted` tokens and reads
  "Submitted — awaiting review". It must never be styled as success.
- **Approved** names its version: "Approved · v2". A bare "Approved" is a bug,
  because approval is a fact about one submission.

## Reviewer actions

Present only when the viewer is an authorized designated reviewer **and** not
the submitter. When the viewer is the submitter the controls are **absent**,
not disabled with a tooltip — a disabled approve button implies the action is
merely unavailable rather than forbidden. The database refuses it regardless.

When a newer submission exists, an inline notice above the actions says so and
names the newer version.

## Confirmation state

Directly beside the requester, never in the rail:

- **Unconfirmed understanding** — amber, with a one-line explanation that this
  is the author's record of a verbal request.
- **Confirmed · rev 3 · by <name>** — neutral, not success green. A
  confirmation is a fact, not an achievement.
- **Awaiting confirmation** — after a material change lapsed an earlier
  acknowledgement. Earlier acknowledgements stay visible in history.

## Revision diff

Before/after in two columns above 900px, stacked below. Uses `<ins>` and
`<del>` so the change survives without colour. Never a colour-only diff.

## Keyboard

- The reviewer action bar is reachable before the discussion in DOM order.
- `Cmd/Ctrl+Enter` in the comment composer posts; it never approves.
- Activity history is a real disclosure button, focusable and labelled with
  its item count.
