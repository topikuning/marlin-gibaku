import { promptDefault } from "@/lib/ai/prompt-registry";
import type { PortfolioPulse, PulseRow, QualityFinding, RiskItem, SourceRef } from "./types";
import { faktaResmi, type FaktaResmi } from "./schemas";
import { LABEL_JENIS, type PotonganNarasi } from "@/lib/narasi/cari";

/**
 * Penyusun prompt AI Hub — data deterministik diringkas jadi payload kompak.
 * PROMPT_VERSION naik setiap perubahan format (tercatat di AiRun.promptVersion).
 * DECISIONS 133 · narasi lapangan DECISIONS 136.
 */

export const PROMPT_VERSION = "hub-v2";

export const SYSTEM_BASE = promptDefault("hub.system");

function rowLine(r: PulseRow): string {
  const parts = [
    `id=${r.locationId}`,
    `nama=${r.name}`,
    `paket=${r.packageName}`,
    `prov=${r.province}`,
    `status=${r.status}`,
    r.hasActiveBaseline
      ? `rencana=${r.planPct.toFixed(1)}% realisasi=${r.actualPct.toFixed(1)}% deviasi=${r.deviationPp.toFixed(1)}pp mgg=${r.currentWeek}/${r.totalWeeks}`
      : "baseline=belum_ada",
    `laporan_final=${r.finalReports}/${r.expectedReports}`,
    `laporan_proses=${r.sentReports} draft=${r.draftReports} koreksi=${r.needFixReports}`,
    r.daysSinceLastReport != null ? `lapor_terakhir=${r.daysSinceLastReport}hr_lalu` : "belum_pernah_lapor",
    `kegiatan=${r.activityCount} foto=${r.photoCount}`,
    `kendala=${r.openIssues}(kritis=${r.criticalIssues},tanpa_recovery=${r.issuesWithoutRecovery})`,
    `recovery_overdue=${r.overdueRecoveries}`,
    `readiness=${r.readiness.score}(${r.readiness.grade})`,
    /*
     * RENCANA KERJA — satu-satunya baris yang menghadap KE DEPAN
     * (DECISIONS 458).
     *
     * Fakta di atas semuanya melaporkan apa yang SUDAH terjadi. Tanpa baris
     * ini, pertanyaan *"pekerjaan apa yang perlu dilakukan untuk mengejar
     * progress?"* memang tidak punya bahan, dan model yang dipagari agar tidak
     * mengarang hanya bisa menolak menjawab.
     *
     * `null` (pekan belum bernomor) dibedakan dari 0 (pekan bernomor, rencana
     * belum disusun): keduanya menuntut tindakan yang berbeda.
     */
    r.plannedItemsThisWeek == null
      ? "rencana_pekan=belum_bernomor"
      : `rencana_item_pekan_ini=${r.plannedItemsThisWeek}` +
        (r.plannedItemNames?.length ? ` [${r.plannedItemNames.join("; ")}]` : "") +
        (r.unfinishedLastWeek != null ? ` komitmen_belum_tuntas=${r.unfinishedLastWeek}` : ""),
  ];
  return "- " + parts.join(" | ");
}

function riskLine(x: RiskItem): string {
  return `- [${x.category}/${x.severity} skor=${x.ruleScore}] ${x.locationName}: ${x.title} – ${x.evidence} (sumber: ${x.sourceRefIds.join(",")})`;
}

/** Risiko teratas yang ikut ke prompt; sisanya disebut jumlahnya, tidak dibuang diam-diam. */
const MAKS_RISIKO = 25;

