import type { FlatNode } from "@/lib/rab/flatten";

/**
 * PASANGKAN ITEM BERKAS ARSIP ↔ ITEM REVISI (DECISIONS baru 2026-10-06). Murni.
 *
 * Urutan bukti, dari yang paling kuat:
 *   1. lineage sama DAN kode + nama sama;
 *   2. (jalur induk, kode, nama, volume, harga) satu-satunya di kedua sisi;
 *   3. (kode, nama, volume, harga) satu-satunya;
 *   4. (nama, volume, harga) satu-satunya;
 *   5. baris kembar persis di induk yang sama → menurut urutan baris.
 * Yang tidak berpasangan tidak diberi rincian.
 */

const bersih = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export type NodeRevisi = {
  lineageKey: string;
  code: string;
  name: string;
  volume: number | null;
  unitPrice: number | null;
  /** Nama induk dari akar (kategori › sub › grup) – pembeda item kembar antar bangunan. */
  jalur?: string;
  sortOrder?: number;
};

/** Jalur nama induk tiap node, dari daftar datar ber-induk. */
export function jalurInduk<T>(xs: T[], kunci: (x: T) => string, induk: (x: T) => string | null, nama: (x: T) => string): Map<string, string> {
  const byKey = new Map(xs.map((x) => [kunci(x), x]));
  const memo = new Map<string, string>();
  const jalur = (k: string | null, d = 0): string => {
    if (k == null || d > 20) return "";
    if (memo.has(k)) return memo.get(k)!;
    const x = byKey.get(k);
    const j = x ? `${jalur(induk(x), d + 1)}›${bersih(nama(x))}` : "";
    memo.set(k, j);
    return j;
  };
  return new Map(xs.map((x) => [kunci(x), jalur(induk(x))]));
}

/** Peta excelRow (string) → lineageKey revisi. Murni, supaya bisa diuji langsung. */
export function cocokkanItem(dariBerkas: FlatNode[], revisi: NodeRevisi[]): Map<string, string> {
  const hasil = new Map<string, string>();
  const jalurBerkas = jalurInduk(dariBerkas, (n) => n.lineageKey, (n) => n.parentLineageKey, (n) => n.name);
  const berkas = dariBerkas
    .filter((n) => n.kind === "item" && n.excelRow != null)
    .map((n) => ({ ...n, jalur: jalurBerkas.get(n.lineageKey) ?? "" }));
  const sisaBerkas = new Set(berkas);
  const sisaRevisi = new Set(revisi);

  const byLineage = new Map(berkas.map((n) => [n.lineageKey, n]));
  for (const r of revisi) {
    const b = byLineage.get(r.lineageKey);
    if (b && sisaBerkas.has(b) && bersih(b.code) === bersih(r.code) && bersih(b.name) === bersih(r.name)) {
      hasil.set(String(b.excelRow), r.lineageKey);
      sisaBerkas.delete(b);
      sisaRevisi.delete(r);
    }
  }

  type Item = { code: string; name: string; volume: number | null; unitPrice: number | null; jalur?: string };
  /*
   * Angka dibandingkan dengan TOLERANSI sebesar presisi penyimpanan, bukan
   * lewat kunci yang dibulatkan: revisi menyimpan volume 3 desimal dan harga 2
   * desimal, berkas membawa pecahan panjang (4,73472 tersimpan 4,735;
   * 121414,39499… tersimpan 121414,40). Pembulatan ganda memisahkan pasangan
   * yang sebenarnya sama.
   */
  const dekat = (a: number | null, b: number | null, tol: number) =>
    a == null || b == null ? a == null && b == null : Math.abs(a - b) <= tol;
  const sepadan = (r: Item, b: Item) => dekat(r.volume, b.volume, 0.0006) && dekat(r.unitPrice, b.unitPrice, 0.006);
  const kelompok = <T,>(xs: Iterable<T>, f: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(f(x), [...(m.get(f(x)) ?? []), x]);
    return m;
  };
  const pasang = (b: (typeof berkas)[number], r: NodeRevisi) => {
    hasil.set(String(b.excelRow), r.lineageKey);
    sisaBerkas.delete(b);
    sisaRevisi.delete(r);
  };
  /** Pasangkan hanya bila keduanya SALING satu-satunya calon yang sepadan. */
  const tahap = (kunci: (x: Item) => string) => {
    const kb = kelompok(sisaBerkas, kunci);
    for (const [k, rs] of kelompok(sisaRevisi, kunci)) {
      const bs = kb.get(k);
      if (!bs) continue;
      for (const r of rs) {
        if (!sisaRevisi.has(r)) continue;
        const calonB = bs.filter((b) => sisaBerkas.has(b) && sepadan(r, b));
        if (calonB.length !== 1) continue;
        const calonR = rs.filter((x) => sisaRevisi.has(x) && sepadan(x, calonB[0]!));
        if (calonR.length === 1) pasang(calonB[0]!, r);
      }
    }
  };
  const teks = (x: Item) => `${bersih(x.code)}|${bersih(x.name)}`;
  tahap((x) => `${x.jalur ?? ""}|${teks(x)}`);
  tahap(teks);
  tahap((x) => bersih(x.name));

  /*
   * Terakhir: baris KEMBAR PERSIS di induk yang sama (jalur, kode, nama sama,
   * volume & harga sepadan). Di basis data keduanya tidak bisa dibedakan
   * dengan cara apa pun selain urutannya – dan urutan revisi memang disusun
   * dari urutan baris berkas yang sama. Hanya dipasangkan bila jumlahnya sama
   * di kedua sisi dan tiap pasangan menurut urutan memang sepadan.
   */
  const kb = kelompok(sisaBerkas, (x) => `${x.jalur ?? ""}|${teks(x)}`);
  for (const [k, rs] of kelompok(sisaRevisi, (x) => `${x.jalur ?? ""}|${teks(x)}`)) {
    const bs = kb.get(k);
    if (!bs || bs.length !== rs.length || rs.some((r) => r.sortOrder == null)) continue;
    const urutB = [...bs].sort((a, b) => a.sortOrder - b.sortOrder);
    const urutR = [...rs].sort((a, b) => a.sortOrder! - b.sortOrder!);
    if (!urutR.every((r, i) => sepadan(r, urutB[i]!))) continue;
    urutR.forEach((r, i) => pasang(urutB[i]!, r));
  }
  return hasil;
}

