import type { ItemRab, MasukanRencana } from "./rencana";
import type { BarisRekap, Cocok, LaporanMarlin, ModeImpor, PilihanBentrok, RekapMatriks, SelMarlin } from "./jenis";

/**
 * Bahan pratinjau impor REKAP HARIAN dan cara menyusunnya jadi masukan
 * rencana (DECISIONS 782). MURNI: dipakai layar (rencana dihitung ulang tiap
 * kali orang mengubah pilihan) DAN server (rencana disusun ulang saat
 * menyimpan, sidiknya harus sama).
 */

export type BahanPratinjau = {
  sheet: string;
  kolomTanggal: number;
  awalPeriode: string;
  akhirPeriode: string | null;
  tersembunyi: RekapMatriks["tersembunyi"];
  barisTersembunyi: number[];
  teksDiSelTanggal: RekapMatriks["teksDiSelTanggal"];
  /** Baris yang berisi angka saja. */
  baris: BarisRekap[];
  cocok: Record<number, Cocok>;
  /** Daun RAB aktif untuk pilihan manual + rencana. */
  daun: (ItemRab & { lineageKey: string })[];
  marlin: Record<string, Record<string, SelMarlin>>;
  laporan: Record<string, LaporanMarlin>;
  tertutup: Record<string, string>;
  izin: { ubahTerkirim: boolean; ubahFinal: boolean };
  hariIni: string;
};

/** Pilihan orang di pratinjau. */
export type PilihanImpor = {
  mode: ModeImpor;
  /** excelRow → kunci item pilihan orang, atau "lewati". Yang tidak disebut memakai hasil cocok otomatis. */
  tujuan: Record<number, string>;
  pilihan: Record<string, PilihanBentrok>;
  /** Foto di baris yang dinolkan ikut pindah ke tanggal Excel terdekat (DECISIONS 783). */
  pindahFoto?: boolean;
};

/** Bahan rencana dari bahan pratinjau + pilihan orang. Dipakai layar DAN server. */
export function masukanRencana(b: BahanPratinjau, p: PilihanImpor): MasukanRencana {
  const daun = new Map(b.daun.map((d) => [d.lineageKey, d]));
  return {
    mode: p.mode,
    hariIni: b.hariIni,
    awalPeriode: b.awalPeriode,
    akhirPeriode: b.akhirPeriode,
    baris: b.baris.map((x) => {
      const pilih = p.tujuan[x.excelRow];
      const otomatis = b.cocok[x.excelRow];
      const lineageKey =
        pilih === "lewati" ? null : pilih && daun.has(pilih) ? pilih : otomatis?.lineageKey ?? null;
      return { excelRow: x.excelRow, nama: x.nama, lineageKey, sel: x.sel.map((s) => ({ tanggal: s.tanggal, volume: s.volume })) };
    }),
    pindahFoto: p.pindahFoto === true,
    rab: Object.fromEntries(b.daun.map((d) => [d.lineageKey, { name: d.name, unit: d.unit, volume: d.volume, jalur: d.jalur }])),
    marlin: b.marlin,
    laporan: b.laporan,
    tertutup: b.tertutup,
    izin: b.izin,
    pilihan: p.pilihan,
  };
}

