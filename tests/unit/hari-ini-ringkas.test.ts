// PELAPORAN HARIAN: strip, saringan, dan ringkasan (DECISIONS 336, dikoreksi 337).
//
// Lapisan murni ini melayani DUA halaman dengan tugas berbeda — /hari-ini
// (alat kerja pelaksana) dan /lokasi/{slug}/harian (pemantauan satu lokasi).
// Janji yang dikunci di sini, semuanya cacat SENYAP kalau dilanggar: halamannya
// tetap tampil rapi, angkanya tetap keluar, hanya artinya yang salah.
//
//  1. Angka ringkasan SELALU membawa penyebutnya. "8" sendirian tidak bisa
//     ditindaklanjuti; 8 dari 14 dan 8 dari 8 dua kabar berbeda.
//  2. Tidak ada dua status yang kata atau hurufnya kembar. Konsep yang
//     diusulkan user memakai "F" untuk Final dan "S" untuk Setuju sambil
//     MEWARNAI keduanya sama, sehingga keduanya tak terbedakan sama sekali.
//  3. Status selalu punya KATA, tidak pernah warna saja — HP murah di bawah
//     matahari, dan buta warna merah-hijau ada pada ±8% laki-laki.
//  4. Saringan yang tidak dikenal jatuh ke "semua", tidak menyembunyikan
//     semuanya; dan saringan sempit bersama-sama menutupi seluruh status.
//  5. "Perlu tindakan" pada LOKASI hanya melihat hari ini + koreksi tertunda,
//     sedangkan pada DAFTAR RIWAYAT ia juga melihat hari lampau. Perbedaan itu
//     disengaja: mandor tidak bisa mengisi hari yang sudah lewat dari /hari-ini,
//     tapi halaman riwayat justru dibuka untuk menambalnya.
import { describe, expect, it, vi } from "vitest";
import type { DailyReportStatus } from "@/generated/prisma/enums";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

const {
  bacaSaringHarian,
  hurufUnik,
  kalimatTindakan,
  lolosSaringHarian,
  perluTindakan,
  ringkasHari,
  selHari,
  urutkanLokasi,
} = await import("@/lib/daily-report/hari-ini-ringkas");
type HariIniLocation = import("@/lib/daily-report/queries").HariIniLocation;

const SEMUA_STATUS: DailyReportStatus[] = [
  "draft",
  "dikirim",
  "perlu_koreksi",
  "disetujui",
  "final",
];

/** Lokasi uji: `hari` = tujuh status, urut lama → hari ini. */
function lok(
  nama: string,
  hari: (DailyReportStatus | null)[],
  koreksi: string[] = [],
): HariIniLocation {
  return {
    id: nama,
    slug: nama.toLowerCase(),
    name: nama,
    village: "Desa",
    regency: "Kab",
    todayDraftItemCount: null,
    todayStatus: hari[hari.length - 1] ?? null,
    corrections: koreksi.map((d) => ({ dateKey: d, itemCount: 1, reason: null })),
    weeklyTargets: [],
    weekNumber: 3,
    last7Days: hari.map((status, i) => ({
      dateKey: `2026-08-${String(10 + i).padStart(2, "0")}`,
      status,
      itemCount: status ? 2 : 0,
    })),
  };
}

const F: DailyReportStatus = "final";

describe("angka ringkasan selalu membawa penyebutnya", () => {
  const hari = (...s: (DailyReportStatus | null)[]) => s.map((status) => ({ status }));

  it("total = jumlah hari, dan seluruh hari terhitung tepat sekali", () => {
    const r = ringkasHari(hari(F, F, "draft", null, "perlu_koreksi", "dikirim", "disetujui"));
    expect(r.total).toBe(7);
    // Tidak ada hari yang hilang atau dihitung dua kali — inilah yang membuat
    // penyebutnya bisa dipercaya.
    expect(r.perluKoreksi + r.belumAda + r.draft + r.dikirim + r.selesai).toBe(r.total);
  });

  it("mencacah tiap status ke lajurnya sendiri", () => {
    const r = ringkasHari(hari(F, "disetujui", "dikirim", "draft", "perlu_koreksi", null, F));
    expect(r.selesai).toBe(3); // final ×2 + disetujui
    expect(r.dikirim).toBe(1);
    expect(r.draft).toBe(1);
    expect(r.perluKoreksi).toBe(1);
    expect(r.belumAda).toBe(1);
  });

  it("tanpa hari, penyebutnya nol – bukan angka karangan", () => {
    const r = ringkasHari([]);
    expect(r.total).toBe(0);
    expect(r.selesai).toBe(0);
  });
});

