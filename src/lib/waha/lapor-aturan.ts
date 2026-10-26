import { formatNumber, jakartaDateKey } from "@/lib/format";

/**
 * LAPOR LEWAT WHATSAPP PRIBADI – aturan MURNI (DECISIONS 706).
 *
 * Permintaan user 2026-10-26: *"aku ingin pic yg berhak, kirim wa ke marlin.
 * misal ketik lokasi A, kemudian sampai beberapa waktu foto dikirim by wa
 * disimpan untuk lokasi itu, bahkan kalau menyebut nama pekerjaan sistem
 * mencari pekerjaan yang matching untuk dilaporkan sebagai laporan harian"*.
 *
 * Tanpa DB dan tanpa jaringan, supaya cara MARLIN MEMBACA pesan bisa diuji
 * langsung. Yang paling mudah salah di sini bukan penyimpanannya, melainkan
 * membedakan perintah lapor dari pertanyaan untuk Tanya MARLIN: keduanya
 * datang lewat chat yang sama.
 */

/** Sesi berakhir sendiri setelah sekian lama tanpa kiriman (pilihan user). */
export const JAM_SESI = 3;
/** Pilihan yang ditawarkan paling banyak sekian; lebih dari itu diminta lebih khusus. */
export const MAKS_PILIHAN = 9;

export type Perintah =
  | { jenis: "lokasi"; nama: string }
  | { jenis: "selesai" }
  | { jenis: "bantuan" }
  | { jenis: "pilih"; nomor: number }
  | { jenis: "tanya" }
  | { jenis: "teks"; teks: string };

/**
 * Pertanyaan untuk Tanya MARLIN, bukan isian laporan.
 *
 * Tanda tanya di akhir selalu menang – itu juga jalan keluar yang disebut di
 * balasan "pekerjaan tidak ketemu". Kata tanya di depan menangkap orang yang
 * tidak biasa memakai tanda tanya di WhatsApp.
 */
const KATA_TANYA =
  /^(apa|apakah|berapa|bagaimana|gimana|kapan|kenapa|mengapa|siapa|mana|dimana|di mana|tolong|minta|mohon|cek|lihat|tampilkan|rekap|ringkas|progres|progress|deviasi|status)\b/i;

export function bacaPerintah(teks: string): Perintah {
  const t = teks.replace(/\s+/g, " ").trim();
  if (!t) return { jenis: "teks", teks: "" };
  if (/\?\s*$/.test(t)) return { jenis: "tanya" };
  if (/^(selesai|stop|keluar)\.?$/i.test(t)) return { jenis: "selesai" };
  if (/^(lapor|cara lapor|bantuan lapor)\.?$/i.test(t)) return { jenis: "bantuan" };
  if (/^\d{1,2}$/.test(t)) return { jenis: "pilih", nomor: Number(t) };
  const lokasi = /^lokasi\b[\s:\-–]*(.+)$/i.exec(t);
  if (lokasi && lokasi[1].trim()) return { jenis: "lokasi", nama: lokasi[1].trim() };
  if (KATA_TANYA.test(t)) return { jenis: "tanya" };
  return { jenis: "teks", teks: t };
}

/* ── Angka & satuan ─────────────────────────────────────────────────────── */

/**
 * Angka gaya Indonesia: koma = desimal, titik = ribuan ("1.250" = 1250,
 * "12,5" = 12,5). Titik TANPA pola ribuan dibaca desimal ("2.5" = 2,5) –
 * lazim diketik dari HP berpapan ketik Inggris. null bila bukan angka.
 */
export function bacaAngka(s: string): number | null {
  const t = s.trim();
  if (!/^\d[\d.,]*$/.test(t)) return null;
  let norm: string;
  if (t.includes(".") && t.includes(",")) norm = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) norm = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, "");
  else norm = t;
  if ((norm.match(/\./g) ?? []).length > 1) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Satuan yang dikenali → bentuk baku. Yang tidak ada di sini tidak dianggap satuan. */
