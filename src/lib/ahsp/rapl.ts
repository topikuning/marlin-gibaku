import "server-only";
import { db } from "@/lib/db";
import { normalisasiSatuan } from "./cocok";
import { itemRabAktif, metodeDisetujui } from "./padanan";
import {
  agregasiKebutuhan,
  hitungItemRapl,
  type BiayaItem,
  type HasilRapl,
  type HargaSatuan,
  type ItemUntukRapl,
} from "./rapl-calc";

/**
 * Simulasi RAPL satu lokasi (DECISIONS 320, diperluas 470): baca data, lalu
 * serahkan seluruh perhitungannya ke `rapl-calc.ts`. Tidak ada formula di
 * berkas ini.
 */

export type SimulasiRapl = HasilRapl & {
  /** Nilai RAB seluruh item kerja lokasi ini — penyebut semua persentase. */
  nilaiRab: bigint;
  barisRab: number;
};

/**
 * Rakit masukan perhitungan: item RAB aktif + padanan AHSP yang DISETUJUI +
 * rincian yang disusun orang.
 *
 * Satu tempat untuk keduanya (agregat sumber daya dan biaya per item), supaya
 * dua layar yang menampilkan angka dari data yang sama tidak pernah bekerja
 * dari masukan yang berbeda.
 */
export async function itemUntukRapl(locationId: string): Promise<ItemUntukRapl[]> {
  const items = await itemRabAktif(locationId);
  if (items.length === 0) return [];
  const tanda = [...new Set(items.map((i) => i.tanda))];

  const [padanan, rincian] = await Promise.all([
    tanda.length
      ? db.ahspPadanan.findMany({
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
      : Promise.resolve([]),
    db.raplRincian.findMany({
      where: { locationId },
      select: {
        lineageKey: true,
        faktorKonversi: true,
        catatanKonversi: true,
        hargaBorongan: true,
        tambahan: {
          select: { kategori: true, nama: true, satuan: true, koefisien: true },
        },
      },
    }),
  ]);

  // Hanya padanan yang sudah ada yang menyetujui yang boleh menjadi angka.
  // Usulan mesin sengaja diperlakukan seperti tidak ada padanan — bukan
  // "dipakai sementara sambil menunggu".
  const peta = new Map(
    padanan.filter((p) => metodeDisetujui(p.metode)).map((p) => [p.tanda, p.entry!]),
  );
  // Usulan mesin yang MASIH menunggu — bukan dipakai menghitung, hanya untuk
  // memberi tahu bahwa barisnya tinggal disetujui, bukan perlu dicari.
  const menunggu = new Set(padanan.filter((p) => p.metode === "otomatis").map((p) => p.tanda));

  const petaRincian = new Map(rincian.map((r) => [r.lineageKey, r]));

  return items.map((it) => {
    const e = peta.get(it.tanda);
    const r = petaRincian.get(it.lineageKey);
    return {
      lineageKey: it.lineageKey,
      code: it.code,
      uraian: it.name,
      satuanNorm: normalisasiSatuan(it.unit),
      volume: it.volume,
      amount: it.amount,
      adaUsulan: menunggu.has(it.tanda),
      rincian: r
        ? {
            faktorKonversi: r.faktorKonversi === null ? null : Number(r.faktorKonversi),
            catatanKonversi: r.catatanKonversi,
            hargaBorongan: r.hargaBorongan,
            tambahan: r.tambahan.map((t) => ({
              kategori: t.kategori,
              nama: t.nama,
              satuan: t.satuan,
              koefisien: Number(t.koefisien),
            })),
          }
        : undefined,
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
}

export async function simulasiRapl(locationId: string): Promise<SimulasiRapl> {
  const untukHitung = await itemUntukRapl(locationId);
  const hasil = agregasiKebutuhan(untukHitung);
  return {
    ...hasil,
    nilaiRab: untukHitung.reduce((a, it) => a + it.amount, 0n),
    barisRab: untukHitung.length,
  };
}

export type KeadaanItemRapl = {
  item: BiayaItem[];
  /** Σ biaya seluruh item yang RINCIANNYA LENGKAP — bukan sebagian. */
  biayaLengkap: bigint;
  nilaiRabLengkap: bigint;
  jumlahLengkap: number;
  /** Item yang marginnya NEGATIF: inilah daftar yang dicari orang. */
  jumlahRugi: number;
};

/**
 * Biaya + margin per item RAB (RAPL-08, DECISIONS 470).
 *
 * Ringkasannya sengaja hanya menjumlahkan item yang LENGKAP: mencampur item
 * yang biayanya baru separuh diketahui ke dalam satu total akan menghasilkan
 * "margin" yang selalu terlihat besar, dan itu angka yang dipakai orang
 * memutuskan menawar.
 */
export async function keadaanItemRapl(locationId: string): Promise<KeadaanItemRapl> {
  const [untukHitung, hsd] = await Promise.all([
    itemUntukRapl(locationId),
    db.hargaSatuanDasar.findMany({
      where: { locationId },
      select: { kategori: true, nama: true, satuan: true, harga: true },
    }),
  ]);

  const item = hitungItemRapl(untukHitung, hsd as HargaSatuan[]);
  const lengkap = item.filter((i) => i.lengkap);
  return {
    item,
    biayaLengkap: lengkap.reduce((a, i) => a + i.biaya, 0n),
    nilaiRabLengkap: lengkap.reduce((a, i) => a + i.nilaiRab, 0n),
    jumlahLengkap: lengkap.length,
    jumlahRugi: lengkap.filter((i) => i.margin !== null && i.margin < 0n).length,
  };
}
