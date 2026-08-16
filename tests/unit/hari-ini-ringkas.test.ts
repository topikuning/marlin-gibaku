// RINGKASAN HALAMAN /hari-ini (DECISIONS 336).
//
// Berkas ini mengunci empat janji yang semuanya berasal dari kritik atas konsep
// yang diusulkan user — dan tiga di antaranya adalah cacat SENYAP: halamannya
// tetap tampil rapi, angkanya tetap keluar, hanya artinya yang salah.
//
//  1. Angka ringkasan SELALU membawa penyebutnya. "51" sendirian tidak bisa
//     ditindaklanjuti; 51 dari 84 dan 51 dari 51 dua kabar berbeda.
//  2. Tidak ada dua status yang huruf matriksnya kembar. Konsepnya memakai "F"
//     untuk Final dan "S" untuk Setuju sambil MEWARNAI keduanya sama, sehingga
//     di matriks keduanya tak terbedakan sama sekali.
//  3. Status selalu punya KATA, tidak pernah warna saja — HP murah di bawah
//     matahari, dan buta warna merah-hijau ada pada ±8% laki-laki.
//  4. "Perlu tindakan" hanya melihat HARI INI + koreksi tertunda. Hari kemarin
//     yang kosong tidak bisa diperbaiki mandor lagi; menandainya setiap hari
//     membuat penandanya kehilangan arti.
import { describe, expect, it, vi } from "vitest";
import type { DailyReportStatus } from "@/generated/prisma/enums";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

const {
  hurufUnik,
  kalimatTindakan,
  perluTindakan,
  ringkasKepatuhan,
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
  it("totalSel = lokasi × 7, dan seluruh sel terhitung tepat sekali", () => {
    const data = [
      lok("A", [F, F, F, F, F, "draft", null]),
      lok("B", [F, "perlu_koreksi", null, F, "dikirim", F, F]),
      lok("C", [null, null, null, null, null, null, null]),
    ];
    const r = ringkasKepatuhan(data);
    expect(r.totalSel).toBe(21);
    expect(r.lokasi).toBe(3);
    // Tidak ada sel yang hilang atau dihitung dua kali — inilah yang membuat
    // penyebutnya bisa dipercaya.
    expect(r.perluKoreksi + r.belumAda + r.draft + r.dikirim + r.selesai).toBe(r.totalSel);
  });

  it("mencacah tiap status ke lajurnya sendiri", () => {
    const r = ringkasKepatuhan([lok("A", [F, "disetujui", "dikirim", "draft", "perlu_koreksi", null, F])]);
    expect(r.selesai).toBe(3); // final ×2 + disetujui
    expect(r.dikirim).toBe(1);
    expect(r.draft).toBe(1);
    expect(r.perluKoreksi).toBe(1);
    expect(r.belumAda).toBe(1);
  });

  it("tanpa lokasi, penyebutnya nol — bukan angka karangan", () => {
    const r = ringkasKepatuhan([]);
    expect(r.totalSel).toBe(0);
    expect(r.lokasi).toBe(0);
    expect(r.lokasiPerluTindakan).toBe(0);
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

  it("judul sel menyebut tanggal DAN keadaannya — untuk pembaca layar", () => {
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

  it("pada bobot yang sama, urut nama — supaya letaknya tidak berpindah-pindah", () => {
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
