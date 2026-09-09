import { NextResponse, type NextRequest } from "next/server";

import { hashShareToken } from "@/lib/share-token";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, hasServiceKey } from "@/lib/supabase/service";

/**
 * Streams one shared file to a guest.
 *
 * Why a proxy rather than a signed URL: a Supabase signed URL stays valid
 * until it expires regardless of what happens to the share, so revocation
 * would not be immediate. Proxying means every byte served is checked
 * against the live share on the way through.
 *
 * The share is resolved by TOKEN HASH, and `resolve_shared_asset` returns
 * the object path only if the share is active and actually covers that
 * asset — so an asset id from outside the share's scope resolves to nothing.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;

  let tokenHash: string;
  try {
    tokenHash = hashShareToken(token);
  } catch {
    return new NextResponse("Sharing is not configured", { status: 503 });
  }

  // Anon client: read_shared_sheet / resolve_shared_asset are the only two
  // functions anon may call, and both demand the hash.
  const anon = await createClient();
  const { data, error } = await anon.rpc("resolve_shared_asset", {
    p_token_hash: tokenHash,
    p_asset: id,
  });

  if (error || !data) {
    // Wrong token, revoked, expired, or out of scope — all the same answer.
    return new NextResponse("Not available", { status: 404 });
  }

  const asset = data as {
    object_path: string;
    mime_type: string | null;
    label: string | null;
    allow_download: boolean;
  };

  if (!hasServiceKey()) {
    return new NextResponse(
      "Server is missing SUPABASE_SECRET_KEY, so shared files cannot be served.",
      { status: 503 },
    );
  }

  const service = createServiceClient();
  const file = await service.storage
    .from("work-assets")
    .download(asset.object_path);

  if (file.error || !file.data) {
    return new NextResponse("Not available", { status: 404 });
  }

  const wantsDownload = request.nextUrl.searchParams.has("download");
  if (wantsDownload && !asset.allow_download) {
    return new NextResponse("Downloads are disabled for this link", {
      status: 403,
    });
  }

  const filename = (asset.label ?? "file").replace(/["\\r\n]/g, "");

  return new NextResponse(file.data, {
    headers: {
      "Content-Type": asset.mime_type ?? "application/octet-stream",
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${filename}"`,
      // Private and short-lived: a shared cache must never outlive the grant.
      "Cache-Control": "private, max-age=60, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
