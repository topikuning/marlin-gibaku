// Excel artefak laporan AI — lembar pertama HARUS ringkasan eksekutif, dan
// angkanya harus sama dengan layar/PDF/WhatsApp (skenario E-05).
//
// Sebelum ini pembangun workbook hidup di dalam route API, jadi tidak pernah
// diuji sama sekali: penataan barisnya bergantung pada nomor baris hardcoded
// dan lebar kolom disetel SETELAH data masuk. Dua-duanya kelas kesalahan yang
// hanya ketahuan saat berkasnya benar-benar dibuka orang.
import type ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildAiReportWorkbook } from "@/lib/ai-hub/excel";
import { computeReadiness } from "@/lib/ai-hub/readiness";
import { buildExecutiveBrief, renderAiReportWhatsApp, type AiReportContent } from "@/lib/ai-hub/render";
import { reportOutputSchema } from "@/lib/ai-hub/schemas";
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
  report?: Record<string, unknown>;
  totals?: Partial<PulseTotals>;
  rows?: PulseRow[];
  humanEdited?: boolean;
} = {}): AiReportContent {
  return {
    templateKey: "exec_portfolio",
    templateVersion: 2,
    humanEdited: over.humanEdited,
    report: reportOutputSchema.parse({
      title: "Executive Portfolio Brief",
      executiveSummary: "Portofolio tertahan dua lokasi; keputusan mobilisasi diminta minggu ini.",
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
      limitations: ["laporan final belum lengkap"],
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

/** Isi kolom A per baris — untuk memeriksa urutan tanpa mengunci nomor baris. */
function kolomA(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow({ includeEmpty: true }, (r) => {
    out.push(String(r.getCell(1).value ?? "").trim());
  });
  return out;
}

function cariBaris(ws: ExcelJS.Worksheet, teks: string): number {
  let found = 0;
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    if (!found && String(r.getCell(1).value ?? "").trim() === teks) found = n;
  });
  return found;
}

describe("Excel artefak: lembar pertama adalah ringkasan eksekutif", () => {
  const wb = buildAiReportWorkbook(konten());
  const summary = wb.worksheets[0]!;

  it("urutan lembar: ringkasan dulu, tabel mentah belakangan", () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Ringkasan Eksekutif",
      "Angka Resmi",
      "Analisis Pendukung",
    ]);
  });

  it("urutan bagian sama dengan kanal lain: kesimpulan → KPI → prioritas → keputusan", () => {
    const kesimpulan = cariBaris(summary, "KESIMPULAN 30 DETIK");
    const indikator = cariBaris(summary, "INDIKATOR UTAMA");
    const prioritas = cariBaris(summary, "3 PRIORITAS UTAMA");
    const keputusan = cariBaris(summary, "KEPUTUSAN YANG DIMINTA");
    expect(kesimpulan).toBeGreaterThan(0);
    expect(kesimpulan).toBeLessThan(indikator);
    expect(indikator).toBeLessThan(prioritas);
    expect(prioritas).toBeLessThan(keputusan);
  });

  it("judul bagian benar-benar tebal – bukan menebak nomor baris", () => {
    for (const judul of ["KESIMPULAN 30 DETIK", "INDIKATOR UTAMA", "3 PRIORITAS UTAMA", "KEPUTUSAN YANG DIMINTA"]) {
      const n = cariBaris(summary, judul);
      expect(summary.getRow(n).font?.bold, `${judul} harus tebal`).toBe(true);
    }
    // Baris tepat di bawah "INDIKATOR UTAMA" adalah kepala tabel, juga tebal.
    const kepala = summary.getRow(cariBaris(summary, "INDIKATOR UTAMA") + 1);
    expect(kepala.getCell(1).value).toBe("Indikator");
    expect(kepala.font?.bold).toBe(true);
  });

  it("lebar kolom tetap terpasang walau data sudah masuk", () => {
    expect(summary.getColumn(1).width).toBe(27);
    expect(summary.getColumn(4).width).toBe(44);
  });

  it("kelima KPI resmi ikut, dengan angka yang sama seperti brief", () => {
    const brief = buildExecutiveBrief(konten());
    const isi = kolomA(summary);
    for (const kpi of brief.kpis) expect(isi).toContain(kpi.label);
    const barisKelengkapan = summary.getRow(cariBaris(summary, "Kelengkapan laporan"));
    expect(barisKelengkapan.getCell(2).value).toBe("86%");
    expect(barisKelengkapan.getCell(3).value).toBe("6 dari 7 final");
  });

  it("prioritas membawa alasan dan angka kunci, bukan nama lokasi saja", () => {
    const baris = summary.getRow(cariBaris(summary, "Tengket"));
    expect(String(baris.getCell(2).value)).toContain("KNMP Bangkalan");
    expect(String(baris.getCell(3).value)).toContain("tertinggal");
    expect(String(baris.getCell(4).value)).toContain("Realisasi 38.0%");
  });

  it("keputusan bernomor, maksimal tiga", () => {
    const isi = kolomA(summary);
    expect(isi).toContain("1. Percepat mobilisasi alat");
    expect(isi).toContain("2. Tagih laporan harian Tengket");
    const baris = summary.getRow(cariBaris(summary, "2. Tagih laporan harian Tengket"));
    expect(baris.getCell(2).value).toBe("Tengket · Jawa Timur");
    expect(baris.getCell(3).value).toBe("Laporan final tertinggal");
  });

  it("judul, status, dan periode terbaca di kepala lembar", () => {
    expect(summary.getCell("A1").value).toBe("Executive Portfolio Brief");
    const status = summary.getRow(cariBaris(summary, "Status"));
    expect(status.getCell(2).value).toBe("Kritis");
    expect(String(status.getCell(4).value)).toContain("2026-07-20");
  });
});

