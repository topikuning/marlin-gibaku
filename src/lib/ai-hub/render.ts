import type { ReportOutput } from "./schemas";
import type { PulseRow, PulseTotals } from "./types";

/**
 * Renderer artefak laporan AI — DETERMINISTIK dari SATU structuredContent
 * kanonik (narasi AI + angka resmi snapshot run). Semua format (pratinjau,
 * cetak A4/PDF via browser print, WhatsApp, Excel) memakai data yang sama —
 * angka dijamin identik lintas format. MURNI (tanpa DB) & unit-testable.
 * DECISIONS 133.
 */

export type AiReportContent = {
  templateKey: string;
  templateVersion: number;
  /**
   * Ditandai saat reviewer mengedit narasi. Setelah diedit, `confidence`
   * dinolkan (rujukan sumber AI tidak lagi berlaku) — tanpa penanda ini setiap
   * kanal menulis "cakupan bukti 0%", yang terbaca sebagai "laporan tidak bisa
   * dipercaya" padahal justru sudah lolos tangan manusia. DECISIONS 454.
   */
  humanEdited?: boolean;
  report: ReportOutput;
  official: {
    periodStart: string;
    periodEnd: string;
    dataAsOf: string | null;
    totals: PulseTotals;
    rows: PulseRow[];
  };
};

/** Parse structuredContent artefak (Json DB) → tipe aman. Lempar bila bentuk tak dikenal. */
export function parseAiReportContent(json: unknown): AiReportContent {
  const j = json as AiReportContent;
  if (!j || typeof j !== "object" || !j.report || !j.official) {
    throw new Error("structuredContent artefak tidak dikenal");
  }
  return j;
}

const STATUS_LABEL: Record<ReportOutput["overallStatus"], string> = {
  normal: "Terkendali",
  perhatian: "Perlu perhatian",
  kritis: "Kritis",
  data_kurang: "Data belum lengkap",
};

export type ExecutivePriority = {
  name: string;
  packageName: string;
  province: string;
  actualPct: number;
  planPct: number;
  deviationPp: number;
  finalReports: number;
  expectedReports: number;
  reason: string;
  tone: "danger" | "warning" | "neutral";
};

export type ExecutiveBrief = {
  status: ReportOutput["overallStatus"];
  statusLabel: string;
  headline: string;
  /** Peringatan "jangan menilai kinerja fisik dulu" — SATU kalimat untuk semua kanal. */
  dataWarning: string | null;
  /** Label kepercayaan: cakupan bukti AI, atau penanda narasi hasil edit manusia. */
  evidenceLabel: string;
  kpis: { label: string; value: string; note: string }[];
  priorities: ExecutivePriority[];
  decisions: { title: string; reason: string; scopeLabel: string }[];
  /**
   * Rekomendasi di luar tiga teratas. Jumlahnya DISEBUT di setiap kanal —
   * "tidak muncul" tidak boleh terbaca sebagai "tidak ada" (CLAUDE.md).
   */
  decisionsHidden: number;
};

/**
 * Batas format eksekutif (DECISIONS 453/454). Dipakai bersama oleh validator
 * keluaran AI, form edit reviewer, dan seluruh renderer supaya angka batasnya
 * tidak berbeda-beda per tempat.
 */
export const MAKS_PRIORITAS = 3;
export const MAKS_KEPUTUSAN = 3;
export const MAKS_ANALISIS = 4;
/** WhatsApp lebih ketat: pesan harus tetap terbaca di layar ponsel (E-06). */
export const MAKS_ANALISIS_WA = 3;

function fmtPp(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
}

/**
 * Ambang "data belum masuk": bila laporan final yang tersedia di bawah porsi
 * ini dari yang seharusnya, portofolio TIDAK BISA dinilai kinerjanya —
 * deviasi 0% vs rencana 90% bukan berarti pekerjaan mandek, melainkan
 * pelaporannya kosong. DECISIONS 196.
 */
const AMBANG_DATA_KOSONG = 0.25;

export function dataBelumMemadai(t: PulseTotals): boolean {
  if (t.reportsExpected <= 0) return true; // belum SPMK / belum ada kewajiban lapor
  return t.reportsFinal / t.reportsExpected < AMBANG_DATA_KOSONG;
}