const SATUAN: Record<string, string> = {
  m2: "m2", "m²": "m2", mtr2: "m2", meter2: "m2", "meter persegi": "m2", m2persegi: "m2",
  m3: "m3", "m³": "m3", mtr3: "m3", meter3: "m3", "meter kubik": "m3", kubik: "m3",
  m: "m", m1: "m", "m'": "m", mtr: "m", meter: "m", ml: "m", "meter lari": "m", "m lari": "m",
  kg: "kg", kilo: "kg", ton: "ton",
  bh: "bh", buah: "bh", pcs: "bh", pc: "bh",
  unit: "unit", unt: "unit",
  titik: "titik", ttk: "titik",
  ls: "ls", lumpsum: "ls", "lump sum": "ls",
  set: "set", lbr: "lbr", lembar: "lbr", btg: "btg", batang: "btg",
  zak: "zak", sak: "zak", ltr: "ltr", liter: "ltr", ttl: "titik", pkt: "paket", paket: "paket",
  hari: "hari", oh: "oh", org: "orang", orang: "orang",
};

const SATUAN_BAKU = new Set(Object.values(SATUAN));

/** Bentuk baku satuan; satuan tak dikenal dikembalikan rapi apa adanya. */
export function bakuSatuan(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return SATUAN[t] ?? SATUAN[t.replace(/\s/g, "")] ?? t.replace(/\s/g, "");
}

/** Satuan yang diketik sepadan dengan satuan RAB? Tanpa satuan = ikut RAB. */
export function satuanSepadan(diketik: string | null, rab: string | null): boolean {
  if (!diketik || !rab) return true;
  return bakuSatuan(diketik) === bakuSatuan(rab);
}

export type IsianPekerjaan = { nama: string; volume: number | null; satuan: string | null };

/** Angka + satuan opsional di AKHIR teks. Satuan boleh dua kata ("meter persegi"). */
const EKOR_VOLUME = /(?:^|[\s,:=])(\d[\d.,]*)\s*([a-zA-Z²³'][a-zA-Z²³'0-9]*(?:\s(?:persegi|kubik|lari))?)?\s*\.?$/;

/**
 * "pasang paving 20 m2" → nama "pasang paving", volume 20, satuan "m2".
 * "20 m2" saja → nama kosong (untuk pekerjaan yang sedang aktif).
 *
 * Volume hanya dibaca di AKHIR pesan, dan satuannya harus satuan yang dikenali
 * atau tidak ada: "pipa 4 inch" tetap nama pekerjaan. Angka yang ternyata
 * bagian NAMA ("beton k 225") diselesaikan pemanggil, yang mencari dengan teks
 * utuh lebih dulu.
 */
export function pisahVolume(teks: string): IsianPekerjaan {
  const t = teks.replace(/\s+/g, " ").trim();
  const utuh: IsianPekerjaan = { nama: t, volume: null, satuan: null };
  const m = EKOR_VOLUME.exec(t);
  if (!m) return utuh;
  const volume = bacaAngka(m[1]);
  const satuan = m[2] ?? null;
  if (volume == null || volume <= 0) return utuh;
  if (satuan != null && !SATUAN_BAKU.has(bakuSatuan(satuan)!)) return utuh;
  return { nama: t.slice(0, m.index).replace(/[\s,:=]+$/, "").trim(), volume, satuan };
}

/* ── Mencari pekerjaan ──────────────────────────────────────────────────── */

/**
 * Bentuk kata benda RAB dari kata kerja yang diketik PIC: "pasang" ada di RAB
 * sebagai "PEMASANGAN", "gali" sebagai "PENGGALIAN", "cor" sebagai
 * "PENGECORAN". Pencarian di aplikasi (DECISIONS 648) tidak butuh ini karena
 * orang memilih dari daftar yang terlihat; di WhatsApp daftarnya tidak
 * terlihat, dan orang menulis seperti bicara.
 *
 * Hanya awalan peN- dengan peluluhannya – cukup untuk kata kerja pekerjaan
 * konstruksi, tanpa kamus.
 */
