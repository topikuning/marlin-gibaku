// Isi laporan AI yang benar-benar sampai ke pimpinan (DECISIONS 196).
//
// Keluhan user 2026-08-01: "apa manfaat output seperti ini, apa yang dikirim ke
// direksi". Pesan WA yang dibekukan hanya berisi judul, satu paragraf, dan
// tabel angka — seluruh `sections` dan `recommendations` yang susah payah
// dihasilkan AI dibuang renderer, statusnya berbunyi "Kritis" padahal sebabnya
// laporan belum masuk, dan footernya tetap berlabel draf walau sudah disetujui.
//
// Tes ini mengunci enam perilaku itu supaya tidak diam-diam kembali.
import { describe, expect, it } from "vitest";
import { computeReadiness } from "@/lib/ai-hub/readiness";
import { reportOutputSchema } from "@/lib/ai-hub/schemas";
import {
  buildExecutiveBrief,
  dataBelumMemadai,
  renderAiReportHtml,
  renderAiReportWhatsApp,
  statusEfektif,
  type AiReportContent,
} from "@/lib/ai-hub/render";
import type { LocationFacts, PulseRow, PulseTotals } from "@/lib/ai-hub/types";

function facts(over: Partial<LocationFacts> = {}): LocationFacts {
  return {
    locationId: "loc-1",
    name: "Tengket",
    slug: "tengket",
    packageName: "KNMP Bangkalan",
    province: "Jawa Timur",
    status: "berjalan",
    startDateKey: "2026-06-01",
    hasActiveRab: true,
    hasActiveBaseline: true,
    totalWeeks: 20,
    currentWeek: 8,
    planPct: 40,
    actualPct: 38,
    deviationPp: -2,
    expectedReports: 7,
    finalReports: 6,
    sentReports: 1,
    draftReports: 0,
    needFixReports: 0,
    daysSinceLastReport: 1,
    activityCount: 3,
    photoCount: 12,
    photosNoGps: 1,
    photosServerTime: 0,
    openIssues: 1,
    criticalIssues: 0,
    issuesWithoutRecovery: 0,
    overdueRecoveries: 0,
    milestonesNeedFix: 0,
    ...over,
  };
}

function row(over: Partial<LocationFacts> = {}): PulseRow {
  const f = facts(over);
  return { ...f, readiness: computeReadiness(f), riskScore: 0, riskSeverity: null };
}

function totals(over: Partial<PulseTotals> = {}): PulseTotals {
  return {
    locations: 1,
    reportsExpected: 7,
    reportsFinal: 6,
    negativeDeviationLocations: 1,
    openIssues: 1,
    overdueRecoveries: 0,
    lowReadinessLocations: 0,
    ...over,
  };
}

function konten(over: {
  report?: Partial<Parameters<typeof reportOutputSchema.parse>[0] & object>;
  totals?: Partial<PulseTotals>;
  rows?: PulseRow[];
} = {}): AiReportContent {
  return {
    templateKey: "exec_portfolio",
    templateVersion: 1,
    report: reportOutputSchema.parse({
      title: "Executive Portfolio Brief",
      executiveSummary: "Ringkasan eksekutif yang cukup panjang untuk validasi skema.",
      overallStatus: "kritis",
      confidence: 75,
      sections: [
        { heading: "Kondisi umum", body: "Mobilisasi alat belum jalan di dua lokasi.", locationId: null },
        { heading: "Tengket", body: "Pemancangan tertunda karena cuaca.", locationId: "loc-1" },
      ],
      recommendations: [
        { title: "Percepat mobilisasi alat", reason: "Deviasi jadwal melebar", locationId: null },
        { title: "Tagih laporan harian Tengket", reason: "Laporan final tertinggal", locationId: "loc-1" },
      ],
      waSummary: "Update mingguan: dua lokasi tertinggal jadwal.",
      limitations: ["laporan final belum lengkap", "foto tanpa GPS di sebagian lokasi"],
      ...(over.report ?? {}),
    }),
    official: {
      periodStart: "2026-07-20",
      periodEnd: "2026-07-26",
      dataAsOf: "2026-07-26T08:00:00.000Z",
      totals: totals(over.totals),
      rows: over.rows ?? [row()],
    },
  };
}

/* ── 1. Isi laporan tidak boleh dibuang renderer ─────────────────────────── */