/**
 * Status yang BOLEH ditampilkan. AI bebas menulis "kritis", tetapi bila
 * datanya sendiri belum masuk, kode MEMAKSA `data_kurang` — menyebut proyek
 * kritis karena belum ada yang melapor adalah kesimpulan yang salah dan itu
 * yang dibaca pimpinan. Aturan deterministik, bukan imbauan prompt.
 */
export function statusEfektif(c: AiReportContent): ReportOutput["overallStatus"] {
  return dataBelumMemadai(c.official.totals) ? "data_kurang" : c.report.overallStatus;
}

function persenKelengkapan(t: PulseTotals): number | null {
  if (t.reportsExpected <= 0) return null;
  return Math.round((t.reportsFinal / t.reportsExpected) * 100);
}

function alasanPrioritas(w: PulseRow): { reason: string; tone: ExecutivePriority["tone"] } {
  // Alasan MELENGKAPI angka, tidak mengulangnya: setiap kanal sudah menampilkan
  // rasio laporan final di sebelah nama lokasi.
  if (w.finalReports === 0 && w.expectedReports > 0) {
    return {
      reason: "Kondisi fisik belum dapat dinilai sampai laporan harian masuk.",
      tone: "danger",
    };
  }
  if (w.criticalIssues > 0) {
    return { reason: `${w.criticalIssues} kendala kritis memerlukan eskalasi.`, tone: "danger" };
  }
  if (w.overdueRecoveries > 0) {
    return { reason: `${w.overdueRecoveries} rencana pemulihan melewati tenggat.`, tone: "danger" };
  }
  if (w.deviationPp < -0.05) {
    return {
      reason: `Realisasi tertinggal ${Math.abs(w.deviationPp).toFixed(1)} poin persentase dari rencana.`,
      tone: w.deviationPp <= -10 ? "danger" : "warning",
    };
  }
  if (w.openIssues > 0) {
    return { reason: `${w.openIssues} kendala masih terbuka.`, tone: "warning" };
  }
  if (w.readiness.grade === "poor" || w.readiness.grade === "limited") {
    return { reason: `Kesiapan data rendah (${w.readiness.score}%).`, tone: "warning" };
  }
  return { reason: "Tidak ada pengecualian utama pada periode ini.", tone: "neutral" };
}

/**
 * Model penyajian satu-pandangan. Seluruh KPI dan urutan prioritas diturunkan
 * dari snapshot resmi; AI hanya memasok headline dan alasan keputusan.
 */
export function buildExecutiveBrief(c: AiReportContent): ExecutiveBrief {
  const totals = c.official.totals;
  const reportingRate = persenKelengkapan(totals);
  const lokasiById = new Map(c.official.rows.map((row) => [row.locationId, row]));
  const priorities = c.official.rows.slice(0, MAKS_PRIORITAS).map((row) => {
    const why = alasanPrioritas(row);
    return {
      name: row.name,
      packageName: row.packageName,
      province: row.province,
      actualPct: row.actualPct,
      planPct: row.planPct,
      deviationPp: row.deviationPp,
      finalReports: row.finalReports,
      expectedReports: row.expectedReports,
      reason: why.reason,
      tone: why.tone,
    };
  });
  const status = statusEfektif(c);
  return {
    status,
    statusLabel: STATUS_LABEL[status],
    headline: ringkas(c.report.executiveSummary, 520),
    dataWarning: dataBelumMemadai(totals)
      ? `Kinerja fisik belum bisa dinilai: baru ${totals.reportsFinal} dari ${totals.reportsExpected} laporan harian yang final. Angka deviasi di bawah mencerminkan data yang belum masuk, bukan pekerjaan yang berhenti.`
      : null,
    evidenceLabel: c.humanEdited
      ? "narasi sudah diedit dan diverifikasi manusia"
      : `cakupan bukti ${c.report.confidence}%`,
    kpis: [
      { label: "Lokasi dipantau", value: String(totals.locations), note: "Dalam scope laporan" },
      {
        label: "Kelengkapan laporan",
        value: reportingRate == null ? "–" : `${reportingRate}%`,
        note: `${totals.reportsFinal} dari ${totals.reportsExpected} final`,
      },
      {
        label: "Lokasi tertinggal",
        value: String(totals.negativeDeviationLocations),
        note: "Deviasi terhadap rencana",
      },
      { label: "Kendala terbuka", value: String(totals.openIssues), note: "Perlu penyelesaian" },
      { label: "Recovery overdue", value: String(totals.overdueRecoveries), note: "Melewati tenggat" },
    ],
    priorities,
    decisions: c.report.recommendations
      .slice(0, MAKS_KEPUTUSAN)
      .map((item) => {
        const lokasi = item.locationId ? lokasiById.get(item.locationId) : null;
        return {
          title: item.title,
          reason: item.reason,
          scopeLabel: item.locationId
            ? lokasi
              ? `${lokasi.name} · ${lokasi.province}`
              : "Lokasi perlu dikonfirmasi"
            : "Seluruh portofolio",
        };
      }),
    decisionsHidden: Math.max(0, c.report.recommendations.length - MAKS_KEPUTUSAN),
  };
}

