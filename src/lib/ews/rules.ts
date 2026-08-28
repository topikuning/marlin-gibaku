/**
 * EARLY WARNING SYSTEM — rule MURNI (tanpa DB, tanpa AI), DECISIONS 426.
 *
 * Setiap warning membawa: sumber (ruleId), objek, alasan spesifik, tindakan
 * yang disarankan, dan deep-link. Ambang deviasi SEJALAN dengan yang sudah
 * dipakai sistem: −10 pp = kritis (dashboard `KRITIS_THRESHOLD`, ai-hub
 * `risk.ts` skor 75), −5 pp = tinggi (risk.ts skor 55). Fakta dihitung
 * calculation layer; modul ini hanya membandingkan terhadap ambang.
 *
 * Pagar minggu-0 (DECISIONS 202/340): lokasi yang SPMK-nya belum tiba
 * (weekNumber 0) tidak dievaluasi rule progres/laporan — hari sebelum kontrak
 * bukan keterlambatan.
 */

export type EwsSeverity = "kritis" | "tinggi" | "sedang";

export const EWS_SEVERITY_LABEL: Record<EwsSeverity, string> = {
  kritis: "Kritis",
  tinggi: "Tinggi",
  sedang: "Sedang",
};

export type EwsKategori =
  | "progress"
  | "kontrak"
  | "laporan"
  | "temuan"
  | "kendala"
  | "dokumen"
  | "administrasi"
  | "surat";

export const EWS_KATEGORI_LABEL: Record<EwsKategori, string> = {
  progress: "Progress",
  kontrak: "Kontrak",
  laporan: "Laporan Harian",
  temuan: "Temuan",
  kendala: "Kendala",
  dokumen: "Dokumen",
  administrasi: "Administrasi",
  surat: "Surat",
};

export type EwsWarning = {
  ruleId: string;
  /**
   * IDENTITAS objek yang bermasalah — terisi salah satu, sesuai tingkat
   * aturannya (perbaikan review 2026-08-28).
   *
   * Sebelumnya satu-satunya petunjuk objek adalah `objek` (nama untuk dibaca)
   * dan `href`. Pemakai di luar layar — adapter AI — terpaksa menebak dari
   * teks href, sehingga peringatan tingkat PAKET dan SURAT tidak pernah
   * terpetakan sama sekali, dan pencocokan `includes` bisa menyamakan slug
   * yang saling berawalan ("kranji" dengan "kranji-2"). Id yang eksplisit
   * menutup keduanya sekaligus.
   */
  locationSlug?: string;
  packageId?: string;
  letterId?: string;
  kategori: EwsKategori;
  severity: EwsSeverity;
  /** Objek yang bermasalah ("Lokasi Sugihwaras", "Paket KNMP NTB 1"). */
  objek: string;
  /** Alasan SPESIFIK dengan angka. */
  alasan: string;
  /** Tindakan yang disarankan. */
  tindakan: string;
  href: string;
};

/* ── Ambang (satu tempat) ─────────────────────────────────── */
export const AMBANG = {
  deviasiKritisPp: -10,
  deviasiTinggiPp: -5,
  tanpaLaporanTinggiHari: 7,
  tanpaLaporanKritisHari: 14,
  sisaKontrakTinggiHari: 30,
  sisaKontrakKritisHari: 14,
  progresAmanAkhirKontrakPct: 90,
  konsumsiWaktuSenjangPp: 20,
  dokKadaluarsaSegeraHari: 30,
  laporanMenggantungSedang: 3,
  /// Surat yang menuntut jawaban dianggap kritis bila lewat tenggat sekian hari.
  suratTelatKritisHari: 7,
} as const;

export type EwsLocationFacts = {
  locationName: string;
  locationSlug: string;
  /** LocationStatus — hanya `berjalan`/`terhenti` yang dievaluasi penuh. */
  status: string;
  /** 0 = SPMK belum tiba (pagar minggu-0). */
  weekNumber: number;
  totalWeeks: number;
  deviationPct: number;
  realizedPct: number;
  /** Hari sejak laporan terhitung terakhir; null = belum pernah lapor. */
  hariTanpaLaporan: number | null;
  /** Laporan berstatus perlu_koreksi yang menggantung. */
  laporanPerluKoreksi: number;
  sisaHariKontrak: number | null;
  /** % masa kontrak yang sudah terpakai (0..100+), null bila belum mulai. */
  waktuTerpakaiPct: number | null;
  temuanKritisTerbuka: number;
  temuanLewatTenggat: number;
  temuanDibukaKembali: number;
  kendalaLewatTenggat: number;
};

