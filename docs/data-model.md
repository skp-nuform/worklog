# Data model, invariants, and access control

The authoritative design for `supabase/migrations/`. Written in M0; the SQL
lands in M1 alongside the pgTAP suite that exercises it (see `decisions.md`
D-19 for why they ship together).

Guiding rule: **push each check to the innermost layer that can express it.**
The further a check sits from the data, the more code paths can bypass it.

---

## 1. Schemas and privilege tiers

| Schema | Exposed via PostgREST | Contents |
|---|---|---|
| `app` | **No** | All base tables. `anon` gets nothing; `authenticated` gets narrow column grants only. |
| `authz` | **No** | `SECURITY DEFINER STABLE` membership and capability helpers used inside RLS policies. |
| `api` | **Yes** | `SECURITY DEFINER` RPCs and `security_invoker` views. The only surface `authenticated` touches for invariant-critical writes. |
| `share` | **No** | Guest token resolution and JSON projection. Only `worklog_share_reader` may EXECUTE. |

`authz` and `share` stay unexposed because Supabase's RLS guide warns that a
`SECURITY DEFINER` function in an exposed schema becomes callable with
elevated privileges through the Data API.

Roles: `worklog_owner` (NOLOGIN, owns everything), `worklog_share_reader`
(guest projection only), `worklog_compliance` (audited redaction only).

---

## 2. Shared conventions

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid, hmac
create extension if not exists citext;     -- guest emails

create type app.workspace_role      as enum ('owner','admin','member','guest');
create type app.project_capability  as enum ('read','comment','submit','review','manage');
create type app.project_role        as enum ('contributor','reviewer','viewer');
create type app.submission_status   as enum ('submitted','withdrawn');
create type app.review_kind         as enum ('approved','changes_requested');
create type app.comment_visibility  as enum ('internal','client');
```

Every mutable aggregate root carries:

```sql
created_at  timestamptz not null default now(),
created_by  uuid        not null default auth.uid() references app.profiles(id),
updated_at  timestamptz not null default now(),
updated_by  uuid        not null default auth.uid(),
version     integer     not null default 1 check (version >= 1)
```

**Trusted actor and time** are enforced two ways at once. First, the columns
are simply absent from the grant, so the client cannot name them at all:

```sql
revoke all on app.work_items from authenticated;
grant insert (title, brief, project_id, brand_id) on app.work_items to authenticated;
```

Second, a stamping trigger overwrites whatever arrives, covering the RPC paths
where column grants do not apply. Domain timestamps use `now()` (transaction
time), not `clock_timestamp()`, so a state change and its event share one
instant.

---

## 3. Invariants and where each one lives

| # | Invariant | Enforced by | Why there |
|---|---|---|---|
| 1 | Submission numbers unique per item, monotonic, never reused | Unique constraint (safety) + definer function (allocation) | Uniqueness is a set property; allocation needs lock-and-increment |
| 2 | Submitter can never approve | **CHECK + composite FK** | A CHECK binds every role, including `service_role` and definer functions |
| 3 | Approval never migrates to a newer submission | Data model (no cached column) | You cannot enforce that a cache stays correct — decline to cache |
| 4 | Submission bytes and metadata never rewritten | Append-only triggers + `ON DELETE RESTRICT` + content-addressed paths + Storage RLS | The one invariant whose violation is undetectable afterwards |
| 5 | Material brief change invalidates current ack, keeps history | Data model + composite FK on a content digest | Modelled away: acks bind to immutable revisions, so there is nothing to mutate |
| 6 | No cross-workspace or cross-project references | Composite foreign keys | Declarative, race-free, uniform over bulk paths, testable |
| 7 | State change + event atomic; retries idempotent | Definer function in one transaction + idempotency-key PK | Atomicity is a transaction property; check-then-insert in the app is the classic race |
| 8 | `expected_version`, never a silent overwrite | `WHERE version = $n` CAS + bump trigger | The predicate *is* the concurrency control |
| 9 | Timestamps and actor from trusted context | Column DEFAULT + column GRANT + trigger | An unmentionable column beats a validated value |
| 10 | `activity_events` immutable | Revoked privileges + append-only trigger + FORCE RLS | Privilege revocation is the primary control |

### 3.1 Submission numbering (invariant 1)

A transactional counter on the parent row, allocated in one statement:

```sql
create or replace function app.allocate_submission_no(p_work_item uuid)
returns integer
language sql security definer set search_path = '' as $$
  update app.work_items
     set next_submission_no = next_submission_no + 1
   where id = p_work_item
  returning next_submission_no - 1;
