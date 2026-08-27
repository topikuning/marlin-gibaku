import { bertanda, pct } from "./tanya-format";
import type {
  BarisDeviasi,
  BarisKelengkapan,
  BarisKendala,
  BarisLaporanWa,
  BarisMingguanWa,
  BarisProgress,
} from "./tanya-format";
import type { LokasiKatalog } from "./tanya-niat";
import { ISSUE_SEVERITY_TONE } from "@/lib/lifecycle";
import { catatanGabung, ringkasKendalaPerLokasi } from "./kendala-ringkas";

/**
 * Balasan WhatsApp berdata → BENTUK TABEL, untuk dicetak jadi PDF
 * (DECISIONS 448).
 *
 * ### Kenapa ada
 *
 * Permintaan user 2026-08-26: *"kalau dalam data yang banyak begitu, misal
 * kendala hari ini, alih-alih ngasih chat panjang lebar, wa merespon dengan
 * format pdf rapi"*. Jawaban 27 lokasi di WhatsApp menjadi lima gelembung teks
 * yang harus digulir – dan begitu di-screenshot lalu diteruskan ke PPK, ia
 * pecah di tempat yang salah. Tabel di PDF tetap satu berkas, tetap sejajar
 * kolomnya, dan bisa diteruskan utuh.
 *
 * ### Yang TIDAK dilakukan di sini
 *
 * Tidak ada satu pun angka yang lahir di berkas ini. Ia menerima baris yang
 * SUDAH jadi – baris yang sama persis dengan yang dipakai balasan teks – lalu
 * hanya menyusunnya jadi kolom. Persennya pun diformat lewat `pct`/`bertanda`
 * milik perakit teks, supaya angka di PDF dan angka di gelembung WhatsApp
 * tidak pernah bisa berbeda.
 *
 * Murni: tanpa DB, tanpa `server-only`. Ia dipanggil dari jalur penjawab, dan
 * modul murni bisa diuji tanpa lingkungan lengkap.
 */

/**
 * Nada sel – kosakata yang SAMA dengan status di layar (`lifecycle.ts`),
 * supaya "kritis" berwarna sama di layar, di PDF, dan di dokumen yang
 * diteruskan ke PPK. Bukan palet kedua yang harus ikut diperbaiki tiap kali
 * tone di layar berubah.
 */
export type NadaSel = "neutral" | "info" | "warning" | "danger" | "success";

export type SelTabel = {
  teks: string;
  align?: "left" | "center" | "right";
  tebal?: boolean;
  nada?: NadaSel;
};

/** Nada status kendala – terbuka menuntut perhatian, ditangani sudah dipegang. */
function nadaStatusKendala(status: string): NadaSel {
  if (status === "terbuka") return "warning";
  if (status === "ditangani" || status === "sedang_ditangani") return "info";
  return "neutral";
}

/** Deviasi: minus itu tertinggal, plus itu di depan rencana. */
function nadaDeviasi(n: number | null): NadaSel {
  if (n === null) return "neutral";
  return n < 0 ? "danger" : "success";
}

export type KolomTabel = {
  label: string;
  /** Bobot lebar relatif; jumlahnya bebas – dinormalkan saat menggambar. */
  bobot: number;
  align?: "left" | "center" | "right";
};

export type TabelWa = {
  judul: string;
  /** Tanggal/periode – persis kalimat yang dipakai kepala balasan teks. */
  subjudul: string | null;
  kolom: KolomTabel[];
  baris: SelTabel[][];
  /**
   * Berapa BUTIR data yang diwakili tabel ini – biasanya sama dengan jumlah
   * baris, tetapi tidak untuk register kendala: di sana satu baris (satu
   * lokasi) bisa memuat beberapa kendala (DECISIONS 450).
   *
   * Dipakai memutuskan "perlu berkas atau tidak". Menghitung baris saja akan
   * mengirim 12 kendala di satu lokasi sebagai gelembung teks panjang, karena
   * barisnya cuma satu.
   */
  jumlahIsi: number;
  /**
   * Pengakuan bahwa jawabannya sebagian (pemotongan baris, pemotongan lingkup,
   * periode yang digeser). WAJIB ikut tercetak – lihat `tanya-format.ts`:
   * jawaban sebagian yang tidak mengaku sebagian akan diteruskan apa adanya
   * sebagai jawaban lengkap, dan PDF justru LEBIH mudah diteruskan.
   */
  catatan: string[];
};

