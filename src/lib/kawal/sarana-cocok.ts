/**
 * PER SARANA: sarana Kawal ↔ kelompok RAB MARLIN di satu lokasi (DECISIONS 694).
 * Murni, tanpa DB.
 *
 * Kelompok MARLIN = kategori RAB tingkat 1 revisi aktif; progresnya dari
 * `progresKelompokPerTanggal` (calculation layer, DECISIONS 683). Progres
 * sarana Kawal dipakai APA ADANYA. Di sini hanya: usulan pasangan dari nama,
 * keputusan orang yang menimpanya, dan selisih kedua angka.
 *
 * Usulan TIDAK pernah dianggap pasti: ia ditampilkan sebagai usulan sampai
 * dikonfirmasi orang. Bobot dan daftar sarana Kawal berbeda dari RAB, jadi
 * satu sarana Kawal bisa jatuh ke kelompok yang namanya lain sama sekali.
 */

export type SaranaKawalTampil = {
  kawalItemId: number;
  nama: string;
  jenis: string | null;
  bobot: number | null;
  progresPct: number | null;
};

export type KelompokMarlin = {
  /** `lineageKey` kategori tingkat 1. */
  kunci: string;
  code: string;
  name: string;
  /** Progres kelompok s/d hari ini (%), dari calculation layer. */
  progresPct: number;
};

export type KeputusanSarana = {
  kawalItemId: number;
  status: "dikonfirmasi" | "tidak_ada";
  lineageKey: string | null;
};

export type AsalPasangan = "dikonfirmasi" | "usulan" | "tidak_ada" | "belum";

export type BarisSarana = {
  sarana: SaranaKawalTampil;
  kelompok: KelompokMarlin | null;
  asal: AsalPasangan;
  /** Keputusan orang menunjuk kelompok yang tidak ada lagi di RAB aktif. */
  kelompokHilang: boolean;
  /** MARLIN − Kawal (pp, dibulatkan 0,01); null bila salah satu tidak ada. */
  selisihPp: number | null;
};

export type HasilPerSarana = {
  baris: BarisSarana[];
  /** Kelompok MARLIN yang tidak dipasangkan dengan sarana Kawal mana pun. */
  kelompokTanpaPasangan: KelompokMarlin[];
};

/** Kata yang tidak membedakan sarana satu dengan lainnya. */
const KATA_UMUM = new Set(["pekerjaan", "pembangunan", "bangunan", "dan", "serta", "unit", "the"]);
const ROMAWI = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/** Kata bermakna dari sebuah nama: huruf kecil, tanpa nomor, romawi, dan kata umum. */
export function kataSarana(nama: string): Set<string> {
  return new Set(
    nama
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !ROMAWI.test(w) && !KATA_UMUM.has(w)),
  );
}

/** Kemiripan dua nama: irisan ÷ gabungan kata bermakna (0..1). */
export function kemiripanNama(a: string, b: string): number {
  const x = kataSarana(a);
  const y = kataSarana(b);
  if (x.size === 0 || y.size === 0) return 0;
  let sama = 0;
  for (const w of x) if (y.has(w)) sama++;
  return sama / (x.size + y.size - sama);
}

/** Usulan hanya bila setidaknya separuh kata bermaknanya sama. */
export const AMBANG_USULAN = 0.5;

const bulat = (n: number) => Math.round(n * 100) / 100;

export function pasangkanSarana(
  sarana: SaranaKawalTampil[],
  kelompok: KelompokMarlin[],
  keputusan: KeputusanSarana[],
): HasilPerSarana {
  const perKunci = new Map(kelompok.map((k) => [k.kunci, k]));
  const putusan = new Map(keputusan.map((d) => [d.kawalItemId, d]));
  const dipakai = new Set<string>();
  const hasil = new Map<number, Omit<BarisSarana, "selisihPp">>();

  // 1. Keputusan orang lebih dulu – ia menang atas usulan apa pun.
  for (const s of sarana) {
    const d = putusan.get(s.kawalItemId);
    if (!d) continue;
    if (d.status === "tidak_ada") {
      hasil.set(s.kawalItemId, { sarana: s, kelompok: null, asal: "tidak_ada", kelompokHilang: false });
      continue;
    }
    const k = d.lineageKey ? perKunci.get(d.lineageKey) : undefined;
    if (k) dipakai.add(k.kunci);
    hasil.set(s.kawalItemId, { sarana: s, kelompok: k ?? null, asal: k ? "dikonfirmasi" : "belum", kelompokHilang: !k });
  }

  // 2. Usulan untuk sisanya: pasangan termirip lebih dulu, satu kelompok satu
  //    sarana. Nilai seri di puncak = tidak tunggal = tidak diusulkan.
  const calon: { s: SaranaKawalTampil; k: KelompokMarlin; skor: number }[] = [];
  for (const s of sarana) {
    if (hasil.has(s.kawalItemId)) continue;
    for (const k of kelompok) {
      if (dipakai.has(k.kunci)) continue;
      const skor = kemiripanNama(s.nama, k.name);
      if (skor >= AMBANG_USULAN) calon.push({ s, k, skor });
    }
  }
  calon.sort((a, b) => b.skor - a.skor);
  type Calon = (typeof calon)[number];
  const bebas = (x: Calon) => !hasil.has(x.s.kawalItemId) && !dipakai.has(x.k.kunci);
  const seri = (c: Calon) =>
    calon.some(
      (x) =>
        x !== c && x.skor === c.skor && bebas(x) && (x.s.kawalItemId === c.s.kawalItemId || x.k.kunci === c.k.kunci),
    );
  for (const c of calon) {
    if (!bebas(c) || seri(c)) continue;
    dipakai.add(c.k.kunci);
    hasil.set(c.s.kawalItemId, { sarana: c.s, kelompok: c.k, asal: "usulan", kelompokHilang: false });
  }

  const baris: BarisSarana[] = sarana.map((s) => {
    const b = hasil.get(s.kawalItemId) ?? { sarana: s, kelompok: null, asal: "belum" as const, kelompokHilang: false };
    const selisihPp =
      b.kelompok && s.progresPct != null && Number.isFinite(s.progresPct)
        ? bulat(b.kelompok.progresPct - s.progresPct)
        : null;
    return { ...b, selisihPp };
  });
  const terpasang = new Set(baris.flatMap((b) => (b.kelompok ? [b.kelompok.kunci] : [])));
  return { baris, kelompokTanpaPasangan: kelompok.filter((k) => !terpasang.has(k.kunci)) };
}

export const LABEL_ASAL: Record<AsalPasangan, string> = {
  dikonfirmasi: "dikonfirmasi",
  usulan: "usulan otomatis",
  tidak_ada: "tidak ada padanannya di RAB",
  belum: "belum dipasangkan",
};
