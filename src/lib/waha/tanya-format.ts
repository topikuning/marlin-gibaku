import { LABEL_TINGKAT, NIAT_LABEL, type HasilResolusi, type Niat } from "./tanya-niat";
import type { BentukDokumen } from "./parser-niat";
import type { JenisPeristiwa, KondisiTerkini, Peristiwa } from "@/lib/kronologi/susun";
import { catatanGabung, ringkasKendalaPerLokasi } from "./kendala-ringkas";

/**
 * Perakit BALASAN WhatsApp — MURNI, dari angka yang SUDAH dihitung
 * (DECISIONS 339).
 *
 * Tidak ada satu pun angka yang lahir di berkas ini; semuanya diterima jadi
 * dari calc layer. Berkas ini hanya memilih kata dan urutan.
 *
 * ### Kenapa formatnya sederhana
 *
 * Balasan ini dibaca di WhatsApp, di ponsel, di lapangan, sering sambil
 * berjalan. Tidak ada tabel, tidak ada emoji berlebih, tidak ada paragraf
 * panjang: satu baris per lokasi, angka di depan, nama di belakang.
 *
 * ### Yang TIDAK boleh hilang
 *
 * Pemotongan lingkup (jawaban grup yang dipangkas ke paket grup) dan daftar
 * lokasi yang tidak dikenali WAJIB ikut tercetak. Jawaban sebagian yang tidak
 * mengaku sebagian akan dibaca sebagai jawaban lengkap — dan di WhatsApp ia
 * akan diteruskan apa adanya.
 */