describe("saringan daftar harian satu lokasi", () => {
  it("nilai saringan yang tidak dikenal jatuh ke 'semua', bukan menyembunyikan semuanya", () => {
    // Alamat yang diketik salah tidak boleh menghasilkan halaman kosong yang
    // terbaca "tidak ada laporan".
    expect(bacaSaringHarian(undefined)).toBe("semua");
    expect(bacaSaringHarian("ngawur")).toBe("semua");
    expect(bacaSaringHarian("draft")).toBe("draft");
  });

  it("'semua' meloloskan setiap status", () => {
    for (const s of [...SEMUA_STATUS, null]) {
      expect(lolosSaringHarian(s, "semua"), String(s)).toBe(true);
    }
  });

  it("'perlu tindakan' = belum ada, draft, atau koreksi", () => {
    // Sengaja BERBEDA dengan perluTindakan(lokasi): ini daftar riwayat, jadi
    // hari lampau yang kosong memang relevan — halaman ini dibuka justru untuk
    // menambalnya.
    expect(lolosSaringHarian(null, "perlu_tindakan")).toBe(true);
    expect(lolosSaringHarian("draft", "perlu_tindakan")).toBe(true);
    expect(lolosSaringHarian("perlu_koreksi", "perlu_tindakan")).toBe(true);
    expect(lolosSaringHarian("final", "perlu_tindakan")).toBe(false);
    expect(lolosSaringHarian("dikirim", "perlu_tindakan")).toBe(false);
  });

  it("'selesai' mencakup dikirim, disetujui, dan final", () => {
    expect(lolosSaringHarian("dikirim", "selesai")).toBe(true);
    expect(lolosSaringHarian("disetujui", "selesai")).toBe(true);
    expect(lolosSaringHarian("final", "selesai")).toBe(true);
    expect(lolosSaringHarian("draft", "selesai")).toBe(false);
    expect(lolosSaringHarian(null, "selesai")).toBe(false);
  });

  it("setiap saringan sempit adalah HIMPUNAN BAGIAN dari 'semua'", () => {
    // Menjamin tidak ada saringan yang meloloskan sesuatu yang bahkan tidak
    // ada di daftar penuh — cacat yang membuat cacah di tombol tidak cocok
    // dengan isi daftarnya.
    const sempit = ["perlu_tindakan", "belum", "draft", "koreksi", "selesai"] as const;
    for (const s of sempit) {
      for (const st of [...SEMUA_STATUS, null]) {
        if (lolosSaringHarian(st, s)) expect(lolosSaringHarian(st, "semua"), `${s}/${st}`).toBe(true);
      }
    }
  });

  it("saringan sempit bersama-sama menutupi seluruh status, tanpa ada yang tercecer", () => {
    // Kalau ada status yang tidak masuk saringan mana pun, ia hanya bisa
    // ditemukan lewat "Semua" — dan orang tidak akan tahu ia ada.
    for (const st of [...SEMUA_STATUS, null]) {
      const masuk = (["belum", "draft", "koreksi", "selesai"] as const).some((s) =>
        lolosSaringHarian(st, s),
      );
      expect(masuk, String(st)).toBe(true);
    }
  });
});

describe("penanda status tidak pernah bergantung warna saja", () => {
  it("setiap status punya KATA yang tidak kosong", () => {
    for (const s of SEMUA_STATUS) {
      expect(selHari("2026-08-16", s, "Minggu, 16 Agu").kata.trim().length).toBeGreaterThan(0);
    }
    expect(selHari("2026-08-16", null, "Minggu, 16 Agu").kata.trim().length).toBeGreaterThan(0);
  });

  it("tidak ada dua status yang KATA-nya kembar", () => {
    const kata = SEMUA_STATUS.map((s) => selHari("2026-08-16", s, "x").kata);
    kata.push(selHari("2026-08-16", null, "x").kata);
    expect(new Set(kata).size).toBe(kata.length);
  });

  it("tidak ada dua status yang HURUF matriksnya kembar", () => {
    // Cacat persis pada konsep yang diusulkan: "F" (Final) dan "S" (Setuju)
    // dicat kelas warna yang sama, jadi di matriks keduanya tak terbedakan.
    expect(hurufUnik()).toBe(true);
    const huruf = SEMUA_STATUS.map((s) => selHari("2026-08-16", s, "x").huruf);
    huruf.push(selHari("2026-08-16", null, "x").huruf);
    expect(new Set(huruf).size).toBe(huruf.length);
  });

  it("judul sel menyebut tanggal DAN keadaannya – untuk pembaca layar", () => {
    const s = selHari("2026-08-16", "perlu_koreksi", "Minggu, 16 Agu");
    expect(s.judul).toContain("Minggu, 16 Agu");
    expect(s.judul.toLowerCase()).toContain("koreksi");
    const kosong = selHari("2026-08-11", null, "Selasa, 11 Agu");
    expect(kosong.judul.toLowerCase()).toContain("belum ada laporan");
  });

  it("hanya draft, perlu koreksi, dan belum ada yang menuntut tindakan", () => {
    expect(selHari("x", "draft", "x").perluTindakan).toBe(true);
    expect(selHari("x", "perlu_koreksi", "x").perluTindakan).toBe(true);
    expect(selHari("x", null, "x").perluTindakan).toBe(true);
    expect(selHari("x", "final", "x").perluTindakan).toBe(false);
    expect(selHari("x", "disetujui", "x").perluTindakan).toBe(false);
    expect(selHari("x", "dikirim", "x").perluTindakan).toBe(false);
  });
});

