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
export type PihakPenyedia = "pelaksana" | "manajer_proyek" | "direktur";

/** Jabatan Project Manager penyedia, dengan istilah resmi Indonesia (user 2026-10-10). */
export const JABATAN_MANAJER_PROYEK = "Manajer Proyek";

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
  // Team Leader pengawas BANUSA 2026-10-10 (DECISIONS 662): mingguan, bulanan,
  // dan Kurva S lokasi diteken Manajer Proyek (PM).
  mingguan: "manajer_proyek",
  bulanan: "manajer_proyek",
  jadwal: "manajer_proyek",
  mc: "direktur",
  cco: "direktur",
  // Belum ditetapkan user – dipertahankan seperti sebelum DECISIONS 402.
  rencana: "direktur",
};

export function pihakPenyedia(jenis: JenisDokumen): PihakPenyedia {
  return PENEKEN[jenis];
}

/**
 * Pihak KKP yang meneken slot "MENGETAHUI" per jenis dokumen (2026-08-24):
 * laporan MINGGUAN & BULANAN diteken WAKIL SAH; dokumen lain tetap PPK.
 * `Record` lengkap dengan alasan yang sama seperti `PENEKEN` di atas.
 */
export type PihakKkp = "ppk" | "wakil_sah";

const PENEKEN_KKP: Record<JenisDokumen, PihakKkp> = {
  // BANUSA 2026-10-10 (DECISIONS 662): harian, mingguan, dan Kurva S lokasi
  // diketahui Wakil Sah PPK; bulanan oleh PPK.
  harian: "wakil_sah",
  mingguan: "wakil_sah",
  bulanan: "ppk",
  jadwal: "wakil_sah",
  mc: "ppk",
  cco: "ppk",
  rencana: "ppk",
};

export function pihakKkp(jenis: JenisDokumen): PihakKkp {
  return PENEKEN_KKP[jenis];
}

/** Label jabatan slot KKP pada blok tanda tangan, per jenis dokumen. */
export function labelPihakKkp(jenis: JenisDokumen): string {
  return pihakKkp(jenis) === "wakil_sah" ? "WAKIL SAH PPK" : "PEJABAT PEMBUAT KOMITMEN";
}

/**
 * Pihak KONSULTAN PENGAWAS yang meneken slot "DIPERIKSA" (BANUSA 2026-10-10,
 * DECISIONS 662). `pengawas_lapangan` = pengawas lokasi (DECISIONS 409) –
 * yang dipakai semua dokumen sebelum ketetapan ini.
 */
export type PihakKonsultan = "pengawas_lapangan" | "koordinator_tl" | "team_leader";

const PENEKEN_KONSULTAN: Record<JenisDokumen, PihakKonsultan> = {
  harian: "pengawas_lapangan",
  mingguan: "koordinator_tl",
  bulanan: "team_leader",
  jadwal: "koordinator_tl",
  mc: "pengawas_lapangan",
  cco: "pengawas_lapangan",
  rencana: "pengawas_lapangan",
};

export function pihakKonsultan(jenis: JenisDokumen): PihakKonsultan {
  return PENEKEN_KONSULTAN[jenis];
}

/** Jabatan yang tercetak di bawah nama konsultan. */
export const JABATAN_KONSULTAN: Record<PihakKonsultan, string> = {
  pengawas_lapangan: "Pengawas Lapangan",
  koordinator_tl: "Koordinator Team Leader",
  team_leader: "Team Leader",
};

/** Sebutan pihak KKP & penyedia di layar (bukan blok cetak). */
export const JABATAN_KKP: Record<PihakKkp, string> = { ppk: "PPK", wakil_sah: "Wakil Sah PPK" };
export const JABATAN_PENYEDIA: Record<PihakPenyedia, string> = {
  pelaksana: JABATAN_PELAKSANA_BAWAAN,
  manajer_proyek: JABATAN_MANAJER_PROYEK,
  direktur: "Direktur",
};

/**
 * Dokumen yang ditampilkan di layar "siapa meneken apa", urut seperti daftar
 * Team Leader pengawas BANUSA. Isinya DITURUNKAN dari tiga `Record` di atas –
 * layar tidak punya daftarnya sendiri yang bisa berbeda dari cetakannya.
 */
const DOKUMEN_DI_LAYAR: { jenis: JenisDokumen; label: string }[] = [
  { jenis: "harian", label: "Laporan harian" },
  { jenis: "mingguan", label: "Laporan progres mingguan" },
  { jenis: "bulanan", label: "Laporan progres bulanan" },
  { jenis: "jadwal", label: "Kurva S lokasi" },
  { jenis: "rencana", label: "Rencana mingguan" },
  { jenis: "mc", label: "MC" },
  { jenis: "cco", label: "CCO" },
];

