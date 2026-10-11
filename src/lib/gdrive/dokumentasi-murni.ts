/**
 * DOKUMENTASI FOTO PER BANGUNAN – bagian MURNI (tanpa DB/jaringan).
 *
 * Permintaan user 2026-10-11: dokumentasi foto selain per hari juga per
 * bangunan, tanpa menggandakan berkas. Ketetapan: Lokasi → Bangunan,
 * shortcut saja (DECISIONS 666).
 *
 * Foto aslinya tetap satu di "3. LAPORAN HARIAN/<Lokasi>/<Bulan>/Foto".
 * "6. DOKUMENTASI/<Lokasi>/<Bangunan>" hanya berisi SHORTCUT ke foto itu –
 * tidak menyalin isi dan tidak memakan kuota.
 */
import { cleanPath, photoFileName, photoMimeFromKey, safeFileName } from "./folders";

export const FOLDER_DOKUMENTASI = "6. DOKUMENTASI";
/** Foto material masuk & peralatan tidak menempel ke pekerjaan RAB. */
export const BANGUNAN_MATERIAL = "Material Masuk";
export const BANGUNAN_ALAT = "Peralatan";

/**
 * Nama folder bangunan = kategori RAB tingkat 1 ditulis seperti di RAB-nya:
 * "III PEKERJAAN TAMBATAN PERAHU". Kodenya membantu orang mencocokkan dengan
 * dokumen kontrak; nama yang sudah memuat kodenya tidak diulang.
 */
export function namaBangunan(root: { code: string; name: string }): string {
  const kode = root.code.trim();
  const nama = root.name.replace(/\s+/g, " ").trim();
  if (!kode || nama.toUpperCase().startsWith(kode.toUpperCase())) return nama;
  return `${kode} ${nama}`;
}

/** 6. DOKUMENTASI / <Lokasi> / <Bangunan> */
export function dokumentasiPath(locationName: string, bangunan: string): string[] {
  return cleanPath([FOLDER_DOKUMENTASI, locationName, bangunan]);
}

/** "2026-09-27 – Pasangan batu kali – 03": nomornya = nomor foto di folder harian. */
export function namaPintasan(dateKey: string, pekerjaan: string, urut: number): string {
  const n = String(Math.max(1, urut)).padStart(2, "0");
  return safeFileName(`${dateKey} – ${pekerjaan} – ${n}`, `${dateKey} – foto – ${n}`);
}

export type BarisUnggahFoto = {
  fileName: string;
  fileId: string;
  photoId: string | null;
  createdAt: Date;
};

/**
 * Foto → berkas Drive-nya di folder laporan harian.
 *
 * Unggahan sejak DECISIONS 666 mencatat `photoId`; itu yang dipakai. Unggahan
 * lama hanya punya nama berkas ("<tanggal> <lokasi> NN.jpg", NN = urutan foto
 * saat diunggah). Nama itu hanya dipercaya bila unggahannya terjadi SESUDAH
 * laporan final – sesudah final foto tidak bisa berubah, jadi urutannya masih
 * urutan yang sekarang. Selebihnya tidak ditebak: shortcut yang menunjuk foto
 * yang salah lebih buruk daripada shortcut yang belum ada.
 */
export function tautkanTarget(
  photos: { id: string; r2Key: string }[],
  rows: BarisUnggahFoto[],
  ctx: { dateKey: string; locationName: string; finalizedAt: Date | null },
): Map<string, string> {
  const terbaru = <K>(kunci: (r: BarisUnggahFoto) => K | null): Map<K, BarisUnggahFoto> => {
    const m = new Map<K, BarisUnggahFoto>();
    for (const r of rows) {
      const k = kunci(r);
      if (k == null) continue;
      const lama = m.get(k);
      if (!lama || r.createdAt > lama.createdAt) m.set(k, r);
    }
    return m;
  };
  const perFoto = terbaru((r) => r.photoId);
  const perNama = terbaru((r) => r.fileName);

  const out = new Map<string, string>();
  photos.forEach((p, i) => {
    const langsung = perFoto.get(p.id);
    if (langsung) {
      out.set(p.id, langsung.fileId);
      return;
    }
    if (!ctx.finalizedAt) return;
    const nama = photoFileName({
      dateKey: ctx.dateKey,
      locationName: ctx.locationName,
      index: i + 1,
      ext: photoMimeFromKey(p.r2Key).ext,
    });
    const r = perNama.get(nama);
    if (r && r.photoId == null && r.createdAt >= ctx.finalizedAt) out.set(p.id, r.fileId);
  });
  return out;
}

export type InginPintasan = {
  photoId: string;
  /** null = berkas Drive foto ini belum diketahui. */
  targetId: string | null;
  bangunan: string;
  nama: string;
};

export type AdaPintasan = {
  photoId: string;
  targetId: string | null;
  shortcutId: string | null;
  folderId: string | null;
  bangunan: string;
  nama: string;
};

export type AksiPintasan =
  | { jenis: "buat"; ingin: InginPintasan; lama: AdaPintasan | null }
  | { jenis: "buat_ulang"; ingin: InginPintasan; lama: AdaPintasan }
  | { jenis: "ubah"; ingin: InginPintasan; lama: AdaPintasan }
  | { jenis: "tunda"; ingin: InginPintasan }
  | { jenis: "buang"; lama: AdaPintasan };

/**
 * Bandingkan yang seharusnya dengan yang sudah ada di Drive. Tidak pernah
 * membuat shortcut kedua untuk foto yang sama: yang berubah dipindah atau
 * diganti nama, bukan ditambah.
 */
export function rencanaPintasan(ingin: InginPintasan[], ada: AdaPintasan[]): AksiPintasan[] {
  const sudah = new Map(ada.map((a) => [a.photoId, a]));
  const out: AksiPintasan[] = [];
  for (const i of ingin) {
    const a = sudah.get(i.photoId) ?? null;
    sudah.delete(i.photoId);
    if (!i.targetId) {
      // Tujuan belum diketahui: catat saja. Shortcut yang sudah ada dibiarkan –
      // "belum tahu" bukan bukti bahwa ia salah.
      if (!a) out.push({ jenis: "tunda", ingin: i });
      continue;
    }
    if (!a || !a.shortcutId) out.push({ jenis: "buat", ingin: i, lama: a });
    else if (a.targetId !== i.targetId) out.push({ jenis: "buat_ulang", ingin: i, lama: a });
    else if (a.bangunan !== i.bangunan || a.nama !== i.nama) out.push({ jenis: "ubah", ingin: i, lama: a });
  }
  for (const a of sudah.values()) out.push({ jenis: "buang", lama: a });
  return out;
}