describe("WA membawa ISI laporan, bukan cuma judul + tabel angka", () => {
  const wa = renderAiReportWhatsApp(konten());

  it("memuat dasar analisis dari sections setelah informasi eksekutif", () => {
    expect(wa).toContain("*DASAR ANALISIS*");
    expect(wa).toContain("Kondisi umum");
    expect(wa).toContain("Mobilisasi alat belum jalan di dua lokasi.");
    expect(wa).toContain("Pemancangan tertunda karena cuaca.");
  });

  it("memuat keputusan yang diminta dari recommendations, bernomor", () => {
    expect(wa).toContain("*KEPUTUSAN YANG DIMINTA*");
    expect(wa).toContain("1. *Percepat mobilisasi alat*");
    expect(wa).toContain("2. *Tagih laporan harian Tengket*");
  });

  it("memuat SEMUA keterbatasan, bukan hanya yang pertama", () => {
    expect(wa).toContain("laporan final belum lengkap");
    expect(wa).toContain("foto tanpa GPS di sebagian lokasi");
  });

  it("angka resmi tetap ikut & identik dengan sumbernya", () => {
    expect(wa).toContain("38.0%");
    expect(wa).toContain("6/7");
  });

  it("membatasi jumlah butir supaya pesan WA tetap terbaca", () => {
    const banyak = renderAiReportWhatsApp(
      konten({
        report: {
          sections: Array.from({ length: 9 }, (_, i) => ({
            heading: `Bagian ${i + 1}`,
            body: `Isi bagian ${i + 1}.`,
            locationId: null,
          })),
          recommendations: Array.from({ length: 8 }, (_, i) => ({
            title: `Aksi ${i + 1}`,
            reason: "alasan",
            locationId: null,
          })),
        },
      }),
    );
    expect(banyak).toContain("Bagian 3");
    expect(banyak).not.toContain("Bagian 4");
    expect(banyak).toContain("3. *Aksi 3*");
    expect(banyak).not.toContain("4. *Aksi 4*");
  });

  it("body panjang dipotong di batas kata dengan elipsis, bukan di tengah kata", () => {
    const panjang = "kata ".repeat(200).trim();
    const wa2 = renderAiReportWhatsApp(
      konten({ report: { sections: [{ heading: "Panjang", body: panjang, locationId: null }] } }),
    );
    const baris = wa2.split("\n").find((l) => l.includes("Panjang"))!;
    expect(baris).toContain("…");
    expect(baris.length).toBeLessThan(400);
    expect(baris).not.toContain("kat…");
  });
});

/* ── 2. Hierarki laporan eksekutif ─────────────────────────────────────── */

describe("laporan terbaca dalam satu pandangan", () => {
  it("menyajikan status, lima KPI, tiga prioritas, lalu keputusan", () => {
    const c = konten();
    const brief = buildExecutiveBrief(c);
    expect(brief.statusLabel).toBe("Kritis");
    expect(brief.kpis).toHaveLength(5);
    expect(brief.kpis.find((kpi) => kpi.label === "Kelengkapan laporan")?.value).toBe("86%");
    expect(brief.priorities[0]).toMatchObject({ name: "Tengket", tone: "warning" });
    expect(brief.decisions.map((decision) => decision.title)).toEqual([
      "Percepat mobilisasi alat",
      "Tagih laporan harian Tengket",
    ]);
  });

  it("HTML menaruh kesimpulan, KPI, prioritas, dan keputusan sebelum tabel detail", () => {
    const html = renderAiReportHtml(konten());
    const summaryAt = html.indexOf("Kesimpulan 30 detik");
    const kpiAt = html.indexOf("Kelengkapan laporan");
    const priorityAt = html.indexOf("3 prioritas utama");
    const decisionAt = html.indexOf("Keputusan yang diminta");
    const detailAt = html.indexOf("Angka resmi per lokasi");
    expect(summaryAt).toBeGreaterThan(0);
    expect(summaryAt).toBeLessThan(kpiAt);
    expect(kpiAt).toBeLessThan(priorityAt);
    expect(priorityAt).toBeLessThan(decisionAt);
    expect(decisionAt).toBeLessThan(detailAt);
  });

  it("WhatsApp membuka dengan kesimpulan dan angka sebelum detail analisis", () => {
    const wa = renderAiReportWhatsApp(konten());
    expect(wa.indexOf("*KESIMPULAN 30 DETIK*")).toBeLessThan(wa.indexOf("*Angka resmi MARLIN:*"));
    expect(wa.indexOf("*Angka resmi MARLIN:*")).toBeLessThan(wa.indexOf("*DASAR ANALISIS*"));
  });
});

