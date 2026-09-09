import { SheetClient } from "./sheet-client";
import { requireViewer } from "@/lib/auth/session";
import { getPeople, getSheet, getWorkspaceTags, signAssetUrls } from "@/lib/data/sheet";
import { getCurrentWorkspace } from "@/lib/data/workspace";

export const metadata = { title: "Sheet" };

function one(v: string | string[] | undefined) {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s : undefined;
}

export default async function SheetPage({ searchParams }: PageProps<"/sheet">) {
  const viewer = await requireViewer("/sheet");
  const workspace = await getCurrentWorkspace();
  if (!workspace) return null;

  const sp = await searchParams;
  const filters = {
    authorId: one(sp.who) === "me" ? viewer.id : one(sp.who),
    from: one(sp.from),
    to: one(sp.to),
    tag: one(sp.tag),
    q: one(sp.q),
  };

  const [days, people, tags] = await Promise.all([
    getSheet(workspace.id, filters),
    getPeople(workspace.id),
    getWorkspaceTags(workspace.id),
  ]);

  // Uploaded assets are in a private bucket, so each needs a short-lived
  // signed URL. Signed with the VIEWER's session, so Storage RLS decides.
  const paths = days.flatMap((d) =>
    d.entries.flatMap((e) =>
      e.assets.map((a) => a.object_path).filter((p): p is string => Boolean(p)),
    ),
  );
  const signed = await signAssetUrls(paths);

  const hydrated = days.map((d) => ({
    workDate: d.workDate,
    entries: d.entries.map((e) => ({
      id: e.id,
      title: e.title,
      note: e.note,
      tags: e.tags,
      author_id: e.author_id,
      author_name: e.author_name,
      version: e.version,
      work_date: d.workDate,
      assets: e.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.url,
        provider: a.provider,
        label: a.label,
        mime_type: a.mime_type,
        byte_size: a.byte_size,
        width: a.width,
        height: a.height,
        src: a.object_path ? (signed.get(a.object_path) ?? null) : a.url,
      })),
    })),
  }));

  return (
    <SheetClient
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      viewerId={viewer.id}
      days={hydrated}
      people={people}
      tags={tags}
      activeWho={one(sp.who) ?? null}
      activeFilters={{
        q: one(sp.q),
        tag: one(sp.tag),
        from: one(sp.from),
        to: one(sp.to),
        who: one(sp.who),
      }}
    />
  );
}
