import "server-only";
import { db } from "@/lib/db";
import { simulasiRapl } from "./rapl";
import {
  bandingkanDenganNilaiProyek,
  hitungBiaya,
  kunciSumberDaya,
  type BarisBiaya,
  type Perbandingan,
} from "./rapl-calc";

/**
 * Harga Satuan Dasar per lokasi + biaya RAPL (DECISIONS 327).
 *
 * Tidak ada formula di berkas ini — semuanya di `rapl-calc.ts` (CLAUDE.md
 * aturan 7). Yang dikerjakan di sini cuma membaca, menulis, dan mencarikan
 * rekomendasi harga dari lokasi lain.
 */

export type BarisHarga = BarisBiaya & {
  /** Dari mana harganya (survei/penawaran/kontrak lalu). */
  sumber: string | null;
  catatan: string | null;
  /**
   * Harga sumber daya yang SAMA di lokasi lain — bahan pertimbangan, bukan
   * nilai yang dipakai. Diurut: satu kabupaten dulu, baru satu paket.
   */
  rekomendasi: {
    harga: bigint;
    lokasi: string;
    kabupaten: string;
    seKabupaten: boolean;
    sePaket: boolean;
  }[];
};

export type KeadaanHarga = {
  baris: BarisHarga[];
  totalBiaya: bigint;
  berharga: number;
  belumBerharga: number;
  perKategori: { kategori: string; biaya: bigint; berharga: number; total: number }[];
  /** Perbandingan terhadap nilai RAB aktif lokasi. */
  perbandingan: Perbandingan;
};

export async function keadaanHarga(locationId: string): Promise<KeadaanHarga> {
  const rapl = await simulasiRapl(locationId);

  const lokasi = await db.location.findUniqueOrThrow({
    where: { id: locationId },
    select: {
      regency: true,
      packageId: true,
    },
  });

  const tersimpan = await db.hargaSatuanDasar.findMany({
    where: { locationId },
    select: { kategori: true, nama: true, satuan: true, harga: true, sumber: true, catatan: true },
  });

  const biaya = hitungBiaya(rapl.kebutuhan, tersimpan);

  /*
   * REKOMENDASI dari lokasi lain — hanya untuk sumber daya yang memang muncul
   * di lokasi ini, dan hanya dari lokasi yang sekabupaten atau sepaket.
   * Sengaja TIDAK dari seluruh Indonesia: harga pasir Demak bukan acuan untuk
   * Sumenep, dan menawarkannya justru mengundang salah pakai.
   */
  const kunciDipakai = new Set(
    rapl.kebutuhan.map((k) => kunciSumberDaya(k.kategori, k.nama, k.satuan)),
  );
  const lain =
    kunciDipakai.size === 0
      ? []
      : await db.hargaSatuanDasar.findMany({
          where: {
            locationId: { not: locationId },
            harga: { gt: 0n },
            location: {
              OR: [{ regency: lokasi.regency }, { packageId: lokasi.packageId }],
            },
          },
          select: {
            kategori: true,
            nama: true,
            satuan: true,
            harga: true,
            location: { select: { name: true, regency: true, packageId: true } },
          },
          orderBy: { updatedAt: "desc" },
        });

  const perKunci = new Map<string, BarisHarga["rekomendasi"]>();
  for (const r of lain) {
    const kunci = kunciSumberDaya(r.kategori, r.nama, r.satuan);
    if (!kunciDipakai.has(kunci)) continue;
    const daftar = perKunci.get(kunci) ?? [];
    daftar.push({
      harga: r.harga,
      lokasi: r.location.name,
      kabupaten: r.location.regency,
      seKabupaten: r.location.regency === lokasi.regency,
      sePaket: r.location.packageId === lokasi.packageId,
    });
    perKunci.set(kunci, daftar);
  }

  const perSumber = new Map(
    tersimpan.filter((t) => t.harga > 0n).map((t) => [
      kunciSumberDaya(t.kategori, t.nama, t.satuan),
      { sumber: t.sumber, catatan: t.catatan },
    ]),
  );

  const baris: BarisHarga[] = biaya.baris.map((b) => {
    const kunci = kunciSumberDaya(b.kategori, b.nama, b.satuan);
    const meta = perSumber.get(kunci);
    const rek = (perKunci.get(kunci) ?? [])
      // Sekabupaten lebih dulu — itu yang paling dekat dengan kenyataan
      // harga di lokasi ini.
      .sort((x, y) => Number(y.seKabupaten) - Number(x.seKabupaten))
      .slice(0, 3);
    return { ...b, sumber: meta?.sumber ?? null, catatan: meta?.catatan ?? null, rekomendasi: rek };
  });

  return {
    baris,
    totalBiaya: biaya.totalBiaya,
    berharga: biaya.berharga,
    belumBerharga: biaya.belumBerharga,
    perKategori: biaya.perKategori,
    perbandingan: bandingkanDenganNilaiProyek({
      biayaRapl: biaya.totalBiaya,
      nilaiProyek: rapl.nilaiRab,
      nilaiRabTerhitung: rapl.dipakai.nilai,
      nilaiRabTotal: rapl.nilaiRab,
      sumberDayaBerharga: biaya.berharga,
      sumberDayaTotal: biaya.baris.length,
    }),
  };
}