/** Payload data pulse/variance/risk — kompak, satu baris per lokasi. */
export function buildPulsePayload(pulse: PortfolioPulse, opts?: { maxRows?: number }): string {
  const rows = pulse.rows.slice(0, opts?.maxRows ?? 30);
  const refs = pulse.sourceRefs.map((s) => `- ${s.id}: ${s.label}${s.value ? ` = ${s.value}` : ""}`);
  return [
    `PERIODE: ${pulse.periodStart} s/d ${pulse.periodEnd} (data terakhir berubah: ${pulse.dataAsOf ?? "belum ada data"})`,
    `TOTAL: ${pulse.totals.locations} lokasi | laporan final ${pulse.totals.reportsFinal}/${pulse.totals.reportsExpected} | deviasi negatif ${pulse.totals.negativeDeviationLocations} lokasi | kendala terbuka ${pulse.totals.openIssues} | recovery overdue ${pulse.totals.overdueRecoveries} | readiness rendah ${pulse.totals.lowReadinessLocations} lokasi`,
    "",
    "DATA PER LOKASI (angka RESMI – kutip persis):",
    ...rows.map(rowLine),
    "",
    "RISIKO (skor rule deterministik – jangan diubah):",
    ...(pulse.risks.length ? pulse.risks.slice(0, MAKS_RISIKO).map(riskLine) : ["- (tidak ada risiko terdeteksi rule)"]),
    // Pemotongan DISEBUTKAN. Daftar yang diam-diam dipangkas terbaca model (dan
    // pembaca laporannya) sebagai "cuma segini risikonya".
    ...(pulse.risks.length > MAKS_RISIKO
      ? [`- (+${pulse.risks.length - MAKS_RISIKO} risiko lain tidak ditampilkan; daftar dipotong ${MAKS_RISIKO} teratas menurut skor rule)`]
      : []),
    "",
    "DAFTAR SUMBER (pakai id ini utk sourceRefIds):",
    ...refs,
    ...((pulse.limitations?.length ?? 0) > 0
      ? ["", "BATAS SNAPSHOT (WAJIB disebut bila relevan):", ...(pulse.limitations ?? []).map((x) => `- ${x}`)]
      : []),
  ].join("\n");
}

/**
 * DAFTAR FAKTA yang boleh diklaim — dipakai kind `tanya` (DECISIONS 378).
 *
 * Tanpa daftar ini model harus MENEBAK sourceRef mana yang menopang metrik
 * mana, dan tanggal berapa yang berlaku. Tebakan yang meleset membuat klaimnya
 * ditolak validator, keyakinannya jatuh ke 0, dan penanya menerima "tidak punya
 * angka bersumber" untuk pertanyaan yang datanya justru ada — pagar yang
 * menghukum jawaban benar karena format rujukannya salah.
 *
 * Jadi bentuk yang diminta validator disodorkan apa adanya: satu baris per
 * (lokasi, metrik), lengkap dengan nilai, periode, dan sumbernya.
 */
export function buildFaktaPayload(
  pulse: PortfolioPulse,
  opts?: { maxRows?: number; tambahan?: FaktaResmi[]; refTambahan?: SourceRef[]; dilewati?: string[] },
): string {
  const rows = pulse.rows.slice(0, opts?.maxRows ?? 30);
  const diizinkan = new Set(rows.map((r) => r.locationId));
  const semua = [...faktaResmi(pulse).values(), ...(opts?.tambahan ?? [])];
  const baris = semua
    .filter((f) => diizinkan.has(f.locationId))
    .map(
      (f) =>
        `- locationId=${f.locationId} metric=${f.metric} value=${f.value} periodKey=${f.periodKey} sourceRefId=${f.sourceRefId}`,
    );
  const refs = (opts?.refTambahan ?? [])
    .filter((r) => r.value)
    .map((r) => `- ${r.id}: ${r.label} = ${r.value}`);

  return [
    "FAKTA YANG BOLEH DIKLAIM (salin PERSIS ke answerParts[].claims):",
    ...baris,
    ...(refs.length ? ["", "SUMBER TAMBAHAN (kontrak/keuangan/RAB/milestone):", ...refs] : []),
    /*
     * Wilayah yang DITAHAN disebut apa adanya (DECISIONS 379).
     *
     * Tanpa baris ini model menyimpulkan "tidak ada data keuangan" dan
     * menuliskannya sebagai fakta — jawaban yang salah untuk alasan yang tidak
     * kelihatan. Yang ditahan adalah ANGKANYA; keberadaan pagarnya sendiri
     * bukan rahasia, dan justru harus terbaca penanya supaya ia tahu harus
     * meminta akses, bukan mengira datanya belum diisi.
     */
    ...(opts?.dilewati?.length
      ? [
          "",
          `TIDAK DITAMPILKAN untuk peran penanya: ${opts.dilewati.join(", ")}.`,
          "Jangan menyimpulkan datanya kosong atau nol. Katakan bahwa angkanya tidak",
          "tersedia untuk peran penanya, dan sarankan menghubungi yang berwenang.",
        ]
      : []),
    "",
    "Setiap bagian jawaban yang menyebut angka WAJIB membawa claims dari daftar di atas,",
    "dengan value, periodKey, dan sourceRefId PERSIS seperti tertulis. Bagian yang menyebut",
    "angka tanpa claims yang cocok akan DIBUANG dan tidak pernah sampai ke penanya.",
  ].join("\n");
}