export function siapaMenekenApa(): { label: string; kkp: string; konsultan: string; penyedia: string }[] {
  return DOKUMEN_DI_LAYAR.map(({ jenis, label }) => ({
    label,
    kkp: JABATAN_KKP[pihakKkp(jenis)],
    konsultan: JABATAN_KONSULTAN[pihakKonsultan(jenis)],
    penyedia: JABATAN_PENYEDIA[pihakPenyedia(jenis)],
  }));
}

/**
 * Personel tambahan di kontrak (BANUSA, DECISIONS 662). Nama + coretan tanda
 * tangan; stempelnya milik firma, bukan orang (DECISIONS 408).
 *
 * Quality Surveyor dan Site Manager BELUM meneken dokumen apa pun di MARLIN:
 * keduanya untuk BUD/Calculation Sheet (WSP – QS – PM/SM) yang menyusul.
 * Diisi sekarang supaya datanya sudah ada saat dokumen itu dibuat.
 */
export const PERSONEL_KONTRAK = [
  { nama: "coTeamLeaderName", ttd: "coTeamLeaderTtdKey", pihak: "konsultan", jabatan: "Koordinator Team Leader" },
  { nama: "teamLeaderName", ttd: "teamLeaderTtdKey", pihak: "konsultan", jabatan: "Team Leader" },
  { nama: "qualitySurveyorName", ttd: "qualitySurveyorTtdKey", pihak: "konsultan", jabatan: "Quality Surveyor" },
  { nama: "projectManagerName", ttd: "projectManagerTtdKey", pihak: "penyedia", jabatan: JABATAN_MANAJER_PROYEK },
  { nama: "siteManagerName", ttd: "siteManagerTtdKey", pihak: "penyedia", jabatan: "Site Manager" },
] as const;

export type MedanNamaPersonel = (typeof PERSONEL_KONTRAK)[number]["nama"];
export type MedanTtdPersonel = (typeof PERSONEL_KONTRAK)[number]["ttd"];

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

/* ────────────────────────────────────────────────────────────────────────────
 * WAKIL SAH PER LOKASI (user 2026-08-24)
 *
 * *"pendandatangan di laporan mingguan dan bulanan bukan PPK, tapi istilahnya
 * Wakil Sah. Wakil Sah bisa per lokasi beda."*
 *
 * Wakil Sah = pihak KKP yang meneken laporan MINGGUAN & BULANAN. PPK tetap
 * dipakai dokumen lain (lembar kurva-S/jadwal, MC, CCO) — ketetapan user
 * 2026-08-24, opsi "mingguan + bulanan saja". Aturan bloknya sama dengan
 * Pelaksana/Pengawas: kontrak menyediakan yang berlaku umum, lokasi boleh
 * menimpa, dan penimpaan diambil SATU BLOK dengan NAMA sebagai penentu —
 * coretan tanda tangan Wakil Sah kontrak di bawah nama Wakil Sah lokasi
 * adalah pernyataan yang tidak benar pada dokumen resmi.
 *
 * Stempel TIDAK ikut blok ini: stempel milik INSTANSI (DECISIONS 408), tetap
 * `Contract.ppkStempelKey` — instansinya satu walau wakilnya berbeda-beda.
 * ──────────────────────────────────────────────────────────────────────────── */

export type BlokWakilSah = {
  nama: string | null;
  /** NIP – baris di bawah nama pada blok tanda tangan (boleh kosong). */
  nip: string | null;
  ttdKey: string | null;
};

export type SumberWakilSah = {
  wakilSahName: string | null;
  wakilSahNip: string | null;
  wakilSahTtdKey: string | null;
};

/**
 * Wakil Sah untuk satu lokasi: penimpaan lokasi kalau ada, kalau tidak kontrak.
 * Penentunya NAMA — sama seperti {@link pilihPelaksana}.
 */
export function pilihWakilSah(
  lokasi: SumberWakilSah | null | undefined,
  kontrak: SumberWakilSah | null | undefined,
): BlokWakilSah {
  const sumber = lokasi && !kosong(lokasi.wakilSahName) ? lokasi : kontrak;
  if (!sumber || kosong(sumber.wakilSahName)) return { nama: null, nip: null, ttdKey: null };
  return {
    nama: sumber.wakilSahName!.trim(),
    nip: kosong(sumber.wakilSahNip) ? null : sumber.wakilSahNip!.trim(),
    ttdKey: sumber.wakilSahTtdKey ?? null,
  };
}

