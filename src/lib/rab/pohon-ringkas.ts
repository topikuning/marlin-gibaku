/**
 * RINGKASAN BERJENJANG POHON RAB — kategori BESERTA sub-kategorinya.
 *
 * **Permintaan user 2026-09-21**: *"bukan hanya kategori harusnya munculkan juga
 * sub kategorinya, berapa jumlahnya."*
 *
 * Pratinjau impor sebelumnya hanya menampilkan simpul `kategori`. Untuk berkas
 * yang kategorinya berisi beberapa sub-pekerjaan, itu berarti satu baris
 * bernilai miliaran tanpa satu pun rincian — cukup untuk melihat grand total
 * cocok, tidak cukup untuk melihat pekerjaan mana yang bergeser.
 *
 * Murni: tanpa DB, tanpa `server-only`, supaya bisa diuji sendirian dan dipakai
 * baik oleh pratinjau impor maupun layar lain yang perlu ringkasan yang sama.
 */

export type SimpulRingkas = {
  kind: "kategori" | "sub";
  code: string;
  name: string;
  /** Nilai rupiah simpul ini, apa adanya dari pohon. */
  total: bigint;
  /** Cacah ITEM di bawahnya, termasuk yang lewat sub/grup. */
  jumlahItem: number;
  /** 0 = kategori, 1 = sub — untuk takik di layar. */
  level: number;
};

type Simpul = {
  kind: string;
  code: string;
  name: string;
  amount: bigint;
  lineageKey: string;
  parentLineageKey: string | null;
  sortOrder: number;
};

/**
 * Kategori + sub-kategori, urut BERKAS (`sortOrder`), masing-masing dengan
 * nilai dan cacah itemnya.
 *
 * Cacah item dihitung menyusuri SELURUH keturunan, bukan anak langsung: pada
 * pohon `kategori → sub → item`, menghitung anak langsung membuat kategori
 * terbaca "0 item" padahal isinya penuh.
 */
export function pohonRingkas(nodes: Simpul[]): SimpulRingkas[] {
  if (nodes.length === 0) return [];

  const anak = new Map<string, Simpul[]>();
  for (const n of nodes) {
    if (!n.parentLineageKey) continue;
    const a = anak.get(n.parentLineageKey);
    if (a) a.push(n);
    else anak.set(n.parentLineageKey, [n]);
  }

  /** Cacah item di seluruh keturunan sebuah simpul. */
  const cacahItem = (key: string, dilewati = new Set<string>()): number => {
    if (dilewati.has(key)) return 0; // pohon rusak tidak boleh jadi loop tak henti
    dilewati.add(key);
    let n = 0;
    for (const a of anak.get(key) ?? []) {
      if (a.kind === "item") n += 1;
      else n += cacahItem(a.lineageKey, dilewati);
    }
    return n;
  };

  return nodes
    .filter((n): n is Simpul & { kind: "kategori" | "sub" } => n.kind === "kategori" || n.kind === "sub")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((n) => ({
      kind: n.kind,
      code: n.code,
      name: n.name,
      total: n.amount,
      jumlahItem: cacahItem(n.lineageKey),
      level: n.kind === "kategori" ? 0 : 1,
    }));
}
