// FILTER PETA DASHBOARD TIDAK BOLEH MENEBAK STATUS LAPOR DARI WARNA.
//
// Laporan user 2026-08-03: kartu KPI menyebut 2 lokasi sudah submit, tapi di
// peta tidak ada satu pun pin hijau. Hijau memang benar tidak ada (dua-duanya
// deviasi negatif), TAPI penelusurannya membuka cacat lain: filternya
// menyimpulkan status lapor dari WARNA pin.
//
// Warna memampatkan dua fakta — lapor & deviasi — dan deviasi kritis sengaja
// menang (keputusan user: "tetap merah"). Jadi pin merah bisa berarti belum
// lapor. Akibat lama:
//   · "Belum Submit" = pin abu saja  → lokasi belum lapor yang kritis RAIB
//   · "Sudah Submit" = hijau/oranye/merah → menarik masuk yang BELUM lapor
// Peta lalu berselisih dengan kartu KPI tepat di atasnya — dan angka yang
// saling bertentangan di satu layar membuat keduanya berhenti dipercaya.
import { describe, expect, it } from "vitest";
import { cocokFilter, type MarkerTone, type StatusLapor } from "@/lib/dashboard-filter";

/** Lokasi contoh: [warna, status lapor]. */
const KRITIS_BELUM_LAPOR: [MarkerTone, StatusLapor] = ["danger", "belum"];
const KRITIS_SUDAH_LAPOR: [MarkerTone, StatusLapor] = ["danger", "sudah"];
const ONTRACK_SUDAH_LAPOR: [MarkerTone, StatusLapor] = ["success", "sudah"];
const MELESET_SUDAH_LAPOR: [MarkerTone, StatusLapor] = ["warning", "sudah"];
const BIASA_BELUM_LAPOR: [MarkerTone, StatusLapor] = ["neutral", "belum"];
const BELUM_MULAI: [MarkerTone, StatusLapor] = ["idle", "belum_mulai"];

describe("KASUS INTI: pin merah yang belum lapor", () => {
  it('masuk "Belum Submit" – dulu raib karena bukan pin abu', () => {
    expect(cocokFilter("belum", ...KRITIS_BELUM_LAPOR)).toBe(true);
  });

  it('TIDAK masuk "Sudah Submit" – dulu ikut terhitung karena warnanya merah', () => {
    expect(cocokFilter("submit", ...KRITIS_BELUM_LAPOR)).toBe(false);
  });

  it('tetap masuk "Kritis" – sinyal mendesaknya tidak hilang', () => {
    expect(cocokFilter("kritis", ...KRITIS_BELUM_LAPOR)).toBe(true);
  });
});

describe('"Sudah Submit" = persis yang dihitung kartu KPI', () => {
  it("semua yang berstatus sudah lapor ikut, apa pun warnanya", () => {
    for (const l of [ONTRACK_SUDAH_LAPOR, MELESET_SUDAH_LAPOR, KRITIS_SUDAH_LAPOR]) {
      expect(cocokFilter("submit", ...l), l[0]).toBe(true);
    }
  });

  it("yang belum lapor tidak pernah ikut", () => {
    for (const l of [BIASA_BELUM_LAPOR, KRITIS_BELUM_LAPOR]) {
      expect(cocokFilter("submit", ...l), l[0]).toBe(false);
    }
  });
});

describe('"Belum Submit" hanya lokasi BERJALAN', () => {
  it("lokasi yang belum mulai bukan tunggakan", () => {
    expect(cocokFilter("belum", ...BELUM_MULAI)).toBe(false);
    expect(cocokFilter("submit", ...BELUM_MULAI)).toBe(false);
  });

  it("lokasi berjalan yang belum lapor ikut, kritis maupun tidak", () => {
    expect(cocokFilter("belum", ...BIASA_BELUM_LAPOR)).toBe(true);
    expect(cocokFilter("belum", ...KRITIS_BELUM_LAPOR)).toBe(true);
  });
});

describe("sudah + belum menutup seluruh lokasi berjalan, tanpa tumpang tindih", () => {
  // Invarian yang bikin peta dan kartu KPI tidak mungkin berselisih:
  // tiap lokasi berjalan masuk TEPAT satu dari dua filter itu.
  const BERJALAN: [MarkerTone, StatusLapor][] = [
    ONTRACK_SUDAH_LAPOR,
    MELESET_SUDAH_LAPOR,
    KRITIS_SUDAH_LAPOR,
    BIASA_BELUM_LAPOR,
    KRITIS_BELUM_LAPOR,
  ];

  it("tepat satu filter cocok untuk tiap lokasi berjalan", () => {
    for (const l of BERJALAN) {
      const cocok = [cocokFilter("submit", ...l), cocokFilter("belum", ...l)].filter(Boolean);
      expect(cocok, `${l[0]}/${l[1]}`).toHaveLength(1);
    }
  });

  it("jumlah sudah + belum = jumlah lokasi berjalan", () => {
    const sudah = BERJALAN.filter((l) => cocokFilter("submit", ...l)).length;
    const belum = BERJALAN.filter((l) => cocokFilter("belum", ...l)).length;
    expect(sudah + belum).toBe(BERJALAN.length);
    expect(sudah).toBe(3);
    expect(belum).toBe(2);
  });
});

describe('"Semua" tidak menyaring apa pun', () => {
  it("termasuk lokasi yang belum mulai", () => {
    for (const l of [ONTRACK_SUDAH_LAPOR, KRITIS_BELUM_LAPOR, BELUM_MULAI]) {
      expect(cocokFilter("semua", ...l), l[0]).toBe(true);
    }
  });
});
