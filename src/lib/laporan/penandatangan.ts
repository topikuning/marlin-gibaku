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

/**
 * Satu blok penanda tangan: nama, jabatan, dan CORETAN TANDA TANGANNYA.
 *
 * TANPA stempel, dan itu keputusan (DECISIONS 408). Keberatan user 2026-08-22:
 * *"kenapa pelaksana dan direktur yang jelas 1 perusahaan stempelnya muncul
 * 2x?"* Karena saya memperlakukan stempel seperti tanda tangan. Keduanya
 * berbeda jenis benda: **coretan tanda tangan milik ORANG, stempel milik
 * PERUSAHAAN.** Pelaksana Lapangan dan Direktur bekerja di perusahaan yang
 * sama, jadi stempelnya satu — diambil dari sisi penyedia (kontrak, lalu
 * master vendor), bukan dari blok orangnya.
 */
export type BlokPelaksana = {
  nama: string | null;
  jabatan: string | null;
  ttdKey: string | null;
};

export type SumberPelaksana = {
  pelaksanaName: string | null;
  pelaksanaTitle: string | null;
  pelaksanaTtdKey: string | null;
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
    return { nama: null, jabatan: JABATAN_PELAKSANA_BAWAAN, ttdKey: null };
  }
  return {
    nama: sumber.pelaksanaName!.trim(),
    jabatan: kosong(sumber.pelaksanaTitle)
      ? JABATAN_PELAKSANA_BAWAAN
      : sumber.pelaksanaTitle!.trim(),
    ttdKey: sumber.pelaksanaTtdKey ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * KONSULTAN PENGAWAS PER LOKASI (DECISIONS 409)
 *
 * User 2026-08-22: *"untuk tanda tangan laporan, ternyata pengawas per lokasi
 * beda orang."*
 *
 * Aturannya PERSIS sama dengan Pelaksana Lapangan: paket menyediakan yang
 * berlaku umum, lokasi boleh menimpanya, dan penimpaannya diambil sebagai SATU
 * BLOK dengan NAMA sebagai penentu.
 *
 * Tersimpannya di `contracts`, bukan `packages` seperti pelaksana — dan itu
 * BUKAN dua tempat yang berbeda: `Contract.packageId` UNIQUE, jadi satu paket
 * tepat satu kontrak. Diisi di formulir yang sama dengan PPK dan Direktur
 * (Paket › Kontrak › Penanda tangan dokumen KKP), jadi di layar ia memang
 * "pengawas paket". Menyalinnya ke `packages` hanya akan melahirkan sumber
 * kedua yang bisa menyimpang — persis cacat stempel ganda di DECISIONS 408. Alasannya juga sama, dan di sini bahkan
 * lebih berat: pengawas adalah pihak KETIGA yang memeriksa pekerjaan kita.
 * Coretan tanda tangan pengawas paket di bawah nama pengawas lokasi bukan
 * sekadar gambar keliru — itu memalsukan pemeriksaan.
 * ──────────────────────────────────────────────────────────────────────────── */

export type BlokPengawas = {
  nama: string | null;
  /** Nama firma pengawas – baris di bawah nama pada blok tanda tangan. */
  firma: string | null;
  ttdKey: string | null;
  /**
   * Stempel firma pengawas, atau null bila TIDAK boleh dipakai.
   *
   * Stempel milik FIRMA (DECISIONS 408). Kalau lokasi menyebut firma yang
   * BERBEDA dari kontrak, stempel kontrak adalah stempel firma lain — dan
   * membubuhkannya di bawah nama firma ini adalah pernyataan yang tidak benar.
   * Dalam keadaan itu blok stempelnya dikosongkan, untuk dibubuhi stempel basah.
   */
  stempelKey: string | null;
};

export type SumberPengawas = {
  supervisorName: string | null;
  supervisorFirm: string | null;
  supervisorTtdKey: string | null;
};

export type SumberPengawasKontrak = SumberPengawas & {
  supervisorStempelKey: string | null;
};

/**
 * Pengawas untuk satu lokasi: penimpaan lokasi kalau ada, kalau tidak kontrak.
 *
 * Penentunya NAMA — sama seperti {@link pilihPelaksana}. Begitu sebuah lokasi
 * menyebut nama pengawasnya sendiri, seluruh bloknya milik lokasi itu, termasuk
 * ketiadaan tanda tangannya.
 */
export function pilihPengawas(
  lokasi: SumberPengawas | null | undefined,
  kontrak: SumberPengawasKontrak | null | undefined,
): BlokPengawas {
  const firmaKontrak = kontrak?.supervisorFirm?.trim() || null;
  if (lokasi && !kosong(lokasi.supervisorName)) {
    const firma = kosong(lokasi.supervisorFirm) ? firmaKontrak : lokasi.supervisorFirm!.trim();
    // Firma sama (atau lokasi tidak menyebut firma) => stempel kontrak sah.
    const firmaSama = !firma || !firmaKontrak || firma === firmaKontrak;
    return {
      nama: lokasi.supervisorName!.trim(),
      firma,
      ttdKey: lokasi.supervisorTtdKey ?? null,
      stempelKey: firmaSama ? (kontrak?.supervisorStempelKey ?? null) : null,
    };
  }
  if (!kontrak || kosong(kontrak.supervisorName)) {
    return { nama: null, firma: firmaKontrak, ttdKey: null, stempelKey: kontrak?.supervisorStempelKey ?? null };
  }
  return {
    nama: kontrak.supervisorName!.trim(),
    firma: firmaKontrak,
    ttdKey: kontrak.supervisorTtdKey ?? null,
    stempelKey: kontrak.supervisorStempelKey ?? null,
  };
}

/** Lokasi ini memakai pengawasnya sendiri, atau ikut kontrak? */
export function asalPengawas(
  lokasi: SumberPengawas | null | undefined,
  kontrak: SumberPengawasKontrak | null | undefined,
): "lokasi" | "kontrak" | "belum diisi" {
  if (lokasi && !kosong(lokasi.supervisorName)) return "lokasi";
  if (kontrak && !kosong(kontrak.supervisorName)) return "kontrak";
  return "belum diisi";
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