/**
 * Analisis pendukung untuk kanal yang ruangnya terbatas (WhatsApp). Sisa yang
 * tidak ditampilkan dikembalikan sebagai angka, bukan dibuang diam-diam.
 */
export function analisisPendukung(
  c: AiReportContent,
  maks: number,
): { items: { heading: string; body: string }[]; hidden: number } {
  const isi = c.report.sections.filter((s) => s.body.trim().length > 0);
  return {
    items: isi.slice(0, maks).map((s) => ({ heading: s.heading, body: s.body })),
    hidden: Math.max(0, isi.length - maks),
  };
}

/**
 * Baris "Nama: realisasi X vs rencana Y" — menandai baris yang tanpa laporan.
 * Menerima PulseRow maupun ExecutivePriority: angkanya identik, dan dengan
 * begitu urutan WA tidak perlu mengindeks ulang `official.rows`.
 */
function barisPrioritas(
  w: Pick<PulseRow, "name" | "finalReports" | "expectedReports" | "planPct" | "actualPct" | "deviationPp">,
): string {
  const tanpaLaporan = w.finalReports === 0;
  const angka = tanpaLaporan
    ? `belum ada laporan final (0/${w.expectedReports}) · rencana ${w.planPct.toFixed(1)}%`
    : `realisasi ${w.actualPct.toFixed(1)}% vs rencana ${w.planPct.toFixed(1)}% (${fmtPp(w.deviationPp)} pp), laporan final ${w.finalReports}/${w.expectedReports}`;
  return `- ${w.name}: ${angka}`;
}

/**
 * Render teks WhatsApp (tanpa markdown selain *bold* WA).
 *
 * `sudahFinal` = artefak sudah disetujui/dibekukan → footer TIDAK lagi berbunyi
 * "draf". Dulu label draf ikut dibekukan ke `renderedText` sehingga pesan yang
 * sampai ke pimpinan tetap berlabel draf mentah walau sudah lolos review.
 */
