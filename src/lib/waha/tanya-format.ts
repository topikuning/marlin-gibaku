import { LABEL_TINGKAT, NIAT_LABEL, type HasilResolusi, type Niat } from "./tanya-niat";

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

const pct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
const bertanda = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2).replace(".", ",")}%`;

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
      `ℹ️ "${w.diketik}" saya baca sebagai ${LABEL_TINGKAT[w.tingkat]} ${w.nama} — ${w.jumlah} lokasi.`,
    );
  }
  if (opts.resolusi && opts.resolusi.tidakDikenal.length > 0) {
    b.push(
      `⚠️ Tidak saya kenali: ${opts.resolusi.tidakDikenal.join(", ")} — mungkin salah ketik, atau di luar penugasan Anda.`,
    );
  }
  if (opts.catatanPeriode) b.push(`ℹ️ ${opts.catatanPeriode}`);
  if (opts.catatanBatas) b.push(`ℹ️ ${opts.catatanBatas}`);
  if (opts.catatanPemotongan) b.push(`ℹ️ ${opts.catatanPemotongan}`);
  return b.length > 0 ? `\n\n${b.join("\n")}` : "";
}

/* ------------------------------------------------------------------ */
/* Balasan yang BUKAN data                                             */
/* ------------------------------------------------------------------ */

/** Niat tidak dikenali — mengaku, lalu menyebut yang bisa dijawab. */
export function balasTidakMengerti(): string {
  const daftar = (Object.keys(NIAT_LABEL) as Niat[]).map((n) => `• ${NIAT_LABEL[n]}`).join("\n");
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
  r: { tanggal: string; baris: BarisKendala[]; lokasiDiperiksa: number },
  opts: OpsiKaki = {},
): string {
  if (r.baris.length === 0) {
    return (
      kepala("Kendala belum selesai", r.tanggal) +
      `\n\nTidak ada kendala belum selesai di ${r.lokasiDiperiksa} lokasi yang saya periksa.` +
      kaki(opts)
    );
  }
  // Dikelompokkan per lokasi supaya terbaca sebagai daftar kerja, bukan aliran.
  const perLokasi = new Map<string, BarisKendala[]>();
  for (const b of r.baris) {
    const k = perLokasi.get(b.lokasi) ?? [];
    k.push(b);
    perLokasi.set(b.lokasi, k);
  }
  const isi = [...perLokasi.entries()].map(([lokasi, baris]) => {
    const item = baris.map(
      (b) => `  • ${b.judul} _(${b.tingkat}, ${b.status}, ${b.umurHari} hari)_`,
    );
    return [`*${lokasi}*`, ...item].join("\n");
  });
  return (
    kepala(`Kendala belum selesai — ${r.baris.length} di ${perLokasi.size} lokasi`, r.tanggal) +
    "\n\n" +
    isi.join("\n\n") +
    kaki(opts)
  );
}

export type BarisProgress = {
  lokasi: string;
  realisasiPct: number;
  rencanaPct: number;
  deviasiPct: number;
  /** null = belum ada laporan hari ini. 0 = ada laporan, isinya masih kosong. */
  itemHariIni: number | null;
  /** Label status laporan hari ini (null = belum ada laporannya). */
  statusHariIni?: string | null;
};

export function balasProgress(
  r: { tanggal: string; baris: BarisProgress[] },
  opts: OpsiKaki = {},
): string {
  if (r.baris.length === 0) {
    return kepala("Progress", r.tanggal) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }
  const isi = r.baris.map((b) => {
    const hariIni =
      b.itemHariIni === null
        ? "belum ada laporan hari ini"
        : `${b.itemHariIni} item dilaporkan hari ini` +
          (b.statusHariIni ? ` (${b.statusHariIni})` : "");
    return [
      `*${b.lokasi}*`,
      `  realisasi ${pct(b.realisasiPct)} · rencana ${pct(b.rencanaPct)} · deviasi ${bertanda(b.deviasiPct)}`,
      `  ${hariIni}`,
    ].join("\n");
  });
  return kepala("Progress", r.tanggal) + "\n\n" + isi.join("\n\n") + kaki(opts);
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
      `*${b.lokasi}* — ${bertanda(b.deviasiPct)}\n  realisasi ${pct(b.realisasiPct)} vs rencana ${pct(b.rencanaPct)}`,
  );
  return (
    kepala(
      `Deviasi negatif — ${r.negatif.length} dari ${r.diperiksa} lokasi`,
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
      : r.perlu.map((b) => `• *${b.lokasi}* — ${b.status}`);
  return (
    kepala(`Kelengkapan laporan — ${beres} dari ${r.total} beres`, r.tanggal) +
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
    "• *Progress* — “progress hari ini”, “progress kemarin di Kedung Mutih”",
    "• *Laporan harian* — isi laporan SATU tanggal: “laporan hari ini”, “laporan tanggal 12”",
    "• *Laporan mingguan* — rekap SEPEKAN: “laporan mingguan”, “laporan mingguan minggu lalu”",
    "• *Kendala* — “ada kendala apa”, “kendala di Tengket”",
    "• *Deviasi* — “mana yang deviasinya negatif”, “siapa yang tertinggal”",
    "• *Kelengkapan* — “siapa yang belum lapor hari ini”",
    "",
    "*Periode yang saya mengerti*",
    "hari ini · kemarin · kemarin lusa · N hari lalu · tanggal tertentu",
    "(“17 agustus”, “tanggal 3”) · minggu ini/lalu · bulan ini/lalu",
    "",
    "Sebut nama lokasi kalau mau dipersempit. Kalau tidak disebut, saya jawab",
    "untuk seluruh lokasi yang boleh Anda lihat.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Laporan mingguan                                                    */
/* ------------------------------------------------------------------ */

export type BarisMingguanWa = {
  lokasi: string;
  rencanaPct: number | null;
  realisasiPct: number;
  deviasiPct: number | null;
  hariBerlaporan: number;
  totalHari: number;
};

/**
 * Rekap MINGGUAN per lokasi (DECISIONS 358).
 *
 * Judulnya "Laporan mingguan", dan itu bukan kosmetik: keluhan user 2026-08-18
 * adalah *"gak jelas apa yang kuminta, sistem kasih apa"* — ia meminta laporan
 * mingguan dan menerima kotak berjudul "Laporan harian". Judul yang tidak sama
 * dengan yang diminta membuat penerimanya harus menebak apakah sistemnya salah
 * paham atau memang begitu isinya.
 */
export function balasMingguan(
  r: { periode: string; baris: BarisMingguanWa[] },
  opts: OpsiKaki = {},
): string {
  if (r.baris.length === 0) {
    return kepala("Laporan mingguan", r.periode) + "\n\nTidak ada lokasi yang cocok." + kaki(opts);
  }
  const isi = r.baris.map((b) => {
    const angka =
      b.rencanaPct == null
        ? // Lokasi tanpa kurva-S TIDAK dicetak "rencana 0%" — rencana yang belum
          // ada bukan rencana nol, dan di sini ia akan terbaca sebagai prestasi.
          `  realisasi ${pct(b.realisasiPct)} · rencana belum ada (kurva-S belum disusun)`
        : `  realisasi ${pct(b.realisasiPct)} · rencana ${pct(b.rencanaPct)} · deviasi ${bertanda(b.deviasiPct ?? 0)}`;
    return [
      `*${b.lokasi}*`,
      angka,
      `  ${b.hariBerlaporan} dari ${b.totalHari} hari sudah dilaporkan`,
    ].join("\n");
  });
  return kepala("Laporan mingguan", r.periode) + "\n\n" + isi.join("\n\n") + kaki(opts);
}
