/**
 * Klasifikasi lampiran grup WA — MURNI (tanpa DB, tanpa AI), deterministik,
 * unit-tested. DECISIONS 432.
 *
 * Kenapa aturan lebih dulu, bukan AI: sebagian besar lampiran bisa diputuskan
 * dari jenis MIME + nama berkas + teks pengiringnya saja. `IMG-20260825-WA0032.jpg`
 * dari mandor jelas foto lapangan; `Surat Teguran No 12.pdf` jelas kandidat
 * surat. Aturan bisa DIUJI dan tidak berubah diam-diam; AI tidak. AI baru
 * dipanggil untuk yang benar-benar perlu dibaca isinya.
 *
 * Yang dihasilkan hanya USULAN (`WaAttachment.saranKind`). Ketetapannya tetap
 * milik orang — ketetapan user 2026-08-25: *"jangan langsung putuskan tapi
 * sarankan"*.
 */

export type LampiranKind = "foto_lapangan" | "dokumen" | "surat_kandidat" | "media_lain" | "abaikan";

export type LampiranInput = {
  fileName: string | null;
  mimeType: string | null;
  /** Teks/caption yang menyertai lampiran. */
  caption: string;
  sizeBytes: number | null;
};

export type LampiranKelas = {
  kind: LampiranKind;
  /** Alasan singkat berbahasa Indonesia — ditampilkan di antrean. */
  alasan: string;
  /** Perlu ditetapkan orang? Foto lapangan sengaja TIDAK, supaya antrean tidak
   *  tenggelam oleh ratusan foto harian dan berhenti dibaca. */
  perluDitetapkan: boolean;
  /** Layak dibaca AI untuk diringkas (berkas dokumen/surat, bukan foto biasa). */
  layakDibacaAi: boolean;
};

/** Batas simpan permanen. Di atas ini hanya metadata yang dicatat. */
export const BATAS_SIMPAN_BYTE = 25 * 1024 * 1024;

const MIME_GAMBAR = /^image\//i;
const MIME_DOKUMEN =
  /^application\/(pdf|msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.ms-powerpoint|rtf)|^text\/(plain|csv)/i;
const MIME_ABAIKAN = /sticker|^audio\/|^video\/|webp/i;

/** Nama berkas kamera/WhatsApp: IMG-20260825-WA0032.jpg, PHOTO-2026-…, 20260825_101500.jpg */
const NAMA_KAMERA = /^(img|image|photo|foto|pxl|dsc|screenshot|wa)[-_ ]?\d|^\d{8}[-_]\d{6}/i;

/** Kata yang menandai surat resmi — dicari di nama berkas DAN caption. */
const KATA_SURAT = [
  "surat",
  "nota dinas",
  "undangan",
  "teguran",
  "peringatan",
  "sp1",
  "sp2",
  "sp3",
  "somasi",
  "berita acara",
  "ba ",
  "permohonan",
  "pemberitahuan",
  "klarifikasi",
  "adendum",
  "addendum",
  "kontrak",
  "spmk",
  "sppbj",
  "spk",
  "perihal",
  "nomor :",
  "no. surat",
];

/** Kata yang menandai berkas kerja (bukan surat, tapi tetap perlu dilihat). */
const KATA_DOKUMEN_KERJA = [
  "rab",
  "jadwal",
  "time schedule",
  "kurva",
  "laporan",
  "absensi",
  "invoice",
  "tagihan",
  "backup",
  "back up",
  "opname",
  "volume",
  "shop drawing",
  "gambar kerja",
  "ded",
];

function mengandung(teks: string, kata: string[]): string | null {
  const t = teks.toLowerCase();
  for (const k of kata) if (t.includes(k)) return k.trim();
  return null;
}

/**
 * Klasifikasi satu lampiran. Deterministik; tidak pernah membuang berkas —
 * hanya menandai perannya. Keputusan simpan/tidak ada di pemanggil.
 */
export function klasifikasiLampiran(input: LampiranInput): LampiranKelas {
  const nama = (input.fileName ?? "").trim();
  const mime = (input.mimeType ?? "").trim();
  const caption = input.caption ?? "";
  const gabungan = `${nama} ${caption}`;

  // 1. Yang jelas bukan bahan kerja — tidak usah menuntut apa pun.
  if (MIME_ABAIKAN.test(mime)) {
    return {
      kind: "abaikan",
      alasan: "Stiker/audio/video – bukan bahan kerja",
      perluDitetapkan: false,
      layakDibacaAi: false,
    };
  }

  const kataSurat = mengandung(gabungan, KATA_SURAT);
  const kataKerja = mengandung(gabungan, KATA_DOKUMEN_KERJA);

  // 2. Berkas dokumen (PDF/Word/Excel): hampir selalu perlu dilihat orang.
  if (MIME_DOKUMEN.test(mime)) {
    if (kataSurat) {
      return {
        kind: "surat_kandidat",
        alasan: `Berkas dokumen dan menyebut "${kataSurat}"`,
        perluDitetapkan: true,
        layakDibacaAi: true,
      };
    }
    return {
      kind: "dokumen",
      alasan: kataKerja ? `Berkas dokumen kerja (menyebut "${kataKerja}")` : "Berkas dokumen",
      perluDitetapkan: true,
      layakDibacaAi: true,
    };
  }

  // 3. Gambar. Di sinilah pemisahan terpenting: foto lapangan biasa TIDAK boleh
  //    masuk antrean — 83 grup × puluhan foto/hari akan menenggelamkannya.
  if (MIME_GAMBAR.test(mime)) {
    if (kataSurat) {
      return {
        kind: "surat_kandidat",
        alasan: `Gambar yang menyebut "${kataSurat}" – mungkin surat yang difoto`,
        perluDitetapkan: true,
        layakDibacaAi: true,
      };
    }
    if (NAMA_KAMERA.test(nama) || nama === "") {
      return {
        kind: "foto_lapangan",
        alasan: "Foto dari kamera/galeri tanpa penanda surat",
        perluDitetapkan: false,
        layakDibacaAi: false,
      };
    }
    if (kataKerja) {
      return {
        kind: "dokumen",
        alasan: `Gambar bernama berkas kerja (menyebut "${kataKerja}")`,
        perluDitetapkan: true,
        layakDibacaAi: true,
      };
    }
    return {
      kind: "foto_lapangan",
      alasan: "Gambar tanpa penanda dokumen",
      perluDitetapkan: false,
      layakDibacaAi: false,
    };
  }

  // 4. Sisanya: tidak dikenali. Ditandai supaya tetap terlihat, tapi tidak
  //    dipaksakan jadi apa pun.
  return {
    kind: "media_lain",
    alasan: mime ? `Jenis berkas tidak dikenali (${mime})` : "Jenis berkas tidak diketahui",
    perluDitetapkan: true,
    layakDibacaAi: false,
  };
}

/** Berkas terlalu besar untuk disimpan permanen? Metadata tetap dicatat. */
export function terlaluBesar(sizeBytes: number | null): boolean {
  return sizeBytes != null && sizeBytes > BATAS_SIMPAN_BYTE;
}
