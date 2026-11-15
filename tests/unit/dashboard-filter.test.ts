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
import {
  AMBANG_KRITIS_PP,
  cincinBelumLapor,
  cocokFilter,
  toneKondisi,
  type MarkerTone,
  type StatusLapor,
} from "@/lib/dashboard-filter";

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

// WARNA TITIK = KONDISI PROYEK SAJA; STATUS LAPOR PINDAH KE CINCIN (DECISIONS 770).
//
// Keluhan user 2026-11-15: *"permainan warna ini membingungkan. seharusnya warna
// utama adalah terhadap proyek itu sendiri, baru lingkaran diluarnya itu
// mencerminkan sudah lapor atau belum"*. Dulu satu warna memampatkan dua fakta:
// lokasi terlambat yang belum lapor tampil abu (keterlambatannya hilang), dan
// merah tidak berkata apa pun soal lapor.
describe("toneKondisi: warna isi hanya dari deviasi, tidak pernah dari status lapor", () => {
  it("terlambat tetap oranye walau belum lapor hari ini – dulu jadi abu", () => {
    expect(toneKondisi({ aktif: true, deviasiPct: -3 })).toBe("warning");
  });

  it("kritis di bawah −10 pp merah; tepat −10 masih terlambat", () => {
    expect(toneKondisi({ aktif: true, deviasiPct: -10.01 })).toBe("danger");
    expect(toneKondisi({ aktif: true, deviasiPct: -10 })).toBe("warning");
    expect(AMBANG_KRITIS_PP).toBe(-10);
  });

  it("sesuai atau di atas jadwal hijau", () => {
    expect(toneKondisi({ aktif: true, deviasiPct: 0 })).toBe("success");
    expect(toneKondisi({ aktif: true, deviasiPct: 4.2 })).toBe("success");
  });

  it("lokasi berjalan tanpa angka progres abu, bukan hijau", () => {
    expect(toneKondisi({ aktif: true, deviasiPct: null })).toBe("neutral");
  });

  it("belum mulai tetap idle, apa pun deviasinya", () => {
    expect(toneKondisi({ aktif: false, deviasiPct: -25 })).toBe("idle");
    expect(toneKondisi({ aktif: false, deviasiPct: null })).toBe("idle");
  });
});

describe("cincin hanya dari status lapor", () => {
  it("belum lapor → cincin tebal; sudah lapor & belum mulai → cincin biasa", () => {
    expect(cincinBelumLapor("belum")).toBe(true);
    expect(cincinBelumLapor("sudah")).toBe(false);
    expect(cincinBelumLapor("belum_mulai")).toBe(false);
    expect(cincinBelumLapor(undefined)).toBe(false);
  });
});