export function bentukKata(kata: string): string[] {
  const w = kata.toLowerCase();
  if (w.length < 3 || /[^a-z]/.test(w)) return [w];
  const bentuk = new Set([w]);
  const sukuKata = (w.match(/[aiueo]+/g) ?? []).length;
  if (sukuKata === 1) bentuk.add(`penge${w}`); // cor → pengecoran, cat → pengecatan
  const a = w[0];
  if (a === "p") bentuk.add(`pem${w.slice(1)}`); // pasang → pemasangan
  else if (a === "t") bentuk.add(`pen${w.slice(1)}`); // timbun → penimbunan
  else if (a === "k") bentuk.add(`peng${w.slice(1)}`); // keruk → pengerukan
  else if (a === "s") bentuk.add(`peny${w.slice(1)}`); // sapu → penyapuan
  else if ("bfv".includes(a)) bentuk.add(`pem${w}`); // bongkar → pembongkaran
  else if ("dcjz".includes(a)) bentuk.add(`pen${w}`); // datar → pendataran
  else if ("aiueogh".includes(a)) bentuk.add(`peng${w}`); // gali → penggalian, urug → pengurugan
  else bentuk.add(`pe${w}`); // lapis → pelapisan
  return [...bentuk];
}

export type OpsiCari = { code: string; name: string; category: string; subPath: string };

function cocokKata(o: OpsiCari, kata: string): boolean {
  const teksItem = `${o.name} ${o.subPath} ${o.category}`.toLowerCase();
  if (bentukKata(kata).some((b) => teksItem.includes(b))) return true;
  // Kode item hanya cocok untuk kode berhuruf yang diketik utuh ("7.a"). Angka
  // polos TIDAK PERNAH dicocokkan ke kode: "bekesting kolom 3" berarti volume 3,
  // bukan item berkode 3.
  const k = kata.replace(/\.$/, "");
  return /[a-z]/.test(k) && o.code.toLowerCase().trim().replace(/\.$/, "") === k;
}

/**
 * `semua` = item yang memuat SEMUA kata (boleh dalam bentuk peN-). Bila tidak
 * ada, `mendekati` = item dengan kata cocok terbanyak – hanya untuk DITAWARKAN,
 * tidak pernah langsung dipakai: "pasang batako" yang mendekati "Pasangan Bata"
 * adalah tebakan, dan volume yang dicatat ke pekerjaan yang salah tidak
 * terlihat salah di laporan.
 */
export function cariPekerjaanWa<T extends OpsiCari>(daftar: T[], query: string): { semua: T[]; mendekati: T[] } {
  const kata = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return { semua: [], mendekati: [] };
  const semua = daftar.filter((o) => kata.every((k) => cocokKata(o, k)));
  if (semua.length > 0) return { semua, mendekati: [] };
  const berarti = kata.filter((k) => /[a-z]/.test(k) && k.length >= 3);
  if (berarti.length === 0) return { semua: [], mendekati: [] };
  const skor = daftar.map((o) => berarti.filter((k) => cocokKata(o, k)).length);
  const maks = Math.max(0, ...skor);
  return { semua: [], mendekati: maks === 0 ? [] : daftar.filter((_, i) => skor[i] === maks) };
}

/* ── Masa sesi ──────────────────────────────────────────────────────────── */

export type KeadaanSesi = {
  locationId: string | null;
  mulaiAt: Date;
  terakhirAt: Date;
  selesaiAt: Date | null;
};

/**
 * Sesi masih berlaku: ada lokasinya, belum diakhiri, kiriman terakhir kurang
 * dari 3 jam lalu, dan masih HARI yang sama (WIB) – sesi tidak pernah menyeberang
 * tengah malam, supaya foto pagi tidak tercatat untuk lokasi kemarin sore.
 */
export function sesiBerlaku(s: KeadaanSesi | null, sekarang: Date): boolean {
  if (!s || !s.locationId || s.selesaiAt) return false;
  if (sekarang.getTime() - s.terakhirAt.getTime() > JAM_SESI * 3_600_000) return false;
  return jakartaDateKey(s.mulaiAt) === jakartaDateKey(sekarang);
}

/**
 * Pilihan yang ditawarkan (balas angka) berlaku selama sesinya bisa berlaku:
 * 3 jam dan hari yang sama. Angka "2" besok pagi bukan jawaban tawaran kemarin.
 */
export function tawaranBerlaku(terakhirAt: Date, sekarang: Date): boolean {
  if (sekarang.getTime() - terakhirAt.getTime() > JAM_SESI * 3_600_000) return false;
  return jakartaDateKey(terakhirAt) === jakartaDateKey(sekarang);
}

