/**
 * BARIS DOKUMEN CCO (Contract Change Order) — modul MURNI, tanpa DB.
 *
 * Format mengikuti berkas contoh dari KKP (sheet "CCO-01 (BANGUNAN)"): satu
 * baris per item, berisi empat blok angka berdampingan —
 *
 *   MC-0            : keadaan kontrak yang BERLAKU (revisi RAB aktif)
 *   PEKERJAAN TAMBAH: kenaikan per item
 *   PEKERJAAN KURANG: penurunan per item
 *   CCO-01          : keadaan SETELAH adendum (draft revisi)
 *
 * Dipisah dari penulis Excel-nya dengan sengaja: yang menentukan benar-salah
 * dokumen ini adalah angkanya, bukan bordernya. Angka diuji di sini.
 *
 * BARIS DIAMBIL DARI GABUNGAN dua revisi, bukan salah satunya. Item yang
 * DICABUT di draft tidak ada di pohon draft, tapi WAJIB muncul di dokumen —
 * justru itu isi "pekerjaan kurang". Sebaliknya item BARU tidak ada di revisi
 * aktif. Membangun baris dari satu sisi saja akan menghilangkan separuh
 * perubahan tanpa jejak.
 */

export type CcoNode = {
  id: string;
  parentId: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  unitPrice: number | null;
  amount: bigint;
  lineageKey: string;
};

/** Keterangan perubahan — satu kata, dibaca pemeriksa tanpa menghitung. */
export type CcoKet = "TETAP" | "TAMBAH" | "KURANG" | "BARU" | "HAPUS";

export type CcoRow = {
  /** "judul" = kategori/sub/grup (tanpa angka), "item", "total" = subtotal blok. */
  jenis: "judul" | "item" | "total";
  depth: number;
  no: string;
  uraian: string;
  satuan: string | null;
  // MC-0 (kontrak berlaku)
  volumeLama: number | null;
  /**
   * Harga satuan yang DIPAKAI dokumen: harga KONTRAK selama itemnya ada di
   * kontrak (DECISIONS 213 – adendum mengubah volume, harga yang sudah
   * disepakati tetap), harga draft untuk item yang memang baru.
   */
  hargaLama: number | null;
  /**
   * Harga satuan item ini DI BERKAS ADENDUM, bila ada barisnya di draft.
   *
   * Wajib dibawa terpisah. Format CCO cuma punya SATU kolom harga, jadi ketika
   * kedua sisi berbeda, dokumen memakai salah satunya dan diam-diam menghitung
   * ulang seluruh baris dengan harga itu. Laporan user 2026-09-05 atas Pasar
   * Banggi V 3.b: kontrak Rp 28.117,52 × volume 0, berkas adendum volume 704
   * dengan harga 0 → dokumen mencetak pekerjaan tambah Rp 19.794.734 yang tidak
   * ada di berkas mana pun, dan JUMLAH CCO-01 di dokumen jadi Rp 27,4 juta di
   * atas nilai adendum yang tercatat. Selisih sebesar itu tidak boleh terjadi
   * tanpa disebut.
   */
  hargaBaru: number | null;
  /** Item ini ada di revisi AKTIF (kontrak) – dasar KET "BARU", bukan volume 0. */
  adaDiKontrak: boolean;
  jumlahLama: bigint;
  // Pekerjaan tambah / kurang (kurang selalu POSITIF = besaran penurunan)
  volumeTambah: number | null;
  jumlahTambah: bigint;
  volumeKurang: number | null;
  jumlahKurang: bigint;
  // CCO-01 (setelah adendum)
  volumeBaru: number | null;
  jumlahBaru: bigint;
  ket: CcoKet | null;
  /** Volume yang SUDAH terealisasi di lapangan (0 bila belum ada). DECISIONS 242. */
  realisasi: number;
};

export type CcoRingkasan = {
  rows: CcoRow[];
  totalLama: bigint;
  totalTambah: bigint;
  totalKurang: bigint;
  totalBaru: bigint;
};

const nol = 0n;