/** Lokasi ini memakai Wakil Sah-nya sendiri, atau ikut kontrak? */
export function asalWakilSah(
  lokasi: SumberWakilSah | null | undefined,
  kontrak: SumberWakilSah | null | undefined,
): "lokasi" | "kontrak" | "belum diisi" {
  if (lokasi && !kosong(lokasi.wakilSahName)) return "lokasi";
  if (kontrak && !kosong(kontrak.wakilSahName)) return "kontrak";
  return "belum diisi";
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
    projectManagerName?: string | null;
  },
): { nama: string | null; sub: string | null } {
  if (pihakPenyedia(jenis) === "manajer_proyek") {
    return { nama: kosong(h.projectManagerName) ? null : h.projectManagerName!.trim(), sub: JABATAN_MANAJER_PROYEK };
  }
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

/* ────────────────────────────────────────────────────────────────────────────
 * KOORDINATOR TEAM LEADER PER LOKASI (DECISIONS 662)
 *
 * Satu kontrak bisa mencakup beberapa wilayah, dan tiap wilayah punya
 * koordinatornya sendiri. Aturan blok sama dengan Wakil Sah: nama penentu,
 * coretan tidak pernah dipinjam antar orang.
 * ──────────────────────────────────────────────────────────────────────────── */

export type SumberKoordinatorTl = {
  coTeamLeaderName: string | null;
  coTeamLeaderTtdKey: string | null;
};

export function pilihKoordinatorTl(
  lokasi: SumberKoordinatorTl | null | undefined,
  kontrak: SumberKoordinatorTl | null | undefined,
): { nama: string | null; ttdKey: string | null } {
  const sumber = lokasi && !kosong(lokasi.coTeamLeaderName) ? lokasi : kontrak;
  if (!sumber || kosong(sumber.coTeamLeaderName)) return { nama: null, ttdKey: null };
  return { nama: sumber.coTeamLeaderName!.trim(), ttdKey: sumber.coTeamLeaderTtdKey ?? null };
}

/** Lokasi ini memakai Koordinator TL-nya sendiri, atau ikut kontrak? */
export function asalKoordinatorTl(
  lokasi: SumberKoordinatorTl | null | undefined,
  kontrak: SumberKoordinatorTl | null | undefined,
): "lokasi" | "kontrak" | "belum diisi" {
  if (lokasi && !kosong(lokasi.coTeamLeaderName)) return "lokasi";
  if (kontrak && !kosong(kontrak.coTeamLeaderName)) return "kontrak";
  return "belum diisi";
}

/* ────────────────────────────────────────────────────────────────────────────
 * TIGA SLOT TANDA TANGAN SATU DOKUMEN (DECISIONS 662)
 *
 * SATU-SATUNYA tempat yang menyusun apa yang tercetak di blok tanda tangan –
 * dipakai halaman cetak, PDF, dan Excel. Sebelum ini tiap penyaji memilih
 * sendiri dari medan kop, dan Excel sempat mencetak nama pelaksana di bawah
 * jabatan direktur.
 *
 * Yang belum diisi tercetak sebagai baris kosong untuk ditandatangani tangan,
 * TIDAK PERNAH jatuh ke orang lain (DECISIONS 402): laporan mingguan tanpa
 * Manajer Proyek tidak boleh diam-diam diteken pelaksana.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Nama-nama yang SUDAH dipilih (penimpaan lokasi sudah diterapkan). */
export type NamaPenandatangan = {
  ppkName: string | null;
  ppkNip: string | null;
  wakilSahName: string | null;
  wakilSahNip: string | null;
  /** Pengawas Lapangan (lokasi menimpa kontrak) dan firmanya. */
  supervisorName: string | null;
  supervisorFirm: string | null;
  /** Firma konsultan di KONTRAK – dipakai Team Leader & Koordinator TL. */
  supervisorFirmKontrak: string | null;
  coTeamLeaderName: string | null;
  teamLeaderName: string | null;
  vendorName: string;
  contractorSignerName: string | null;
  contractorSignerTitle: string | null;
  projectManagerName: string | null;
  pelaksanaName: string | null;
  pelaksanaTitle: string | null;
};

export type SlotDokumen = {
  /** "Wakil Sah PPK" · "Pejabat Pembuat Komitmen" · "Konsultan Pengawas" · "Penyedia Jasa". */
  pihak: string;
  /** Firma konsultan / perusahaan penyedia, ditulis apa adanya. */
  instansi: string | null;
  /** null = belum diisi: dicetak garis titik. */
  nama: string | null;
  /** Di bawah nama: NIP (KKP) atau jabatan (konsultan, penyedia). */
  sub: string | null;
};

const isi = (v: string | null | undefined): string | null => (kosong(v) ? null : v!.trim());

export function penandatanganDokumen(
  jenis: JenisDokumen,
  h: NamaPenandatangan,
): { kkp: SlotDokumen; konsultan: SlotDokumen; penyedia: SlotDokumen } {
  const wakil = pihakKkp(jenis) === "wakil_sah";
  const nip = isi(wakil ? h.wakilSahNip : h.ppkNip);
  const kkp: SlotDokumen = {
    pihak: wakil ? "Wakil Sah PPK" : "Pejabat Pembuat Komitmen",
    instansi: null,
    nama: isi(wakil ? h.wakilSahName : h.ppkName),
    sub: nip ? `NIP. ${nip}` : null,
  };

  const k = pihakKonsultan(jenis);
  const konsultan: SlotDokumen = {
    pihak: "Konsultan Pengawas",
    instansi: k === "pengawas_lapangan" ? isi(h.supervisorFirm) : isi(h.supervisorFirmKontrak),
    nama: isi(k === "pengawas_lapangan" ? h.supervisorName : k === "koordinator_tl" ? h.coTeamLeaderName : h.teamLeaderName),
    sub: JABATAN_KONSULTAN[k],
  };

  const p = penyediaLaporan(jenis, h);
  const penyedia: SlotDokumen = { pihak: "Penyedia Jasa", instansi: isi(h.vendorName), nama: p.nama, sub: p.sub };
  return { kkp, konsultan, penyedia };
}

/**
 * Baris peran di atas ruang tanda tangan: "Konsultan Pengawas – PT X". Hanya
 * nama PIHAK-nya yang dibesarkan bila diminta; nama firma ditulis apa adanya.
 */
export function peranSlot(slot: SlotDokumen, kapital = false): string {
  const pihak = kapital ? slot.pihak.toUpperCase() : slot.pihak;
  return slot.instansi ? `${pihak} – ${slot.instansi}` : pihak;
}

/** Dokumen yang penanda tangannya ditetapkan BANUSA – yang diperiksa kekosongannya. */
const DOKUMEN_DIPERIKSA: JenisDokumen[] = ["harian", "mingguan", "bulanan", "jadwal"];
const URUTAN_JABATAN = [
  "PPK",
  "Wakil Sah PPK",
  "Pengawas Lapangan",
  "Koordinator Team Leader",
  "Team Leader",
  "Manajer Proyek",
  "Pelaksana Lapangan",
  "Direktur",
];

/**
 * Penanda tangan yang BELUM DIISI, berikut dokumen yang slotnya akan tercetak
 * kosong (DECISIONS 662). Kosong tetap boleh dicetak – garis titik untuk
 * ditandatangani tangan – tapi orang harus tahu SEBELUM mengirimnya.
 */
export function slotPenandatanganKosong(h: NamaPenandatangan): { jabatan: string; dokumen: string[] }[] {
  const per = new Map<string, string[]>();
  for (const { jenis, label } of DOKUMEN_DI_LAYAR.filter((d) => DOKUMEN_DIPERIKSA.includes(d.jenis))) {
    const tt = penandatanganDokumen(jenis, h);
    const slot: [string, SlotDokumen][] = [
      [JABATAN_KKP[pihakKkp(jenis)], tt.kkp],
      [JABATAN_KONSULTAN[pihakKonsultan(jenis)], tt.konsultan],
      [JABATAN_PENYEDIA[pihakPenyedia(jenis)], tt.penyedia],
    ];
    for (const [jabatan, s] of slot) {
      if (s.nama) continue;
      per.set(jabatan, [...(per.get(jabatan) ?? []), label]);
    }
  }
  return [...per.entries()]
    .map(([jabatan, dokumen]) => ({ jabatan, dokumen }))
    .sort((a, b) => URUTAN_JABATAN.indexOf(a.jabatan) - URUTAN_JABATAN.indexOf(b.jabatan));
}

export function peringatanPelaksana(blok: BlokPelaksana): string | null {
  if (blok.nama) return null;
  return (
    "Pelaksana Lapangan belum diisi – blok tanda tangan laporan harian " +
    "akan tercetak tanpa nama. Isi di Paket › Kontrak, atau di lokasi ini bila pelaksananya berbeda."
  );
}
