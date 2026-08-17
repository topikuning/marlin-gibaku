// KALENDER PELAKSANAAN HARIAN (DECISIONS 340).
//
// Dua kelas cacat dijaga di sini, dan keduanya SENYAP — tidak menerbitkan galat
// apa pun, hanya menghasilkan halaman yang salah:
//
//  1. **Pergeseran kolom.** `getUTCDay()` memakai Minggu = 0; kalender ini
//     Senin = 0. Salah satu kolom saja meleset dan SETIAP tanggal jatuh di hari
//     yang salah — cacat yang hanya ketahuan kalau ada yang mencocokkan tanggal
//     dengan nama harinya.
//  2. **Riwayat yang tidak terjangkau.** Batas navigasi yang terlalu ketat
//     mengembalikan persis cacat yang halaman ini perbaiki (jendela 14 hari),
//     hanya dengan bentuk yang lebih meyakinkan: kalendernya terlihat lengkap,
//     padahal bulan yang memuat data tidak bisa dibuka.
//
// Ditambah invarian penyajian: "kosong" ada TIGA macam, dan hanya SATU yang
// berarti ada yang harus ditambal.
import { describe, expect, it } from "vitest";
import {
  bacaBulan,
  batasBulan,
  bulanDari,
  geserBulan,
  jepitBulan,
  judulBulan,
  jumlahHari,
  lolosSelSaring,
  offsetSenin,
  ringkasKalender,
  singkatUnik,
  susunDaftar,
  susunKalender,
  type DataHari,
} from "@/lib/daily-report/kalender-harian";
import { TAMPIL_STATUS } from "@/lib/daily-report/hari-ini-ringkas";

const KOSONG = new Map<string, DataHari>();

function kalender(
  bulan: string,
  opts: Partial<Parameters<typeof susunKalender>[0]> = {},
) {
  return susunKalender({
    bulan,
    hariIniKey: "2026-08-17",
    mulaiKontrak: null,
    akhirKontrak: null,
    data: KOSONG,
    ...opts,
  });
}

describe("aritmetika bulan", () => {
  it("geser bulan melewati batas tahun", () => {
    expect(geserBulan("2026-01", -1)).toBe("2025-12");
    expect(geserBulan("2026-12", 1)).toBe("2027-01");
    expect(geserBulan("2026-08", -14)).toBe("2025-06");
  });

  it("jumlah hari ikut tahun kabisat", () => {
    expect(jumlahHari("2026-02")).toBe(28);
    expect(jumlahHari("2028-02")).toBe(29); // kabisat
    expect(jumlahHari("2026-04")).toBe(30);
    expect(jumlahHari("2026-12")).toBe(31);
  });

  it("bacaBulan menolak bentuk tak sah TANPA galat", () => {
    // Query string datang dari luar; bentuk aneh harus jatuh ke bulan berjalan,
    // bukan meruntuhkan halaman.
    for (const buruk of [undefined, "", "2026-13", "2026-00", "agustus", "2026-8", "26-08"]) {
      expect(bacaBulan(buruk, "2026-08"), String(buruk)).toBe("2026-08");
    }
    expect(bacaBulan("2025-01", "2026-08")).toBe("2025-01");
  });

  it("judul bulan berbahasa Indonesia", () => {
    expect(judulBulan("2026-08")).toBe("Agustus 2026");
    expect(judulBulan("2026-01")).toBe("Januari 2026");
  });
});

