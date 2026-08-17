// NIAT & BALASAN tanya-jawab WhatsApp bebas (DECISIONS 339).
//
// Dua kegagalan yang dijaga berkas ini adalah kegagalan yang MENGAKU vs
// kegagalan yang MENIPU:
//
//  1. Niat tidak dikenali → balasan "belum saya mengerti" + daftar yang bisa
//     dijawab. Balasan yang terdengar meyakinkan tapi salah jauh lebih merusak,
//     apalagi lewat WhatsApp yang di-screenshot dan diteruskan ke PPK.
//  2. Nama lokasi ambigu → BALIK BERTANYA menyebut kandidatnya. Memilih sendiri
//     menghasilkan jawaban yang BENAR untuk lokasi yang SALAH — dan penanya
//     tidak punya cara mengetahuinya.
//
// Ditambah satu invarian penyajian: pemotongan lingkup dan nama yang tidak
// dikenal WAJIB ikut tercetak di balasan. Jawaban sebagian yang tidak mengaku
// sebagian akan diteruskan apa adanya sebagai jawaban lengkap.
import { describe, expect, it } from "vitest";
import {
  cocokkanLokasi,
  normalNama,
  resolusiLokasi,
  skemaNiat,
  type LokasiKatalog,
} from "@/lib/waha/tanya-niat";
import {
  balasAmbigu,
  balasDeviasi,
  balasKelengkapan,
  balasKendala,
  balasProgress,
  balasTidakMengerti,
} from "@/lib/waha/tanya-format";

const KATALOG: LokasiKatalog[] = [
  { id: "1", nama: "Kedung Mutih" },
  { id: "2", nama: "Kedungmalang" },
  { id: "3", nama: "Tengket" },
  { id: "4", nama: "Batah Timur" },
];

