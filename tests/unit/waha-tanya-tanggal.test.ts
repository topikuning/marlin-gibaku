// PERIODE PERTANYAAN WHATSAPP → TANGGAL NYATA (DECISIONS 356).
//
// Permintaan user 2026-08-17: *"mulai dari minta laporan harian, progress
// tanggal tertentu atau kemarin, kemarin lusa … aku ingin marlin seluwes itu"*.
//
// Kelenturan itu bertumpu pada satu hal: AI menyebut BENTUK yang ia baca, dan
// seluruh aritmetika tanggal dikerjakan di sini. Karena itu berkas ini menguji
// hal-hal yang model tidak akan pernah andal mengerjakannya sendiri — panjang
// bulan, pergantian tahun, tahun kabisat, dan batas "belum terjadi".
import { describe, expect, it } from "vitest";
import { bacaPeriode, daftarTanggal, keKey, keTitik, pekanDari } from "@/lib/waha/tanya-tanggal";

const HARI_INI = "2026-08-17"; // Senin

describe("periode relatif", () => {
  it("tanpa periode / hari_ini → hari ini", () => {
    for (const p of [null, undefined, { jenis: "hari_ini" } as const]) {
      const r = bacaPeriode(p, HARI_INI);
      expect(r.mulai).toBe(HARI_INI);
      expect(r.akhir).toBe(HARI_INI);
      expect(r.satuHari).toBe(true);
    }
  });

  it("kemarin & kemarin lusa", () => {
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 1 }, HARI_INI).mulai).toBe("2026-08-16");
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 2 }, HARI_INI).mulai).toBe("2026-08-15");
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 1 }, HARI_INI).label).toBe("kemarin");
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 2 }, HARI_INI).label).toBe("kemarin lusa");
  });

  it("mundur melewati AWAL BULAN dan AWAL TAHUN", () => {
    // Aritmetika yang paling sering salah kalau diserahkan ke model.
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 1 }, "2026-03-01").mulai).toBe("2026-02-28");
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 1 }, "2026-01-01").mulai).toBe("2025-12-31");
    // 2024 kabisat: 1 Maret mundur satu hari = 29 Februari.
    expect(bacaPeriode({ jenis: "mundur_hari", hari: 1 }, "2024-03-01").mulai).toBe("2024-02-29");
  });

  it("mundur nol / negatif TIDAK pernah jadi tanggal depan", () => {
    // Jalan paling mudah menjawab hari yang belum terjadi.
    for (const hari of [0, -1, -99]) {
      expect(bacaPeriode({ jenis: "mundur_hari", hari }, HARI_INI).mulai, String(hari)).toBe(HARI_INI);
    }
  });
});

describe("rentang minggu & bulan", () => {
  it("minggu ini dimulai SENIN, dan dipotong di hari ini", () => {
    // 2026-08-19 = Rabu.
    const r = bacaPeriode({ jenis: "rentang", satuan: "minggu", mundur: 0 }, "2026-08-19");
    expect(r.mulai).toBe("2026-08-17"); // Senin
    expect(r.akhir).toBe("2026-08-19"); // hari ini, bukan Minggu depan
    expect(r.catatan).toContain("sampai hari ini");
  });

  it("minggu lalu utuh Senin–Minggu, tanpa catatan pemotongan", () => {
    const r = bacaPeriode({ jenis: "rentang", satuan: "minggu", mundur: 1 }, "2026-08-19");
    expect(r.mulai).toBe("2026-08-10");
    expect(r.akhir).toBe("2026-08-16");
    expect(r.catatan).toBeNull();
    expect(r.satuHari).toBe(false);
  });

  it("bulan ini dipotong di hari ini; bulan lalu utuh", () => {
    const ini = bacaPeriode({ jenis: "rentang", satuan: "bulan", mundur: 0 }, HARI_INI);
    expect(ini.mulai).toBe("2026-08-01");
    expect(ini.akhir).toBe(HARI_INI);
    const lalu = bacaPeriode({ jenis: "rentang", satuan: "bulan", mundur: 1 }, HARI_INI);
    expect(lalu.mulai).toBe("2026-07-01");
    expect(lalu.akhir).toBe("2026-07-31"); // Juli 31 hari
    expect(lalu.catatan).toBeNull();
  });

  it("panjang bulan yang berbeda-beda benar", () => {
    expect(bacaPeriode({ jenis: "rentang", satuan: "bulan", mundur: 1 }, "2026-03-10").akhir).toBe("2026-02-28");
    expect(bacaPeriode({ jenis: "rentang", satuan: "bulan", mundur: 1 }, "2024-03-10").akhir).toBe("2024-02-29");
    expect(bacaPeriode({ jenis: "rentang", satuan: "bulan", mundur: 8 }, "2026-08-17").mulai).toBe("2025-12-01");
  });
});