/**
 * Ambang jumlah baris yang membuat balasan lebih baik dibaca sebagai tabel.
 *
 * Dipilih 10 karena di situlah balasan teks mulai melewati satu layar ponsel
 * untuk hampir semua niat. Di bawah itu, gelembung WhatsApp tetap lebih cepat
 * dibaca daripada membuka lampiran.
 */
export const AMBANG_BARIS_PDF = 10;

/**
 * Perlukah balasan ini dikirim sebagai PDF?
 *
 * Dua sebab, dan keduanya soal keterbacaan – bukan selera:
 *  - barisnya banyak (≥ {@link AMBANG_BARIS_PDF}); atau
 *  - teksnya tidak muat satu pesan WhatsApp, jadi ia akan dipecah menjadi
 *    beberapa gelembung yang urutannya harus dirakit sendiri oleh pembaca.
 */
export function perluPdf(jumlahBagianPesan: number, jumlahIsi: number): boolean {
  if (jumlahIsi === 0) return false;
  return jumlahIsi >= AMBANG_BARIS_PDF || jumlahBagianPesan > 1;
}

/** Keterangan tetap per nama lokasi – kolom pembuka setiap tabel. */
export type PetaLokasi = Map<
  string,
  { kabupaten: string; provinsi: string; pelaksana: string | null }
>;

export function petaLokasi(katalog: LokasiKatalog[]): PetaLokasi {
  return new Map(
    katalog.map((l) => [
      l.nama,
      { kabupaten: l.kabupaten, provinsi: l.provinsi, pelaksana: l.pelaksana ?? null },
    ]),
  );
}

/**
 * Kolom pembuka untuk satu lokasi: perusahaan, kabupaten, provinsi.
 *
 * Yang tidak ada di katalog diberi "–", BUKAN ditebak dari nama. Menebak
 * kabupaten dari nama desa adalah cara termurah menaruh lokasi di provinsi
 * yang salah pada dokumen yang akan diteruskan ke PPK — dan menebak
 * perusahaannya lebih buruk lagi: pada daftar kendala, itu tuduhan.
 */
const KOL_AWAL: KolomTabel[] = [
  { label: "No", bobot: 3, align: "center" },
  { label: "Perusahaan", bobot: 13 },
  { label: "Lokasi", bobot: 11 },
  { label: "Kabupaten/Kota", bobot: 12 },
  { label: "Provinsi", bobot: 10 },
];

function awal(n: number, lokasi: string, peta: PetaLokasi): SelTabel[] {
  const w = peta.get(lokasi);
  return [
    { teks: String(n), align: "center" },
    { teks: w?.pelaksana ?? "–", tebal: true },
    { teks: lokasi },
    { teks: w?.kabupaten ?? "–" },
    { teks: w?.provinsi ?? "–" },
  ];
}

/**
 * URUTAN BACA: perusahaan dulu, lalu lokasi (permintaan user 2026-08-26).
 *
 * Daftar lintas lokasi ditagihkan per perusahaan, jadi baris satu perusahaan
 * harus berdampingan — kalau tersebar, pembacanya harus menyisir seluruh
 * halaman untuk tahu siapa menanggung apa.
 *
 * Yang TIDAK diurutkan ulang: jawaban yang memang sebuah PERINGKAT (deviasi,
 * "progress terburuk dulu"). Judulnya sudah berjanji urutan tertentu; menyusun
 * ulang isinya membuat judul itu berbohong. Lihat pemanggilnya.
 *
 * Perusahaan yang belum diketahui ditaruh di BELAKANG: ia bukan nama, dan
 * menaruhnya di depan (karena "–" kecil menurut abjad) membuat halaman pertama
 * berisi baris yang paling tidak bisa ditindak.
 */
