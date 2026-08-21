/**
 * SIAPA YANG MENEKEN DOKUMEN MANA — MODUL MURNI (DECISIONS 402).
 *
 * Ketetapan user 2026-08-21:
 *
 * | Dokumen | Pihak penyedia yang meneken |
 * |---|---|
 * | Laporan harian    | Pelaksana Lapangan |
 * | Laporan mingguan  | Pelaksana Lapangan |
 * | Laporan bulanan   | Direktur |
 * | MC (Monthly Certificate) | Direktur |
 * | CCO               | Direktur |
 *
 * Sebelum ini SEMUA dokumen memakai satu nama yang sama —
 * `Contract.contractorSignerName`, yaitu direkturnya. Jadi laporan harian
 * menyatakan direktur yang membuatnya, padahal yang mengisi dan meneken di
 * lapangan orang lain. Itu bukan salah ketik melainkan pernyataan yang tidak
 * benar pada dokumen resmi.
 *
 * Dipisah sebagai modul murni supaya aturannya bisa diuji tanpa DB, dan supaya
 * hanya ADA SATU tempat yang menjawab pertanyaan "dokumen ini diteken siapa".
 */

/**
 * Dokumen resmi yang punya blok tanda tangan pihak penyedia.
 *
 * `jadwal` (Time Schedule / kurva-S) dan `rencana` (Rencana Mingguan) TIDAK
 * disebut user dalam ketetapan di atas. Keduanya sengaja dibiarkan seperti
 * sekarang — diteken Direktur — dan ditulis di sini apa adanya supaya
 * "belum diputuskan" tidak menyamar sebagai "sudah diputuskan". Rencana
 * mingguan khususnya bisa jadi memang milik pelaksana; itu pertanyaan untuk
 * user, bukan tebakan untuk saya.
 */
export type JenisDokumen =
  | "harian"
  | "mingguan"
  | "bulanan"
  | "mc"
  | "cco"
  | "jadwal"
  | "rencana";

/** Pihak penyedia jasa yang meneken. */
export type PihakPenyedia = "pelaksana" | "direktur";

/**
 * Jabatan bawaan bila kolomnya dikosongkan.
 *
 * Bisa diubah per paket/lokasi (mis. "Site Manager", "Pelaksana K3") karena
 * sebutan resminya berbeda-beda antar paket KKP – tapi yang tidak mengisi tetap
 * mendapat sebutan yang benar, bukan baris kosong.
 */
export const JABATAN_PELAKSANA_BAWAAN = "Pelaksana Lapangan";

/**
 * Dokumen ini diteken siapa dari pihak penyedia?
 *
 * Ditulis sebagai `Record` lengkap, bukan `if`: menambah jenis dokumen baru
 * memerahkan kompiler sampai penulisnya MEMUTUSKAN siapa yang meneken. Cacat
 * yang diperbaiki hari ini lahir justru karena tidak ada tempat yang pernah
 * menanyakan itu.
 */
const PENEKEN: Record<JenisDokumen, PihakPenyedia> = {
  harian: "pelaksana",
  mingguan: "pelaksana",
  bulanan: "direktur",
  mc: "direktur",
  cco: "direktur",
  // Belum ditetapkan user – dipertahankan seperti sebelum DECISIONS 402.
  jadwal: "direktur",
  rencana: "direktur",
};

export function pihakPenyedia(jenis: JenisDokumen): PihakPenyedia {
  return PENEKEN[jenis];
}

/** Satu blok penanda tangan: nama, jabatan, dan gambar-gambarnya. */
export type BlokPelaksana = {
  nama: string | null;
  jabatan: string | null;
  ttdKey: string | null;
  stempelKey: string | null;
};

export type SumberPelaksana = {
  pelaksanaName: string | null;
  pelaksanaTitle: string | null;
  pelaksanaTtdKey: string | null;
  pelaksanaStempelKey: string | null;
};

function kosong(v: string | null | undefined): boolean {
  return !v || v.trim() === "";
}