describe("tanggal yang DITULIS penanya", () => {
  it("tanggal + bulan lengkap", () => {
    const r = bacaPeriode({ jenis: "tanggal", hari: 3, bulan: 7, tahun: null }, HARI_INI);
    expect(r.mulai).toBe("2026-07-03");
    expect(r.label).toBe("3 Juli 2026");
  });

  it("tahun tidak disebut & tanggalnya masih DI DEPAN → tahun lalu", () => {
    /*
     * "progress 20 desember" yang ditanya Agustus 2026 berarti Desember 2025.
     * Menebak ke depan menjawab hari yang belum terjadi, dan jawabannya kosong
     * — terbaca seperti "tidak ada pekerjaan", bukan "salah tahun".
     */
    const r = bacaPeriode({ jenis: "tanggal", hari: 20, bulan: 12, tahun: null }, HARI_INI);
    expect(r.mulai).toBe("2025-12-20");
  });

  it("tanggal saja (bulan tidak disebut) memakai bulan berjalan", () => {
    expect(bacaPeriode({ jenis: "tanggal", hari: 5, bulan: null, tahun: null }, HARI_INI).mulai).toBe(
      "2026-08-05",
    );
  });

  it("tahun DISEBUT dipakai apa adanya, walau di depan — tapi diberi catatan", () => {
    const r = bacaPeriode({ jenis: "tanggal", hari: 1, bulan: 12, tahun: 2027 }, HARI_INI);
    expect(r.mulai).toBe("2027-12-01");
    expect(r.catatan).toContain("belum terjadi");
  });

  it("tanggal yang TIDAK ADA di kalender ditolak, bukan digulung diam-diam", () => {
    // Date.UTC menggulung 31 Februari jadi 2/3 Maret tanpa mengeluh — persis
    // jenis "perbaikan" diam-diam yang dilarang di proyek ini.
    const r = bacaPeriode({ jenis: "tanggal", hari: 31, bulan: 2, tahun: 2026 }, HARI_INI);
    expect(r.mulai).toBe(HARI_INI);
    expect(r.catatan).toContain("tidak ada di kalender");
  });

  it("angka di luar akal ditolak", () => {
    for (const p of [
      { jenis: "tanggal", hari: 0, bulan: 5, tahun: null },
      { jenis: "tanggal", hari: 32, bulan: 5, tahun: null },
      { jenis: "tanggal", hari: 5, bulan: 13, tahun: null },
    ] as const) {
      const r = bacaPeriode(p, HARI_INI);
      expect(r.mulai, JSON.stringify(p)).toBe(HARI_INI);
      expect(r.catatan, JSON.stringify(p)).not.toBeNull();
    }
  });
});