export function renderAiReportWhatsApp(c: AiReportContent, sudahFinal = false): string {
  const r = c.report;
  const o = c.official;
  const brief = buildExecutiveBrief(c);

  const lines: string[] = [
    `*${r.title}*`,
    `Periode ${o.periodStart} s/d ${o.periodEnd} · status: ${brief.statusLabel}`,
    "",
  ];

  // Saat data belum masuk, kalimat pembuka menyebut sebabnya lebih dulu —
  // supaya pimpinan tidak menyimpulkan pekerjaan mandek. Kalimatnya sama persis
  // dengan layar, PDF, dan Excel karena sumbernya satu: brief.dataWarning.
  if (brief.dataWarning) lines.push(`_${brief.dataWarning}_`, "");
  lines.push("*KESIMPULAN 30 DETIK*", ringkas(r.waSummary.trim() || brief.headline, 650), "");

  lines.push(
    "*Angka resmi MARLIN:*",
    `Lokasi: ${o.totals.locations} · Laporan final: ${o.totals.reportsFinal}/${o.totals.reportsExpected}`,
    `Deviasi negatif: ${o.totals.negativeDeviationLocations} lokasi · Kendala terbuka: ${o.totals.openIssues} · Recovery overdue: ${o.totals.overdueRecoveries}`,
  );

  if (brief.priorities.length) {
    lines.push("", `*${MAKS_PRIORITAS} PRIORITAS UTAMA*`);
    // Angka kunci SAJA tidak cukup: pimpinan perlu tahu mengapa lokasi ini yang
    // naik ke atas (E-03). Alasannya deterministik, dari alasanPrioritas().
    for (const p of brief.priorities) {
      lines.push(barisPrioritas(p), `  ↳ ${ringkas(p.reason, 160)}`);
    }
    if (o.rows.length > brief.priorities.length) {
      lines.push(`_${o.rows.length - brief.priorities.length} lokasi lain ada di laporan lengkap._`);
    }
  }

  if (brief.decisions.length) {
    lines.push("", "*KEPUTUSAN YANG DIMINTA*");
    for (const [i, a] of brief.decisions.entries()) {
      lines.push(`${i + 1}. *${a.title}* [${a.scopeLabel}] – ${ringkas(a.reason, 180)}`);
    }
    if (brief.decisionsHidden > 0) {
      lines.push(`_${brief.decisionsHidden} usulan lain tidak ditampilkan – buka laporan lengkap._`);
    }
  }

  const analisis = analisisPendukung(c, MAKS_ANALISIS_WA);
  if (analisis.items.length) {
    lines.push("", "*DASAR ANALISIS*");
    for (const sec of analisis.items) lines.push(`• *${sec.heading}* – ${ringkas(sec.body, 220)}`);
    if (analisis.hidden > 0) {
      lines.push(`_${analisis.hidden} bagian analisis lain ada di laporan lengkap._`);
    }
  }

  // SEMUA keterbatasan, bukan hanya yang pertama.
  if (r.limitations.length) {
    lines.push("", "*Keterbatasan:*");
    for (const l of r.limitations.slice(0, 4)) lines.push(`- ${l}`);
  }

  lines.push(
    "",
    sudahFinal
      ? "_Laporan MARLIN – angka dari sistem, narasi disusun AI dan sudah direview._"
      : "_Draf AI MARLIN – angka dari sistem, narasi perlu review manusia._",
  );
  return lines.join("\n");
}