function urutkanPerPerusahaan<T extends { lokasi: string }>(baris: T[], peta: PetaLokasi): T[] {
  const kunci = (b: T) => peta.get(b.lokasi)?.pelaksana ?? null;
  return [...baris].sort((a, b) => {
    const pa = kunci(a);
    const pb = kunci(b);
    if (pa !== pb) {
      if (!pa) return 1;
      if (!pb) return -1;
      const c = pa.localeCompare(pb, "id");
      if (c !== 0) return c;
    }
    return a.lokasi.localeCompare(b.lokasi, "id");
  });
}

/** Catatan yang benar-benar ada saja – yang kosong tidak menyisakan baris. */
function catatan(...c: (string | null | undefined)[]): string[] {
  return c.map((t) => t?.trim()).filter((t): t is string => !!t);
}

/** Urutan baca tabel: peringkat dibiarkan, sisanya per perusahaan lalu lokasi. */
function urut<T extends { lokasi: string }>(baris: T[], peta: PetaLokasi, o: OpsiTabel): T[] {
  return o.peringkat ? baris : urutkanPerPerusahaan(baris, peta);
}

export type OpsiTabel = {
  /**
   * Jangan urutkan ulang – jawaban ini sebuah PERINGKAT dan judulnya sudah
   * menjanjikan urutannya (deviasi, "progress terburuk dulu").
   */
  peringkat?: boolean;
  catatanBatas?: string | null;
  /** Pengakuan bahwa baris kembar sudah digabung (DECISIONS 450). */
  catatanGabung?: string | null;
  catatanPeriode?: string | null;
  catatanPemotongan?: string | null;
  penandaLingkup?: string | null;
};

