import "server-only";
import { bacaanLaporanSchema, type BacaanLaporan } from "./bentuk";

const SKEMA_HINT = `{
  "tanggalTeks": string|null, "hariTeks": string|null, "lokasiTeks": string|null, "tahunAnggaran": number|null,
  "pekerjaan": [{ "no": string|null, "uraian": string, "volume": number|null, "satuan": string|null, "volumeRencana": number|null, "catatan": string|null }],
  "tenaga": [{ "jabatan": string, "pagi": number|null, "siang": number|null }],
  "bahan": [{ "nama": string, "merk": string|null, "teksTerima": string|null, "teksTolak": string|null }]
}`;

/**
 * Format laporan pelaksana yang belum dikenali pembaca templat dibaca AI
 * (pilihan user 2026-11-01: "Templat + AI"). Keluarannya divalidasi zod;
 * hasilnya tetap hanya pratinjau – orang yang memilih isi draft.
 */
export async function bacaDenganAi(
  buf: Buffer,
  nama: string,
): Promise<{ ok: true; bacaan: BacaanLaporan } | { ok: false; error: string }> {
  const { getActiveAiConfig } = await import("@/lib/ai/config");
  const cfg = await getActiveAiConfig();
  if (!cfg) return { ok: false, error: "AI belum disiapkan di Sistem → AI, jadi format lain belum bisa dibaca." };
  const { dukunganLampiran } = await import("@/lib/ai/client");
  const dukung = dukunganLampiran(cfg.jalurPdf);
  if (!dukung.pdf) return { ok: false, error: dukung.alasan };

  const { aiStructured } = await import("@/lib/ai/structured");
  const { promptDefault } = await import("@/lib/ai/prompt-registry");
  const { resolvePrompt } = await import("@/lib/ai/prompts");
  const r = await aiStructured(bacaanLaporanSchema, {
    system: (await resolvePrompt("harian.baca_pelaksana")) || promptDefault("harian.baca_pelaksana"),
    prompt: `Berkas: ${nama}\nSalin isi laporan harian ini sesuai skema.`,
    attachments: [{ mediaType: "application/pdf", dataBase64: buf.toString("base64"), nama }],
    schemaHint: SKEMA_HINT,
    maxTokens: 3000,
    timeoutMs: 120_000,
    tenggatTotalMs: 180_000,
  });
  if (!r.ok) return { ok: false, error: `AI gagal membaca berkas ini (${r.error}).` };
  return {
    ok: true,
    bacaan: { ...r.data, sumber: "ai", catatanBaca: ["Dibaca AI karena formatnya belum dikenali. Periksa setiap baris sebelum dimasukkan."] },
  };
}