describe("Excel artefak: yang tidak ditampilkan tetap disebut", () => {
  it("peringatan data kosong memakai kalimat yang sama dengan WhatsApp", () => {
    const c = konten({ totals: { reportsExpected: 100, reportsFinal: 3 } });
    const summary = buildAiReportWorkbook(c).worksheets[0]!;
    const brief = buildExecutiveBrief(c);
    expect(brief.dataWarning).toBeTruthy();
    expect(cariBaris(summary, "JANGAN MENILAI KINERJA FISIK DULU")).toBeGreaterThan(0);
    expect(kolomA(summary)).toContain(brief.dataWarning!);
    expect(renderAiReportWhatsApp(c)).toContain(brief.dataWarning!);
  });

  it("usulan di luar tiga teratas disebut jumlahnya", () => {
    const c = konten({
      report: {
        recommendations: [1, 2, 3, 4, 5].map((i) => ({
          title: `Aksi ${i}`,
          reason: `Alasan ${i}`,
          locationId: null,
        })),
      },
    });
    const summary = buildAiReportWorkbook(c).worksheets[0]!;
    const isi = kolomA(summary).join("\n");
    expect(isi).toContain("3. Aksi 3");
    expect(isi).not.toContain("4. Aksi 4");
    expect(isi).toContain("2 usulan lain tidak ditampilkan");
  });

  it("lokasi di luar tiga prioritas disebut jumlahnya", () => {
    const rows = ["A", "B", "C", "D", "E"].map((n) => row({ locationId: `loc-${n}`, name: n, slug: n.toLowerCase() }));
    const summary = buildAiReportWorkbook(konten({ rows, totals: { locations: 5 } })).worksheets[0]!;
    expect(kolomA(summary).join("\n")).toContain("2 lokasi lain ada di lembar Angka Resmi.");
  });

  it("narasi hasil edit manusia tidak dilaporkan sebagai cakupan bukti 0%", () => {
    const c = konten({ humanEdited: true, report: { confidence: 0 } });
    const wb = buildAiReportWorkbook(c);
    const isi = [...kolomA(wb.worksheets[0]!), ...kolomA(wb.worksheets[2]!)].join("\n");
    const nilai = wb.worksheets[0]!.getRow(cariBaris(wb.worksheets[0]!, "Dasar keyakinan")).getCell(2).value;
    expect(nilai).toBe("narasi sudah diedit dan diverifikasi manusia");
    expect(isi).not.toContain("cakupan bukti 0%");
  });
});

describe("Excel artefak: lembar angka resmi tetap utuh", () => {
  const wb = buildAiReportWorkbook(konten());
  const angka = wb.worksheets[1]!;

  it("kepala tabel tebal dan baris lokasi memakai angka numerik", () => {
    expect(angka.getRow(1).font?.bold).toBe(true);
    expect(angka.getRow(1).getCell(1).value).toBe("Lokasi");
    expect(angka.getRow(2).getCell(4).value).toBe(40);
    expect(angka.getRow(2).getCell(5).value).toBe(38);
  });

  it("analisis pendukung memuat seluruh bagian, tidak dipangkas seperti WhatsApp", () => {
    const isi = kolomA(wb.worksheets[2]!).join("\n");
    expect(isi).toContain("Kondisi umum");
    expect(isi).toContain("Tengket");
    expect(isi).toContain("Keterbatasan analisis");
  });
});