/**
 * Pelaksana untuk satu lokasi: penimpaan lokasi kalau ada, kalau tidak milik paket.
 *
 * **Diambil sebagai SATU BLOK, bukan per medan.** Ini keputusan yang paling
 * penting di berkas ini dan paling mudah dilanggar tanpa sadar: kalau nama
 * diambil dari lokasi sementara gambar tanda tangannya jatuh ke milik paket
 * (karena lokasinya belum mengunggah), yang tercetak adalah **coretan tanda
 * tangan seseorang di bawah nama orang lain**. Pada dokumen yang diserahkan ke
 * KKP, itu bukan cacat tampilan.
 *
 * Penentunya NAMA: begitu sebuah lokasi menyebut nama pelaksananya sendiri,
 * seluruh bloknya milik lokasi itu — termasuk ketiadaan tanda tangannya.
 */
export function pilihPelaksana(
  lokasi: SumberPelaksana | null | undefined,
  paket: SumberPelaksana | null | undefined,
): BlokPelaksana {
  const sumber = lokasi && !kosong(lokasi.pelaksanaName) ? lokasi : paket;
  if (!sumber || kosong(sumber.pelaksanaName)) {
    return { nama: null, jabatan: JABATAN_PELAKSANA_BAWAAN, ttdKey: null, stempelKey: null };
  }
  return {
    nama: sumber.pelaksanaName!.trim(),
    jabatan: kosong(sumber.pelaksanaTitle)
      ? JABATAN_PELAKSANA_BAWAAN
      : sumber.pelaksanaTitle!.trim(),
    ttdKey: sumber.pelaksanaTtdKey ?? null,
    stempelKey: sumber.pelaksanaStempelKey ?? null,
  };
}

/** Lokasi ini memakai pelaksananya sendiri, atau ikut paket? */
export function asalPelaksana(
  lokasi: SumberPelaksana | null | undefined,
  paket: SumberPelaksana | null | undefined,
): "lokasi" | "paket" | "belum diisi" {
  if (lokasi && !kosong(lokasi.pelaksanaName)) return "lokasi";
  if (paket && !kosong(paket.pelaksanaName)) return "paket";
  return "belum diisi";
}

/**
 * Peringatan untuk LAYAR bila Pelaksana belum diisi – null kalau sudah.
 *
 * Ketetapan user: yang kosong dicetak sebagai baris kosong untuk ditandatangani
 * tangan, DAN layarnya menyebutkan. Yang ditolak dengan sengaja adalah jatuh ke
 * nama Direktur: dokumennya akan selalu tampak lengkap sambil menyatakan orang
 * yang salah — cacat yang tidak pernah ketahuan sampai ada yang menuntutnya.
 */
/**
 * Nama + jabatan yang TERCETAK di slot penyedia, menurut jenis dokumennya.
 *
 * Dipakai bersama oleh penyaji layar, PDF, dan Excel. Disatukan dengan sengaja:
 * tiga penyaji yang masing-masing memilih sendiri adalah cara paling mudah
 * membuat PDF dan Excel dari laporan yang SAMA menyebut dua orang berbeda —
 * dan yang membacanya di KKP tidak punya cara tahu mana yang benar.
 */
export function penyediaLaporan(
  jenis: JenisDokumen,
  h: {
    contractorSignerName: string | null;
    contractorSignerTitle: string | null;
    pelaksanaName: string | null;
    pelaksanaTitle: string | null;
  },
): { nama: string | null; sub: string | null } {
  if (pihakPenyedia(jenis) === "pelaksana") {
    return {
      nama: kosong(h.pelaksanaName) ? null : h.pelaksanaName!.trim(),
      sub: kosong(h.pelaksanaTitle) ? JABATAN_PELAKSANA_BAWAAN : h.pelaksanaTitle!.trim(),
    };
  }
  return {
    nama: kosong(h.contractorSignerName) ? null : h.contractorSignerName!.trim(),
    sub: kosong(h.contractorSignerTitle) ? null : h.contractorSignerTitle!.trim(),
  };
}

export function peringatanPelaksana(blok: BlokPelaksana): string | null {
  if (blok.nama) return null;
  return (
    "Pelaksana Lapangan belum diisi – blok tanda tangan laporan harian dan mingguan " +
    "akan tercetak tanpa nama. Isi di Paket › Kontrak, atau di lokasi ini bila pelaksananya berbeda."
  );
}
