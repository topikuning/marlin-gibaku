import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { buildCcoXlsx } from "@/lib/export/cco-xlsx";
import type { CcoNode } from "@/lib/rab/cco-rows";

export const dynamic = "force-dynamic";

/**
 * Unduh DOKUMEN CCO (.xlsx) — format berkas contoh KKP, sheet "CCO-01".
 *
 * Dibangun dari DUA revisi sekaligus: RAB aktif sebagai MC-0 dan draft adendum
 * sebagai CCO-01. Karena itu rutenya ada di halaman adendum, bukan di halaman
 * RAB: tanpa draft, tidak ada yang bisa dibandingkan.
 *
 * Dipagari `rab.manage` seperti template adendum — berkas ini bahan pengajuan
 * perubahan nilai kontrak, bukan bacaan umum.
 */
const pilih = {
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
} as const;

type BarisDb = {
  id: string;
  parentId: string | null;
  kind: string;
  code: string;
  name: string;
  unit: string | null;
  volume: unknown;
  unitPrice: unknown;
  amount: bigint;
  lineageKey: string;
};

const keCcoNode = (n: BarisDb): CcoNode => ({
  id: n.id,
  parentId: n.parentId,
  kind: n.kind as CcoNode["kind"],
  code: n.code,
  name: n.name,
  unit: n.unit,
  volume: n.volume == null ? null : Number(n.volume),
  unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
  amount: n.amount,
  lineageKey: n.lineageKey,
});

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
      village: true,
      district: true,
      regency: true,
      province: true,
      package: {
        select: {
          name: true,
          contract: {
            select: {
              contractNumber: true,
              workTitle: true,
              ppnPercent: true,
              // Penanda tangan: ketiganya sudah tercatat di kontrak, jadi dokumen
              // tidak perlu mencetak garis titik-titik (DECISIONS 243).
              ppkName: true,
              ppkNip: true,
              supervisorName: true,
              supervisorFirm: true,
              contractorSignerName: true,
              contractorSignerTitle: true,
              vendor: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const [aktif, draft] = await Promise.all([
    db.rabRevision.findFirst({
      where: { locationId: location.id, status: "aktif" },
      select: { id: true, revisionNo: true, totalValue: true },
    }),
    db.rabRevision.findFirst({
      where: { locationId: location.id, status: "draft" },
      select: { id: true, revisionNo: true, totalValue: true },
    }),
  ]);
  if (!aktif) return NextResponse.json({ error: "Belum ada revisi RAB aktif – tidak ada MC-0 untuk dibandingkan" }, { status: 404 });
  if (!draft) return NextResponse.json({ error: "Belum ada draft adendum – buat draftnya dulu di tab Adendum" }, { status: 404 });

  const [nodeLama, nodeBaru] = await Promise.all([
    db.rabNode.findMany({ where: { revisionId: aktif.id }, orderBy: { sortOrder: "asc" }, select: pilih }),
    db.rabNode.findMany({ where: { revisionId: draft.id }, orderBy: { sortOrder: "asc" }, select: pilih }),
  ]);

  const c = location.package.contract;
  const buf = await buildCcoXlsx({
    locationName: location.name,
    packageName: location.package.name,
    workTitle: c?.workTitle ?? null,
    address: [location.village, location.district, location.regency, location.province]
      .filter(Boolean)
      .join(", "),
    contractNumber: c?.contractNumber ?? null,
    vendorName: c?.vendor?.name ?? null,
    // PPN dari kontrak, JANGAN dipatok 11 (RAB pra-PPN, kontrak incl-PPN).
    ppnPercent: c ? Number(c.ppnPercent) : 11,
    // Nomor CCO = nomor revisi draft dikurangi HPS awal: revisi #2 = CCO-01.
    ccoNo: Math.max(1, draft.revisionNo - 1),
    // Nilai kontrak yang TERCATAT — dokumen memakainya untuk baris rekonsiliasi
    // terhadap Σ(harga × volume). Selisih bukan-nol harus terlihat, bukan
    // ditutup diam-diam (DECISIONS 203).
    nilaiTercatatLama: aktif.totalValue,
    nilaiTercatatBaru: draft.totalValue,
    // Pengaman di level berkas: volume CCO-01 tidak boleh turun di bawah
    // pekerjaan yang sudah dikerjakan (DECISIONS 242).
    realisasiByLineage: await cumulativeVolumeByLineage(location.id),
    ppkName: c?.ppkName ?? null,
    ppkNip: c?.ppkNip ?? null,
    supervisorName: c?.supervisorName ?? null,
    supervisorFirm: c?.supervisorFirm ?? null,
    contractorSignerName: c?.contractorSignerName ?? null,
    contractorSignerTitle: c?.contractorSignerTitle ?? null,
    lama: nodeLama.map(keCcoNode),
    baru: nodeBaru.map(keCcoNode),
  });

  await audit(user.id, "rab.cco_export", "rab_revision", draft.id, {
    locationId: location.id,
    revisiAktif: aktif.revisionNo,
    revisiDraft: draft.revisionNo,
  });

  const nama = `CCO-${String(Math.max(1, draft.revisionNo - 1)).padStart(2, "0")}_${slug}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nama}"`,
      "Cache-Control": "no-store",
    },
  });
}