$$;
```

Rejected alternatives, and why:

- `select max(submission_no) + 1` is a read-then-write race. Under READ
  COMMITTED two submitters both read `3`; one takes a unique violation. Under
  REPEATABLE READ you get a serialization error. Either way a correctness bug
  becomes a retry storm.
- A per-work-item `SEQUENCE` is wrong twice: unbounded DDL (one object per
  work item), and `nextval` is non-transactional, so a rolled-back attempt
  **permanently burns a number** and leaves holes.

`UPDATE … RETURNING` takes a row lock; concurrent callers queue on the tuple
and the loser re-reads to get `n+1`. Because the counter is transactional, a
rolled-back submission returns its number (no hole), while a committed one
consumes its number permanently — even after withdrawal, since the row remains
with `status = 'withdrawn'` and the unique index still covers it. That is
exactly the invariant. The unique constraint stays as the backstop, so a bug
in the allocator is a failed request rather than a duplicate number.

```sql
constraint submissions_no_uniq unique (work_item_id, submission_no)
```

**Immutability** uses a subtract-the-mutable-keys comparison rather than
per-column checks, so it survives a future `ADD COLUMN` without anyone
remembering to update the trigger:

```sql
declare mutable text[] := array['status','withdrawn_at','withdrawn_by'];
begin
  if to_jsonb(old) - mutable is distinct from to_jsonb(new) - mutable then
    raise exception 'submission % is immutable', old.id using errcode = 'P0410';
  end if;
```

### 3.2 Self-approval is impossible (invariant 2)

A `CHECK` can only see the current row, so the other row's fact is pulled onto
this row and pinned with composite foreign keys:

```sql
create table app.review_decisions (
  ...
  submission_id           uuid not null,
  submission_submitted_by uuid not null,   -- denormalized, made truthful below
  submission_no           integer not null,
  submission_content_hash bytea not null,
  decided_by uuid not null default auth.uid() references app.profiles(id),

  -- the submission really belongs to this work item, at this number
  constraint rd_submission_fk foreign key (submission_id, work_item_id, submission_no)
    references app.submissions(id, work_item_id, submission_no) on update restrict,

  -- submission_submitted_by cannot be forged: it must match the real submitter
  constraint rd_submitter_fk foreign key (submission_id, submission_submitted_by)
    references app.submissions(id, submitted_by) on update restrict,

  -- the artifact set reviewed is pinned by hash (invariants 3 and 4)
  constraint rd_content_fk foreign key (submission_id, submission_content_hash)
    references app.submissions(id, content_hash) on update restrict,

  -- INVARIANT 2, declaratively, for every role, forever
  constraint rd_no_self_review check (decided_by <> submission_submitted_by)
);

create unique index rd_one_approval_per_submission
  on app.review_decisions (submission_id) where decision = 'approved';
