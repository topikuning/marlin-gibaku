import { NextResponse, type NextRequest } from "next/server";
import { accessibleLocationIds, getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { audit } from "@/lib/audit";
import { parsePaparanContent } from "@/lib/paparan/susun";
import { namaBerkasPaparan, renderPaparanPdf } from "@/lib/paparan/render-pdf";

export const dynamic = "force-dynamic";

/**
 * Unduh PDF Paparan Mingguan KKP (DECISIONS 416).
 *
 * Konten SELALU dibaca dari DB — route ini tidak menerima structured content
 * dari klien. Artefak yang belum beku diunduh sebagai DRAF ber-watermark di
 * setiap slide; PDF final (tanpa watermark) hanya dari artefak beku/terkirim.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "ai.view")) return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const artifact = await db.aiArtifact.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      version: true,
      frozenAt: true,
      structuredContent: true,
      run: { select: { scopeIds: true } },
      package: { select: { orgId: true } },
    },
  });
  // 404 juga untuk organisasi/scope lain — jangan konfirmasi keberadaan.
  if (!artifact || artifact.kind !== "paparan" || artifact.package?.orgId !== user.orgId) {
    return NextResponse.json({ error: "Paparan tidak ditemukan" }, { status: 404 });
  }
  if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) {
    return NextResponse.json({ error: "Paparan tidak ditemukan" }, { status: 404 });
  }

  let content;
  try {
    content = parsePaparanContent(artifact.structuredContent);
  } catch {
    return NextResponse.json({ error: "Konten paparan tidak valid" }, { status: 422 });
  }

  const draf = !(artifact.frozenAt && (artifact.status === "beku" || artifact.status === "terkirim"));
  try {
    const buffer = await renderPaparanPdf(content, { draf });
    await audit(user.id, "ai.artifact.unduh_pdf", "ai_artifact", artifact.id, {
      kind: "paparan",
      version: artifact.version,
      draf,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${namaBerkasPaparan(content, artifact.version)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal merender PDF" },
      { status: 500 },
    );
  }
}
