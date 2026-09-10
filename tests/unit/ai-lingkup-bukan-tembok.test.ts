// JUMLAH LOKASI ADALAH BATAS DAFTAR, BUKAN TEMBOK.
//
// Pertanyaan user 2026-09-10, sesudah lokasi yang ia sebut akhirnya terbaca:
// *"ya kalau lokasinya memang lebih dari itu gimana?"* — dan itu pertanyaan
// yang benar. Jawaban sebelumnya ("naikkan batasnya sendiri di Sistem → AI")
// bukan jawaban: programnya menargetkan 200+ lokasi, jadi berapa pun angkanya
// dipasang, suatu hari ia akan terlampaui lagi. Batas yang menghalangi
// pemakaian normal bukan kehati-hatian, melainkan cacat (DECISIONS 133).
//
// Mesinnya sebenarnya SUDAH bisa menanganinya sejak dulu: `buildPulsePayload`
// memotong daftar per lokasi di `maxRows`, dan `TOTAL:` dihitung dari SELURUH
// lokasi, bukan dari yang tercetak. Yang salah cuma dua hal:
//
//   1. pemotongan barisnya TIDAK disebut — hanya pemotongan risiko yang disebut;
//   2. guard menolak lebih dulu, jadi kemampuan itu tidak pernah terpakai.
//
// Urutan barisnya bukan sembarang: `exceptionFirst` menaruh yang paling
// bermasalah di atas, jadi yang terpotong justru yang paling tidak mendesak.
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { AI_GUARD_DEFAULTS, decideAiGuard } = await import("@/lib/ai-hub/guard-rules");
const { buildPulsePayload } = await import("@/lib/ai-hub/prompt");
type GuardFacts = Parameters<typeof decideAiGuard>[1];
type PortfolioPulse = Parameters<typeof buildPulsePayload>[0];
type PulseRow = PortfolioPulse["rows"][number];

const FAKTA: GuardFacts = {
  enabled: true,
  userRunsLastHour: 0,
  orgRunsToday: 0,
  locationCount: 1,
  inputChars: 0,
};

function baris(i: number): PulseRow {
  return {
    locationId: `loc-${i}`,
    locationName: `Lokasi ${i}`,
    slug: `lokasi-${i}`,
    packageName: "Paket A",
    progressPct: 10,
    plannedPct: 20,
    deviationPp: -10,
    expectedReports: 1,
    finalReports: 1,
    openIssues: 0,
    overdueRecoveries: 0,
    riskScore: 100 - i,
    readiness: { grade: "good", score: 90, reasons: [] },
  } as unknown as PulseRow;
}

function pulse(jumlah: number): PortfolioPulse {
  return {
    periodStart: "2026-09-01",
    periodEnd: "2026-09-10",
    dataAsOf: "2026-09-10",
    totals: {
      locations: jumlah,
      reportsExpected: jumlah,
      reportsFinal: jumlah,
      negativeDeviationLocations: jumlah,
      openIssues: 0,
      overdueRecoveries: 0,
      lowReadinessLocations: 0,
    },
    rows: Array.from({ length: jumlah }, (_, i) => baris(i)),
    risks: [],
    sourceRefs: [],
    limitations: [],
  } as unknown as PortfolioPulse;
}

describe("lingkup lebih besar daripada batas bukan alasan menolak", () => {
  it("lokasi melebihi maxLocationsPerRun TIDAK lagi ditolak", () => {
    const v = decideAiGuard(AI_GUARD_DEFAULTS, {
      ...FAKTA,
      locationCount: AI_GUARD_DEFAULTS.maxLocationsPerRun + 50,
    });
    expect(v.ok, "lingkup besar masih ditolak – itu tembok, bukan batas").toBe(true);
  });

  it("batas UKURAN payload tetap menolak – itu pagar ongkos yang sesungguhnya", () => {
    const v = decideAiGuard(AI_GUARD_DEFAULTS, {
      ...FAKTA,
      inputChars: AI_GUARD_DEFAULTS.maxInputChars + 1,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("input_too_big");
  });

  it("kill switch & batas jumlah run tidak ikut dilonggarkan", () => {
    expect(decideAiGuard(AI_GUARD_DEFAULTS, { ...FAKTA, enabled: false }).ok).toBe(false);
    expect(
      decideAiGuard(AI_GUARD_DEFAULTS, {
        ...FAKTA,
        userRunsLastHour: AI_GUARD_DEFAULTS.maxRunsPerUserPerHour,
      }).ok,
    ).toBe(false);
  });
});

describe("daftar yang dipotong DIKATAKAN, bukan dipangkas diam-diam", () => {
  it("pemotongan baris disebut beserta jumlah yang tidak tercetak", () => {
    const teks = buildPulsePayload(pulse(77), { maxRows: 75 });
    expect(teks).toMatch(/\+2 lokasi lain tidak ditampilkan/);
  });

  it("alasan urutannya ikut disebut – yang terpotong yang paling tidak mendesak", () => {
    const teks = buildPulsePayload(pulse(77), { maxRows: 75 });
    expect(teks).toMatch(/paling bermasalah|skor risiko/i);
  });

  it("TOTAL tetap menghitung SELURUH lokasi, bukan yang tercetak saja", () => {
    // Ini yang membuat pemotongan aman: angka portofolionya tetap utuh,
    // yang dipotong hanya daftar per lokasinya.
    const teks = buildPulsePayload(pulse(77), { maxRows: 75 });
    expect(teks).toContain("TOTAL: 77 lokasi");
  });

  it("tanpa pemotongan, tidak ada catatan yang mengganggu", () => {
    const teks = buildPulsePayload(pulse(10), { maxRows: 75 });
    expect(teks).not.toMatch(/tidak ditampilkan/);
  });
});