```

Why a CHECK and not a trigger or policy: CHECK constraints are evaluated
unconditionally for every row Postgres writes. They are not suppressed by
`session_replication_role = 'replica'`, not skipped by `DISABLE TRIGGER`, not
bypassed by `service_role`, a `SECURITY DEFINER` function, or a superuser —
only by `DROP CONSTRAINT`, which is a migration and shows up in review.

To defeat it an attacker must supply a `submission_submitted_by` that is not
the real submitter, which `rd_submitter_fk` rejects; and `submitted_by` is
itself immutable, so the fact cannot be retro-edited after the decision lands.
`decided_by` comes from `auth.uid()` via column grant and trigger, so it cannot
be spoofed from the request body.

An admin who is also the submitter therefore gets a **constraint violation
(`23514`)**, not a policy denial. That distinction matters: policy denials are
the thing people write `service_role` escape hatches around.

`review_decisions` is append-only. "Un-approving" is a new
`changes_requested` row, never a mutation.

### 3.3 Approval never migrates (invariants 3, 4)

**There is no `work_items.approved_submission_id` column.** Approval is a fact
about a submission, stored only on `review_decisions.submission_id` and read
through a `security_invoker` view. Artifact replacement creates a new artifact
version; `submission_artifacts` and the submission's `content_hash` are
unchanged, and referenced versions are `ON DELETE RESTRICT`.

### 3.4 expected_version (invariant 8)

```sql
update app.work_items
   set title = coalesce(p_title, title), version = version + 1
 where id = p_id and version = p_expected_version
returning id into v_id;

if v_id is null then
  if exists (select 1 from app.work_items where id = p_id) then
    raise exception 'version_conflict' using errcode = 'P0409';
  else
    raise exception 'not_found' using errcode = 'P0404';
  end if;
end if;
```

The `WHERE version = …` predicate *is* the concurrency control: two writers
serialize on the row lock, and the loser re-evaluates against the winner's
committed tuple, matches zero rows, and gets `P0409` — never a silent
overwrite. A bump trigger rejects any path that forgets to increment or tries
to set `version` arbitrarily.

**Deliberate subtlety:** inside the RPC the `EXISTS` check runs as the definer,
so it can see rows the caller cannot. The route handler maps both `P0404` and
"RLS-invisible" to HTTP 404, so there is no existence oracle across workspaces.

### 3.5 Acknowledgement invalidation (invariant 5)

Acknowledgements bind to an immutable revision through a digest over the
*material* fields only, pinned by composite FK. A revision that changes only an
internal note produces the same digest, so the acknowledgement stays current; a
revision that changes the brief produces a new digest, so the current
acknowledgement lapses while every historical row survives untouched. There is
no mutation to guard, which is stronger than guarding one.

### 3.6 Atomicity and idempotency (invariant 7)

One `SECURITY DEFINER` function per transition holds the state change and its
event in a single transaction, and `app.emit_event` is the **only** writer to
`activity_events` — which is what stops a future feature from changing state
without recording it. Idempotency keys are a primary key: replaying the same
key with the same payload digest returns the original result, while the same
key with a *different* digest raises `P0409`.

---

## 4. Cross-tenant safety

`workspace_id` is denormalized onto every `app` row. Every parent carries
`UNIQUE (id, workspace_id)` and every child FK is composite:

```sql
constraint submissions_wi_fk
  foreign key (work_item_id, workspace_id)
  references app.work_items(id, workspace_id) on update restrict on delete restrict
