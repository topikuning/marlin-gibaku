import { autoCategorySchedule, weeklyFromSegments } from "@/lib/scurve/generate";

/**
 * BARIS KURVA-S vs RAB AKTIF (DECISIONS 794) – murni.
 *
 * Keluhan user 2026-11-26 (Kurva S minggu ke-10 BUYAT TENGAH): *"kenapa kamu
 * sajikan tambatan perahu yang volume jelas 0 … lalu pekerjaan tidak ada judul
 * yang sudah hilang juga kamu munculkan"*, dan *"dulu hal ini tidak pernah
 * terjadi, ketika di rab baru sudah tidak ada ya gak muncul"*.
 *
 * Jadwal tersimpan (baseline) membawa satu baris per kategori sejak dibuat.
 * Sesudah adendum/koreksi, sebagian kategorinya tidak ada lagi di RAB aktif
 * (kategori bayangan parser lama, "judul tidak ada di file") atau bernilai 0
 * (Tambatan Perahu dinolkan CCO). Adendum sengaja tidak mengubah bobot jadwal
 * (DECISIONS 698), jadi:
 *
 * - baris BERBOBOT 0 yang pekerjaannya tidak ada/bernilai 0 di RAB aktif tidak
 *   ditampilkan – tidak satu angka pun berubah;
 * - baris yang MASIH BERBOBOT tetap tampil (bobotnya bagian rencana resmi;
 *   menyembunyikannya membuat rencana tidak berbaris), tetapi ketidakcocokannya
 *   dilaporkan supaya jadwalnya diperbarui – begitu juga pekerjaan RAB aktif
 *   yang belum berjadwal.
 */

const NOL = 0.005;

export type BarisKurva = { lineageKey: string; code: string; name: string; weekly: number[] };
export type KategoriRab = { lineageKey: string; code: string; name: string; amount: bigint };

export type KurvaTakSesuai = {
  /** Berbobot di kurva-S, tetapi tidak ada atau bernilai 0 di RAB aktif. */
  tanpaRab: { name: string; bobot: number }[];
  /** Ada dan bernilai di RAB aktif, tetapi bobotnya 0 di kurva-S. */
  tanpaJadwal: { code: string; name: string; bobotRab: number }[];
};

export function cocokkanKurvaDenganRab(
  baris: readonly BarisKurva[],
  kategori: readonly KategoriRab[],
): { tampil: BarisKurva[]; takSesuai: KurvaTakSesuai | null } {
  const nilai = new Map(kategori.map((k) => [k.lineageKey, k.amount]));
  const total = kategori.reduce((s, k) => s + (k.amount > 0n ? k.amount : 0n), 0n);
  const bobot = (b: BarisKurva) => b.weekly.reduce((s, v) => s + v, 0);
  const diRab = (key: string) => (nilai.get(key) ?? 0n) > 0n;

  const tampil = baris.filter((b) => bobot(b) > NOL || diRab(b.lineageKey));
  const tanpaRab = baris
    .filter((b) => bobot(b) > NOL && !diRab(b.lineageKey))
    .map((b) => ({ name: b.name, bobot: Math.round(bobot(b) * 100) / 100 }));
  const berbobot = new Set(baris.filter((b) => bobot(b) > NOL).map((b) => b.lineageKey));
  const tanpaJadwal = kategori
    .filter((k) => k.amount > 0n && !berbobot.has(k.lineageKey))
    .map((k) => ({
      code: k.code,
      name: k.name,
      bobotRab: total > 0n ? Math.round((Number(k.amount) / Number(total)) * 10_000) / 100 : 0,
    }));
  return {
    tampil,
    takSesuai: tanpaRab.length > 0 || tanpaJadwal.length > 0 ? { tanpaRab, tanpaJadwal } : null,
  };
}

/**
 * JADWAL ACUAN MENGIKUTI RAB AKTIF (DECISIONS 795) – dipakai "Simpan kurva
 * manual" sebelum jadwal dipetakan ke kurva baru (`rescheduleToCurve`).
 *
 * Keluhan user 2026-11-26: penyesuaian halus %-mingguan sesudah CCO tetap
 * membawa kategori lama (Tambatan Perahu, kategori bayangan) dan tidak memuat
 * kategori baru – baru benar sesudah "Hitung ulang" lalu disimpan manual lagi.
 * Layarnya sendiri berjanji "Bobot tiap pekerjaan tetap sesuai RAB, hanya
 * waktunya yang bergeser".
 *
 * Baris = kategori RAB aktif yang bernilai, urut RAB; bobot = porsinya di RAB.
 * Bentuk waktunya:
 * - pekerjaan yang sudah punya jadwal: bentuk lamanya, diskalakan ke bobot RAB;
 * - pekerjaan baru (atau yang jadwalnya kosong): jendela otomatis yang sama
 *   dengan "Hitung ulang" (`autoCategorySchedule`).
 * Pekerjaan berbobot yang tidak ada lagi di RAB aktif keluar, dan disebut.
 */
export function jadwalAcuanIkutRab(
  lama: readonly { lineageKey: string; name: string; weekly: number[] }[],
  kategori: readonly { lineageKey: string; name: string; amount: bigint }[],
  minggu: number,
  weekEndFracs?: number[] | null,
): { rows: { lineageKey: string; name: string; weightPct: number; weekly: number[] }[]; keluar: string[]; masuk: string[] } {
  const bernilai = kategori.filter((k) => k.amount > 0n);
  const grand = bernilai.reduce((s, k) => s + Number(k.amount), 0);
  const jumlah = (w: number[]) => w.reduce((s, v) => s + v, 0);
  const lamaByKey = new Map(lama.map((r) => [r.lineageKey, r]));
  const auto = new Map(
    autoCategorySchedule(
      bernilai.map((k) => ({ lineageKey: k.lineageKey, name: k.name, amount: k.amount })),
      minggu,
      weekEndFracs,
    ).map((a) => [a.lineageKey, a]),
  );
  const masuk: string[] = [];
  const rows = grand <= 0 ? [] : bernilai.map((k) => {
    const weightPct = (Number(k.amount) / grand) * 100;
    const r = lamaByKey.get(k.lineageKey);
    let weekly: number[];
    if (r && r.weekly.length === minggu && jumlah(r.weekly) > NOL) {
      const f = weightPct / jumlah(r.weekly);
      weekly = r.weekly.map((v) => v * f);
    } else {
      const a = auto.get(k.lineageKey);
      weekly = weeklyFromSegments(weightPct, [{ startWeek: a?.startWeek ?? 1, endWeek: a?.endWeek ?? minggu }], minggu, weekEndFracs);
      masuk.push(k.name);
    }
    return { lineageKey: k.lineageKey, name: k.name, weightPct, weekly };
  });
  const diRab = new Set(bernilai.map((k) => k.lineageKey));
  const keluar = lama.filter((r) => !diRab.has(r.lineageKey) && jumlah(r.weekly) > NOL).map((r) => r.name);
  return { rows, keluar, masuk };
}
