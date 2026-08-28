import { NextResponse, type NextRequest } from "next/server";
import { accessibleLocationIds, getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { audit } from "@/lib/audit";
import { parseAiReportContent } from "@/lib/ai-hub/render";
import { buildAiReportWorkbook } from "@/lib/ai-hub/excel";

export const dynamic = "force-dynamic";

/**
 * Export artefak laporan AI ke xlsx (exceljs, pola export existing). Data dari
 * structuredContent kanonik — angka sama dengan pratinjau/cetak/WA. DECISIONS 133.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "ai.view")) return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const artifact = await db.aiArtifact.findUnique({
    where: { id },
    select: { id: true, kind: true, title: true, version: true, structuredContent: true, run: { select: { scopeIds: true } } },
  });
  if (!artifact || artifact.kind !== "laporan") {
    return NextResponse.json({ error: "Artefak tidak ditemukan" }, { status: 404 });
  }
  // Scope baca (audit 2026-07-27, B9): 404, bukan 403 — jangan konfirmasi keberadaan.
  if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) {
    return NextResponse.json({ error: "Artefak tidak ditemukan" }, { status: 404 });
  }

  let content;
  try {
    content = parseAiReportContent(artifact.structuredContent);
  } catch {
    return NextResponse.json({ error: "Konten artefak tidak valid" }, { status: 422 });
  }

  const wb = buildAiReportWorkbook(content);
  const buffer = await wb.xlsx.writeBuffer();
  await audit(user.id, "ai.artifact.export_xlsx", "ai_artifact", artifact.id, { version: artifact.version });

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="laporan-ai-v${artifact.version}.xlsx"`,
    },
  });
}
