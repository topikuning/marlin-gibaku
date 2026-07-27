import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { accessibleLocationIds, getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { audit } from "@/lib/audit";
import { parseAiReportContent, renderAiReportExcelRows } from "@/lib/ai-hub/render";

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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Angka Resmi");
  const rows = renderAiReportExcelRows(content);
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  const ws2 = wb.addWorksheet("Narasi AI");
  ws2.addRow(["Judul", content.report.title]);
  ws2.addRow(["Status keseluruhan", content.report.overallStatus]);
  ws2.addRow(["Confidence AI (%)", content.report.confidence]);
  ws2.addRow([]);
  ws2.addRow(["Ringkasan eksekutif"]);
  ws2.addRow([content.report.executiveSummary]);
  ws2.addRow([]);
  for (const s of content.report.sections) {
    ws2.addRow([s.heading]);
    ws2.addRow([s.body]);
    ws2.addRow([]);
  }
  ws2.getColumn(1).width = 110;
  ws2.eachRow((r) => {
    r.alignment = { wrapText: true, vertical: "top" };
  });

  const buffer = await wb.xlsx.writeBuffer();
  await audit(user.id, "ai.artifact.export_xlsx", "ai_artifact", artifact.id, { version: artifact.version });

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="laporan-ai-v${artifact.version}.xlsx"`,
    },
  });
}
