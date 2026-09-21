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
  /**
   * Identitas baris yang benar-benar unik.
   *
   * Kode kategori/sub berulang antar cabang ("1" ada di setiap sub-kategori),
   * jadi layar yang menyusun kunci React dari `code + name` akan memasang kunci
   * kembar – dan React boleh MENGHILANGKAN atau MENGGANDAKAN baris yang
   * kuncinya kembar. Pada tabel pemeriksaan adendum, baris yang hilang diam-diam
   * adalah cacat yang paling mahal. `lineageKey` unik sejak `flatten`; ia cuma
   * belum pernah dibawa sampai ke sini.
   */
  lineageKey: string;
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
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name,
      total: n.amount,
      jumlahItem: cacahItem(n.lineageKey),
      level: n.kind === "kategori" ? 0 : 1,
    }));
}

export type SimpulBanding = SimpulRingkas & {
  /** Nilai di RAB AKTIF. `null` = kategori/sub ini belum ada di kontrak. */
  kontrak: bigint | null;
  /** Nilai di berkas yang diimpor. `null` = hilang dari berkas itu. */
  adendum: bigint | null;
  selisih: bigint;
  status: "tetap" | "berubah" | "baru" | "hilang";
};

/**
 * Ringkasan berjenjang yang DIADU: nilai kontrak di kiri, nilai berkas baru di
 * kanan, per kategori dan sub-kategori.
 *
 * **Permintaan user 2026-09-21**: *"yang kuminta ada perbandingan itu di bagian
 * ini, kenapa ini malah tidak ada!"* – sambil menunjuk tabel kategori di
 * pratinjau impor. Tabel banding per ITEM sudah ada, tetapi ia blok lain; yang
 * dibaca orang lebih dulu saat memeriksa adendum adalah ringkasan kategori ini,
 * dan di situ hanya ada angka berkas baru. Ringkasan tanpa pembanding cuma bisa
 * menjawab "berapa totalnya", bukan "apa yang bergeser".
 *
 * Kosong ≠ nol: kategori yang belum ada di kontrak bernilai `null` di sisi
 * kiri, bukan `0n`. Menyamakan keduanya membuat pekerjaan tambah terbaca sebagai
 * pekerjaan yang dinolkan – dua keadaan yang tindak lanjutnya berbeda.
 *
 * Urutan mengikuti BERKAS BARU (begitulah dokumennya dibaca); kategori yang ada
 * di kontrak tapi hilang dari berkas menyusul di akhir, supaya tidak satu pun
 * kehilangan lewat tanpa baris.
 */
export function pohonRingkasBanding(aktif: Simpul[], baru: Simpul[]): SimpulBanding[] {
  const kiri = new Map(pohonRingkas(aktif).map((b) => [b.lineageKey, b]));
  const kanan = pohonRingkas(baru);
  const terpakai = new Set<string>();

  const hasil: SimpulBanding[] = kanan.map((b) => {
    const lama = kiri.get(b.lineageKey);
    if (lama) terpakai.add(b.lineageKey);
    const kontrak = lama ? lama.total : null;
    const selisih = b.total - (kontrak ?? 0n);
    return {
      ...b,
      kontrak,
      adendum: b.total,
      selisih,
      status: kontrak === null ? "baru" : selisih === 0n ? "tetap" : "berubah",
    };
  });

  for (const [key, lama] of kiri) {
    if (terpakai.has(key)) continue;
    hasil.push({
      ...lama,
      kontrak: lama.total,
      adendum: null,
      selisih: -lama.total,
      status: "hilang",
    });
  }

  return hasil;
}