export function evaluasiEwsLokasi(f: EwsLocationFacts): EwsWarning[] {
  /*
   * Identitas lokasinya dicap SEKALI di akhir, bukan diulang di tiap aturan:
   * satu aturan baru yang lupa mencantumkannya akan hilang lagi dari AI, dan
   * hilangnya tidak menghasilkan galat apa pun.
   */
  const w: EwsWarning[] = [];
  const lok = f.locationName;
  const hrefLokasi = `/lokasi/${f.locationSlug}`;
  const aktif = f.status === "berjalan" || f.status === "terhenti";
  const sudahMulai = f.weekNumber >= 1;

  if (f.status === "terhenti") {
    w.push({
      ruleId: "lokasi_terhenti",
      kategori: "progress",
      severity: "tinggi",
      objek: lok,
      alasan: "Pekerjaan berstatus terhenti.",
      tindakan: "Periksa kendala penyebab terhenti dan rencana pemulihannya.",
      href: `${hrefLokasi}/progress`,
    });
  }

  if (aktif && sudahMulai) {
    if (f.deviationPct <= AMBANG.deviasiKritisPp) {
      w.push({
        ruleId: "deviasi_kritis",
        kategori: "progress",
        severity: "kritis",
        objek: lok,
        alasan: `Deviasi ${f.deviationPct.toFixed(1)} pp terhadap rencana minggu ke-${f.weekNumber}.`,
        tindakan: "Susun rencana kejar (recovery) dan verifikasi hambatan lapangan.",
        href: `${hrefLokasi}/progress`,
      });
    } else if (f.deviationPct <= AMBANG.deviasiTinggiPp) {
      w.push({
        ruleId: "deviasi_tinggi",
        kategori: "progress",
        severity: "tinggi",
        objek: lok,
        alasan: `Deviasi ${f.deviationPct.toFixed(1)} pp terhadap rencana minggu ke-${f.weekNumber}.`,
        tindakan: "Tinjau item pekerjaan yang tertinggal di rencana mingguan.",
        href: `${hrefLokasi}/progress`,
      });
    }

    if (f.hariTanpaLaporan === null) {
      w.push({
        ruleId: "belum_pernah_lapor",
        kategori: "laporan",
        severity: "tinggi",
        objek: lok,
        alasan: "Belum ada satu pun laporan harian terkirim sejak SPMK.",
        tindakan: "Tagih laporan harian pertama ke Site Manager/pelaksana.",
        href: `${hrefLokasi}/harian`,
      });
    } else if (f.hariTanpaLaporan >= AMBANG.tanpaLaporanKritisHari) {
      w.push({
        ruleId: "tanpa_laporan_kritis",
        kategori: "laporan",
        severity: "kritis",
        objek: lok,
        alasan: `${f.hariTanpaLaporan} hari tanpa laporan harian terkirim.`,
        tindakan: "Hubungi lapangan – pastikan pekerjaan dan pelaporannya masih berjalan.",
        href: `${hrefLokasi}/harian`,
      });
    } else if (f.hariTanpaLaporan >= AMBANG.tanpaLaporanTinggiHari) {
      w.push({
        ruleId: "tanpa_laporan_tinggi",
        kategori: "laporan",
        severity: "tinggi",
        objek: lok,
        alasan: `${f.hariTanpaLaporan} hari tanpa laporan harian terkirim.`,
        tindakan: "Ingatkan pelapor – pengingat WA harian bisa dipicu dari Sistem.",
        href: `${hrefLokasi}/harian`,
      });
    }

    if (f.waktuTerpakaiPct !== null && f.waktuTerpakaiPct - f.realizedPct > AMBANG.konsumsiWaktuSenjangPp) {
      w.push({
        ruleId: "konsumsi_waktu",
        kategori: "kontrak",
        severity: "sedang",
        objek: lok,
        alasan: `Waktu kontrak terpakai ${f.waktuTerpakaiPct.toFixed(0)}% sedangkan progress ${f.realizedPct.toFixed(1)}%.`,
        tindakan: "Bandingkan kurva-S dan pertimbangkan percepatan/adendum waktu.",
        href: `${hrefLokasi}/progress`,
      });
    }
  }

  if (aktif && f.sisaHariKontrak !== null) {
    if (f.sisaHariKontrak < 0) {
      w.push({
        ruleId: "kontrak_lewat",
        kategori: "kontrak",
        severity: "kritis",
        objek: lok,
        alasan: `Masa kontrak lewat ${Math.abs(f.sisaHariKontrak)} hari dan pekerjaan belum selesai (progress ${f.realizedPct.toFixed(1)}%).`,
        tindakan: "Segera proses adendum waktu / langkah kontraktual (SCM).",
        href: hrefLokasi,
      });
    } else if (f.sisaHariKontrak <= AMBANG.sisaKontrakKritisHari && f.realizedPct < AMBANG.progresAmanAkhirKontrakPct) {
      w.push({
        ruleId: "sisa_kontrak_kritis",
        kategori: "kontrak",
        severity: "kritis",
        objek: lok,
        alasan: `Sisa waktu kontrak ${f.sisaHariKontrak} hari, progress baru ${f.realizedPct.toFixed(1)}%.`,
        tindakan: "Putuskan percepatan atau adendum sekarang – bukan di hari terakhir.",
        href: hrefLokasi,
      });
    } else if (f.sisaHariKontrak <= AMBANG.sisaKontrakTinggiHari && f.realizedPct < AMBANG.progresAmanAkhirKontrakPct) {
      w.push({
        ruleId: "sisa_kontrak_tinggi",
        kategori: "kontrak",
        severity: "tinggi",
        objek: lok,
        alasan: `Sisa waktu kontrak ${f.sisaHariKontrak} hari, progress ${f.realizedPct.toFixed(1)}%.`,
        tindakan: "Tinjau sisa pekerjaan terhadap sisa waktu.",
        href: hrefLokasi,
      });
    }
  }

  if (f.laporanPerluKoreksi >= AMBANG.laporanMenggantungSedang) {
    w.push({
      ruleId: "laporan_menggantung",
      kategori: "laporan",
      severity: "sedang",
      objek: lok,
      alasan: `${f.laporanPerluKoreksi} laporan dikembalikan (perlu koreksi) belum diperbaiki.`,
      tindakan: "Minta pelapor menyelesaikan koreksi supaya angkanya ikut terhitung.",
      href: `${hrefLokasi}/harian?saring=perlu_tindakan`,
    });
  }

  if (f.temuanKritisTerbuka > 0) {
    w.push({
      ruleId: "temuan_kritis",
      kategori: "temuan",
      severity: "kritis",
      objek: lok,
      alasan: `${f.temuanKritisTerbuka} temuan kritis masih terbuka.`,
      tindakan: "Prioritaskan tindak lanjut dan ajukan verifikasi penutupan.",
      href: `/temuan?status=terbuka&tingkat=kritis&lokasi=${f.locationSlug}`,
    });
  }
  if (f.temuanLewatTenggat > 0) {
    w.push({
      ruleId: "temuan_lewat_tenggat",
      kategori: "temuan",
      severity: "tinggi",
      objek: lok,
      alasan: `${f.temuanLewatTenggat} temuan lewat tenggat tindak lanjut.`,
      tindakan: "Tagih PIC tindak lanjut; perbarui tenggat bila disepakati verifikator.",
      href: `/temuan?status=lewat_tenggat&lokasi=${f.locationSlug}`,
    });
  }
  if (f.temuanDibukaKembali > 0) {
    w.push({
      ruleId: "temuan_dibuka_kembali",
      kategori: "temuan",
      severity: "tinggi",
      objek: lok,
      alasan: `${f.temuanDibukaKembali} temuan dibuka kembali setelah dinyatakan selesai.`,
      tindakan: "Periksa akar masalah – perbaikan sebelumnya tidak tuntas.",
      href: `/temuan?status=dibuka_kembali&lokasi=${f.locationSlug}`,
    });
  }
  if (f.kendalaLewatTenggat > 0) {
    w.push({
      ruleId: "kendala_lewat_tenggat",
      kategori: "kendala",
      severity: "sedang",
      objek: lok,
      alasan: `${f.kendalaLewatTenggat} kendala lewat tenggat penyelesaian.`,
      tindakan: "Tinjau papan kendala dan tagih pemiliknya.",
      href: "/kendala?status=lewat_tenggat",
    });
  }

  return w.map((x) => ({ ...x, locationSlug: f.locationSlug }));
}

