import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey, parseDateKey } from "@/lib/format";

/**
 * SATU aturan "lokasi ini sudah melapor hari ini atau belum", dipakai bersama
 * pengingat perorangan dan pengingat grup.
 *
 * Dipisah bukan karena kodenya panjang, melainkan karena dua penagih yang
 * masing-masing menghitung sendiri PASTI menyimpang cepat atau lambat — dan
 * saat itu terjadi, satu orang ditagih untuk lokasi yang menurut grup sudah
 * beres. Yang bertengkar bukan kodenya, tapi orangnya.
 */

/**
 * Sudah dianggap melapor begitu laporannya KELUAR dari draf (dikirim, perlu
 * koreksi, disetujui, final). Menunggu sampai `final` berarti menagih orang
 * yang sudah mengerjakan bagiannya dan kini menunggu atasannya.
 */
export function sudahLapor(status: string | null | undefined): boolean {
  return status != null && status !== "draft";
}

export type LokasiTertagihPaket = {
  locationId: string;
  nama: string;
  /** true = barisnya ada tapi masih draf. */
  adaDraft: boolean;
};

export type TagihanPaket = {
  packageId: string;
  namaPaket: string;
  waGroupId: string;
  belum: LokasiTertagihPaket[];
  /** Lokasi paket ini yang laporannya SUDAH masuk hari itu. */
  sudah: number;
};

/**
 * Tagihan laporan harian per PAKET yang punya grup WhatsApp.
 *
 * Lingkupnya sama persis dengan pengingat perorangan: lokasi berjalan, di paket
 * `pelaksanaan`, yang SPMK-nya sudah lewat. Paket tanpa `waGroupId` tidak ikut —
 * bukan kegagalan, ia memang belum disiapkan.
 */
export async function tagihanPerPaket(
  now = new Date(),
  opts: { packageId?: string; orgId?: string } = {},
): Promise<TagihanPaket[]> {
  const tanggal = parseDateKey(jakartaDateKey(now))!;

  const paket = await db.package.findMany({
    where: {
      stage: "pelaksanaan",
      waGroupId: { not: null },
      contract: { startDate: { not: null, lte: tanggal } },
      ...(opts.packageId ? { id: opts.packageId } : {}),
      ...(opts.orgId ? { orgId: opts.orgId } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      waGroupId: true,
      locations: {
        where: { status: "berjalan", isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          dailyReports: { where: { reportDate: tanggal }, select: { status: true } },
        },
      },
    },
  });

  const hasil: TagihanPaket[] = [];
  for (const p of paket) {
    if (!p.waGroupId) continue;
    const belum: LokasiTertagihPaket[] = [];
    let sudah = 0;
    for (const l of p.locations) {
      const laporan = l.dailyReports[0];
      if (sudahLapor(laporan?.status)) {
        sudah += 1;
        continue;
      }
      belum.push({ locationId: l.id, nama: l.name, adaDraft: !!laporan });
    }
    hasil.push({
      packageId: p.id,
      namaPaket: p.name,
      waGroupId: p.waGroupId,
      belum,
      sudah,
    });
  }
  return hasil;
}