/** Persen apa adanya – dipakai balasan teks DAN tabel PDF (DECISIONS 448). */
export const pct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
/** Angka bertanda; sama persis dengan yang terbaca di WhatsApp. */
export const bertanda = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2).replace(".", ",")}%`;

/** Sapaan tetap di kepala tiap balasan, supaya jelas ini balasan MARLIN. */
function kepala(judul: string, tanggal: string): string {
  return `*${judul}*\n_${tanggal}_`;
}

/**
 * Kaki balasan: nama yang tidak dikenal + pemotongan lingkup + pemotongan
 * jumlah baris. Selalu di akhir, dan TIDAK PERNAH dilewati.
 *
 * Ketiganya adalah pengakuan bahwa jawabannya sebagian. Jawaban sebagian yang
 * tidak mengaku sebagian akan diteruskan apa adanya sebagai jawaban lengkap.
 */
export type OpsiKaki = {
  catatanPemotongan?: string | null;
  /**
   * Periode yang tidak bisa dipenuhi apa adanya — mis. minggu berjalan dipotong
   * di hari ini, atau tanggal yang belum terjadi (DECISIONS 356). Periode yang
   * diam-diam digeser menghasilkan angka yang benar untuk hari yang salah.
   */
  catatanPeriode?: string | null;
  /** Pemotongan JUMLAH baris ("ditampilkan 15 dari 40"). */
  catatanBatas?: string | null;
  /**
   * Pengakuan bahwa baris kembar sudah digabung (DECISIONS 450). Daftar yang
   * dipadatkan diam-diam terlihat lebih pendek dari kenyataannya.
   */
  catatanGabung?: string | null;
  resolusi?: HasilResolusi | null;
};

function kaki(opts: OpsiKaki): string {
  const b: string[] = [];
  /*
   * Perluasan wilayah disebut DULUAN, dan tidak pernah dilewati.
   *
   * Menjawab 5 lokasi untuk pertanyaan yang menyebut satu kata — tanpa
   * mengatakan kata itu sebuah kabupaten — membuat penanya mengira ia sedang
   * membaca angka SATU lokasi. Di WhatsApp balasan itu diteruskan apa adanya.
   */
  for (const w of opts.resolusi?.wilayah ?? []) {
    b.push(
      `ℹ️ "${w.diketik}" saya baca sebagai ${LABEL_TINGKAT[w.tingkat]} ${w.nama} – ${w.jumlah} lokasi.`,
    );
  }
  if (opts.resolusi && opts.resolusi.tidakDikenal.length > 0) {
    b.push(
      `⚠️ Tidak saya kenali: ${opts.resolusi.tidakDikenal.join(", ")} – mungkin salah ketik, atau di luar penugasan Anda.`,
    );
  }
  if (opts.catatanPeriode) b.push(`ℹ️ ${opts.catatanPeriode}`);
  if (opts.catatanBatas) b.push(`ℹ️ ${opts.catatanBatas}`);
  if (opts.catatanGabung) b.push(`ℹ️ ${opts.catatanGabung}`);
  if (opts.catatanPemotongan) b.push(`ℹ️ ${opts.catatanPemotongan}`);
  return b.length > 0 ? `\n\n${b.join("\n")}` : "";
}

/* ------------------------------------------------------------------ */
/* Balasan yang BUKAN data                                             */
/* ------------------------------------------------------------------ */

/** Niat tidak dikenali — mengaku, lalu menyebut yang bisa dijawab. */
export function balasTidakMengerti(): string {
  /*
   * `produksi` sengaja TIDAK ikut didaftar. Daftar ini berjudul "yang bisa saya
   * jawab", sedangkan produksi justru satu-satunya niat yang jawabannya adalah
   * pengakuan tidak bisa. Mencantumkannya di sini akan menjanjikan hal yang
   * kemudian ditolak MARLIN sendiri (audit 2026-08-28).
   */
  const daftar = (Object.keys(NIAT_LABEL) as Niat[])
    .filter((n) => n !== "produksi")
    .map((n) => `• ${NIAT_LABEL[n]}`)
    .join("\n");
  return [
    "Maaf, saya belum mengerti pertanyaan itu.",
    "",
    "Yang bisa saya jawab sekarang:",
    daftar,
    "",
    'Contoh: "ada kendala apa hari ini", "progress hari ini di Kedung Mutih", "mana yang deviasinya negatif", "siapa yang belum lapor".',
  ].join("\n");
}

/**
 * Nama lokasi ambigu — BALIK BERTANYA, sebutkan kandidatnya.
 *
 * Bukan memilih yang pertama: itu menghasilkan jawaban yang benar untuk lokasi
 * yang salah, dan penanya tidak punya cara mengetahuinya.
 */
export function balasAmbigu(
  ambigu: HasilResolusi["ambigu"],
  ambiguWilayah: HasilResolusi["ambiguWilayah"] = [],
): string {
  const b = ambigu.map(
    (a) => `"${a.diketik}" bisa berarti: ${a.kandidat.map((k) => k.nama).join(", ")}`,
  );
  /*
   * Satu kata yang cocok di dua TINGKAT wilayah sekaligus — mis. Kecamatan
   * Demak (1 lokasi) di dalam Kabupaten Demak (4 lokasi). Jumlah lokasinya
   * ikut disebut karena itulah beda yang menentukan pilihan penanya; tanpa
   * angka itu, kedua pilihan terlihat sama saja.
   */
  for (const a of ambiguWilayah) {
    b.push(
      `"${a.diketik}" bisa berarti: ${a.pilihan
        .map((p) => `${LABEL_TINGKAT[p.tingkat]} ${p.nama} (${p.lokasi.length} lokasi)`)
        .join(", ")}`,
    );
  }
  return ["Nama lokasinya belum pasti:", "", ...b, "", "Tolong sebut nama lengkapnya."].join("\n");
}

/**
 * Balasan atas perintah "abaikan" / "lupakan" (DECISIONS 390).
 *
 * Membedakan "sudah saya lupakan" dari "memang tidak ada yang saya ingat":
 * kalau keduanya dijawab sama, penanya tidak pernah tahu apakah perintahnya
 * benar-benar berlaku – dan itu justru alasan ia mengetiknya.
 */
export function balasLupakan(adaKonteks: boolean): string {
  return adaKonteks
    ? "Baik, saya lupakan percakapan sebelumnya. Pertanyaan berikutnya saya baca dari nol – sebutkan lokasi & periodenya kalau perlu."
    : "Tidak ada percakapan yang sedang saya ingat, jadi tidak ada yang perlu dilupakan. Silakan tanya apa saja.";
}

export function balasDitolak(alasan: string): string {
  return alasan;
}

/* ------------------------------------------------------------------ */
/* Balasan berdata                                                     */
/* ------------------------------------------------------------------ */

export type BarisKendala = {
  lokasi: string;
  judul: string;
  tingkat: string;
  /** `terbuka` / `ditangani` — "sudah ada yang pegang" tidak boleh hilang. */
  status: string;
  umurHari: number;
};

export function balasKendala(
  r: {
    tanggal: string;
    baris: BarisKendala[];
    lokasiDiperiksa: number;
    /**
     * Judul yang menyebut CARA BACA-nya (DECISIONS 381) — "yang dibuka",
     * "yang dibuka & masih terbuka", atau "belum selesai".
     *
     * Wajib berbeda per cara baca: tiga daftar yang isinya bisa sangat berbeda
     * di bawah satu judul yang sama membuat penanya tidak punya cara mengetahui
     * pertanyaan mana yang sebenarnya dijawab.
     */
    judul?: string;
  },
  opts: OpsiKaki = {},
): string {
  const judul = r.judul ?? "Kendala belum selesai";
  if (r.baris.length === 0) {
    return (
      kepala(judul, r.tanggal) +
      `\n\nTidak ada yang cocok di ${r.lokasiDiperiksa} lokasi yang saya periksa.` +
      kaki(opts)
    );
  }
  /*
   * Satu blok per lokasi, dan KEMBARNYA dibuang (DECISIONS 450).
   *
   * Peringkasan yang sama dipakai balasan teks DAN tabel PDF – dua daftar yang
   * mengaku isi yang sama tidak boleh berbeda jumlah barisnya tergantung
   * wadahnya.
   */
  const { baris: perLokasi, digabung } = ringkasKendalaPerLokasi(r.baris);
  const jumlahKendala = perLokasi.reduce((n, l) => n + l.kendala.length, 0);
  const isi = perLokasi.map((l) => {
    const item = l.kendala.map((k) => `  • ${k}`);
    return [`*${l.lokasi}* _(${l.tingkat}, ${l.status}, ${l.umurHari} hari)_`, ...item].join("\n");
  });
  return (
    kepala(`${judul} – ${jumlahKendala} di ${perLokasi.length} lokasi`, r.tanggal) +
    "\n\n" +
    isi.join("\n\n") +
    kaki({ ...opts, catatanGabung: catatanGabung(digabung) })
  );
}

export type BarisProgress = {
  lokasi: string;
  realisasiPct: number;
  rencanaPct: number;
  deviasiPct: number;
  /**
   * Tambahan realisasi PADA HARI ITU saja, poin persen (DECISIONS 458).
   * null = tanggalnya tidak terbaca, jadi tambahannya tidak punya arti.
   */
  tambahanPct?: number | null;
  /** null = belum ada laporan hari ini. 0 = ada laporan, isinya masih kosong. */
  itemHariIni: number | null;
  /** Label status laporan hari ini (null = belum ada laporannya). */
  statusHariIni?: string | null;
};

/**
 * Baris "sekian bertambah di rentang yang ditanyakan".
 *
 * Keluhan user 2026-08-28: *"progress kemarin dan total progress mingguan tidak
 * bisa dibedakan."* Betul — keduanya menampilkan `realizedPct`, yang SELALU
 * kumulatif, jadi selama tidak ada laporan baru di antaranya angkanya sama
 * persis. Tidak ada satu kata pun di balasan lama yang menyatakan itu angka
 * kumulatif.
 *
 * Karena itu tiap balasan progres kini membuka dengan TAMBAHAN pada rentang
 * yang ditanya, dan angka kumulatifnya diberi label "kumulatif" apa adanya.
 * Dua balasan yang isinya berbeda jadi terlihat berbeda.
 */
function barisTambahan(tambahanPct: number | null | undefined, sebutan: string): string | null {
  if (tambahanPct == null) return null;
  return `  ${bertanda(tambahanPct)} ${sebutan}`;
}

/**
 * Judul yang MENGAKU diurutkan.
 *
 * Daftar yang diurutkan lalu dipotong tanpa menyebut urutannya terbaca sebagai
 * "inilah lokasinya" – padahal ia "inilah 15 teratas". Bedanya menentukan
 * tindakan orang yang membacanya.
 */
export function judulProgress(
  urutan: "terbaik" | "terburuk" | null,
  batas: number | null = null,
): string {
  if (!urutan) return "Progress";
  // "5 terbaik" disebut apa adanya: daftar yang dipotong tanpa menyebut
  // cacahannya terbaca sebagai "inilah seluruhnya".
  const arah = urutan === "terbaik" ? "terbaik" : "terburuk";
  return batas ? `Progress – ${batas} ${arah}` : `Progress – ${arah} dulu`;
}

export function balasProgress(
  r: {
    tanggal: string;
    baris: BarisProgress[];
    urutan?: "terbaik" | "terburuk" | null;
    batas?: number | null;
  },
  opts: OpsiKaki = {},
): string {
  const judul = judulProgress(r.urutan ?? null, r.batas ?? null);
  if (r.baris.length === 0) {
    return kepala(judul, r.tanggal) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }
  const isi = r.baris.map((b) => {
    /*
     * TIDAK menulis "hari ini".
     *
     * Cacat produksi 2026-08-20, terlihat di tangkapan layar user: pertanyaan
     * "kalau kemarin lusa?" dijawab dengan baris "2 item dilaporkan HARI INI".
     * Itemnya memang dua, tapi dilaporkan kemarin lusa – kalimatnya menempelkan
     * hari yang salah pada angka yang benar, yaitu jenis kesalahan yang paling
     * sulit dibantah karena angkanya sendiri tidak keliru.
     *
     * Harinya sudah disebut sekali di kepala balasan; mengulanginya per baris
     * hanya menambah kesempatan untuk salah.
     */
    const laporan =
      b.itemHariIni === null
        ? "belum ada laporan"
        : `${b.itemHariIni} item dilaporkan` + (b.statusHariIni ? ` (${b.statusHariIni})` : "");
    return [
      `*${b.lokasi}*`,
      // "hari itu", bukan "hari ini" — alasan yang sama dengan catatan di atas:
      // pertanyaan bisa menyebut tanggal lampau, dan harinya sudah disebut
      // sekali di kepala balasan.
      barisTambahan(b.tambahanPct, "hari itu"),
      `  kumulatif ${pct(b.realisasiPct)} · rencana ${pct(b.rencanaPct)} · deviasi ${bertanda(b.deviasiPct)}`,
      `  ${laporan}`,
    ]
      .filter((x): x is string => x !== null)
      .join("\n");
  });
  return kepala(judul, r.tanggal) + "\n\n" + isi.join("\n\n") + kaki(opts);
}

export type BarisDeviasi = { lokasi: string; deviasiPct: number; realisasiPct: number; rencanaPct: number };

export function balasDeviasi(
  r: { tanggal: string; negatif: BarisDeviasi[]; diperiksa: number },
  opts: OpsiKaki = {},
): string {
  if (r.negatif.length === 0) {
    return (
      kepala("Deviasi terhadap kurva-S", r.tanggal) +
      `\n\nTidak ada lokasi berdeviasi negatif dari ${r.diperiksa} yang saya periksa.` +
      kaki(opts)
    );
  }
  const isi = r.negatif.map(
    (b) =>
      `*${b.lokasi}* – ${bertanda(b.deviasiPct)}\n  realisasi ${pct(b.realisasiPct)} vs rencana ${pct(b.rencanaPct)}`,
  );
  return (
    kepala(
      `Deviasi negatif – ${r.negatif.length} dari ${r.diperiksa} lokasi`,
      r.tanggal,
    ) +
    "\n\n" +
    isi.join("\n\n") +
    kaki(opts)
  );
}

export type BarisKelengkapan = { lokasi: string; status: string; perluTindakan: boolean };

/**
 * Kelengkapan laporan harian.
 *
 * Yang dirinci HANYA lokasi yang perlu ditindak — itu isi jawaban yang
 * sebenarnya dicari; menyebut satu per satu lokasi yang sudah beres hanya
 * memanjangkan pesan sampai tidak terbaca. Tetapi PENYEBUTNYA wajib utuh:
 * `total` adalah seluruh lokasi yang diperiksa, bukan yang dirinci. "3 lokasi
 * belum lapor" tanpa penyebut bisa berarti 3 dari 4 atau 3 dari 83.
 */
export function balasKelengkapan(
  r: { tanggal: string; perlu: BarisKelengkapan[]; total: number },
  opts: OpsiKaki = {},
): string {
  if (r.total === 0) {
    return kepala("Kelengkapan laporan", r.tanggal) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }
  const beres = r.total - r.perlu.length;
  const isi =
    r.perlu.length === 0
      ? ["Semua lokasi sudah melapor hari ini."]
      : r.perlu.map((b) => `• *${b.lokasi}* – ${b.status}`);
  return (
    kepala(`Kelengkapan laporan – ${beres} dari ${r.total} beres`, r.tanggal) +
    "\n\n" +
    isi.join("\n") +
    kaki(opts)
  );
}

/* ------------------------------------------------------------------ */
/* Isi laporan harian                                                  */
/* ------------------------------------------------------------------ */

export type BarisLaporanWa = {
  lokasi: string;
  status: string | null;
  itemCount: number;
  contohItem: string[];
  pekerjaCount: number;
  fotoCount: number;
  cuaca: string | null;
  jamKerja: string | null;
};

/**
 * ISI laporan harian satu tanggal (DECISIONS 356).
 *
 * Lokasi tanpa laporan TETAP disebut, dengan kalimatnya sendiri. Menghilangkan
 * barisnya membuat "belum ada laporan" tak bisa dibedakan dari "lokasi itu
 * memang tidak saya periksa".
 */
export function balasLaporan(
  r: { tanggal: string; baris: BarisLaporanWa[] },
  opts: OpsiKaki = {},
): string {
  if (r.baris.length === 0) {
    return kepala("Laporan harian", r.tanggal) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }
  const isi = r.baris.map((b) => {
    if (!b.status) return `*${b.lokasi}*\n  belum ada laporan`;
    const rinci = [
      `${b.itemCount} item`,
      b.pekerjaCount > 0 ? `${b.pekerjaCount} baris tenaga kerja` : null,
      b.fotoCount > 0 ? `${b.fotoCount} foto` : null,
      b.cuaca,
      b.jamKerja,
    ].filter(Boolean);
    const baris = [`*${b.lokasi}* (${b.status})`, `  ${rinci.join(" · ")}`];
    if (b.contohItem.length > 0) {
      // Nama pekerjaan yang benar-benar dilaporkan — bukti bahwa isinya nyata,
      // bukan sekadar angka yang bisa saja nol item.
      baris.push(`  ${b.contohItem.map((n) => `– ${n}`).join("\n  ")}`);
    }
    return baris.join("\n");
  });
  return kepala("Laporan harian", r.tanggal) + "\n\n" + isi.join("\n\n") + kaki(opts);
}

/**
 * "Kamu bisa apa saja?" — MARLIN menjelaskan dirinya sendiri (DECISIONS 356).
 *
 * Kelenturan yang tidak diketahui sama dengan tidak ada. Orang lapangan tidak
 * membaca dokumentasi; satu-satunya tempat mereka bisa menemukan batas
 * kemampuan MARLIN adalah percakapan yang sedang berlangsung.
 */
export function balasBantuan(): string {
  return [
    "*Yang bisa saya jawab lewat chat*",
    "",
    "• *Progress* – “progress hari ini”, “progress kemarin di Kedung Mutih”",
    "• *Laporan harian* – isi laporan SATU tanggal: “laporan hari ini”, “laporan tanggal 12”",
    "• *Laporan mingguan* – rekap SEPEKAN: “laporan mingguan”, “laporan mingguan minggu lalu”",
    "• *Rencana kerja* – apa yang AKAN dikerjakan: “rencana minggu depan”,",
    "  “rencana kerja di Kemantren”, “apa yang perlu dikerjakan”",
    "• *Kendala* – “ada kendala apa”, “kendala di Tengket”",
    "• *Deviasi* – “mana yang deviasinya negatif”, “siapa yang tertinggal”",
    "• *Kelengkapan* – “siapa yang belum lapor hari ini”",
    "",
    "*Periode yang saya mengerti*",
    "hari ini · kemarin · kemarin lusa · N hari lalu · tanggal tertentu",
    "(“17 agustus”, “tanggal 3”) · minggu ini/lalu · bulan ini/lalu",
    "Khusus rencana kerja, saya juga mengerti “minggu depan” / “ke depan”.",
    "",
    "",
    "*Di luar daftar itu, tanya bebas saja*",
    "Temuan pemeriksa · kesiapan termin/PHO/FHO · peringatan dini · verifikasi",
    "Wakil PPK · inspeksi lapangan · surat yang menunggu jawaban · kontrak · RAB",
    "· kelengkapan dokumen – semuanya saya jawab dari data MARLIN, dengan sumber",
    "yang bisa ditelusuri.",
    "",
    "Di GRUP, hal-hal berkapabilitas itu tidak saya sebutkan – satu grup berisi",
    "orang dengan hak berbeda-beda. Tanyakan lewat chat pribadi ke saya.",
    "",
    "Sebut nama lokasi kalau mau dipersempit. Kalau tidak disebut, saya jawab",
    "untuk seluruh lokasi yang boleh Anda lihat.",
  ].join("\n");
}

/**
 * TAFSIR YANG DIPAKAI, DITULIS DI DEPAN JAWABAN (audit 2026-08-28).
 *
 * Hanya untuk pertanyaan yang niatnya dibaca AI, bukan parser deterministik.
 *
 * Sebabnya mode gagal AI berbeda dari mode gagal parser. Parser yang tidak
 * yakin menawarkan pilihan; AI selalu memilih. Kalau pilihannya meleset,
 * MARLIN mengeksekusinya dengan sempurna, mengarangkannya dengan rapi, dan
 * menyertakan sumber yang benar — untuk pertanyaan yang tidak ditanyakan.
 * Salahnya jadi SUNYI, dan makin rapi jawabannya makin lama ketahuannya.
 *
 * Satu baris di depan memindahkan pemeriksaan itu ke orang yang paling tahu
 * maksudnya sendiri, dalam satu detik, sebelum ia membaca angkanya.
 *
 * `null` untuk niat yang tafsirnya tidak menambah apa pun: `bantuan` sudah
 * menjelaskan dirinya, dan `produksi` seluruh balasannya memang tentang apa
 * yang dibaca MARLIN.
 */
export function barisTafsir(niat: Niat): string | null {
  if (niat === "bantuan" || niat === "produksi") return null;
  return `_Saya baca sebagai: ${NIAT_LABEL[niat]}._`;
}

/**
 * Balasan saat berkas hariannya MEMANG dikirim.
 *
 * Menyebut lokasi dan tanggalnya, karena berkas WhatsApp diteruskan tanpa
 * konteks percakapannya — penerima kedua tidak pernah melihat pertanyaannya.
 *
 * Dan menyebut BENTUK dokumennya dengan nama yang benar. Sampai 2026-08-31
 * balasan ini menamai "Ringkasan pelaksanaan harian" sebagai *blanko harian*
 * lalu menjelaskannya sebagai *blanko lapangan* — dua dokumen yang berbeda,
 * satu nama. Orang yang meminta blanko KKP karena itu menerima dokumen lain di
 * bawah keterangan yang menamainya dokumen yang ia minta.
 *
 * Tiap balasan juga menunjukkan bentuk yang SATUNYA. Penanya tidak bisa
 * mengoreksi pilihan yang tidak pernah ia tahu ada.
 */
export function balasProduksiBerkas(
  lokasi: string,
  dateKey: string,
  bentuk: BentukDokumen,
): string {
  if (bentuk === "kkp") {
    return [
      `*Blanko harian KKP ${lokasi}* – ${dateKey}`,
      "",
      "Berkasnya menyusul di pesan berikut: sampul, pekerjaan, tenaga, material,",
      "alat, cuaca, lampiran foto, dan kendala yang tercatat hari itu.",
      "",
      "Ini blanko setoran lapangan, BUKAN laporan eksekutif yang ditandatangani.",
      "Yang ditandatangani disusun di MARLIN → *AI* → *Report Studio* lewat",
      "review → disetujui → dibekukan, supaya angkanya tidak berubah setelah",
      "dikirim.",
      "",
      "Kalau yang kamu butuhkan versi ringkasan untuk dibaca di grup, sebut",
      "“ringkasan harian”.",
    ].join("\n");
  }
  return [
    `*Ringkasan pelaksanaan harian ${lokasi}* – ${dateKey}`,
    "",
    "Berkasnya menyusul di pesan berikut: posisi kumulatif, deviasi, pekerjaan,",
    "tenaga, material, alat, cuaca, foto, dan kendala yang tercatat hari itu.",
    "",
    "Ini dokumen BACAAN untuk grup – bukan blanko setoran KKP, dan bukan laporan",
    "eksekutif yang ditandatangani. Blanko KKP-nya tinggal diminta dengan",
    "menyebut “versi kkp”; yang ditandatangani disusun di MARLIN → *AI* →",
    "*Report Studio* lewat review → disetujui → dibekukan.",
  ].join("\n");
}

/**
 * Balasan untuk PERINTAH membuat/mengirim artefak (audit 2026-08-28).
 *
 * MARLIN memang belum bisa memproduksi laporan dari WhatsApp, dan itu bukan
 * kekurangan yang perlu disembunyikan: artefak resmi wajib lewat
 * review→setujui→beku di Report Studio, dan melompati pagar itu lewat pintu
 * WhatsApp akan membatalkan keputusan yang dibuat sengaja (DECISIONS 193).
 *
 * Yang penting balasannya tidak berhenti pada "tidak bisa". Tiga hal harus ada:
 * pengakuan, jalan yang benar, dan hal terdekat yang BISA dilakukan sekarang —
 * karena orang yang meminta laporan biasanya sedang butuh angkanya, bukan
 * berkasnya.
 */
export function balasProduksi(): string {
  return [
    "*Membuat & mengirim laporan belum bisa lewat chat*",
    "",
    "Laporan resmi harus melewati review → disetujui → dibekukan dulu supaya",
    "angkanya tidak berubah setelah dikirim. Pagar itu ada di aplikasi, bukan di",
    "chat – jadi saya tidak bisa membuatnya dari sini.",
    "",
    "*Jalannya*",
    "Buka MARLIN → menu *AI* → *Report Studio*. Di sana laporan disusun, diperiksa,",
    "disetujui, lalu dikirim sebagai PDF/Excel/WhatsApp dengan angka yang sama persis.",
    "",
    "*Yang bisa saya berikan sekarang juga*",
    "Angkanya, langsung di chat ini:",
    "• “progress minggu ini”",
    "• “laporan mingguan”",
    "• “deviasi” – siapa yang tertinggal",
    "• “kendala” – yang masih terbuka",
    "",
    "Sebut nama lokasi kalau mau dipersempit.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Kronologi lokasi                                                    */
/* ------------------------------------------------------------------ */

const LABEL_PERISTIWA: Record<JenisPeristiwa, string> = {
  kendala_dibuka: "Kendala muncul",
  kendala_ditutup: "Kendala selesai",
  kegiatan: "Kegiatan",
};

/**
 * KRONOLOGI satu lokasi, bentuk CADANGAN — dipakai saat AI mati, kuotanya
 * habis, atau keluarannya tidak tergrounding.
 *
 * Bentuk utamanya `balasKronologiRapi` di atas. Yang ini memang daftar apa
 * adanya, dan itu keputusan: jawaban yang kurang enak dibaca jauh lebih
 * berguna daripada tidak ada jawaban, dan orang yang bertanya lewat WhatsApp
 * biasanya sedang tidak di depan komputer. Bahwa perapiannya tidak jalan
 * DIKATAKAN lewat `opts.catatanBatas`, tidak didiamkan.
 *
 * Susunannya: kondisi terkini DULU, urutan kejadian menyusul. Terbalik dari
 * bentuk kronologi yang lazim, dan sengaja: yang membaca di HP sering berhenti
 * di layar pertama.
 *
 * Tidak ada satu angka pun yang dihitung di sini; semuanya datang dari
 * `susunKronologi`.
 */
export type KronologiWa = {
  lokasi: string;
  wilayah: string | null;
  sampai: string;
  hari: number;
  peristiwa: Peristiwa[];
  kondisi: KondisiTerkini;
  dipotong: number;
};

/**
 * Kronologi diminta tanpa menyebut SATU lokasi.
 *
 * Menyebutkan pilihannya, bukan menolak. Orang yang mengetik "kronologi" tanpa
 * nama biasanya sedang di grup yang memang cuma punya beberapa lokasi — dan
 * menampilkan namanya membuat pertanyaan susulannya cukup satu kata.
 */
/**
 * Kronologi yang SUDAH DIRAPIKAN AI — bentuk yang diminta user 2026-08-31:
 * *"jangan apa adanya semua dikirim, tapi kamu minta AI rapikan"*.
 *
 * Yang dikirim: kesimpulan 2–3 kalimat, lalu babak ceritanya, lalu dua baris
 * angka kondisi terkini. Daftar peristiwa mentahnya TIDAK ikut — itulah
 * bedanya dengan bentuk cadangan di bawah. Yang ingin melihat satu per satu
 * diberi tahu di mana melihatnya.
 *
 * Angka di bagian kondisi tetap datang dari `susunKronologi`, bukan dari
 * kalimat model: yang dirapikan bahasanya, bukan hitungannya.
 */
export function balasKronologiRapi(
  k: KronologiWa,
  rapi: { kesimpulan: string; babak: { judul: string; periode: string; reason: string }[] },
  opts: OpsiKaki = {},
): string {
  const c = k.kondisi;
  const b: string[] = [`*Kronologi ${k.lokasi}* – s.d. ${k.sampai}`];
  if (k.wilayah) b.push(`_${k.wilayah}_`);
  b.push("", rapi.kesimpulan);

  if (rapi.babak.length > 0) {
    b.push("", "*Yang terjadi*");
    for (const x of rapi.babak) {
      b.push(`• *${x.judul}* – ${x.periode}`);
      b.push(`   ${x.reason}`);
    }
  }

  b.push("", "*Angka kondisi terkini*");
  b.push(
    c.kendalaTerbuka === 0
      ? "• Tidak ada kendala yang masih terbuka."
      : `• ${c.kendalaTerbuka} kendala terbuka` +
        (c.kendalaKritis > 0 ? `, ${c.kendalaKritis} kritis` : "") +
        (c.kendalaLewatTenggat > 0 ? `, ${c.kendalaLewatTenggat} lewat tenggat` : "") +
        (c.kendalaTertuaHari !== null ? `; tertua ${c.kendalaTertuaHari} hari` : ""),
  );
  b.push(
    c.kegiatanTerakhir === null
      ? "• Belum ada kegiatan lapangan tercatat."
      : `• Kegiatan lapangan terakhir ${c.kegiatanTerakhir}` +
        (c.hariTanpaKegiatan !== null ? ` – ${c.hariTanpaKegiatan} hari lalu` : ""),
  );

  b.push(
    "",
    `_Daftar kejadian satu per satu ada di MARLIN → AI → Kronologi (${k.peristiwa.length + k.dipotong} kejadian)._`,
  );
  return `${b.join("\n")}${kaki(opts)}`;
}

export function balasKronologiTanpaLokasi(nama: string[], total: number): string {
  const b = [
    "*Kronologi perlu satu lokasi*",
    "",
    "Kronologi menceritakan URUTAN kejadian di satu tempat – kendala dan",
    "kegiatan lapangannya – lalu menutupnya dengan kondisi terkini. Digabung",
    "lintas lokasi ia berhenti jadi cerita.",
  ];
  if (nama.length > 0) {
    b.push("", "*Sebut salah satu*", ...nama.map((n) => `• ${n}`));
    if (total > nama.length) b.push(`_…dan ${total - nama.length} lokasi lain._`);
    b.push("", `Contoh: “kronologi ${nama[0]}”`);
  }
  return b.join("\n");
}

export function balasKronologi(k: KronologiWa, opts: OpsiKaki = {}): string {
  const b: string[] = [`*Kronologi ${k.lokasi}* – s.d. ${k.sampai}`];
  if (k.wilayah) b.push(`_${k.wilayah}_`);
  b.push("");

  b.push("*Kondisi terkini*");
  const c = k.kondisi;
  if (c.kendalaTerbuka === 0) {
    b.push("• Tidak ada kendala yang masih terbuka.");
  } else {
    const rinci = [
      c.kendalaKritis > 0 ? `${c.kendalaKritis} kritis` : null,
      c.kendalaLewatTenggat > 0 ? `${c.kendalaLewatTenggat} lewat tenggat` : null,
    ].filter(Boolean);
    b.push(
      `• ${c.kendalaTerbuka} kendala masih terbuka${rinci.length ? ` (${rinci.join(", ")})` : ""}` +
        (c.kendalaTertuaHari !== null ? `; yang tertua sudah ${c.kendalaTertuaHari} hari` : ""),
    );
  }
  b.push(
    c.kegiatanTerakhir === null
      ? "• Belum ada kegiatan lapangan yang tercatat."
      : `• Kegiatan lapangan terakhir ${c.kegiatanTerakhir}` +
        (c.hariTanpaKegiatan !== null ? ` – ${c.hariTanpaKegiatan} hari lalu` : ""),
  );
  b.push(
    `• Dalam ${k.hari} hari terakhir: ${c.kegiatanDalamJendela} kegiatan` +
      (c.drafKegiatan > 0 ? ` (${c.drafKegiatan} masih draf)` : "") +
      `, ${c.kendalaSelesaiDalamJendela} kendala selesai.`,
  );

  b.push("", "*Urutan kejadian* – terbaru dulu");
  if (k.peristiwa.length === 0) {
    b.push("Belum ada kendala maupun kegiatan lapangan yang tercatat di rentang ini.");
  } else {
    for (const p of k.peristiwa) {
      const tanda = p.jenis === "kendala_dibuka" && p.lewatTenggat ? " ❗" : "";
      b.push(`• ${p.tanggal} · ${LABEL_PERISTIWA[p.jenis]}: ${p.judul}${tanda}`);
      for (const r of p.rincian) b.push(`   ${r}`);
    }
  }

  if (k.dipotong > 0) {
    b.push(
      "",
      `_${k.dipotong} kejadian lebih lama tidak ditampilkan. Selengkapnya di MARLIN → AI → Kronologi._`,
    );
  }
  return `${b.join("\n")}${kaki(opts)}`;
}

/* ------------------------------------------------------------------ */
/* Laporan mingguan                                                    */
/* ------------------------------------------------------------------ */

export type BarisMingguanWa = {
  lokasi: string;
  rencanaPct: number | null;
  realisasiPct: number;
  deviasiPct: number | null;
  /** Tambahan realisasi SEPANJANG pekan itu, poin persen (DECISIONS 458). */
  tambahanPct?: number | null;
  hariBerlaporan: number;
  totalHari: number;
};

/**
 * Rekap per lokasi untuk SATU RENTANG (DECISIONS 358; bulanan DECISIONS 462).
 *
 * Judulnya bukan kosmetik: keluhan user 2026-08-18 adalah *"gak jelas apa yang
 * kuminta, sistem kasih apa"* — ia meminta laporan mingguan dan menerima kotak
 * berjudul "Laporan harian". Judul yang tidak sama dengan yang diminta membuat
 * penerimanya harus menebak apakah sistemnya salah paham atau memang begitu
 * isinya.
 *
 * Karena itu `judul` dan `sebutan` DIBERIKAN pemanggil, tidak dipatok di sini.
 * Rekap bulanan memakai perakit yang sama (rumusnya memang sama), dan versi
 * pertamanya membiarkan keduanya terpatok "mingguan" — sehingga chat berbunyi
 * "Laporan mingguan · sepanjang pekan" sementara PDF lampirannya berjudul
 * "Laporan bulanan". Persis kesalahan yang sama dengan keluhan 2026-08-18,
 * hanya sepasang kata lebih halus.
 */
export function balasMingguan(
  r: {
    periode: string;
    baris: BarisMingguanWa[];
    /** Bawaan "Laporan mingguan" — bulanan mengirim judulnya sendiri. */
    judul?: string;
    /** Sebutan rentang pada baris tambahan, mis. "sepanjang pekan". */
    sebutan?: string;
  },
  opts: OpsiKaki = {},
): string {
  const judul = r.judul ?? "Laporan mingguan";
  const sebutan = r.sebutan ?? "sepanjang pekan";
  if (r.baris.length === 0) {
    return kepala(judul, r.periode) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }
  const isi = r.baris.map((b) => {
    const angka =
      b.rencanaPct == null
        ? // Lokasi tanpa kurva-S TIDAK dicetak "rencana 0%" — rencana yang belum
          // ada bukan rencana nol, dan di sini ia akan terbaca sebagai prestasi.
          `  kumulatif ${pct(b.realisasiPct)} · rencana belum ada (kurva-S belum disusun)`
        : `  kumulatif ${pct(b.realisasiPct)} · rencana ${pct(b.rencanaPct)} · deviasi ${bertanda(b.deviasiPct ?? 0)}`;
    return [
      `*${b.lokasi}*`,
      // Sebutan yang MEMBEDAKAN balasan ini dari balasan progres harian:
      // "sepanjang pekan" vs "hari itu". Tanpa itu keduanya menampilkan angka
      // kumulatif yang sama dan pembacanya tidak bisa tahu bedanya.
      barisTambahan(b.tambahanPct, sebutan),
      angka,
      `  ${b.hariBerlaporan} dari ${b.totalHari} hari sudah dilaporkan`,
    ]
      .filter((x): x is string => x !== null)
      .join("\n");
  });
  return kepala(judul, r.periode) + "\n\n" + isi.join("\n\n") + kaki(opts);
}

/**
 * Tawaran pilihan untuk pertanyaan yang tafsirnya lebih dari satu
 * (DECISIONS 375/376).
 *
 * Menggantikan `balasTidakMengerti()` untuk kasus yang sebenarnya HAMPIR
 * jelas. Keberatan user 2026-08-19: menyodorkan menu kemampuan yang sama untuk
 * semua orang terlalu cepat menyerah dan membuang waktu penanya, padahal
 * tafsirnya cuma dua atau tiga.
 *
 * Labelnya memakai KATA YANG IA TULIS ("kemarin"), bukan istilah baku — itu
 * bedanya antara balik bertanya dan menyodorkan daftar fitur.
 */
export function balasPilihan(
  pertanyaan: string,
  kandidat: { label: string }[],
  umurMenit: number,
): string {
  const daftar = kandidat.map((k, i) => `${i + 1}. ${k.label}`).join("\n");
  return [
    // Pertanyaannya DIKUTIP: di grup yang ramai, tawaran ini bisa muncul
    // beberapa pesan setelah pertanyaannya, dan tanpa kutipan penanya harus
    // menebak tawaran ini milik pertanyaan yang mana.
    `"${pertanyaan}" bisa saya baca dengan ${kandidat.length === 2 ? "dua" : "beberapa"} cara.`,
    "Maksud Anda yang mana?",
    "",
    daftar,
    "",
    "Balas angkanya saja (mis. *1*). Kalau bukan salah satunya, tulis ulang lebih lengkap.",
    `_Pilihan ini berlaku ${umurMenit} menit, dan hanya untuk Anda._`,
  ].join("\n");
}

/**
 * Angka yang dibalas tidak lagi punya tawaran yang hidup.
 *
 * DIKATAKAN, bukan didiamkan: penanya baru saja mengetik "2" dan berhak tahu
 * kenapa tidak terjadi apa-apa. Diam di sini terbaca seperti sistem rusak.
 */
export function balasPilihanKedaluwarsa(pertanyaan: string, umurMenit: number): string {
  return [
    `Maaf, pilihan untuk "${pertanyaan}" sudah lewat ${umurMenit} menit jadi saya tutup.`,
    "Silakan tanyakan lagi – saya tawarkan pilihannya sekali lagi.",
  ].join("\n");
}

/** Angka di luar daftar yang ditawarkan. */
export function balasPilihanTakAda(jumlah: number): string {
  return `Pilihannya hanya 1–${jumlah}. Balas salah satu angka itu, atau tulis ulang pertanyaannya.`;
}

/* ------------------------------------------------------------------ */
/* Catatan lapangan (DECISIONS 383)                                    */
/* ------------------------------------------------------------------ */

export type BarisNarasi = {
  lokasi: string;
  jenis: string;
  tanggal: string | null;
  teks: string;
};

/** Sepanjang apa satu kutipan boleh tampil di WhatsApp sebelum dipotong. */
const BATAS_KUTIPAN = 240;

/**
 * Jawaban dari CATATAN LAPANGAN — kutipan apa adanya (DECISIONS 383).
 *
 * ### Kenapa verbatim, dan kenapa tanpa AI
 *
 * Yang dikirim adalah kalimat yang benar-benar ditulis pelapor, disalin bulat-
 * bulat dari basis data. Tidak ada model yang merangkum, jadi **tidak ada yang
 * bisa mengarang** — bukan karena dilarang di prompt, melainkan karena tidak
 * ada langkah yang bisa mengarang. Itu juga membuatnya tetap menjawab saat
 * penyedia AI mati (alasan yang sama dengan DECISIONS 375).
 *
 * ### Kenapa harus DITANDAI
 *
 * Balasan WhatsApp di-screenshot dan diteruskan ke PPK. Angka di dalam catatan
 * lapangan ("cor 12 m3") adalah KATA PELAPOR, bukan hasil hitungan MARLIN —
 * kalau tidak dikatakan, pembacanya akan memperlakukannya sebagai angka resmi.
 * Penandanya karena itu bukan hiasan dan tidak boleh dilepas.
 *
 * Pemotongan kutipan yang terlalu panjang juga DISEBUT: kutipan yang dipangkas
 * diam-diam bisa membalik artinya ("…tidak jadi berhenti" → "…tidak jadi").
 */
export function balasNarasi(
  r: { pertanyaan: string; baris: BarisNarasi[] },
  opts: OpsiKaki = {},
): string {
  if (r.baris.length === 0) {
    return (
      kepala("Catatan lapangan", r.pertanyaan) +
      "\n\nTidak ada catatan lapangan yang cocok dengan pertanyaan itu." +
      kaki(opts)
    );
  }
  const isi = r.baris.map((b) => {
    const dipotong = b.teks.length > BATAS_KUTIPAN;
    const teks = dipotong ? `${b.teks.slice(0, BATAS_KUTIPAN)}…` : b.teks;
    const jejak = [b.jenis, b.tanggal].filter(Boolean).join(" · ");
    return [`*${b.lokasi}* _(${jejak})_`, `  "${teks}"${dipotong ? " _(dipotong)_" : ""}`].join("\n");
  });
  return (
    kepala("Catatan lapangan", r.pertanyaan) +
    "\n\n" +
    isi.join("\n\n") +
    "\n\n📝 Ini KUTIPAN catatan pelapor, disalin apa adanya – termasuk angkanya. " +
    "Bukan angka resmi hasil hitungan MARLIN." +
    kaki(opts)
  );
}

/* ------------------------------------------------------------------ */
/* Rencana kerja — satu-satunya balasan yang menghadap KE DEPAN        */
/* ------------------------------------------------------------------ */

export type ItemRencanaBaris = {
  nama: string;
  satuan: string | null;
  target: number;
  sisa: number;
  pic: string | null;
};

export type BarisRencanaWaFmt = {
  lokasi: string;
  minggu: number | null;
  totalMinggu: number | null;
  periode: string | null;
  targetPct: number | null;
  realisasiPct: number | null;
  deviasiPct: number | null;
  item: ItemRencanaBaris[];
  itemTersembunyi: number;
  bobotTarget: number | null;
  /** Pekan yang diminta tidak bisa dijawab apa adanya – WAJIB tercetak. */
  catatan?: string | null;
  tidakTuntas: { nama: string; satuan: string | null; target: number; realisasi: number }[];
};

const vol = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const poin = (n: number) => `${n.toFixed(2).replace(".", ",")} pp`;

/**
 * Balasan RENCANA KERJA (DECISIONS 458).
 *
 * ### Yang paling penting di sini adalah kejujuran saat rencananya BELUM ADA
 *
 * Sebelum niat ini ada, *"rencana seminggu ke depan untuk kemantren?"* jatuh ke
 * jalur kutipan catatan lapangan dan dibalas notulen rapat 10 Agustus di bawah
 * judul "Catatan lapangan". Kutipannya benar apa adanya, tetapi ditempatkan
 * sebagai jawaban atas pertanyaan tentang pekan depan — dan pembacanya tidak
 * punya cara tahu bahwa MARLIN sebenarnya tidak menjawab pertanyaannya.
 *
 * Karena itu lokasi yang rencananya belum disusun ditulis APA ADANYA: "belum
 * disusun". Kosong yang diakui jauh lebih berguna daripada isi yang mirip.
 */
export function balasRencana(
  r: { pekanDepan: boolean; baris: BarisRencanaWaFmt[] },
  opts: OpsiKaki = {},
): string {
  const judul = "Rencana kerja";
  const label = r.pekanDepan ? "pekan depan" : "pekan berjalan";
  if (r.baris.length === 0) {
    return kepala(judul, label) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }

  const isi = r.baris.map((b) => {
    const kepalaLokasi =
      b.minggu != null && b.totalMinggu != null
        ? `*${b.lokasi}* (minggu ${b.minggu}/${b.totalMinggu})`
        : `*${b.lokasi}*`;
    const garis: string[] = [kepalaLokasi];

    if (b.minggu == null) {
      // Bukan "belum ada rencana": yang belum ada adalah DASARNYA. Menyebutnya
      // salah akan mengirim orang menyusun rencana yang memang belum bisa
      // disusun.
      garis.push("  Belum ada kontrak/kurva-S aktif – pekannya belum bernomor.");
      return garis.join("\n");
    }

    /*
     * Catatan pekan yang meleset ditulis DULUAN, sebelum angkanya. Kalau ia
     * ditaruh di bawah, pembaca sudah terlanjur membaca angka pekan berjalan
     * sebagai angka pekan depan.
     */
    if (b.catatan) garis.push(`  ⚠️ ${b.catatan}`);
    if (b.periode) garis.push(`  periode ${b.periode}`);
    if (b.targetPct != null && b.realisasiPct != null && b.deviasiPct != null) {
      garis.push(
        `  target kurva-S ${pct(b.targetPct)} · kumulatif ${pct(b.realisasiPct)} · deviasi ${bertanda(b.deviasiPct)}`,
      );
    }

    if (b.item.length === 0) {
      garis.push("  Rencana pekan ini BELUM disusun di MARLIN.");
    } else {
      const bobot = b.bobotTarget != null ? ` · bobot ${poin(b.bobotTarget)}` : "";
      garis.push(`  komitmen: ${b.item.length + b.itemTersembunyi} item${bobot}`);
      for (const it of b.item) {
        const satuan = it.satuan ? ` ${it.satuan}` : "";
        const pic = it.pic ? ` · ${it.pic}` : "";
        garis.push(
          `  • ${it.nama} – ${vol.format(it.target)}${satuan} (sisa ${vol.format(it.sisa)}${satuan})${pic}`,
        );
      }
      if (b.itemTersembunyi > 0) {
        garis.push(`  … ${b.itemTersembunyi} item lain tidak dirinci di sini.`);
      }
    }

    if (b.tidakTuntas.length > 0) {
      // Komitmen pekan lalu yang meleset adalah bahan PERTAMA untuk mengejar,
      // jadi ia ikut disebut — bukan disembunyikan karena kurang enak dibaca.
      garis.push("  Belum tuntas pekan lalu:");
      for (const t of b.tidakTuntas.slice(0, 5)) {
        const satuan = t.satuan ? ` ${t.satuan}` : "";
        garis.push(
          `  • ${t.nama} – target ${vol.format(t.target)}${satuan}, terealisasi ${vol.format(t.realisasi)}${satuan}`,
        );
      }
      if (b.tidakTuntas.length > 5) {
        garis.push(`  … ${b.tidakTuntas.length - 5} lagi.`);
      }
    }
    return garis.join("\n");
  });

  return kepala(judul, label) + "\n\n" + isi.join("\n\n") + kaki(opts);
}