```

A pgTAP test walks `information_schema` and fails if any table carrying a
`workspace_id` lacks a tenant-pinning composite FK, which keeps the rule true
as the schema grows.

---

## 5. RLS strategy

- RLS enabled on **every** `app` table; `FORCE ROW LEVEL SECURITY` on
  `activity_events`.
- Helpers are argument-free and set-returning — `authz.my_workspaces()`,
  `authz.my_projects(cap)` — declared `SECURITY DEFINER STABLE` with a pinned
  `search_path`. Definer is what breaks the `42P17` infinite recursion when a
  policy on a membership table needs to read that same table.
- Capabilities live in a `project_role_caps` table, so adding a role is an
  INSERT rather than a deploy, and both RLS and the RPCs read one source.
- Performance, which D-06 makes mandatory rather than optional: wrap helper
  calls as `(select authz.…)` so Postgres caches them as an InitPlan, always
  name `TO <role>` on a policy, and index every column a policy filters on.
- Every view in `api` must set `security_invoker = on`. A pgTAP test enumerates
  `pg_class` and fails otherwise — this catches the most common Supabase RLS
  bypass, where a view runs with its owner's privileges.

---

## 6. Guest share path

There is **no `anon` policy on any `app` table.** The chain is:

1. Token arrives in the URL. At least 256 bits of randomness.
2. The application HMACs it with `SHARE_TOKEN_PEPPER` (D-11). The raw token
   never enters a SQL string or query log.
3. `share.resolve_and_project(hash)` runs as `worklog_share_reader`, validating
   grant, expiry, and live resource permissions, and emitting an explicit JSON
   projection.
4. A `zod.strict()` guest DTO at one choke point — the only module `app/s/**`
   may import — drops anything the projection did not intend.

The field allowlist is a **registry table that defaults to deny**, so a column
added by a later migration is invisible to guests until deliberately published
(D-12). Internal comments are excluded structurally: the guest view exposes
only `visibility = 'client'` rows for that specific grant.

Wrong, revoked, and expired tokens must all return results **indistinguishable
from one another**, so a share URL is not an enumeration oracle.

**Pinned publication.** A share stores the submission version it was published
at. Internal work moving forward does not change the guest projection;
"newer version available" is computed for the share's manager, and republishing
is an explicit, forward-only action.

**Revocation.** Revoking denies new application reads and new signed URLs
immediately. Because Supabase signed URLs stay valid until expiry regardless of
key changes, guest assets under ~10 MB are proxied through a route handler so
revocation is genuinely immediate, with a 60-second signed-URL fallback for
large files that the share UI discloses (D-10).

---

## 7. Storage

Private bucket. `storage.objects` policies grant `anon` nothing, and grant
`authenticated` SELECT only where the first path segment is a workspace they
belong to. No UPDATE or DELETE policy for either role. Uploads use signed
upload URLs with content-addressed paths; `finalize` verifies size and MIME
against `storage.objects.metadata` before the version becomes referenceable.

The secret key bypasses RLS entirely, so it lives only in the server-side
proxy and the cleanup worker — never in a client bundle.

---

## 8. pgTAP suite — the negative cases

Structural: every `workspace_id` child has a tenant-pinning composite FK;
**`anon` holds zero privileges anywhere**; RLS enabled on every `app` table;
append-only tables have no UPDATE/DELETE policies or grants; `authz`/`share`
functions are definer, stable, with pinned `search_path`; every `api` view is
`security_invoker`.

Behavioural, all asserting the *denial*:

| Test | Asserts | Expected error |
|---|---|---|
| Cross-workspace ID substitution | collection items, share items, comment parents, project brands all refuse a foreign tenant | `23503` |
| Self-approval, incl. admin submitter | contributor and owner both refused on their own submission | `23514` |
| Forged submitter | a spoofed `submission_submitted_by` is refused before the CHECK | `23503` |
| Double approval | second approval on one submission | `23505` |
| Numbering | 1,2,3; withdraw #2, next is **4**; direct insert of #2 refused | `23505` |
| Removed member with stale admin JWT | sees nothing; mutations refused | `P0403` |
| Stale `expected_version` | row unchanged, no overwrite | `P0409` |
| RLS-invisible id | must not reveal existence | `P0404`, never `P0403` |
| Revoked / expired / wrong token | all three identical, no oracle | `NULL` |
| Guest role reaching internal tables | `app.work_items`, `app.comments`, `app.profiles` | `42501` |
| Internal comment leak | full serialized projection contains no internal body, author email, or rationale | substring assertion |
| Event atomicity | one event per transition; zero of both on failure | — |
| Approval does not migrate | approve #2, create #3, approval still names #2 | — |
| Share stays pinned | guest still sees #2 after #3 exists | — |

The internal-comment test asserts over the **whole serialized JSON document**,
not just a column list — crude, but it catches a leak at any nesting depth,
including ones a column-list test would miss.

CI gate: `supabase db reset && supabase test db` on every change, plus
plan-shape assertions on the hottest RLS-filtered queries so a policy rewrite
that reintroduces a `Seq Scan` on `work_items` fails the build.