export type EwsPackageFacts = {
  packageId: string;
  packageName: string;
  dokSudahKadaluarsa: { title: string }[];
  dokSegeraKadaluarsa: { title: string; hariLagi: number }[];
  milestoneTerlambat: number;
};

export function evaluasiEwsPaket(f: EwsPackageFacts): EwsWarning[] {
  // Dicap sekali di akhir — alasan yang sama dengan `evaluasiEwsLokasi`.
  const w: EwsWarning[] = [];
  const hrefDok = `/paket/${f.packageId}/dokumen`;
  if (f.dokSudahKadaluarsa.length > 0) {
    w.push({
      ruleId: "dok_kadaluarsa",
      kategori: "dokumen",
      severity: "tinggi",
      objek: f.packageName,
      alasan: `${f.dokSudahKadaluarsa.length} dokumen aktif lewat masa berlaku (mis. ${f.dokSudahKadaluarsa[0].title}).`,
      tindakan: "Perpanjang / unggah dokumen pengganti (mis. jaminan pelaksanaan).",
      href: hrefDok,
    });
  }
  if (f.dokSegeraKadaluarsa.length > 0) {
    const terdekat = f.dokSegeraKadaluarsa[0];
    w.push({
      ruleId: "dok_segera_kadaluarsa",
      kategori: "dokumen",
      severity: "sedang",
      objek: f.packageName,
      alasan: `${f.dokSegeraKadaluarsa.length} dokumen kadaluarsa dalam ${AMBANG.dokKadaluarsaSegeraHari} hari (terdekat: ${terdekat.title}, ${terdekat.hariLagi} hari lagi).`,
      tindakan: "Jadwalkan perpanjangan sebelum jatuh tempo.",
      href: hrefDok,
    });
  }
  if (f.milestoneTerlambat > 0) {
    w.push({
      ruleId: "milestone_terlambat",
      kategori: "administrasi",
      severity: "sedang",
      objek: f.packageName,
      alasan: `${f.milestoneTerlambat} milestone administrasi lewat tenggat.`,
      tindakan: "Tinjau papan kepatuhan dokumen paket.",
      href: hrefDok,
    });
  }
  return w.map((x) => ({ ...x, packageId: f.packageId }));
}