describe("kolom hari — Senin di kiri", () => {
  it("offset dihitung dengan Senin = 0", () => {
    // 1 Agustus 2026 = SABTU → kolom ke-6 (indeks 5).
    expect(offsetSenin("2026-08")).toBe(5);
    // 1 Juni 2026 = SENIN → kolom pertama, tanpa sel titipan sama sekali.
    expect(offsetSenin("2026-06")).toBe(0);
    // 1 Februari 2026 = MINGGU → kolom terakhir (indeks 6).
    expect(offsetSenin("2026-02")).toBe(6);
  });

  it("tanggal jatuh di kolom hari yang BENAR", () => {
    // Penjaga langsung terhadap pergeseran satu kolom: 17 Agustus 2026 adalah
    // hari SENIN, jadi indeksnya harus habis dibagi 7.
    const sel = kalender("2026-08");
    const i = sel.findIndex((s) => s.dateKey === "2026-08-17");
    expect(i % 7).toBe(0);
    // Dan 23 Agustus 2026 adalah MINGGU → kolom terakhir.
    const j = sel.findIndex((s) => s.dateKey === "2026-08-23");
    expect(j % 7).toBe(6);
  });

  it("selalu kelipatan 7 sel, dan seluruh tanggal bulan itu ada", () => {
    for (const b of ["2026-02", "2026-06", "2026-08", "2028-02"]) {
      const sel = kalender(b);
      expect(sel.length % 7, b).toBe(0);
      expect(sel.filter((s) => s.bulanIni).length, b).toBe(jumlahHari(b));
    }
  });

  it("sel titipan bulan tetangga membawa tanggal yang benar", () => {
    // 1 Agu 2026 Sabtu → lima sel titipan: 27–31 Juli.
    const sel = kalender("2026-08");
    expect(sel.slice(0, 5).map((s) => s.dateKey)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    expect(sel.slice(0, 5).every((s) => !s.bulanIni)).toBe(true);
  });
});

describe("kosong ada TIGA macam", () => {
  const kontrak = { mulaiKontrak: "2026-03-01", akhirKontrak: "2026-07-28" };

  it("tiap keadaan punya KATA PENDEK yang berbeda", () => {
    // Di ponsel sel selebar ±44px hanya memuat kata pendek. Kalau "di luar
    // kontrak" dan "belum tiba" memakai tanda yang sama, dua fakta berbeda
    // tampil identik — persis yang dilarang aturan "status tidak pernah hanya
    // warna".
    expect(singkatUnik()).toBe(true);
    const luar = kalender("2026-02", { mulaiKontrak: "2026-03-01" }).find((s) => s.bulanIni)!;
    const nanti = kalender("2026-09", { mulaiKontrak: "2026-01-01" }).find((s) => s.bulanIni)!;
    expect(luar.singkat).not.toBe(nanti.singkat);
    expect(luar.singkat.length).toBeLessThanOrEqual(7);
    expect(nanti.singkat.length).toBeLessThanOrEqual(7);
  });

  it("sebelum SPMK bukan kelalaian", () => {
    const sel = kalender("2026-02", kontrak);
    const isi = sel.filter((s) => s.bulanIni);
    expect(isi.every((s) => s.keadaan === "luar_kontrak")).toBe(true);
    expect(isi[0].kata.toLowerCase()).toContain("luar kontrak");
  });

  it("sesudah masa kontrak juga bukan kelalaian", () => {
    const sel = kalender("2026-08", kontrak);
    expect(sel.filter((s) => s.bulanIni).every((s) => s.keadaan === "luar_kontrak")).toBe(true);
  });

  it("hari yang BELUM TIBA dipisahkan dari yang terlewat", () => {
    // Tanpa pemisahan ini, membuka bulan depan menampilkan 30 hari "belum ada
    // laporan" — angka yang menakutkan, salah, dan tak bisa ditindaklanjuti.
    const sel = kalender("2026-09", { mulaiKontrak: "2026-03-01", akhirKontrak: "2026-12-31" });
    const isi = sel.filter((s) => s.bulanIni);
    expect(isi.every((s) => s.keadaan === "belum_tiba")).toBe(true);
    expect(ringkasKalender(sel).belumAda).toBe(0);
  });

  it("dalam kontrak & sudah lewat & tanpa laporan = kosong (yang harus ditambal)", () => {
    const sel = kalender("2026-08", { mulaiKontrak: "2026-03-01", akhirKontrak: "2026-12-31" });
    const tgl10 = sel.find((s) => s.dateKey === "2026-08-10")!;
    expect(tgl10.keadaan).toBe("kosong");
    // Hari ini sendiri masih terhitung wajib — laporannya masih bisa dibuat.
    expect(sel.find((s) => s.dateKey === "2026-08-17")!.keadaan).toBe("kosong");
  });

  it("laporan yang TERLANJUR ADA di luar masa kontrak tetap ditampilkan", () => {
    // Impor rekap Excel bisa menghasilkannya. Data yang terlanjur ada harus
    // bisa DILIHAT untuk bisa diperbaiki; menyembunyikannya membuatnya awet.
    const data = new Map<string, DataHari>([
      ["2026-02-10", { status: "final", itemCount: 3, fotoCount: 2 }],
    ]);
    const sel = kalender("2026-02", { ...kontrak, data });
    const s = sel.find((x) => x.dateKey === "2026-02-10")!;
    expect(s.keadaan).toBe("ada");
    expect(s.kata).toBe(TAMPIL_STATUS.final.kata);
  });
});

describe("ringkasan selalu membawa penyebut yang JUJUR", () => {
  it("penyebut hanya hari yang memang menagih laporan", () => {
    // Agustus 2026 = 31 hari, kontrak berakhir 10 Agu, hari ini 17 Agu.
    // → 1–10 wajib (10 hari), 11–31 di luar kontrak.
    const sel = kalender("2026-08", { mulaiKontrak: "2026-03-01", akhirKontrak: "2026-08-10" });
    const r = ringkasKalender(sel);
    expect(r.wajib).toBe(10);
    expect(r.luarKontrak).toBe(21);
    expect(r.belumTiba).toBe(0);
    expect(r.belumAda).toBe(10);
  });

  it("hari titipan bulan tetangga TIDAK ikut dihitung", () => {
    // Kalau ikut, ringkasan Agustus memuat lima hari Juli — angka yang tidak
    // pernah cocok dengan apa pun.
    const sel = kalender("2026-08", { mulaiKontrak: "2026-01-01", akhirKontrak: "2026-12-31" });
    const r = ringkasKalender(sel);
    expect(r.wajib + r.luarKontrak + r.belumTiba).toBe(31);
  });

  it("mencacah tiap status pada tempatnya", () => {
    const data = new Map<string, DataHari>([
      ["2026-08-03", { status: "final", itemCount: 4, fotoCount: 6 }],
      ["2026-08-04", { status: "disetujui", itemCount: 2, fotoCount: 1 }],
      ["2026-08-05", { status: "dikirim", itemCount: 1, fotoCount: 0 }],
      ["2026-08-06", { status: "draft", itemCount: 1, fotoCount: 0 }],
      ["2026-08-07", { status: "perlu_koreksi", itemCount: 3, fotoCount: 2 }],
    ]);
    const r = ringkasKalender(
      kalender("2026-08", { mulaiKontrak: "2026-01-01", akhirKontrak: "2026-12-31", data }),
    );
    expect(r.selesai).toBe(2); // final + disetujui
    expect(r.dikirim).toBe(1);
    expect(r.draft).toBe(1);
    expect(r.perluKoreksi).toBe(1);
    expect(r.wajib).toBe(17); // 1..17 Agustus
    expect(r.belumAda).toBe(12);
  });
});

describe("saringan status", () => {
  const data = new Map<string, DataHari>([
    ["2026-08-03", { status: "draft", itemCount: 1, fotoCount: 0 }],
    ["2026-08-04", { status: "final", itemCount: 2, fotoCount: 3 }],
  ]);
  const sel = kalender("2026-08", {
    mulaiKontrak: "2026-08-02",
    akhirKontrak: "2026-08-20",
    data,
  });
  const ambil = (k: string) => sel.find((s) => s.dateKey === k)!;

  it("menyorot status yang diminta saja", () => {
    expect(lolosSelSaring(ambil("2026-08-03"), "draft")).toBe(true);
    expect(lolosSelSaring(ambil("2026-08-04"), "draft")).toBe(false);
    expect(lolosSelSaring(ambil("2026-08-04"), "selesai")).toBe(true);
  });

  it('"semua" meloloskan apa pun, termasuk hari di luar kontrak', () => {
    expect(lolosSelSaring(ambil("2026-08-01"), "semua")).toBe(true);
    expect(lolosSelSaring(ambil("2026-08-25"), "semua")).toBe(true);
  });

  it('hari di luar kontrak & yang belum tiba TIDAK cocok dengan "Belum ada"', () => {
    // Kegagalan yang dijaga: menekan "Belum ada" pada bulan depan menyorot 30
    // hari yang belum terjadi seolah semuanya tertinggal. Saringan yang
    // menyorot hal yang salah lebih buruk daripada tidak ada saringan — ia
    // terlihat seperti jawaban.
    expect(ambil("2026-08-01").keadaan).toBe("luar_kontrak");
    expect(lolosSelSaring(ambil("2026-08-01"), "belum")).toBe(false);
    expect(ambil("2026-08-19").keadaan).toBe("belum_tiba");
    expect(lolosSelSaring(ambil("2026-08-19"), "belum")).toBe(false);
    // Yang di dalam kontrak & sudah lewat tetap cocok — itu yang dicari.
    expect(lolosSelSaring(ambil("2026-08-05"), "belum")).toBe(true);
  });

  it('"perlu tindakan" mencakup kosong, draft, dan koreksi', () => {
    expect(lolosSelSaring(ambil("2026-08-05"), "perlu_tindakan")).toBe(true);
    expect(lolosSelSaring(ambil("2026-08-03"), "perlu_tindakan")).toBe(true);
    expect(lolosSelSaring(ambil("2026-08-04"), "perlu_tindakan")).toBe(false);
  });
});

describe("batas navigasi — setiap bulan berdata WAJIB terjangkau", () => {
  it("mundur sampai bulan mulai kontrak", () => {
    const b = batasBulan({
      hariIniKey: "2026-08-17",
      mulaiKontrak: "2026-03-01",
      laporanPertama: null,
      laporanTerakhir: null,
    });
    expect(b.min).toBe("2026-03");
    expect(b.max).toBe("2026-08");
  });

  it("laporan yang lebih TUA dari kontrak tetap terjangkau", () => {
    // Inti berkas ini. Kalau batasnya hanya masa kontrak, data hasil impor yang
    // tanggalnya meleset menjadi mustahil dibuka — dan karena itu mustahil
    // diperbaiki.
    const b = batasBulan({
      hariIniKey: "2026-08-17",
      mulaiKontrak: "2026-03-01",
      laporanPertama: "2025-11-20",
      laporanTerakhir: "2026-08-04",
    });
    expect(b.min).toBe("2025-11");
  });

  it("laporan bertanggal MASA DEPAN tetap terjangkau", () => {
    const b = batasBulan({
      hariIniKey: "2026-08-17",
      mulaiKontrak: "2026-03-01",
      laporanPertama: "2026-03-02",
      laporanTerakhir: "2026-11-09",
    });
    expect(b.max).toBe("2026-11");
  });

  it("tanpa kontrak & tanpa laporan: hanya bulan berjalan", () => {
    const b = batasBulan({
      hariIniKey: "2026-08-17",
      mulaiKontrak: null,
      laporanPertama: null,
      laporanTerakhir: null,
    });
    expect(b).toEqual({ min: "2026-08", max: "2026-08" });
  });

  it("bulan di luar batas dijepit, bukan ditolak", () => {
    const b = { min: "2026-03", max: "2026-08" };
    expect(jepitBulan("2025-01", b)).toBe("2026-03");
    expect(jepitBulan("2030-01", b)).toBe("2026-08");
    expect(jepitBulan("2026-05", b)).toBe("2026-05");
  });

  it("SELURUH rentang antara min dan max bisa dicapai dengan tombol ‹ ›", () => {
    // Bukti jangkauan, bukan sekadar batasnya benar: menekan ‹ berulang dari
    // max harus benar-benar sampai ke min tanpa tersangkut.
    const b = batasBulan({
      hariIniKey: "2026-08-17",
      mulaiKontrak: "2026-03-01",
      laporanPertama: "2025-11-20",
      laporanTerakhir: null,
    });
    const dilalui: string[] = [];
    let kursor = b.max;
    for (let i = 0; i < 40 && kursor > b.min; i++) {
      dilalui.push(kursor);
      kursor = jepitBulan(geserBulan(kursor, -1), b);
    }
    dilalui.push(kursor);
    expect(kursor).toBe(b.min);
    expect(dilalui).toContain("2026-03");
    expect(dilalui).toContain("2025-12");
    expect(new Set(dilalui).size).toBe(dilalui.length); // tidak berputar
  });
});

describe("bentuk daftar — SELURUH rentang, bukan satu bulan", () => {
  const dasar = {
    min: "2026-06",
    max: "2026-08",
    hariIniKey: "2026-08-17",
    mulaiKontrak: "2026-06-15",
    akhirKontrak: "2026-12-31",
    data: KOSONG,
  };

  it("melintasi banyak bulan tanpa bolong dan tanpa duplikat", () => {
    // Inti permintaan user: "jangan hanya 14 hari terakhir".
    const { baris } = susunDaftar(dasar);
    const kunci = baris.map((b) => b.dateKey);
    expect(new Set(kunci).size).toBe(kunci.length);
    // 15–30 Juni (16) + Juli (31) + 1–17 Agustus (17) = 64 hari wajib.
    expect(baris).toHaveLength(64);
    expect(kunci[0]).toBe("2026-06-15");
    expect(kunci.at(-1)).toBe("2026-08-17");
    // Berurutan menaik.
    expect([...kunci].sort()).toEqual(kunci);
  });

  it("hari yang dibuang DIHITUNG, tidak lenyap diam-diam", () => {
    const { baris, disembunyikan } = susunDaftar(dasar);
    // Juni 30 + Juli 31 + Agustus 31 = 92 hari kalender.
    expect(baris.length + disembunyikan).toBe(92);
    expect(disembunyikan).toBe(28); // 1–14 Juni (luar kontrak) + 18–31 Agu (belum tiba)
  });

  it("laporan di luar masa kontrak tetap muncul di daftar", () => {
    const data = new Map<string, DataHari>([
      ["2026-06-02", { status: "final", itemCount: 1, fotoCount: 0 }],
    ]);
    const { baris } = susunDaftar({ ...dasar, data });
    expect(baris.some((b) => b.dateKey === "2026-06-02")).toBe(true);
  });

  it("rentang terbalik tidak menggantung", () => {
    const { baris } = susunDaftar({ ...dasar, min: "2026-08", max: "2026-06" });
    expect(baris).toHaveLength(0);
  });
});

describe("bulanDari", () => {
  it("memotong dateKey ke kunci bulan", () => {
    expect(bulanDari("2026-08-17")).toBe("2026-08");
  });
});
