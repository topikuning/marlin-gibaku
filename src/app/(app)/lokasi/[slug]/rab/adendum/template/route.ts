import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { buildAdendumTemplateXlsx, type AdendumTemplateNode } from "@/lib/export/adendum-template-xlsx";

export const dynamic = "force-dynamic";

/**
 * Unduh TEMPLATE KERJA ADENDUM (.xlsx) dari RAB revisi aktif — isi kolom
 * VOLUME ADENDUM di Excel, lalu impor balik ke draft adendum. DECISIONS 216.
 *
 * Dipagari `rab.manage`, bukan `rab.view` seperti ekspor RAB biasa: berkas ini
 * bukan untuk dibaca, melainkan untuk mengubah nilai kontrak.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "rab.manage")) return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      package: {
        select: {
          name: true,
          contract: { select: { contractNumber: true, vendor: { select: { name: true } } } },
        },
      },
    },
  });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const active = await db.rabRevision.findFirst({
    where: { locationId: location.id, status: "aktif" },
    select: { id: true, revisionNo: true, totalValue: true },
  });
  if (!active) return NextResponse.json({ error: "Belum ada revisi RAB aktif" }, { status: 404 });

  const nodes = await db.rabNode.findMany({
    where: { revisionId: active.id },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      parentId: true,
      kind: true,
      code: true,
      name: true,
      unit: true,
      volume: true,
      unitPrice: true,
      amount: true,
      lineageKey: true,
    },
  });

  const contract = location.package.contract;
  const buffer = await buildAdendumTemplateXlsx({
    locationName: location.name,
    packageName: location.package.name,
    contractNumber: contract?.contractNumber ?? null,
    vendorName: contract?.vendor.name ?? null,
    revisionNo: active.revisionNo,
    totalValue: active.totalValue,
    // Realisasi lapangan ikut ke berkas: itu dasar pengaman "volume tidak boleh
    // turun di bawah yang sudah dikerjakan" — lihat DECISIONS 242.
    realisasiByLineage: await cumulativeVolumeByLineage(location.id),
    nodes: nodes.map(
      (n): AdendumTemplateNode => ({
        id: n.id,
        parentId: n.parentId,
        kind: n.kind as AdendumTemplateNode["kind"],
        code: n.code,
        name: n.name,
        unit: n.unit,
        volume: n.volume == null ? null : Number(n.volume),
        unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
        amount: n.amount,
        lineageKey: n.lineageKey,
      }),
    ),
  });

  await audit(user.id, "rab.export_template_adendum", "rab_revision", active.id, {
    locationId: location.id,
    revisionNo: active.revisionNo,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template-adendum-${slug}-rev${active.revisionNo}.xlsx"`,
    },
  });
}