describe("penolong tanggal", () => {
  it("keTitik menolak bentuk yang bukan tanggal", () => {
    expect(keTitik("2026-02-30")).toBeNull();
    expect(keTitik("17-08-2026")).toBeNull();
    expect(keTitik("bukan tanggal")).toBeNull();
    expect(keTitik("2026-08-17")).not.toBeNull();
  });

  it("keKey ↔ keTitik bolak-balik", () => {
    for (const k of ["2026-01-01", "2024-02-29", "2026-12-31"]) {
      expect(keKey(keTitik(k)!)).toBe(k);
    }
  });

  it("daftarTanggal mencakup kedua ujung, dan berbatas", () => {
    const p = bacaPeriode({ jenis: "rentang", satuan: "minggu", mundur: 1 }, "2026-08-19");
    const d = daftarTanggal(p);
    expect(d).toHaveLength(7);
    expect(d[0]).toBe("2026-08-10");
    expect(d[6]).toBe("2026-08-16");
    // Batas menjaga rentang panjang tidak meledak jadi ratusan query.
    expect(daftarTanggal(bacaPeriode({ jenis: "rentang", satuan: "bulan", mundur: 1 }, HARI_INI), 5)).toHaveLength(5);
  });
});

describe("pekan untuk niat laporan mingguan (DECISIONS 358)", () => {
  /*
   * Keluhan user 2026-08-18: *"gak jelas apa yang kuminta, sistem kasih apa"* —
   * ia meminta laporan MINGGUAN dan menerima kotak berjudul "Laporan harian"
   * berisi satu hari, berlabel "minggu lalu".
   *
   * Salah satu sebabnya di sini: rentang yang diminta harus jadi PEKAN PENUH,
   * berapa pun bentuk periode yang ditulis penanya.
   */
  it("periode satu hari jadi pekan yang memuat hari itu", () => {
    // 2026-08-05 = Rabu → pekan Senin 3 s/d Minggu 9 Agustus.
    const p = pekanDari(bacaPeriode({ jenis: "tanggal", hari: 5, bulan: 8, tahun: 2026 }, HARI_INI), HARI_INI);
    expect(p.mulai).toBe("2026-08-03");
    expect(p.akhir).toBe("2026-08-09");
    expect(p.satuHari).toBe(false);
  });

  it("tanpa periode → pekan BERJALAN, dipotong di hari ini", () => {
    // HARI_INI = 2026-08-17 (Senin), jadi pekannya baru satu hari.
    const p = pekanDari(bacaPeriode(null, HARI_INI), HARI_INI);
    expect(p.mulai).toBe("2026-08-17");
    expect(p.akhir).toBe("2026-08-17");
    expect(p.catatan).toContain("Pekan berjalan");
  });

  it("'minggu lalu' tetap pekan utuh Senin–Minggu, tanpa catatan pemotongan", () => {
    const p = pekanDari(bacaPeriode({ jenis: "rentang", satuan: "minggu", mundur: 1 }, HARI_INI), HARI_INI);
    expect(p.mulai).toBe("2026-08-10");
    expect(p.akhir).toBe("2026-08-16");
    expect(p.catatan).toBeNull();
  });

  it("'kemarin' jadi pekan yang memuat kemarin, bukan satu hari", () => {
    // Kemarin = Minggu 16 Agustus → pekan 10–16 Agustus.
    const p = pekanDari(bacaPeriode({ jenis: "mundur_hari", hari: 1 }, HARI_INI), HARI_INI);
    expect(p.mulai).toBe("2026-08-10");
    expect(p.akhir).toBe("2026-08-16");
  });

  it("labelnya menyebut RENTANG TANGGALNYA, bukan kata relatif", () => {
    /*
     * "minggu lalu" berarti berbeda tergantung kapan dibaca, dan balasan
     * WhatsApp dibaca lagi berhari-hari kemudian — sering setelah diteruskan.
     */
    const p = pekanDari(bacaPeriode({ jenis: "rentang", satuan: "minggu", mundur: 1 }, HARI_INI), HARI_INI);
    expect(p.label).toContain("10 Agustus 2026");
    expect(p.label).toContain("16 Agustus 2026");
  });

  it("pekan tidak pernah melewati hari ini", () => {
    for (const p of [
      bacaPeriode(null, HARI_INI),
      bacaPeriode({ jenis: "mundur_hari", hari: 1 }, HARI_INI),
      bacaPeriode({ jenis: "rentang", satuan: "minggu", mundur: 0 }, HARI_INI),
    ]) {
      expect(pekanDari(p, HARI_INI).akhir <= HARI_INI).toBe(true);
    }
  });
});