function rakit(
  judul: string,
  subjudul: string | null,
  kolom: KolomTabel[],
  baris: SelTabel[][],
  o: OpsiTabel,
  jumlahIsi: number = baris.length,
): TabelWa {
  return {
    judul,
    subjudul,
    kolom,
    baris,
    jumlahIsi,
    catatan: catatan(
      o.penandaLingkup,
      o.catatanPeriode,
      o.catatanBatas,
      o.catatanGabung,
      o.catatanPemotongan,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Per niat                                                            */
/* ------------------------------------------------------------------ */

/**
 * Register kendala – SATU BARIS PER LOKASI (DECISIONS 450).
 *
 * Keberatan user 2026-08-27 atas dokumen yang benar-benar terkirim: satu lokasi
 * bisa memakan tiga baris untuk dua persoalan, dan kalimat yang persis sama
 * muncul dua kali. Peringkasannya dipakai bersama balasan teks
 * (`ringkasKendalaPerLokasi`), jadi jumlah baris keduanya tidak bisa berbeda.
 *
 * Kolom tingkat/status/umur menampilkan yang PALING MENUNTUT di lokasi itu –
 * tingkat tertinggi, status paling belum tertangani, umur terlama. Itu yang
 * menentukan urutan kerja; rata-rata tidak menentukan apa-apa.
 */
export function tabelKendala(
  r: { judul: string; tanggal: string; baris: BarisKendala[] },
  peta: PetaLokasi,
  o: OpsiTabel = {},
): TabelWa {
  const { baris: perLokasi, digabung } = ringkasKendalaPerLokasi(r.baris);
  return rakit(
    r.judul,
    r.tanggal,
    [
      ...KOL_AWAL,
      { label: "Tingkat", bobot: 7, align: "center" },
      { label: "Status", bobot: 9, align: "center" },
      { label: "Umur", bobot: 6, align: "center" },
      { label: "Kendala", bobot: 38 },
    ],
    urut(perLokasi, peta, o).map((b, i) => [
      ...awal(i + 1, b.lokasi, peta),
      {
        teks: b.tingkat,
        align: "center",
        tebal: b.tingkat === "kritis",
        // Tingkat kendala memakai tone yang sama dengan StatusPill di layar.
        nada: ISSUE_SEVERITY_TONE[b.tingkat as keyof typeof ISSUE_SEVERITY_TONE] ?? "neutral",
      },
      { teks: b.status, align: "center", nada: nadaStatusKendala(b.status) },
      { teks: `${b.umurHari} hari`, align: "center" },
      // Beberapa kendala dalam satu sel, bernomor supaya jumlahnya terbaca
      // sekali lihat. Satu kendala tidak diberi nomor – "1." untuk satu-satunya
      // baris hanya menambah derau.
      {
        teks:
          b.kendala.length === 1
            ? b.kendala[0]
            : b.kendala.map((k, n) => `${n + 1}. ${k}`).join("\n"),
      },
    ]),
    { ...o, catatanGabung: catatanGabung(digabung) },
    perLokasi.reduce((n, l) => n + l.kendala.length, 0),
  );
}

export function tabelProgress(
  r: { judul: string; tanggal: string; baris: BarisProgress[] },
  peta: PetaLokasi,
  o: OpsiTabel = {},
): TabelWa {
  return rakit(
    r.judul,
    r.tanggal,
    [
      ...KOL_AWAL,
      { label: "Realisasi", bobot: 9, align: "right" },
      { label: "Rencana", bobot: 9, align: "right" },
      { label: "Deviasi", bobot: 9, align: "right" },
      { label: "Laporan", bobot: 26 },
    ],
    urut(r.baris, peta, o).map((b, i) => [
      ...awal(i + 1, b.lokasi, peta),
      { teks: pct(b.realisasiPct), align: "right" },
      { teks: pct(b.rencanaPct), align: "right" },
      {
        teks: bertanda(b.deviasiPct),
        align: "right",
        tebal: b.deviasiPct < 0,
        nada: nadaDeviasi(b.deviasiPct),
      },
      {
        nada: b.itemHariIni === null ? "warning" : "neutral",
        teks:
          b.itemHariIni === null
            ? "belum ada laporan"
            : `${b.itemHariIni} item dilaporkan${b.statusHariIni ? ` (${b.statusHariIni})` : ""}`,
      },
    ]),
    o,
  );
}

export function tabelDeviasi(
  r: { judul: string; tanggal: string; baris: BarisDeviasi[] },
  peta: PetaLokasi,
  o: OpsiTabel = {},
): TabelWa {
  return rakit(
    r.judul,
    r.tanggal,
    [
      ...KOL_AWAL,
      { label: "Deviasi", bobot: 12, align: "right" },
      { label: "Realisasi", bobot: 12, align: "right" },
      { label: "Rencana", bobot: 12, align: "right" },
    ],
    urut(r.baris, peta, o).map((b, i) => [
      ...awal(i + 1, b.lokasi, peta),
      { teks: bertanda(b.deviasiPct), align: "right", tebal: true, nada: nadaDeviasi(b.deviasiPct) },
      { teks: pct(b.realisasiPct), align: "right" },
      { teks: pct(b.rencanaPct), align: "right" },
    ]),
    o,
  );
}

export function tabelKelengkapan(
  r: { judul: string; tanggal: string; baris: BarisKelengkapan[] },
  peta: PetaLokasi,
  o: OpsiTabel = {},
): TabelWa {
  return rakit(
    r.judul,
    r.tanggal,
    [...KOL_AWAL, { label: "Keterangan", bobot: 40 }],
    urut(r.baris, peta, o).map((b, i) => [
      ...awal(i + 1, b.lokasi, peta),
      { teks: b.status, tebal: b.perluTindakan, nada: b.perluTindakan ? "warning" : "neutral" },
    ]),
    o,
  );
}

export function tabelLaporan(
  r: { judul: string; tanggal: string; baris: BarisLaporanWa[] },
  peta: PetaLokasi,
  o: OpsiTabel = {},
): TabelWa {
  return rakit(
    r.judul,
    r.tanggal,
    [
      ...KOL_AWAL,
      { label: "Status", bobot: 9, align: "center" },
      { label: "Item", bobot: 5, align: "center" },
      { label: "Pekerja", bobot: 6, align: "center" },
      { label: "Foto", bobot: 5, align: "center" },
      { label: "Cuaca", bobot: 7 },
      { label: "Jam kerja", bobot: 7 },
      { label: "Contoh item", bobot: 21 },
    ],
    urut(r.baris, peta, o).map((b, i) => [
      ...awal(i + 1, b.lokasi, peta),
      {
        teks: b.status ?? "belum ada laporan",
        align: "center",
        nada: b.status ? "neutral" : "warning",
      },
      { teks: String(b.itemCount), align: "center" },
      { teks: String(b.pekerjaCount), align: "center" },
      { teks: String(b.fotoCount), align: "center" },
      { teks: b.cuaca ?? "–" },
      { teks: b.jamKerja ?? "–" },
      { teks: b.contohItem.join("; ") },
    ]),
    o,
  );
}

export function tabelMingguan(
  r: { judul: string; periode: string; baris: BarisMingguanWa[] },
  peta: PetaLokasi,
  o: OpsiTabel = {},
): TabelWa {
  return rakit(
    r.judul,
    r.periode,
    [
      ...KOL_AWAL,
      { label: "Rencana", bobot: 10, align: "right" },
      { label: "Realisasi", bobot: 10, align: "right" },
      { label: "Deviasi", bobot: 10, align: "right" },
      { label: "Hari berlaporan", bobot: 11, align: "center" },
    ],
    urut(r.baris, peta, o).map((b, i) => [
      ...awal(i + 1, b.lokasi, peta),
      // `null` = belum ada baseline kurva-S; "–" bukan nol, dan menuliskannya
      // sebagai 0,00% akan terbaca sebagai rencana yang memang nol.
      { teks: b.rencanaPct === null ? "–" : pct(b.rencanaPct), align: "right" },
      { teks: pct(b.realisasiPct), align: "right" },
      {
        teks: b.deviasiPct === null ? "–" : bertanda(b.deviasiPct),
        align: "right",
        tebal: b.deviasiPct !== null && b.deviasiPct < 0,
        nada: nadaDeviasi(b.deviasiPct),
      },
      { teks: `${b.hariBerlaporan}/${b.totalHari}`, align: "center" },
    ]),
    o,
  );
}

/* ------------------------------------------------------------------ */
/* Pengantar berkas                                                    */
/* ------------------------------------------------------------------ */

/** Nama berkas: terbaca manusia, tanpa spasi, dan menyebut tanggalnya. */
export function namaBerkasTabel(t: TabelWa, dateKey: string): string {
  const slug = t.judul
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `marlin-${slug || "laporan"}-${dateKey}.pdf`;
}

/**
 * Keterangan singkat yang menemani berkas.
 *
 * Isinya kepala jawaban, BUKAN ringkasan isi tabel: orang yang membaca sambil
 * berjalan harus tahu ini jawaban atas pertanyaannya tanpa membuka lampiran,
 * dan ringkasan yang mengarang angka baru justru menambah satu angka yang bisa
 * berbeda dari isi berkasnya.
 */
export function keteranganBerkas(t: TabelWa): string {
  const b = [`*${t.judul}*`];
  if (t.subjudul) b.push(`_${t.subjudul}_`);
  // Register kendala memampatkan beberapa kendala ke satu baris; menyebut
  // barisnya saja akan terbaca "cuma 1 kendala" untuk 12 kendala di satu lokasi.
  const ringkas =
    t.jumlahIsi > t.baris.length
      ? `${t.jumlahIsi} rincian di ${t.baris.length} baris`
      : `${t.baris.length} baris`;
  b.push("", `${ringkas} – selengkapnya di berkas terlampir.`);
  if (t.catatan.length > 0) b.push("", ...t.catatan);
  return b.join("\n");
}
