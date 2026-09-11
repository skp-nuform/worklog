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
  const who = one(sp.who);
  const dept = one(sp.dept);

  const [people, tags] = await Promise.all([
    getPeople(workspace.id),
    getWorkspaceTags(workspace.id),
  ]);

  let authorIds: string[] | undefined;
  if (dept) {
    authorIds = people
      .filter((p) => p.department?.toLowerCase() === dept.toLowerCase())
      .map((p) => p.user_id);
  }

  const filters = {
    authorId: who === "me" ? viewer.id : who,
    authorIds,
    from: one(sp.from),
    to: one(sp.to),
    tag: one(sp.tag),
    q: one(sp.q),
  };

  const days = await getSheet(workspace.id, filters);

  // Uploaded assets are in a private bucket, so each needs a short-lived
  // signed URL. Signed with the VIEWER's session, so Storage RLS decides.
  const paths = days.flatMap((d) =>
    d.entries.flatMap((e) =>
      e.assets.map((a) => a.object_path).filter((p): p is string => Boolean(p)),
    ),
  );
  const signed = await signAssetUrls(paths);

  const peopleMap = new Map(people.map((p) => [p.user_id, p]));

  const hydrated = days.map((d) => ({
    workDate: d.workDate,
    entries: d.entries.map((e) => {
      const person = peopleMap.get(e.author_id);
      return {
        id: e.id,
        title: e.title,
        note: e.note,
        tags: e.tags,
        author_id: e.author_id,
        author_name: e.author_name || person?.display_name || null,
        author_department: person?.department || null,
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
      };
    }),
  }));

  return (
    <SheetClient
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      viewerId={viewer.id}
      viewerRole={workspace.role}
      days={hydrated}
      people={people}
      tags={tags}
      activeWho={who ?? null}
      activeFilters={{
        q: one(sp.q),
        tag: one(sp.tag),
        from: one(sp.from),
        to: one(sp.to),
        who,
        dept,
      }}
    />
  );
}