/** Potong rapi di batas kata supaya pesan WA tidak terputus di tengah kata. */
function ringkas(teks: string, maks: number): string {
  const t = teks.trim().replace(/\s+/g, " ");
  if (t.length <= maks) return t;
  const potong = t.slice(0, maks);
  const spasi = potong.lastIndexOf(" ");
  return `${(spasi > maks * 0.6 ? potong.slice(0, spasi) : potong).trimEnd()}…`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render HTML (pratinjau in-app & halaman cetak A4 → PDF via print browser). */
export function renderAiReportHtml(c: AiReportContent, sudahFinal = false): string {
  const r = c.report;
  const o = c.official;
  const brief = buildExecutiveBrief(c);
  const rowsHtml = o.rows
    .map(
      (w) => `<tr>
  <td>${esc(w.name)}</td><td>${esc(w.packageName)}</td><td>${esc(w.province)}</td>
  <td class="num">${w.planPct.toFixed(1)}%</td><td class="num">${w.actualPct.toFixed(1)}%</td>
  <td class="num">${fmtPp(w.deviationPp)} pp</td>
  <td class="num">${w.finalReports}/${w.expectedReports}</td>
  <td class="num">${w.openIssues}</td>
  <td class="num">${w.readiness.score}%</td>
</tr>`,
    )
    .join("");
  const sections = r.sections
    .map((s) => `<section><h3>${esc(s.heading)}</h3><p>${esc(s.body).replace(/\n/g, "<br/>")}</p></section>`)
    .join("");
  const kpis = brief.kpis
    .map((kpi) => `<div class="kpi"><span>${esc(kpi.label)}</span><strong>${esc(kpi.value)}</strong><small>${esc(kpi.note)}</small></div>`)
    .join("");
  const priorities = brief.priorities.length
    ? brief.priorities
        .map(
          (item, index) => `<div class="priority priority-${item.tone}">
  <div class="priority-rank">${index + 1}</div><div><strong>${esc(item.name)}</strong><small>${esc(item.packageName)} · ${esc(item.province)}</small>
  <p>${esc(item.reason)}</p><span class="priority-numbers">Realisasi ${item.actualPct.toFixed(1)}% · Rencana ${item.planPct.toFixed(1)}% · Laporan ${item.finalReports}/${item.expectedReports}</span></div>
</div>`,
        )
        .join("")
    : `<p class="empty">Tidak ada lokasi dalam scope laporan.</p>`;
  const decisions = brief.decisions.length
    ? `<ol class="decision-list">${brief.decisions
        .map(
          (x) =>
            `<li><strong>${esc(x.title)}</strong><small>Fokus: ${esc(x.scopeLabel)}</small><p>${esc(x.reason)}</p></li>`,
        )
        .join("")}</ol>${
        brief.decisionsHidden > 0
          ? `<p class="sisa">${brief.decisionsHidden} usulan lain di luar tiga teratas tidak ditampilkan – buka editor laporan untuk melihatnya.</p>`
          : ""
      }`
    : `<p class="empty">Tidak ada keputusan yang diminta pada periode ini.</p>`;
  const limits = r.limitations.length
    ? `<div class="limits"><strong>Keterbatasan analisis:</strong><ul>${r.limitations
        .map((l) => `<li>${esc(l)}</li>`)
        .join("")}</ul></div>`
    : "";
  const dataWarning = brief.dataWarning
    ? `<div class="data-warning"><strong>Jangan menilai kinerja fisik dulu.</strong> ${esc(brief.dataWarning)}</div>`
    : "";
  return `<article class="ai-report">
<header>
  <p class="eyebrow">EXECUTIVE CONTROL BRIEF</p>
  <h1>${esc(r.title)}</h1>
  <p class="meta">Periode ${o.periodStart} s/d ${o.periodEnd} · data terakhir berubah ${o.dataAsOf ? esc(new Date(o.dataAsOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })) + " WIB" : "–"} · ${esc(brief.evidenceLabel)}</p>
</header>
<div class="status status-${brief.status}"><span>Status portofolio</span><strong>${esc(brief.statusLabel)}</strong></div>
${dataWarning}
<section class="summary"><span>Kesimpulan 30 detik</span><p>${esc(brief.headline).replace(/\n/g, "<br/>")}</p></section>
<div class="kpi-grid">${kpis}</div>
<div class="executive-grid">
  <section><h2>3 prioritas utama</h2>${priorities}</section>
  <section><h2>Keputusan yang diminta</h2>${decisions}</section>
</div>
<div class="page-break"></div>
<h2>Angka resmi per lokasi</h2>
<table>
  <thead><tr><th>Lokasi</th><th>Paket</th><th>Provinsi</th><th>Rencana</th><th>Realisasi</th><th>Deviasi</th><th>Lap. final</th><th>Kendala</th><th>Readiness</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
<h2>Analisis pendukung</h2>
${sections}
${limits}
<footer><p>${sudahFinal ? "Laporan MARLIN – narasi disusun AI dan sudah direview manusia." : "Draf disusun AI dari data MARLIN – wajib review manusia sebelum distribusi."} Angka bersumber dari calculation layer MARLIN, bukan dari AI.</p></footer>
</article>`;
}

/** Baris Excel (array-of-arrays) — dipakai route export exceljs. */
export function renderAiReportExcelRows(c: AiReportContent): (string | number)[][] {
  const o = c.official;
  const head = [
    "Lokasi",
    "Paket",
    "Provinsi",
    "Rencana %",
    "Realisasi %",
    "Deviasi pp",
    "Laporan final",
    "Laporan diharapkan",
    "Kendala terbuka",
    "Recovery overdue",
    "Readiness %",
  ];
  const rows = o.rows.map((w) => [
    w.name,
    w.packageName,
    w.province,
    Number(w.planPct.toFixed(1)),
    Number(w.actualPct.toFixed(1)),
    Number(w.deviationPp.toFixed(1)),
    w.finalReports,
    w.expectedReports,
    w.openIssues,
    w.overdueRecoveries,
    w.readiness.score,
  ]);
  return [head, ...rows];
}
