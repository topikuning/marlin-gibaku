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

/** Baris "Nama: realisasi X vs rencana Y" — menandai baris yang tanpa laporan. */
function barisPrioritas(w: PulseRow): string {
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
  const status = statusEfektif(c);
  const kosong = dataBelumMemadai(o.totals);

  const lines: string[] = [
    `*${r.title}*`,
    `Periode ${o.periodStart} s/d ${o.periodEnd} · status: ${STATUS_LABEL[status]}`,
    "",
  ];

  // Saat data belum masuk, kalimat pembuka menyebut sebabnya lebih dulu —
  // supaya pimpinan tidak menyimpulkan pekerjaan mandek.
  if (kosong) {
    lines.push(
      `_Kinerja belum bisa dinilai: baru ${o.totals.reportsFinal} dari ${o.totals.reportsExpected} laporan harian yang final. Angka deviasi di bawah mencerminkan data yang belum masuk, bukan pekerjaan yang berhenti._`,
      "",
    );
  }
  lines.push(r.waSummary.trim(), "");

  // ISI laporan — dulu dibuang seluruhnya oleh renderer ini sehingga pimpinan
  // hanya menerima judul + satu paragraf + tabel angka (DECISIONS 196).
  const sections = r.sections.filter((x) => x.body.trim().length > 0).slice(0, 5);
  if (sections.length) {
    lines.push("*Catatan lapangan:*");
    for (const sec of sections) {
      lines.push(`• *${sec.heading}* – ${ringkas(sec.body, 320)}`);
    }
    lines.push("");
  }

  const rekom = r.recommendations.slice(0, 5);
  if (rekom.length) {
    lines.push("*Tindakan yang disarankan:*");
    for (const [i, a] of rekom.entries()) {
      lines.push(`${i + 1}. ${a.title} – ${ringkas(a.reason, 200)}`);
    }
    lines.push("");
  }

  lines.push(
    "*Angka resmi MARLIN:*",
    `Lokasi: ${o.totals.locations} · Laporan final: ${o.totals.reportsFinal}/${o.totals.reportsExpected}`,
    `Deviasi negatif: ${o.totals.negativeDeviationLocations} lokasi · Kendala terbuka: ${o.totals.openIssues} · Recovery overdue: ${o.totals.overdueRecoveries}`,
  );

  const worst = o.rows.slice(0, 5);
  if (worst.length) {
    lines.push("", "*Prioritas:*");
    for (const w of worst) lines.push(barisPrioritas(w));
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
  const recs = r.recommendations.length
    ? `<h3>Tindakan untuk dipertimbangkan</h3><ul>${r.recommendations
        .map((x) => `<li><strong>${esc(x.title)}</strong> – ${esc(x.reason)}</li>`)
        .join("")}</ul>`
    : "";
  const limits = r.limitations.length
    ? `<div class="limits"><strong>Keterbatasan analisis:</strong><ul>${r.limitations
        .map((l) => `<li>${esc(l)}</li>`)
        .join("")}</ul></div>`
    : "";
  return `<article class="ai-report">
<header>
  <h1>${esc(r.title)}</h1>
  <p class="meta">Periode ${o.periodStart} s/d ${o.periodEnd} · data terakhir berubah ${o.dataAsOf ? esc(new Date(o.dataAsOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })) + " WIB" : "–"} · status: <strong>${STATUS_LABEL[statusEfektif(c)]}</strong> · cakupan bukti ${r.confidence}%</p>
</header>
<div class="summary"><strong>Ringkasan (Analisis AI)</strong><p>${esc(r.executiveSummary).replace(/\n/g, "<br/>")}</p></div>
<h3>Angka Resmi MARLIN</h3>
<table>
  <thead><tr><th>Lokasi</th><th>Paket</th><th>Provinsi</th><th>Rencana</th><th>Realisasi</th><th>Deviasi</th><th>Lap. final</th><th>Kendala</th><th>Readiness</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
${sections}
${recs}
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
