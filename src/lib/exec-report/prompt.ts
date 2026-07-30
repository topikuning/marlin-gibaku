import { promptDefault } from "@/lib/ai/prompt-registry";
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

const SYSTEM = promptDefault("exec.system");

const INSTRUCTIONS: Record<ExecReportKey, string> = {
  rangkuman_kegiatan: promptDefault("exec.rangkuman_kegiatan"),
  rekap_kendala: promptDefault("exec.rekap_kendala"),
  kepatuhan_lapor: promptDefault("exec.kepatuhan_lapor"),
};


export function buildExecPrompt(
  key: ExecReportKey,
  data: ExecData,
  periodLabel: string,
  /** Teks dari Sistem → Prompt AI; kosong = pakai bawaan registri. */
  override?: { system?: string; instruction?: string },
): { system: string; prompt: string } {
  const prompt =
    `${override?.instruction?.trim() || INSTRUCTIONS[key]}\n\n` +
    `Periode: ${periodLabel}\n` +
    `Total lokasi dalam cakupan: ${data.totalLocations}; sudah lapor: ${data.reportedCount}; belum lapor: ${
      data.totalLocations - data.reportedCount
    }.\n\n` +
    `DATA PER LOKASI:\n${serializeLocations(data)}\n\n` +
    `Tulis laporannya sekarang (siap kirim ke WhatsApp).`;
  return { system: override?.system?.trim() || SYSTEM, prompt };
}
