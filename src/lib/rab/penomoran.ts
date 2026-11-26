/**
 * NOMOR ITEM DI LAPORAN = NOMOR DARI RAB (DECISIONS 785). MURNI.
 *
 * Keluhan user 2026-11-26, memotret laporan mingguan: item bernomor urut
 * 1…ratusan, padahal *"dari import penomoran sudah ada"*. Nomor urut buatan
 * MARLIN tidak bisa dicocokkan dengan dokumen kontrak, dan tanpa baris
 * induknya "a, b, c" kehilangan arti. Tabel item di laporan meniru susunan
 * RAB: kategori → judul (sub-kategori, kelompok) → item dengan nomornya
 * sendiri.
 *
 * Dua hal dari parser yang dibalik di sini supaya nomor tampil seperti di
 * berkas:
 * - huruf "a" di bawah item "1" disimpan sebagai "1.a" (kode harus unik);
 *   bila induknya tampil sebagai judul, yang tercetak cukup "a";
 * - sufiks kode kembar "#2" dan kode karangan "~3" bukan nomor berkas.
 * Titik penutup ("III.1.", "1.1.1.") DIPERTAHANKAN – begitu tertulis di berkas
 * dan di contoh Lampiran Termin (DECISIONS 670).
 */

export type NodePenomoran = {
  id: string;
  parentId: string | null;
  kind: string;
  code: string;
  name: string;
};

export type JudulBaris = { kode: string; nama: string; tingkat: number };

/** Hasil untuk satu item: judul yang harus tercetak sebelum item ini + nomornya. */
export type PenomoranItem = { kode: string; tingkat: number; judul: JudulBaris[] };

/** Tanpa sufiks kode kembar – bentuk yang dicetak, titik penutup berkas tetap. */
const tanpaSufiks = (code: string) => code.trim().replace(/(?:#\d+)+$/, "");
/** Bentuk pembanding: tanpa sufiks dan titik penutup ("6.1." = "6.1"). */
const bersih = (code: string) => tanpaSufiks(code).replace(/\.+$/, "");

/**
 * Nomor yang dicetak. `kodeInduk` diisi bila induknya tercetak sebagai judul
 * tepat di atas kelompok item ini – huruf berawalan induk dipendekkan
 * kembali ke hurufnya ("1.a" → "a"). Nomor bertitik yang memang ditulis
 * begitu di berkas ("6.1", "1.1.1.") tidak disentuh, titiknya juga.
 */
export function kodeTampil(code: string, kodeInduk?: string | null): string {
  const k = tanpaSufiks(code);
  // Kode karangan parser untuk baris tanpa nomor ("~3") dan anaknya
  // ("~1.b", "-.a"): yang benar-benar ada di berkas hanya hurufnya.
  const karangan = /^(?:~\d+|-)(?:\.(.+))?$/.exec(k);
  if (karangan) return karangan[1] ?? "";
  if (kodeInduk != null) {
    const induk = bersih(kodeInduk);
    if (induk && k.startsWith(`${induk}.`)) {
      const sisa = k.slice(induk.length + 1);
      if (/^[a-z](?:\.\d+)?\.?$/i.test(sisa)) return sisa;
    }
  }
  return k;
}

/**
 * Penyusun baris judul untuk tabel item yang dikelompokkan per kategori.
 * Panggil SEKALI per item, dalam urutan tampil; tiap judul (sub-kategori,
 * kelompok, item induk) keluar satu kali, tepat sebelum item pertamanya.
 * Kategori sendiri tidak termasuk – tabelnya sudah punya baris kategori.
 */
export function penyusunJudul(nodes: readonly NodePenomoran[]): (itemId: string) => PenomoranItem {
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const sudah = new Set<string>();
  return (itemId) => {
    const it = byId.get(itemId);
    if (!it) return { kode: "", tingkat: 0, judul: [] };
    // Leluhur dari induk langsung ke atas, berhenti di kategori. Pagar 30
    // untuk pohon rusak (induk melingkar).
    const rantai: NodePenomoran[] = [];
    const dilihat = new Set<string>([it.id]);
    let kini = it.parentId ? byId.get(it.parentId) : undefined;
    while (kini && kini.kind !== "kategori" && !dilihat.has(kini.id) && rantai.length < 30) {
      dilihat.add(kini.id);
      rantai.unshift(kini);
      kini = kini.parentId ? byId.get(kini.parentId) : undefined;
    }
    const judul: JudulBaris[] = [];
    rantai.forEach((nd, tingkat) => {
      if (sudah.has(nd.id)) return;
      sudah.add(nd.id);
      const induk = tingkat > 0 ? rantai[tingkat - 1]!.code : null;
      judul.push({ kode: kodeTampil(nd.code, induk), nama: nd.name, tingkat });
    });
    const induk = rantai.at(-1)?.code ?? null;
    return { kode: kodeTampil(it.code, induk), tingkat: rantai.length, judul };
  };
}