/* ── 3. Status dipaksa data_kurang saat laporannya yang kosong ───────────── */

describe("data belum masuk ≠ pekerjaan mandek", () => {
  it("dataBelumMemadai: di bawah 25% laporan final, atau tanpa kewajiban lapor", () => {
    expect(dataBelumMemadai(totals({ reportsExpected: 100, reportsFinal: 10 }))).toBe(true);
    expect(dataBelumMemadai(totals({ reportsExpected: 100, reportsFinal: 25 }))).toBe(false);
    expect(dataBelumMemadai(totals({ reportsExpected: 0, reportsFinal: 0 }))).toBe(true);
  });

  it("AI bilang kritis, tapi datanya kosong → status efektif data_kurang", () => {
    const c = konten({ totals: { reportsExpected: 100, reportsFinal: 3 } });
    expect(c.report.overallStatus).toBe("kritis");
    expect(statusEfektif(c)).toBe("data_kurang");
    const wa = renderAiReportWhatsApp(c);
    expect(wa).toContain("Data belum lengkap");
    expect(wa).not.toContain("status: Kritis");
    expect(wa).toContain("Kinerja belum bisa dinilai");
    expect(wa).toContain("3 dari 100");
  });

  it("data memadai → status AI dihormati apa adanya", () => {
    const c = konten({ totals: { reportsExpected: 10, reportsFinal: 9 } });
    expect(statusEfektif(c)).toBe("kritis");
    const wa = renderAiReportWhatsApp(c);
    expect(wa).toContain("status: Kritis");
    expect(wa).not.toContain("Kinerja belum bisa dinilai");
  });

  it("HTML memakai status efektif yang sama dengan WA", () => {
    const html = renderAiReportHtml(konten({ totals: { reportsExpected: 100, reportsFinal: 3 } }));
    expect(html).toContain("Data belum lengkap");
    expect(html).not.toContain("<strong>Kritis</strong>");
  });

  it("baris lokasi tanpa laporan final ditulis apa adanya, bukan 'realisasi 0%'", () => {
    const wa = renderAiReportWhatsApp(
      konten({ rows: [row({ finalReports: 0, actualPct: 0, planPct: 68, expectedReports: 30 })] }),
    );
    expect(wa).toContain("belum ada laporan final (0/30) · rencana 68.0%");
    expect(wa).not.toContain("realisasi 0.0% vs rencana 68.0%");
  });
});

/* ── 3. Footer mengikuti status artefak ──────────────────────────────────── */

describe("label draf tidak ikut membeku", () => {
  it("WA: draf vs sudah direview", () => {
    expect(renderAiReportWhatsApp(konten())).toContain("Draf AI MARLIN");
    const final = renderAiReportWhatsApp(konten(), true);
    expect(final).not.toContain("Draf AI MARLIN");
    expect(final).toContain("sudah direview");
  });

  it("HTML: draf vs sudah direview", () => {
    expect(renderAiReportHtml(konten())).toContain("wajib review manusia");
    expect(renderAiReportHtml(konten(), true)).toContain("sudah direview manusia");
  });
});

/* ── 4. Readiness: tanpa RAB tidak boleh terlihat "Memadai" ──────────────── */

describe("readiness lokasi kosong", () => {
  it("tanpa RAB & tanpa baseline → poor (dulu 70 = 'Memadai')", () => {
    const r = computeReadiness(
      facts({
        hasActiveRab: false,
        hasActiveBaseline: false,
        expectedReports: 0,
        finalReports: 0,
        sentReports: 0,
        photoCount: 0,
        activityCount: 0,
        actualPct: 0,
        daysSinceLastReport: null,
        startDateKey: null,
        status: "persiapan",
      }),
    );
    expect(r.score).toBeLessThan(50);
    expect(r.grade).toBe("poor");
    expect(r.blockers.map((b) => b.key)).toEqual(
      expect.arrayContaining(["rab_aktif", "baseline_aktif"]),
    );
  });

  it("RAB ada tapi baseline belum → tetap kehilangan bobot baseline", () => {
    const r = computeReadiness(facts({ hasActiveBaseline: false }));
    expect(r.blockers.some((b) => b.key === "baseline_aktif")).toBe(true);
    expect(r.score).toBeLessThanOrEqual(75);
  });
});
