import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { simulasiRapl } from "@/lib/ahsp/rapl";
import { buildRaplXlsx } from "@/lib/export/rapl-xlsx";
import { muatLogoLaporan } from "@/lib/export/logo-laporan";

export const dynamic = "force-dynamic";

/**
 * Unduh KEBUTUHAN SUMBER DAYA (RAPL) satu lokasi sebagai .xlsx — DECISIONS 322.
 *
 * Capability `report.export` (bukan `rab.manage`): ini keluaran BACA. Orang yang
 * berhak melihat angka proyek berhak membawanya keluar; yang butuh hak kelola
 * adalah menyetujui padanan, dan itu jalur lain.
 *
 * Berkasnya diunduh apa adanya sesuai keadaan sekarang — termasuk saat belum
 * ada padanan yang disetujui. Menolak mengunduh selagi kosong akan membuat
 * orang mengira fiturnya rusak; berkas yang jujur berkata "belum ada yang
 * disetujui" lebih berguna daripada tombol yang diam.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });
  }

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      package: {
        select: {
          name: true,
          contract: {
            select: { contractNumber: true, vendor: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const [rapl, basis, logo] = await Promise.all([
    simulasiRapl(location.id),
    ringkasAhsp(),
    muatLogoLaporan(location.id),
  ]);
  if (!basis) {
    return NextResponse.json(
      { error: "Basis analisa AHSP belum dimuat — muat dulu di halaman Sistem." },
      { status: 409 },
    );
  }

  const buffer = await buildRaplXlsx(
    rapl,
    {
      lokasi: location.name,
      paket: location.package.name,
      kabupaten: location.regency,
      provinsi: location.province,
      kontrak: location.package.contract?.contractNumber ?? null,
      penyedia: location.package.contract?.vendor.name ?? null,
      sumberAhsp: basis.name,
      shaAhsp: basis.fileSha256,
      dicetakPada: new Date(),
      dicetakOleh: user.fullName,
    },
    { logo },
  );

  await audit(user.id, "report.export_rapl_xlsx", "location", location.id, {
    sumberDaya: rapl.kebutuhan.length,
    barisDipakai: rapl.dipakai.baris,
    barisRab: rapl.barisRab,
    nilaiDipakai: rapl.dipakai.nilai.toString(),
    nilaiRab: rapl.nilaiRab.toString(),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="kebutuhan-rapl-${slug}.xlsx"`,
    },
  });
}