/* ── Teks balasan ───────────────────────────────────────────────────────── */

export function angkaSatuan(v: number, satuan: string | null): string {
  return `${formatNumber(v)}${satuan ? ` ${satuan}` : ""}`;
}

export const teks = {
  bantuan:
    "Cara melapor lewat WhatsApp:\n" +
    "1. Ketik *lokasi* lalu namanya, mis. *lokasi Kedung Mutih*.\n" +
    "2. Kirim fotonya. Supaya GPS dan jam aslinya ikut, kirim sebagai *Dokumen*.\n" +
    "3. Sebut nama pekerjaannya kalau fotonya untuk pekerjaan itu, mis. *pasang paving*, " +
    "atau sekalian volumenya: *pasang paving 20 m2*. Foto dan volume itu menjadi USULAN – " +
    "masuk laporan harian setelah diperiksa di aplikasi.\n" +
    "4. Ketik *selesai* kalau sudah. Sesi berakhir sendiri setelah 3 jam tanpa kiriman.\n" +
    "Pertanyaan untuk MARLIN tetap bisa, akhiri dengan tanda tanya.",

  lokasiAktif: (nama: string) =>
    `Lokasi aktif: *${nama}*.\n` +
    "Kirim fotonya sekarang. Sebut nama pekerjaannya kalau fotonya untuk pekerjaan itu, " +
    "mis. *pasang paving*, atau sekalian volumenya: *pasang paving 20 m2*.\n" +
    "Ketik *selesai* kalau sudah. Sesi berakhir sendiri setelah 3 jam tanpa kiriman.",

  pilihLokasi: (diketik: string, pilihan: string[]) =>
    `Ada ${pilihan.length} lokasi yang cocok dengan "${diketik}":\n` +
    pilihan.map((p, i) => `${i + 1}. ${p}`).join("\n") +
    "\nBalas dengan angkanya.",

  terlaluBanyakLokasi: (diketik: string, jumlah: number) =>
    `Ada ${jumlah} lokasi yang cocok dengan "${diketik}". Sebut nama lokasinya yang lebih lengkap.`,

  fotoTanpaLokasi: (sesiHabis: boolean) =>
    (sesiHabis ? "Sesi lapor sebelumnya sudah berakhir, jadi foto" : "Foto") +
    " ini belum saya simpan karena lokasinya belum disebut. Ketik dulu *lokasi* lalu namanya, " +
    "mis. *lokasi Kedung Mutih*, kemudian kirim ulang fotonya.",

  belumVerifikasi:
    "Nomor WhatsApp Anda belum diverifikasi di MARLIN, jadi foto dan laporan dari nomor ini belum bisa " +
    "diterima. Buka MARLIN, masuk ke halaman *Verifikasi WhatsApp*, lalu coba lagi.",

  tanpaIzinFoto: "Akun Anda tidak punya izin mengirim foto lapangan, jadi foto ini tidak disimpan.",
  tanpaIzinVolume:
    "Akun Anda tidak punya izin mengisi laporan harian, jadi volumenya tidak dicatat. Fotonya tetap bisa dikirim.",
  tanpaAksesLokasi: (nama: string) =>
    `Akun Anda sudah tidak punya akses ke *${nama}*. Sesi lapor saya akhiri.`,

  selesai: (nama: string, jumlah: number) =>
    `Sesi lapor *${nama}* selesai. ` +
    (jumlah > 0
      ? `${jumlah} foto tersimpan lewat WhatsApp di sesi ini. Lengkapi dan kirim laporannya lewat aplikasi.`
      : "Tidak ada foto yang tersimpan di sesi ini."),
  tanpaSesi: "Tidak ada sesi lapor yang sedang aktif.",

  pekerjaanAktif: (nama: string, satuan: string | null) =>
    `Pekerjaan aktif: *${nama}*${satuan ? ` (${satuan})` : ""}. Foto berikutnya diusulkan untuk pekerjaan ini. ` +
    `Kirim volumenya juga kalau mau, mis. *20${satuan ? ` ${satuan}` : ""}*.`,

  pekerjaanTidakAda: (diketik: string, lokasi: string) =>
    `Pekerjaan "${diketik}" tidak ketemu di RAB *${lokasi}*. Coba kata lain yang ada di nama pekerjaannya. ` +
    "Kalau ini pertanyaan untuk MARLIN, akhiri dengan tanda tanya.",

  pilihPekerjaan: (diketik: string, pilihan: string[]) =>
    `Ada ${pilihan.length} pekerjaan yang cocok dengan "${diketik}":\n` +
    pilihan.map((p, i) => `${i + 1}. ${p}`).join("\n") +
    "\nBalas dengan angkanya.",

  mendekatiPekerjaan: (diketik: string, pilihan: string[]) =>
    `Tidak ada pekerjaan yang persis cocok dengan "${diketik}". Yang paling mendekati:\n` +
    pilihan.map((p, i) => `${i + 1}. ${p}`).join("\n") +
    "\nBalas dengan angkanya kalau memang itu, atau tulis ulang nama pekerjaannya.",

  terlaluBanyakPekerjaan: (diketik: string, jumlah: number) =>
    `Ada ${jumlah} pekerjaan yang cocok dengan "${diketik}". Tambahkan kata supaya lebih khusus, ` +
    "mis. kode atau nama bagiannya.",

  pilihanDiLuar: (jumlah: number) => `Balas dengan angka 1 sampai ${jumlah}.`,

  pilihanKedaluwarsa:
    "Pilihan itu sudah tidak berlaku karena sesi lapornya berakhir. Ketik *lokasi* lalu namanya untuk mulai lagi.",

  fotoMenungguPilihan: "Foto tadi belum disimpan. Kirim ulang setelah memilih lokasinya.",

  volumeTanpaPekerjaan:
    "Volume itu untuk pekerjaan apa? Sebut nama pekerjaannya, mis. *pasang paving 20 m2*.",

  satuanBeda: (pekerjaan: string, rab: string, diketik: string) =>
    `Satuan *${pekerjaan}* di RAB adalah *${rab}*, bukan *${diketik}*. Kirim ulang dengan satuan yang benar, ` +
    "atau tanpa satuan.",

  usulanVolume: (pekerjaan: string, baru: string, lama: string | null, foto: number) =>
    `Usulan volume *${pekerjaan}* hari ini: *${baru}*` +
    (lama ? ` (menggantikan usulan sebelumnya ${lama})` : "") +
    (foto > 0 ? `, dengan ${foto} foto` : "") +
    ". Belum masuk laporan – yang memeriksa memasukkannya lewat halaman laporan harian di aplikasi.",

  melebihiSisa: (sisa: string) => `melebihi sisa RAB. Sisa yang masih bisa dilaporkan: ${sisa}.`,

  volumeDitolak: (sebab: string) => `Volume tidak dicatat: ${sebab}`,

  fotoTersimpan: (o: {
    jumlah: number;
    lokasi: string;
    diusulkan: number;
    pekerjaan: string | null;
    kantong: number;
    catatanGps: boolean;
  }) => {
    const bagian = [`${o.jumlah} foto tersimpan untuk *${o.lokasi}*.`];
    if (o.diusulkan > 0 && o.pekerjaan)
      bagian.push(
        o.diusulkan === o.jumlah
          ? `Semuanya diusulkan untuk pekerjaan *${o.pekerjaan}* – masuk laporan setelah diperiksa di aplikasi.`
          : `${o.diusulkan} diusulkan untuk pekerjaan *${o.pekerjaan}*.`,
      );
    if (o.kantong > 0)
      bagian.push(
        `${o.kantong === o.jumlah ? "Semuanya" : o.kantong} ada di kantong Foto Cepat. ` +
          "Sebut nama pekerjaannya kalau foto berikutnya untuk pekerjaan tertentu.",
      );
    if (o.catatanGps)
      bagian.push(
        "Foto lewat WhatsApp biasanya kehilangan GPS dan jam aslinya, jadi koordinatnya memakai titik lokasi " +
          "proyek dan diberi tanda. Supaya GPS dan jam aslinya ikut, kirim sebagai *Dokumen*.",
      );
    return bagian.join(" ");
  },

  fotoGagal: (sebab: string) => `Satu foto tidak tersimpan: ${sebab}`,
};