describe("skema niat", () => {
  it("menerima niat null — AI WAJIB boleh mengaku tidak tahu", () => {
    const r = skemaNiat.safeParse({ niat: null, lokasiDisebut: [], periode: "hari_ini" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.niat).toBeNull();
  });

  it("menolak niat yang dikarang di luar daftar", () => {
    // Kalau ini lolos, AI bisa menciptakan niat baru yang tidak ada penanganannya
    // dan jalur balasannya jatuh ke cabang yang salah.
    expect(skemaNiat.safeParse({ niat: "keuangan", lokasiDisebut: [] }).success).toBe(false);
  });

  it("periode default hari_ini", () => {
    const r = skemaNiat.parse({ niat: "kendala", lokasiDisebut: [] });
    expect(r.periode).toBe("hari_ini");
  });

  it("membatasi jumlah lokasi — pesan yang membanjiri tidak jadi kueri raksasa", () => {
    const banyak = Array.from({ length: 21 }, (_, i) => `L${i}`);
    expect(skemaNiat.safeParse({ niat: "progress", lokasiDisebut: banyak }).success).toBe(false);
  });
});

describe("pencocokan nama lokasi", () => {
  it("mengabaikan besar-kecil huruf, tanda baca, dan spasi ganda", () => {
    expect(normalNama("  Kedung   MUTIH! ")).toBe("kedung mutih");
    const c = cocokkanLokasi("kedung mutih", KATALOG);
    expect(c.jenis === "tepat" && c.lokasi.id).toBe("1");
  });

  it("cocok sebagian yang TUNGGAL diterima", () => {
    const c = cocokkanLokasi("tengket", KATALOG);
    expect(c.jenis === "tepat" && c.lokasi.id).toBe("3");
  });

  it("cocok sebagian yang GANDA = ambigu, BUKAN yang pertama", () => {
    // Inti berkas ini. "kedung" cocok ke Kedung Mutih DAN Kedungmalang.
    const c = cocokkanLokasi("kedung", KATALOG);
    expect(c.jenis).toBe("ambigu");
    expect(c.jenis === "ambigu" && c.kandidat.map((k) => k.id).sort()).toEqual(["1", "2"]);
  });

  it("nama yang tidak ada → tidak_ada, bukan tebakan terdekat", () => {
    expect(cocokkanLokasi("Surabaya", KATALOG).jenis).toBe("tidak_ada");
  });

  it("nama kosong tidak mencocoki apa pun", () => {
    // Tanpa penjagaan ini, string kosong "mengandung"-nya SEMUA lokasi.
    expect(cocokkanLokasi("   ", KATALOG).jenis).toBe("tidak_ada");
    expect(cocokkanLokasi("!!!", KATALOG).jenis).toBe("tidak_ada");
  });

  it("resolusi mengumpulkan ketiga hasil tanpa membuang satu pun", () => {
    const r = resolusiLokasi(["Tengket", "kedung", "Surabaya"], KATALOG);
    expect(r.cocok.map((l) => l.id)).toEqual(["3"]);
    expect(r.ambigu.map((a) => a.diketik)).toEqual(["kedung"]);
    expect(r.tidakDikenal).toEqual(["Surabaya"]);
  });

  it("lokasi yang disebut dua kali tidak diduakalikan", () => {
    const r = resolusiLokasi(["Tengket", "tengket"], KATALOG);
    expect(r.cocok).toHaveLength(1);
  });

  it("katalog yang sudah dipotong izin membuat lokasi luar jadi 'tidak dikenal'", () => {
    // Penting: pemotongan izin terjadi SEBELUM pencocokan, sehingga lokasi di
    // luar hak penanya tidak pernah bisa disebut — bahkan namanya.
    const sempit = KATALOG.filter((l) => l.id === "3");
    const r = resolusiLokasi(["Kedung Mutih"], sempit);
    expect(r.cocok).toHaveLength(0);
    expect(r.tidakDikenal).toEqual(["Kedung Mutih"]);
  });
});

describe("balasan yang mengaku, bukan menebak", () => {
  it("tidak mengerti → menyebut yang BISA dijawab", () => {
    const t = balasTidakMengerti();
    expect(t.toLowerCase()).toContain("belum mengerti");
    for (const kata of ["kendala", "progress", "deviasi", "kelengkapan"]) {
      expect(t.toLowerCase(), kata).toContain(kata);
    }
  });

  it("ambigu → menyebut SELURUH kandidat, tidak memilih", () => {
    const t = balasAmbigu([
      { diketik: "kedung", kandidat: [KATALOG[0], KATALOG[1]] },
    ]);
    expect(t).toContain("Kedung Mutih");
    expect(t).toContain("Kedungmalang");
    expect(t.toLowerCase()).toContain("nama lengkap");
  });
});

describe("balasan berdata selalu jujur soal batasnya", () => {
  const opts = {
    catatanPemotongan: "Jawaban ini hanya mencakup Paket X.",
    resolusi: { cocok: [], ambigu: [], tidakDikenal: ["Surabaya"] },
  };

  it("pemotongan lingkup ikut tercetak di SETIAP jenis balasan", () => {
    // Kalau salah satu jenis balasan lupa mencetaknya, jawaban sebagian di grup
    // akan terbaca lengkap — dan diteruskan begitu.
    const semua = [
      balasKendala({ tanggal: "17 Agu 2026", baris: [], lokasiDiperiksa: 2 }, opts),
      balasProgress({ tanggal: "17 Agu 2026", baris: [] }, opts),
      balasDeviasi({ tanggal: "17 Agu 2026", negatif: [], diperiksa: 2 }, opts),
      balasKelengkapan({ tanggal: "17 Agu 2026", perlu: [], total: 0 }, opts),
    ];
    for (const t of semua) {
      expect(t).toContain("Paket X");
      expect(t).toContain("Surabaya");
    }
  });

  it("pemotongan JUMLAH BARIS ikut tercetak di SETIAP jenis balasan", () => {
    // Daftar yang dipotong diam-diam akan dibaca sebagai daftar lengkap —
    // "cuma 15 lokasi yang tertinggal" padahal 40.
    const batas = { catatanBatas: "Ditampilkan 15 dari 40 lokasi." };
    const semua = [
      balasKendala({ tanggal: "17 Agu 2026", baris: [], lokasiDiperiksa: 2 }, batas),
      balasProgress({ tanggal: "17 Agu 2026", baris: [] }, batas),
      balasDeviasi({ tanggal: "17 Agu 2026", negatif: [], diperiksa: 2 }, batas),
      balasKelengkapan({ tanggal: "17 Agu 2026", perlu: [], total: 3 }, batas),
    ];
    for (const t of semua) expect(t).toContain("15 dari 40");
  });

  it("kendala kosong menyebut BERAPA lokasi diperiksa, bukan cuma 'tidak ada'", () => {
    // "Tidak ada kendala" tanpa penyebut bisa berarti "tidak ada lokasi yang
    // diperiksa" — dua kabar yang sangat berbeda.
    const t = balasKendala({ tanggal: "17 Agu 2026", baris: [], lokasiDiperiksa: 5 }, {});
    expect(t).toContain("5 lokasi");
  });

  it("deviasi kosong menyebut penyebutnya", () => {
    const t = balasDeviasi({ tanggal: "17 Agu 2026", negatif: [], diperiksa: 7 }, {});
    expect(t).toContain("7");
  });

  it("deviasi negatif ditulis BERTANDA", () => {
    // "3,20%" dan "−3,20%" dua kabar berbeda; tanda tidak boleh hilang.
    const t = balasDeviasi(
      {
        tanggal: "17 Agu 2026",
        negatif: [{ lokasi: "Tengket", deviasiPct: -3.2, realisasiPct: 40, rencanaPct: 43.2 }],
        diperiksa: 3,
      },
      {},
    );
    expect(t).toContain("−3,20%");
  });

  it("progress menyebut 'belum ada laporan' bila memang belum, bukan 0 item", () => {
    // "0 item" berarti melapor tapi kosong; null berarti belum melapor.
    const t = balasProgress(
      {
        tanggal: "17 Agu 2026",
        baris: [
          { lokasi: "Tengket", realisasiPct: 10, rencanaPct: 12, deviasiPct: -2, itemHariIni: null },
          { lokasi: "Batah Timur", realisasiPct: 20, rencanaPct: 19, deviasiPct: 1, itemHariIni: 0 },
        ],
      },
      {},
    );
    expect(t).toContain("belum ada laporan hari ini");
    expect(t).toContain("0 item dilaporkan hari ini");
  });

  it("kelengkapan menyebut berapa yang beres DARI berapa", () => {
    // Penyebutnya lokasi yang DIPERIKSA, bukan yang dirinci. "1 belum lapor"
    // tanpa penyebut bisa berarti 1 dari 2 atau 1 dari 83.
    const t = balasKelengkapan(
      {
        tanggal: "17 Agu 2026",
        perlu: [{ lokasi: "B", status: "Belum ada laporan", perluTindakan: true }],
        total: 2,
      },
      {},
    );
    expect(t).toContain("1 dari 2");
    expect(t).toContain("B");
  });

  it("kelengkapan tanpa yang perlu ditindak tetap membawa penyebut", () => {
    const t = balasKelengkapan({ tanggal: "17 Agu 2026", perlu: [], total: 9 }, {});
    expect(t).toContain("9 dari 9");
    expect(t.toLowerCase()).toContain("sudah melapor");
  });

  it("kendala menuliskan STATUS tiap baris — 'sudah ada yang pegang' tidak hilang", () => {
    const t = balasKendala(
      {
        tanggal: "17 Agu 2026",
        baris: [
          { lokasi: "Tengket", judul: "Material telat", tingkat: "kritis", status: "ditangani", umurHari: 4 },
        ],
        lokasiDiperiksa: 1,
      },
      {},
    );
    expect(t).toContain("ditangani");
    expect(t).toContain("kritis");
    expect(t).toContain("4 hari");
  });

  it("tanpa pemotongan & tanpa nama asing, tidak ada kaki yang mengganggu", () => {
    const t = balasKelengkapan({ tanggal: "17 Agu 2026", perlu: [], total: 0 }, {});
    expect(t).not.toContain("⚠️");
    expect(t).not.toContain("ℹ️");
  });
});