describe("perlu tindakan = hari ini + koreksi tertunda, bukan seluruh 7 hari", () => {
  it("hari kemarin yang kosong TIDAK menandai lokasi perlu tindakan", () => {
    // Mandor tidak bisa mengisi hari yang sudah lewat. Menandainya setiap hari
    // membuat penanda itu selalu menyala dan kehilangan arti.
    expect(perluTindakan(lok("A", [null, null, F, F, F, F, F]))).toBe(false);
  });

  it("hari ini kosong / draft / koreksi menandai perlu tindakan", () => {
    expect(perluTindakan(lok("A", [F, F, F, F, F, F, null]))).toBe(true);
    expect(perluTindakan(lok("A", [F, F, F, F, F, F, "draft"]))).toBe(true);
    expect(perluTindakan(lok("A", [F, F, F, F, F, F, "perlu_koreksi"]))).toBe(true);
  });

  it("koreksi tertunda menandai perlu tindakan walau hari ini sudah final", () => {
    // Laporan yang dikembalikan reviewer TETAP pekerjaan yang menunggu.
    expect(perluTindakan(lok("A", [F, F, F, F, F, F, F], ["2026-08-12"]))).toBe(true);
  });

  it("semuanya beres → tidak perlu tindakan", () => {
    expect(perluTindakan(lok("A", [F, F, F, F, F, F, F]))).toBe(false);
    expect(perluTindakan(lok("A", [F, F, F, F, F, F, "dikirim"]))).toBe(false);
  });
});

describe("urutan: yang bermasalah lebih dulu", () => {
  it("koreksi tertunda naik ke paling atas", () => {
    const urut = urutkanLokasi([
      lok("Beres", [F, F, F, F, F, F, F]),
      lok("Kosong", [F, F, F, F, F, F, null]),
      lok("Koreksi", [F, F, F, F, F, F, F], ["2026-08-12"]),
      lok("Draft", [F, F, F, F, F, F, "draft"]),
    ]);
    expect(urut.map((l) => l.name)).toEqual(["Koreksi", "Kosong", "Draft", "Beres"]);
  });

  it("pada bobot yang sama, urut nama – supaya letaknya tidak berpindah-pindah", () => {
    const urut = urutkanLokasi([
      lok("Zebra", [F, F, F, F, F, F, null]),
      lok("Alfa", [F, F, F, F, F, F, null]),
    ]);
    expect(urut.map((l) => l.name)).toEqual(["Alfa", "Zebra"]);
  });

  it("tidak mengubah larik aslinya", () => {
    const asli = [lok("B", [F, F, F, F, F, F, null]), lok("A", [F, F, F, F, F, F, F])];
    urutkanLokasi(asli);
    expect(asli.map((l) => l.name)).toEqual(["B", "A"]);
  });
});

describe("kalimat tindakan dirakit dari cacah, bukan dikarang", () => {
  it("menyebut tiap jenis pekerjaan beserta jumlahnya", () => {
    const k = kalimatTindakan([
      lok("A", [F, F, F, F, F, F, null]),
      lok("B", [F, F, F, F, F, F, "draft"]),
      lok("C", [F, F, F, F, F, F, F], ["2026-08-12", "2026-08-13"]),
    ]);
    expect(k).toContain("2 laporan perlu koreksi");
    expect(k).toContain("1 lokasi belum ada laporan hari ini");
    expect(k).toContain("1 lokasi masih draft");
  });

  it("tidak menyebut yang jumlahnya nol", () => {
    const k = kalimatTindakan([lok("A", [F, F, F, F, F, F, null])]);
    expect(k).toContain("belum ada laporan");
    expect(k).not.toContain("koreksi");
    expect(k).not.toContain("draft");
  });

  it("null bila memang tidak ada yang perlu dikerjakan", () => {
    // null ≠ "semuanya sempurna": hari kosong yang sudah lewat tetap ada dan
    // dilaporkan terpisah oleh ringkasKepatuhan.
    expect(kalimatTindakan([lok("A", [null, null, F, F, F, F, F])])).toBeNull();
    expect(kalimatTindakan([])).toBeNull();
  });
});
