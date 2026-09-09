# Page exception — Guest share (`/s/[token]`)

Overrides MASTER only where stated. This is the only page an outsider sees.

## Why this page needs an exception

It has no app shell, no navigation, no workspace identity, and an audience that
did not log in. Every pixel is a disclosure decision. The design job here is
mostly **subtraction**: the safest guest page is the one that renders the least.

## Deviations from MASTER

| Item | MASTER | Here | Why |
|---|---|---|---|
| Sidebar | 232px | **none** | No workspace navigation exists for a guest |
| Header | 64px app header | 56px minimal bar: collection or item title, and the audience notice | Nothing to navigate to |
| Max width | unbounded for lists | 880px centred | Reading and reviewing, not scanning a table |
| Brand label | shown in app chrome | shown **only** if the publisher included it | The brand is itself a disclosure |

## What the layout must never contain

- Workspace, project, or brand switchers.
- Counts of anything not in the share ("3 of 47 items" tells an outsider the
  workspace holds 47 items).
- Member names, avatars, or a mention autocomplete that enumerates people.
- Internal comment threads, in any form, at any nesting depth.
- Search across anything.
- A link to the internal app that implies the guest could use it.

## The audience notice

A persistent, quiet line in the header bar stating what this is and how long it
lasts, in plain language:

> Shared with you by <publisher display name> · access ends 8 October 2026

For an unlisted link the notice also says, without euphemism, that anyone with
the link can open the page. Users are not protected by an implication.

## Comment sign-in

Commenting requires verified email sign-in. The prompt appears **in place**,
attached to the thread, and explains three things: sign-in is needed to attach
a name to the comment, it does not create an account in the workspace, and the
guest returns to this same content afterwards.

An anonymous visitor cannot type a display name and post. There is no field
for it, because a name nobody verified is an impersonation vector.

## Comment permission is not review permission

Comment controls never sit next to anything resembling approval. Approve and
Request changes appear on a guest page only for an invited, explicitly
designated review grant bound to one submission — and then they name that
version. An ordinary unlisted link shows no decision control at all.

## Artifacts

Images and PDFs render inline through the proxied asset route. Office files are
download-only. An external link always offers a plain **Open link** fallback and
never promises that the guest has access to the upstream resource — a private
Figma file stays private, and the page says so rather than failing silently.

## Unavailable state — one message, three causes

Expired, revoked, and wrong token render an **identical** page:

> This link is no longer available.

Plus a request-access option where the publisher configured one. Nothing in the
copy, the status code, the page title, or the timing distinguishes the three
causes. Any variation is an enumeration oracle.

## Mobile is the primary case

Guests open share links on phones. Verified at 375px:

- No horizontal page scroll; wide artifacts scroll inside their own container.
- The comment composer stays visible above the on-screen keyboard.
- The artifact viewer's controls are reachable without pinch-zoom.
- Touch targets are ~44px, which on this page means the `lg` button size.

Covers AC-24.

## Headers this page depends on

Set in `next.config.ts` and tightened in `src/proxy.ts`:
`no-store`, `Referrer-Policy: no-referrer`,
`X-Robots-Tag: noindex, nofollow, noarchive`. No third-party trackers or
analytics of any kind.

`noindex` is discoverability hygiene, **not** access control, and is never
described as protection.
