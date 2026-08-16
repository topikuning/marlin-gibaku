import "server-only";
import { db } from "@/lib/db";
import { normalisasiSatuan } from "./cocok";
import { itemRabAktif, metodeDisetujui } from "./padanan";
import { agregasiKebutuhan, type HasilRapl, type ItemUntukRapl } from "./rapl-calc";

/**
 * Simulasi RAPL satu lokasi (DECISIONS 320): baca data, lalu serahkan seluruh
 * perhitungannya ke `rapl-calc.ts`. Tidak ada formula di berkas ini.
 */

export type SimulasiRapl = HasilRapl & {
  /** Nilai RAB seluruh item kerja lokasi ini — penyebut semua persentase. */
  nilaiRab: bigint;
  barisRab: number;
};

export async function simulasiRapl(locationId: string): Promise<SimulasiRapl> {
  const items = await itemRabAktif(locationId);
  const tanda = [...new Set(items.map((i) => i.tanda))];

  const padanan = tanda.length
    ? await db.ahspPadanan.findMany({
        where: { tanda: { in: tanda }, entryId: { not: null } },
        select: {
          tanda: true,
          metode: true,
          entry: {
            select: {
              kode: true,
              uraian: true,
              satuan: true,
              components: {
                orderBy: { urutan: "asc" },
                select: { kategori: true, nama: true, satuan: true, koefisien: true },
              },
            },
          },
        },
      })
    : [];

  // Hanya padanan yang sudah ada yang menyetujui yang boleh menjadi angka.
  // Usulan mesin sengaja diperlakukan seperti tidak ada padanan — bukan
  // "dipakai sementara sambil menunggu".
  const peta = new Map(
    padanan.filter((p) => metodeDisetujui(p.metode)).map((p) => [p.tanda, p.entry!]),
  );

  const untukHitung: ItemUntukRapl[] = items.map((it) => {
    const e = peta.get(it.tanda);
    return {
      lineageKey: it.lineageKey,
      code: it.code,
      uraian: it.name,
      satuanNorm: normalisasiSatuan(it.unit),
      volume: it.volume,
      amount: it.amount,
      analisa: e
        ? {
            kode: e.kode,
            uraian: e.uraian,
            satuanNorm: normalisasiSatuan(e.satuan),
            komponen: e.components.map((c) => ({
              kategori: c.kategori,
              nama: c.nama,
              satuan: c.satuan,
              koefisien: Number(c.koefisien),
            })),
          }
        : null,
    };
  });

  const hasil = agregasiKebutuhan(untukHitung);
  return {
    ...hasil,
    nilaiRab: items.reduce((a, it) => a + it.amount, 0n),
    barisRab: items.length,
  };
}