const SEVERITY_RANK: Record<EwsSeverity, number> = { kritis: 0, tinggi: 1, sedang: 2 };

export function urutkanWarning(list: EwsWarning[]): EwsWarning[] {
  return [...list].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.objek.localeCompare(b.objek),
  );
}


/* ── Surat yang belum dijawab lewat tenggat (DECISIONS 432) ─────────────────
   Inti register surat: bukan arsip yang rapi, tapi surat yang MENDIAMKAN DIRI
   harus kelihatan. Aturan ini MURNI supaya bisa diuji tanpa DB. */

export type EwsSuratFacts = {
  letterId: string;
  /** Paket yang menaungi surat ini; null = surat tingkat organisasi. */
  packageId?: string | null;
  /** Nomor agenda utk penyebutan di layar ("Agenda 12/2026"). */
  agenda: string;
  subject: string;
  pihak: string;
  /** Hari keterlambatan menjawab (positif = sudah lewat). */
  telatHari: number;
};

/** Satu peringatan per surat yang lewat tenggat jawab. MURNI. */
export function evaluasiEwsSurat(f: EwsSuratFacts): EwsWarning[] {
  if (f.telatHari <= 0) return [];
  const kritis = f.telatHari >= AMBANG.suratTelatKritisHari;
  return [
    {
      ruleId: "surat.belum_dijawab",
      kategori: "surat",
      severity: kritis ? "kritis" : "tinggi",
      objek: `Agenda ${f.agenda} – ${f.subject}`,
      alasan: `Surat dari ${f.pihak} menunggu jawaban, lewat tenggat ${f.telatHari} hari.`,
      tindakan: "Balas suratnya, lalu tandai sudah dijawab di register surat.",
      href: `/surat?sorot=${f.letterId}`,
      letterId: f.letterId,
      packageId: f.packageId ?? undefined,
    },
  ];
}