/** Anak langsung, urut sesuai urutan masukan (sudah sortOrder dari DB). */
function anakDari(nodes: CcoNode[]): Map<string | null, CcoNode[]> {
  const m = new Map<string | null, CcoNode[]>();
  for (const n of nodes) {
    const arr = m.get(n.parentId) ?? [];
    arr.push(n);
    m.set(n.parentId, arr);
  }
  return m;
}

/**
 * Susun baris CCO dari revisi aktif (MC-0) + revisi draft (CCO-01).
 *
 * Tulang punggung urutan = pohon revisi AKTIF, supaya dokumen terbaca sejajar
 * dengan kontrak yang sedang berjalan — itu yang dipegang pemeriksa. Item baru
 * dari draft disisipkan di akhir kategori induknya (dicocokkan lewat
 * lineageKey induk), jadi tidak pernah menumpuk di ujung berkas terlepas dari
 * kategorinya.
 */
export function susunBarisCco(
  lama: CcoNode[],
  baru: CcoNode[],
  /**
   * Volume terealisasi per lineageKey. Dipakai dokumen CCO untuk memasang
   * pengaman DI BERKASNYA: sejak berkas itu ber-formula dan memang diedit
   * lokal, menurunkan volume di bawah realisasi menghasilkan dokumen pengajuan
   * yang mengusulkan membatalkan pekerjaan yang sudah dikerjakan.
   */
  realisasiByLineage?: Map<string, number>,
): CcoRingkasan {
  const baruByLineage = new Map(baru.map((n) => [n.lineageKey, n]));
  const lamaByLineage = new Map(lama.map((n) => [n.lineageKey, n]));

  const baruById = new Map(baru.map((n) => [n.id, n]));

  // Item draft yang TIDAK ada di revisi aktif = item baru. Dikelompokkan per
  // lineageKey induknya supaya bisa disisipkan di kategori yang benar.
  const itemBaruPerInduk = new Map<string, CcoNode[]>();
  for (const n of baru) {
    if (n.kind !== "item" || lamaByLineage.has(n.lineageKey)) continue;
    const induk = n.parentId ? baruById.get(n.parentId) : null;
    // Induk tanpa padanan di revisi aktif berarti KATEGORI-nya juga baru;
    // barisnya ikut terbawa saat kategori itu dirender (lihat kategoriBaru).
    const kunci = induk?.lineageKey ?? "";
    const arr = itemBaruPerInduk.get(kunci) ?? [];
    arr.push(n);
    itemBaruPerInduk.set(kunci, arr);
  }

  const anakLama = anakDari(lama);
  const anakBaru = anakDari(baru);
  const rows: CcoRow[] = [];
  let totalLama = nol;
  let totalTambah = nol;
  let totalKurang = nol;
  let totalBaru = nol;

  const barisItem = (l: CcoNode | null, b: CcoNode | null, depth: number, no: string): CcoRow => {
    const jumlahLama = l?.amount ?? nol;
    const jumlahBaru = b?.amount ?? nol;
    const selisih = jumlahBaru - jumlahLama;
    const naik = selisih > nol;
    const turun = selisih < nol;
    const ket: CcoKet = !l ? "BARU" : !b ? "HAPUS" : naik ? "TAMBAH" : turun ? "KURANG" : "TETAP";
    // Volume tambah/kurang = selisih volume, bukan volume penuh — kolomnya
    // memang menanyakan "berapa yang bertambah", bukan "berapa jadinya".
    const volL = l?.volume ?? null;
    const volB = b?.volume ?? null;
    const dVol = (volB ?? 0) - (volL ?? 0);

    totalLama += jumlahLama;
    totalBaru += jumlahBaru;
    if (naik) totalTambah += selisih;
    if (turun) totalKurang += -selisih;

    return {
      jenis: "item",
      depth,
      no,
      uraian: (b ?? l)!.name,
      satuan: (b ?? l)!.unit,
      volumeLama: volL,
      hargaLama: (l ?? b)!.unitPrice,
      hargaBaru: b?.unitPrice ?? null,
      adaDiKontrak: l != null,
      jumlahLama,
      volumeTambah: naik ? dVol : null,
      jumlahTambah: naik ? selisih : nol,
      volumeKurang: turun ? -dVol : null,
      jumlahKurang: turun ? -selisih : nol,
      volumeBaru: volB,
      jumlahBaru,
      ket,
      realisasi: realisasiByLineage?.get((b ?? l)!.lineageKey) ?? 0,
    };
  };

  /** Telusuri pohon revisi AKTIF; kategori/sub jadi judul, item jadi baris. */
  const jalanLama = (parentId: string | null, depth: number) => {
    let nomor = 0;
    for (const n of anakLama.get(parentId) ?? []) {
      const b = baruByLineage.get(n.lineageKey) ?? null;
      if (n.kind === "item") {
        nomor += 1;
        rows.push(barisItem(n, b, depth, n.code || String(nomor)));
        continue;
      }
      rows.push(judul(n, depth));
      jalanLama(n.id, depth + 1);
      // Item BARU milik kategori ini — disisipkan tepat setelah anak-anak
      // lamanya, bukan dibuang ke ujung dokumen.
      for (const nb of itemBaruPerInduk.get(n.lineageKey) ?? []) {
        nomor += 1;
        rows.push(barisItem(null, nb, depth + 1, nb.code || String(nomor)));
      }
    }
  };

  jalanLama(null, 0);

  /**
   * KATEGORI yang hanya ada di draft (seluruh blok pekerjaan baru). Tanpa ini
   * item di dalamnya hilang dari dokumen — perubahan terbesar justru yang
   * paling mudah luput.
   */
  const kategoriBaru = (parentId: string | null, depth: number) => {
    for (const n of anakBaru.get(parentId) ?? []) {
      const adaDiLama = lamaByLineage.has(n.lineageKey);
      if (n.kind === "item") {
        if (adaDiLama) continue; // sudah dirender jalanLama()
        // Item baru yang induknya LAMA sudah tersisip lewat itemBaruPerInduk;
        // yang sampai di sini adalah item di kategori yang juga baru (atau
        // item lepas tanpa induk).
        const induk = n.parentId ? baruById.get(n.parentId) : null;
        if (induk && lamaByLineage.has(induk.lineageKey)) continue;
        rows.push(barisItem(null, n, depth, n.code));
        continue;
      }
      if (adaDiLama) {
        // Kategori lama: isinya sudah dirender, tapi turunannya bisa memuat
        // SUB-kategori baru — telusuri terus.
        kategoriBaru(n.id, depth + 1);
        continue;
      }
      rows.push(judul(n, depth));
      kategoriBaru(n.id, depth + 1);
    }
  };
  kategoriBaru(null, 0);


  rows.push({
    jenis: "total",
    depth: 0,
    no: "",
    uraian: "JUMLAH",
    satuan: null,
    volumeLama: null,
    hargaLama: null,
    hargaBaru: null,
    adaDiKontrak: true,
    jumlahLama: totalLama,
    volumeTambah: null,
    jumlahTambah: totalTambah,
    volumeKurang: null,
    jumlahKurang: totalKurang,
    volumeBaru: null,
    jumlahBaru: totalBaru,
    ket: null,
    realisasi: 0,
  });

  return { rows, totalLama, totalTambah, totalKurang, totalBaru };
}

function judul(n: CcoNode, depth: number): CcoRow {
  return {
    jenis: "judul",
    depth,
    no: n.code,
    uraian: n.name,
    satuan: null,
    volumeLama: null,
    hargaLama: null,
    hargaBaru: null,
    adaDiKontrak: true,
    jumlahLama: nol,
    volumeTambah: null,
    jumlahTambah: nol,
    volumeKurang: null,
    jumlahKurang: nol,
    volumeBaru: null,
    jumlahBaru: nol,
    ket: null,
    realisasi: 0,
  };
}

/**
 * Bobot (%) = nilai ÷ penyebut × 100.
 *
 * Penyebutnya DINYATAKAN oleh pemanggil, tidak ditebak di sini: kolom bobot di
 * dokumen CCO tidak menyebut pembaginya, dan menebaknya berarti mencetak
 * persentase yang tidak bisa ditelusuri. Pilihan MARLIN ditulis di
 * `cco-xlsx.ts` dan dicetak sebagai catatan kaki di berkasnya.
 */
export function bobotPersen(nilai: bigint, penyebut: bigint): number {
  if (penyebut === nol) return 0;
  return (Number(nilai) / Number(penyebut)) * 100;
}
