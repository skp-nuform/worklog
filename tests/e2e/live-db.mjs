/**
 * Live verification of the work sheet: entries, assets, uploads, and the
 * public share path with real identities.
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Auto-populate from .env.local if not present in environment
if (!process.env.SB_URL && existsSync(resolve(process.cwd(), ".env.local"))) {
  const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "NEXT_PUBLIC_SUPABASE_URL" && !process.env.SB_URL) process.env.SB_URL = val;
    if (key === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && !process.env.SB_PUBLISHABLE) process.env.SB_PUBLISHABLE = val;
    if (key === "SUPABASE_SECRET_KEY" && !process.env.SB_SECRET) process.env.SB_SECRET = val;
    if (key === "SHARE_TOKEN_PEPPER" && !process.env.SHARE_TOKEN_PEPPER) process.env.SHARE_TOKEN_PEPPER = val;
  }
}

const U = process.env.SB_URL;
const P = process.env.SB_PUBLISHABLE;
const S = process.env.SB_SECRET;
const PEPPER = process.env.SHARE_TOKEN_PEPPER;

if (!U || !P || !S || !PEPPER) {
  console.error("Missing required environment variables (SB_URL, SB_PUBLISHABLE, SB_SECRET, SHARE_TOKEN_PEPPER)");
  process.exit(1);
}

let pass = 0,
  fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const admin = (path, init = {}) =>
  fetch(`${U}${path}`, {
    ...init,
    headers: {
      apikey: S,
      Authorization: `Bearer ${S}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

async function asUser(token, path, init = {}) {
  const res = await fetch(`${U}${path}`, {
    ...init,
    headers: {
      apikey: P,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const anon = async (path, init = {}) => {
  const res = await fetch(`${U}${path}`, {
    ...init,
    headers: { apikey: P, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

const hash = (t) => `\\x${createHmac("sha256", PEPPER).update(t).digest("hex")}`;

const stamp = Date.now();
const a = { email: `worklog-sheet-a-${stamp}@example.com`, password: `Sh-${stamp}-aA!` };
const b = { email: `worklog-sheet-b-${stamp}@example.com`, password: `Sh-${stamp}-bB!` };
const made = [];

async function mkUser(u) {
  const r = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
  }).then((r) => r.json());
  if (!r.id) throw new Error(`create user: ${JSON.stringify(r)}`);
  made.push(r.id);
  return r.id;
}

async function signIn(u) {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: P, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  }).then((r) => r.json());
  if (!r.access_token) throw new Error(`sign in: ${JSON.stringify(r)}`);
  return r.access_token;
}

try {
  console.log("=== setup ===");
  a.id = await mkUser(a);
  b.id = await mkUser(b);
  const tokA = await signIn(a);
  const tokB = await signIn(b);

  const wsA = (
    await asUser(tokA, "/rest/v1/rpc/bootstrap_workspace", {
      method: "POST",
      body: JSON.stringify({ p_name: "Sheet A", p_display_name: "Ana" }),
    })
  ).body;
  const wsB = (
    await asUser(tokB, "/rest/v1/rpc/bootstrap_workspace", {
      method: "POST",
      body: JSON.stringify({ p_name: "Sheet B", p_display_name: "Bo" }),
    })
  ).body;
  check("two workspaces created", typeof wsA === "string" && typeof wsB === "string");

  // ---- upload a real image straight to storage, as the user -------------
  console.log("\n=== direct-to-storage upload (bypasses the 4.5 MB function cap) ===");
  // Smallest valid PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/rvKeAAAAAElFTkSuQmCC",
    "base64",
  );
  const objectPath = `${wsA}/${crypto.randomUUID()}.png`;
  const up = await fetch(`${U}/storage/v1/object/work-assets/${objectPath}`, {
    method: "POST",
    headers: { apikey: P, Authorization: `Bearer ${tokA}`, "Content-Type": "image/png" },
    body: png,
  });
  check("author can upload to their workspace folder", up.ok, `status ${up.status}`);

  // Cross-tenant upload must be refused by the storage policy.
  const badUp = await fetch(
    `${U}/storage/v1/object/work-assets/${wsA}/${crypto.randomUUID()}.png`,
    {
      method: "POST",
      headers: { apikey: P, Authorization: `Bearer ${tokB}`, "Content-Type": "image/png" },
      body: png,
    },
  );
  check(
    "a non-member cannot upload into another workspace's folder",
    !badUp.ok,
    `status ${badUp.status}`,
  );

  // ---- create an entry with a link and the uploaded image ---------------
  console.log("\n=== create_entry with assets ===");
  const today = new Date().toISOString().slice(0, 10);
  const mk = await asUser(tokA, "/rest/v1/rpc/create_entry", {
    method: "POST",
    body: JSON.stringify({
      p_workspace: wsA,
      p_title: "Reworked the pricing page tiers",
      p_work_date: today,
      p_note: "Tightened the comparison table and made the annual toggle obvious.",
      p_tags: ["design", "web"],
      p_assets: [
        {
          kind: "link",
          url: "https://www.figma.com/design/abc123/Pricing",
          provider: "figma",
          label: "Pricing v3",
        },
        {
          kind: "link",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          provider: "youtube",
          label: "Walkthrough",
        },
        {
          kind: "image",
          object_path: objectPath,
          mime_type: "image/png",
          byte_size: png.length,
          width: 1,
          height: 1,
          label: "Final screen",
        },
      ],
    }),
  });
  check("entry created", typeof mk.body === "string", JSON.stringify(mk.body).slice(0, 200));
  const entryId = mk.body;

  const rows = await asUser(tokA, `/rest/v1/entries?select=*&id=eq.${entryId}`);
  const row = rows.body?.[0];
  check("entry readable", Boolean(row));
  check("dated to the chosen day", row?.work_date === today, String(row?.work_date));
  check("author derived server-side", row?.author_id === a.id);
  check("three assets attached", row?.asset_count === 3, String(row?.asset_count));
  check("tags stored", JSON.stringify(row?.tags) === '["design","web"]', JSON.stringify(row?.tags));

  const assets = await asUser(
    tokA,
    `/rest/v1/entry_assets?select=*&entry_id=eq.${entryId}&order=position`,
  );
  check("asset order preserved", assets.body?.map((x) => x.position).join(",") === "1,2,3");
  check("link asset kept its provider", assets.body?.[0]?.provider === "figma");
  check("image asset kept its object path", assets.body?.[2]?.object_path === objectPath);
  check(
    "a link asset stores no object path, and vice versa",
    assets.body?.[0]?.object_path === null && assets.body?.[2]?.url === null,
  );

  // Backdating is allowed; future-dating is not.
  const back = await asUser(tokA, "/rest/v1/rpc/create_entry", {
    method: "POST",
    body: JSON.stringify({
      p_workspace: wsA,
      p_title: "Yesterday's standup notes",
      p_work_date: "2026-09-01",
    }),
  });
  check("backdating a day is allowed", typeof back.body === "string");

  const future = await asUser(tokA, "/rest/v1/rpc/create_entry", {
    method: "POST",
    body: JSON.stringify({
      p_workspace: wsA,
      p_title: "Work I have not done yet",
      p_work_date: "2030-01-01",
    }),
  });
  check(
    "future-dating is refused (a log records what is done)",
    future.body?.code === "23514",
    JSON.stringify(future.body).slice(0, 160),
  );

  // ---- tenant isolation --------------------------------------------------
  console.log("\n=== tenant isolation ===");
  const bSees = await asUser(tokB, `/rest/v1/entries?select=id&workspace_id=eq.${wsA}`);
  check("user B sees none of A's entries", Array.isArray(bSees.body) && bSees.body.length === 0);

  const bSub = await asUser(tokB, `/rest/v1/entries?select=id&id=eq.${entryId}`);
  check("substituting A's entry id returns nothing", Array.isArray(bSub.body) && bSub.body.length === 0);

  const bAssets = await asUser(tokB, `/rest/v1/entry_assets?select=id&entry_id=eq.${entryId}`);
  check("user B cannot read A's assets", Array.isArray(bAssets.body) && bAssets.body.length === 0);

  const bWrite = await asUser(tokB, "/rest/v1/rpc/create_entry", {
    method: "POST",
    body: JSON.stringify({ p_workspace: wsA, p_title: "Injected by an outsider" }),
  });
  check("user B cannot log into A's workspace", bWrite.body?.code === "P0403");

  const bDelete = await asUser(tokB, "/rest/v1/rpc/delete_entry", {
    method: "POST",
    body: JSON.stringify({ p_entry: entryId }),
  });
  check(
    "user B deleting A's entry gets 404, not 403 (no existence oracle)",
    bDelete.body?.code === "P0404",
    JSON.stringify(bDelete.body).slice(0, 160),
  );

  const anonRead = await anon(`/rest/v1/entries?select=id&workspace_id=eq.${wsA}`);
  check("anon cannot read entries at all", anonRead.status >= 400, `status ${anonRead.status}`);

  // ---- share link --------------------------------------------------------
  console.log("\n=== share link ===");
  const rawToken = randomBytes(32).toString("base64url");
  const mkShare = await asUser(tokA, "/rest/v1/rpc/create_share_link", {
    method: "POST",
    body: JSON.stringify({
      p_workspace: wsA,
      p_token_hash: hash(rawToken),
      p_label: "September review",
      p_author_id: a.id,
      p_allow_download: true,
    }),
  });
  check("share link created", typeof mkShare.body === "string", JSON.stringify(mkShare.body).slice(0, 200));
  const shareId = mkShare.body;

  // The guest path: anon, with only the hash.
  const sheet = await anon("/rest/v1/rpc/read_shared_sheet", {
    method: "POST",
    body: JSON.stringify({ p_token_hash: hash(rawToken) }),
  });
  const doc = sheet.body;
  check("anon can read the shared sheet with the token", Boolean(doc), JSON.stringify(doc).slice(0, 160));
  check("share label carried through", doc?.label === "September review");
  check("downloads flagged on", doc?.allow_download === true);
  check("days present", Array.isArray(doc?.days) && doc.days.length >= 1, String(doc?.days?.length));

  const day = doc?.days?.find((d) => d.work_date === today);
  const shared = day?.entries?.[0];
  check("the entry appears under its day", Boolean(shared), JSON.stringify(day)?.slice(0, 120));
  check("assets projected", shared?.assets?.length === 3, String(shared?.assets?.length));
  check(
    "the object path is NEVER sent to a guest",
    !JSON.stringify(doc).includes(objectPath),
    "object_path leaked into the guest document",
  );
  check(
    "guest sees a has_file flag instead",
    shared?.assets?.some((x) => x.has_file === true),
  );

  // A wrong token is indistinguishable from a revoked or expired one.
  const wrong = await anon("/rest/v1/rpc/read_shared_sheet", {
    method: "POST",
    body: JSON.stringify({ p_token_hash: hash("not-a-real-token") }),
  });
  check("a wrong token returns null", wrong.body === null, JSON.stringify(wrong.body).slice(0, 120));

  // Asset resolution is scoped to the share.
  const resolved = await anon("/rest/v1/rpc/resolve_shared_asset", {
    method: "POST",
    body: JSON.stringify({
      p_token_hash: hash(rawToken),
      p_asset: shared.assets.find((x) => x.has_file).id,
    }),
  });
  check(
    "the share resolves its own file asset",
    resolved.body?.object_path === objectPath,
    JSON.stringify(resolved.body).slice(0, 160),
  );

  const foreign = await anon("/rest/v1/rpc/resolve_shared_asset", {
    method: "POST",
    body: JSON.stringify({
      p_token_hash: hash("not-a-real-token"),
      p_asset: shared.assets.find((x) => x.has_file).id,
    }),
  });
  check("a wrong token resolves no asset", foreign.body === null);

  // ---- revocation is immediate ------------------------------------------
  console.log("\n=== revocation ===");
  await asUser(tokA, "/rest/v1/rpc/revoke_share_link", {
    method: "POST",
    body: JSON.stringify({ p_share: shareId }),
  });

  const afterRevoke = await anon("/rest/v1/rpc/read_shared_sheet", {
    method: "POST",
    body: JSON.stringify({ p_token_hash: hash(rawToken) }),
  });
  check("a revoked link reads null immediately", afterRevoke.body === null);

  const assetAfter = await anon("/rest/v1/rpc/resolve_shared_asset", {
    method: "POST",
    body: JSON.stringify({
      p_token_hash: hash(rawToken),
      p_asset: shared.assets.find((x) => x.has_file).id,
    }),
  });
  check("a revoked link resolves no files", assetAfter.body === null);
  check(
    "revoked and wrong are the same answer",
    JSON.stringify(afterRevoke.body) === JSON.stringify(wrong.body),
  );
} catch (err) {
  fail++;
  failures.push(`harness: ${err.message}`);
  console.error("\nHARNESS ERROR:", err.message);
} finally {
  console.log("\n=== cleanup ===");
  for (const id of made) {
    try {
      const r = await admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
      console.log(`  user ${id.slice(0, 8)}… delete status ${r.status}`);
    } catch {
      // Ignore cleanup error if trigger block prevents direct delete
    }
  }
}

console.log("\n" + "=".repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  -", f);
}
console.log("=".repeat(64));
process.exit(fail === 0 ? 0 : 1);
