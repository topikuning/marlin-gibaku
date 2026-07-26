import type { ExecData } from "./gather";
import type { ExecReportKey } from "./catalog";

/**
 * Susun prompt AI untuk laporan eksekutif. Data terstruktur diserialisasi jadi
 * teks ringkas; instruksi menegaskan HANYA memakai data (tidak mengarang) &
 * memformat untuk WhatsApp. DECISIONS 122.
 */

function serializeLocations(data: ExecData): string {
  if (data.locations.length === 0) return "(tidak ada lokasi dalam cakupan)";
  return data.locations
    .map((l) => {
      const rep = l.reportStatus ? `laporan: ${l.reportStatus}` : "laporan: BELUM LAPOR";
      const cuaca = l.weather ? `, cuaca ${l.weather}` : "";
      const keg =
        l.activities.length > 0
          ? l.activities.map((a) => `${a.label}: ${a.title}${a.final ? "" : " (draft)"}`).join("; ")
          : "tidak ada kegiatan tercatat";
      const kendala =
        l.openIssues.length > 0
          ? l.openIssues.map((i) => `[${i.severity}] ${i.title}`).join("; ")
          : "tidak ada kendala terbuka";
      return `- ${l.name} (${l.province} · ${l.packageName}) — ${rep}${cuaca}. Kegiatan: ${keg}. Kendala: ${kendala}.`;
    })
    .join("\n");
}

const SYSTEM =
  "Kamu asisten pengendali proyek MARLIN (program Kampung Nelayan Merah Putih / KNMP). " +
  "Tugasmu menulis laporan eksekutif untuk direksi/manajemen yang dikirim via WhatsApp, dalam " +
  "Bahasa Indonesia yang ringkas, profesional, dan faktual. ATURAN PENTING: gunakan HANYA data " +
  "yang diberikan — JANGAN mengarang angka, nama, atau fakta yang tidak ada. Bila data kosong, " +
  "katakan apa adanya. Format WhatsApp: *tebal* untuk judul/penekanan, '- ' untuk poin. Ringkas " +
  "(± maksimal 1500 karakter). Tanpa salam berlebihan, langsung ke inti.";

const INSTRUCTIONS: Record<ExecReportKey, string> = {
  rangkuman_kegiatan:
    "Tulis RANGKUMAN KEGIATAN semua lokasi periode ini untuk direksi. Mulai dengan ringkasan sekilas " +
    "(jumlah lokasi, berapa sudah/belum lapor). Lalu sorot per lokasi yang ada kegiatan atau kendala " +
    "penting (lokasi tanpa aktivitas cukup disebut ringkas atau dikelompokkan). Tegaskan kendala berat/kritis.",
  rekap_kendala:
    "Tulis REKAP KENDALA lintas lokasi periode ini. Fokus hanya pada kendala terbuka; urutkan dari yang " +
    "paling berat (kritis > tinggi > sedang > rendah). Untuk tiap kendala berat, beri saran tindakan " +
    "singkat yang wajar. Bila tak ada kendala, nyatakan aman.",
  kepatuhan_lapor:
    "Tulis STATUS KEPATUHAN LAPOR periode ini. Sebutkan berapa lokasi sudah lapor dan berapa belum, lalu " +
    "DAFTAR lokasi yang BELUM lapor (paling penting untuk ditindaklanjuti). Ringkas.",
};

export function buildExecPrompt(
  key: ExecReportKey,
  data: ExecData,
  periodLabel: string,
): { system: string; prompt: string } {
  const prompt =
    `${INSTRUCTIONS[key]}\n\n` +
    `Periode: ${periodLabel}\n` +
    `Total lokasi dalam cakupan: ${data.totalLocations}; sudah lapor: ${data.reportedCount}; belum lapor: ${
      data.totalLocations - data.reportedCount
    }.\n\n` +
    `DATA PER LOKASI:\n${serializeLocations(data)}\n\n` +
    `Tulis laporannya sekarang (siap kirim ke WhatsApp).`;
  return { system: SYSTEM, prompt };
}
