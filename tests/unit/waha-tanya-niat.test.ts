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

const lok = (
  id: string,
  nama: string,
  kabupaten: string,
  provinsi: string,
  kecamatan: string | null = null,
): LokasiKatalog => ({ id, nama, desa: nama, kecamatan, kabupaten, provinsi });

const KATALOG: LokasiKatalog[] = [
  lok("1", "Kedung Mutih", "Demak", "Jawa Tengah"),
  lok("2", "Kedungmalang", "Jepara", "Jawa Tengah"),
  lok("3", "Tengket", "Bangkalan", "Jawa Timur"),
  lok("4", "Batah Timur", "Bangkalan", "Jawa Timur"),
];

describe("skema niat", () => {
  it("menerima niat null – AI WAJIB boleh mengaku tidak tahu", () => {
    const r = skemaNiat.safeParse({ niat: null, lokasiDisebut: [], periode: { jenis: "hari_ini" } });
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
    expect(r.periode).toEqual({ jenis: "hari_ini" });
  });

  it("periode bentuk BARU dibaca apa adanya (DECISIONS 356)", () => {
    const r = skemaNiat.parse({
      niat: "progress",
      lokasiDisebut: [],
      periode: { jenis: "mundur_hari", hari: 2 },
    });
    expect(r.periode).toEqual({ jenis: "mundur_hari", hari: 2 });
  });

  it("bentuk LAMA berupa string tetap diterima, tidak menggagalkan parse", () => {
    // Skema ini memeriksa keluaran MODEL, bukan masukan program kita. Satu kata
    // yang meleset tidak boleh membuat penanya menerima "AI tidak bisa membaca
    // pertanyaan" — padahal niatnya sudah terbaca benar.
    const r = skemaNiat.parse({ niat: "kendala", lokasiDisebut: [], periode: "hari_ini" });
    expect(r.periode).toEqual({ jenis: "hari_ini" });
  });

  it("periode yang TIDAK DIKENAL jatuh ke hari ini, bukan gagal total", () => {
    for (const aneh of ["minggu_depan", 42, { jenis: "entah" }, { jenis: "mundur_hari" }]) {
      const r = skemaNiat.safeParse({ niat: "progress", lokasiDisebut: [], periode: aneh });
      expect(r.success, JSON.stringify(aneh)).toBe(true);
      expect(r.success && r.data.periode, JSON.stringify(aneh)).toEqual({ jenis: "hari_ini" });
    }
  });

  it("membatasi jumlah lokasi – pesan yang membanjiri tidak jadi kueri raksasa", () => {
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

  it("nama KABUPATEN dikenali, bukan dijawab 'tidak menemukan lokasi'", () => {
    /*
     * Keluhan user 2026-08-19: *"apa jember kemarin laporan?"* dijawab "Saya
     * tidak menemukan lokasi: jember. Mungkin salah ketik" — padahal Jember
     * kabupaten, dan lokasinya ada. Orang lapangan menyebut daerah, bukan cuma
     * nama titik proyek (DECISIONS 367).
     */
    const c = cocokkanLokasi("Bangkalan", KATALOG);
    expect(c.jenis).toBe("wilayah");
    expect(c.jenis === "wilayah" && c.wilayah.tingkat).toBe("kabupaten");
    expect(c.jenis === "wilayah" && c.wilayah.lokasi.map((l) => l.id).sort()).toEqual(["3", "4"]);
  });

  it("nama PROVINSI juga dikenali", () => {
    const c = cocokkanLokasi("jawa tengah", KATALOG);
    expect(c.jenis === "wilayah" && c.wilayah.tingkat).toBe("provinsi");
    expect(c.jenis === "wilayah" && c.wilayah.lokasi.map((l) => l.id).sort()).toEqual(["1", "2"]);
  });

  it("awalan 'kabupaten'/'kab.' diabaikan di kedua sisi", () => {
    // Penanya menulis sesukanya; data menyimpan "Bangkalan" polos.
    for (const ketik of ["Kabupaten Bangkalan", "kab. bangkalan", "KAB BANGKALAN"]) {
      const c = cocokkanLokasi(ketik, KATALOG);
      expect(c.jenis, ketik).toBe("wilayah");
    }
  });

  it("wilayah berisi SATU lokasi = sama saja menyebut lokasinya", () => {
    // Tidak perlu berkata "Kabupaten Demak — 1 lokasi"; itu cerewet tanpa guna.
    const c = cocokkanLokasi("Demak", KATALOG);
    expect(c.jenis === "tepat" && c.lokasi.id).toBe("1");
  });

  it("nama LOKASI menang atas nama wilayah – yang khusus mengalahkan yang luas", () => {
    // Kalau ada lokasi yang namanya persis "Demak", itulah yang dimaksud,
    // bukan seluruh Kabupaten Demak.
    const katalog = [...KATALOG, lok("5", "Demak", "Demak", "Jawa Tengah")];
    const c = cocokkanLokasi("Demak", katalog);
    expect(c.jenis === "tepat" && c.lokasi.id).toBe("5");
  });

  it("satu kata cocok di DUA tingkat dengan isi berbeda → balik bertanya", () => {
    /*
     * Kecamatan Bangkalan (1 lokasi) di dalam Kabupaten Bangkalan (2 lokasi).
     * Memilih sendiri menghasilkan jawaban yang benar untuk daerah yang salah,
     * dan penanya tidak punya cara mengetahuinya.
     */
    const katalog = [
      lok("3", "Tengket", "Bangkalan", "Jawa Timur", "Bangkalan"),
      lok("4", "Batah Timur", "Bangkalan", "Jawa Timur", "Arosbaya"),
    ];
    const c = cocokkanLokasi("Bangkalan", katalog);
    expect(c.jenis).toBe("ambigu_wilayah");
    expect(c.jenis === "ambigu_wilayah" && c.pilihan.map((p) => p.tingkat)).toEqual([
      "kecamatan",
      "kabupaten",
    ]);
  });

  it("dua tingkat yang isinya PERSIS SAMA tidak jadi pertanyaan tanpa beda", () => {
    /*
     * Desa Sepulu di Kecamatan Sepulu: satu lokasi yang sama, dua tingkat.
     * Bertanya "maksud Anda desa atau kecamatan?" tidak menambah apa pun.
     *
     * Nama lokasinya sengaja BUKAN "Sepulu" — kalau sama, lapis nama sudah
     * menjawab lebih dulu dan uji ini lolos tanpa pernah menyentuh jalur yang
     * dimaksud.
     */
    const katalog = [
      { ...lok("3", "Tanjung Bumi", "Bangkalan", "Jawa Timur", "Sepulu"), desa: "Sepulu" },
      lok("4", "Batah Timur", "Bangkalan", "Jawa Timur", "Arosbaya"),
    ];
    const c = cocokkanLokasi("Sepulu", katalog);
    expect(c.jenis === "tepat" && c.lokasi.id).toBe("3");
  });

  it("resolusi mencatat perluasan wilayah supaya balasan bisa mengakuinya", () => {
    const r = resolusiLokasi(["Bangkalan"], KATALOG);
    expect(r.cocok.map((l) => l.id).sort()).toEqual(["3", "4"]);
    expect(r.wilayah).toEqual([
      { diketik: "Bangkalan", tingkat: "kabupaten", nama: "Bangkalan", jumlah: 2 },
    ]);
  });

  it("wilayah di luar izin penanya tetap tidak dikenal", () => {
    // Pemotongan izin terjadi SEBELUM pencocokan; menyebut kabupaten tidak
    // boleh jadi jalan pintas melewatinya.
    const sempit = KATALOG.filter((l) => l.id === "3");
    const r = resolusiLokasi(["Jawa Tengah"], sempit);
    expect(r.cocok).toHaveLength(0);
    expect(r.tidakDikenal).toEqual(["Jawa Tengah"]);
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

  it("ambigu antar TINGKAT wilayah menyebut jumlah lokasinya", () => {
    // Jumlah lokasi itulah beda yang menentukan pilihan penanya; tanpa angka
    // itu kedua pilihan terlihat sama saja.
    const t = balasAmbigu(
      [],
      [
        {
          diketik: "Bangkalan",
          pilihan: [
            { tingkat: "kecamatan", nama: "Bangkalan", lokasi: [KATALOG[2]] },
            { tingkat: "kabupaten", nama: "Bangkalan", lokasi: [KATALOG[2], KATALOG[3]] },
          ],
        },
      ],
    );
    expect(t).toContain("Kecamatan Bangkalan (1 lokasi)");
    expect(t).toContain("Kabupaten Bangkalan (2 lokasi)");
  });
});

describe("balasan berdata selalu jujur soal batasnya", () => {
  const opts = {
    catatanPemotongan: "Jawaban ini hanya mencakup Paket X.",
    resolusi: {
      cocok: [],
      wilayah: [],
      ambigu: [],
      ambiguWilayah: [],
      tidakDikenal: ["Surabaya"],
    },
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

  it("perluasan WILAYAH ikut tercetak di SETIAP jenis balasan", () => {
    /*
     * Menjawab 2 lokasi untuk pertanyaan yang menyebut satu kata — tanpa
     * mengatakan kata itu sebuah kabupaten — membuat penanya mengira ia sedang
     * membaca angka SATU lokasi. Di WhatsApp balasan itu di-screenshot dan
     * diteruskan apa adanya ke PPK (DECISIONS 367).
     */
    const w = {
      resolusi: {
        cocok: [KATALOG[2], KATALOG[3]],
        wilayah: [
          { diketik: "bangkalan", tingkat: "kabupaten" as const, nama: "Bangkalan", jumlah: 2 },
        ],
        ambigu: [],
        ambiguWilayah: [],
        tidakDikenal: [],
      },
    };
    const semua = [
      balasKendala({ tanggal: "17 Agu 2026", baris: [], lokasiDiperiksa: 2 }, w),
      balasProgress({ tanggal: "17 Agu 2026", baris: [] }, w),
      balasDeviasi({ tanggal: "17 Agu 2026", negatif: [], diperiksa: 2 }, w),
      balasKelengkapan({ tanggal: "17 Agu 2026", perlu: [], total: 0 }, w),
    ];
    for (const t of semua) {
      expect(t).toContain("Kabupaten Bangkalan");
      expect(t).toContain("2 lokasi");
    }
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
    /*
     * TANPA kata "hari ini" (DECISIONS 390): balasan yang sama dipakai untuk
     * pertanyaan hari lain, dan versi lama menulis "dilaporkan HARI INI" pada
     * jawaban "kemarin lusa" – hari yang salah ditempelkan pada angka yang
     * benar. Harinya sudah disebut sekali di kepala balasan.
     */
    expect(t).toContain("belum ada laporan");
    expect(t).toContain("0 item dilaporkan");
    expect(t).not.toContain("hari ini");
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

  it("kendala menuliskan STATUS tiap baris – 'sudah ada yang pegang' tidak hilang", () => {
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

describe("nama lokasi bespasi vs menyatu (DECISIONS 390)", () => {
  /*
   * Dilaporkan user 2026-08-20 dengan tangkapan layar: *"aku sengaja ketik
   * randu putih, seharusnya randuputih malah daerahnya kemana-mana"*.
   *
   * Yang terjadi: "randu putih" tidak cocok dengan apa pun, pertanyaannya
   * jatuh ke jalur catatan lapangan, lalu dijawab dengan catatan lokasi LAIN
   * (Betahwalang, Kedungmutih, Purworejo) – tanpa satu pun tanda bahwa nama
   * yang ia tulis tidak dikenali. Jawaban yang sepenuhnya nyambung ke
   * pertanyaan yang tidak diajukan.
   */
  const kat: LokasiKatalog[] = [
    { id: "1", nama: "Randuputih", desa: "Randuputih", kecamatan: "Dringu", kabupaten: "Probolinggo", provinsi: "Jawa Timur" },
    { id: "2", nama: "Batah Timur", desa: "Batah Timur", kecamatan: null, kabupaten: "Bangkalan", provinsi: "Jawa Timur" },
  ];

  it('"randu putih" cocok ke Randuputih', () => {
    const r = cocokkanLokasi("randu putih", kat);
    expect(r.jenis).toBe("tepat");
    if (r.jenis === "tepat") expect(r.lokasi.nama).toBe("Randuputih");
  });

  it('sebaliknya juga: "batahtimur" cocok ke Batah Timur', () => {
    const r = cocokkanLokasi("batahtimur", kat);
    expect(r.jenis).toBe("tepat");
    if (r.jenis === "tepat") expect(r.lokasi.nama).toBe("Batah Timur");
  });

  it("nama yang memang bespasi tetap menang lebih dulu", () => {
    // Pencocokan rapat adalah lapis TERAKHIR; ia tidak boleh menyalip
    // pencocokan biasa yang sudah benar.
    const r = cocokkanLokasi("Batah Timur", kat);
    expect(r.jenis).toBe("tepat");
    if (r.jenis === "tepat") expect(r.lokasi.nama).toBe("Batah Timur");
  });

  it("nama asing tetap TIDAK cocok – bukan dipaksakan ke yang terdekat", () => {
    expect(cocokkanLokasi("zxqwerty", kat).jenis).toBe("tidak_ada");
  });
});