/**
 * CATATAN LAPANGAN yang ditemukan pencarian narasi (DECISIONS 382).
 *
 * Teksnya disodorkan APA ADANYA beserta `chunkId`-nya, karena validator menuntut
 * kutipan yang PERSIS. Model yang harus menebak bentuk kutipannya akan
 * menghasilkan parafrase, seluruh kutipannya ditolak, dan penanya menerima
 * jawaban kosong untuk pertanyaan yang catatannya justru ada.
 */
export function buildNarasiPayload(potongan: PotonganNarasi[]): string {
  if (potongan.length === 0) {
    return [
      "CATATAN LAPANGAN: tidak ada catatan yang cocok dengan pertanyaan ini.",
      "Jangan mengarang isi catatan. Katakan saja tidak ada catatan yang cocok.",
    ].join("\n");
  }
  const baris = potongan.map(
    (p) =>
      `- chunkId=${p.id} | ${LABEL_JENIS[p.jenis]} | ${p.namaLokasi}` +
      `${p.tanggal ? ` | ${p.tanggal}` : ""}\n  teks: ${p.teks.replace(/\s+/g, " ")}`,
  );
  return [
    "CATATAN LAPANGAN (teks yang ditulis pelapor – BUKAN angka resmi MARLIN):",
    ...baris,
    "",
    "ATURAN KUTIPAN – dijaga mesin, bukan sekadar anjuran:",
    "1. Bila memakai isi catatan, SALIN PERSIS potongan kalimatnya ke answerParts[].kutipan",
    "   ({ chunkId, teks }). Parafrase DITOLAK dan bagiannya dibuang.",
    "2. Setiap ANGKA yang kamu tulis harus berasal dari claims (angka resmi) ATAU",
    "   berada di dalam kutipan verbatim. Angka lain dianggap karangan dan bagiannya",
    "   DIBUANG.",
    "3. Angka di dalam catatan lapangan adalah KATA PELAPOR, bukan angka resmi MARLIN.",
    "   Sebutkan begitu; jangan menyajikannya sebagai hasil hitungan sistem.",
  ].join("\n");
}

/** Payload temuan kualitas data (utk run kualitas_data). */
export function buildQualityPayload(findings: QualityFinding[]): string {
  const active = findings.filter((f) => f.status === "gagal" || f.status === "periksa");
  return [
    "TEMUAN AUDIT KUALITAS DATA (status ditentukan rule – jangan diubah):",
    ...(active.length
      ? active.map(
          (f) => `- [${f.status}] ${f.locationName} · ${f.key}: ${f.label} – ${f.detail} (jumlah=${f.count})`,
        )
      : ["- Semua rule lulus."]),
  ].join("\n");
}

export const KIND_INSTRUCTION: Record<string, string> = {
  pulse: promptDefault("hub.kind.pulse"),
  deviasi: promptDefault("hub.kind.deviasi"),
  risiko: promptDefault("hub.kind.risiko"),
  kualitas_data: promptDefault("hub.kind.kualitas_data"),
  tanya: promptDefault("hub.kind.tanya"),
};
