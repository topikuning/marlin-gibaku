/**
 * Fungsi MURNI ringkasan chat grup (tanpa DB) — filter pesan noise & penyusun
 * konteks/prompt. Dipisah dari `chat-summary.ts` (server-only) agar unit-testable.
 * DECISIONS 137.
 */

/** Identitas paket utk konteks ringkasan — grup WA harus jelas milik pekerjaan apa. */
export type PackageContext = {
  packageName: string;
  packageNumber: string | null;
  workTitle: string | null;
  vendorName: string | null;
  waGroupName: string | null;
  locationNames: string[];
};

/**
 * Judul kontekstual grup: sebut pekerjaan & lokasi, bukan sekadar nama grup WA
 * yang sering generik ("KNMP Jawa"). Dipakai di prompt & header ringkasan.
 */
export function describePackageContext(ctx: PackageContext): string {
  const parts: string[] = [];
  parts.push(`Paket: ${ctx.packageName}${ctx.packageNumber ? ` (${ctx.packageNumber})` : ""}`);
  if (ctx.workTitle) parts.push(`Pekerjaan: ${ctx.workTitle}`);
  if (ctx.vendorName) parts.push(`Pelaksana: ${ctx.vendorName}`);
  if (ctx.locationNames.length > 0) {
    const shown = ctx.locationNames.slice(0, 6).join(", ");
    const more = ctx.locationNames.length > 6 ? ` (+${ctx.locationNames.length - 6} lokasi lain)` : "";
    parts.push(`Lokasi: ${shown}${more}`);
  }
  if (ctx.waGroupName) parts.push(`Nama grup WA: ${ctx.waGroupName}`);
  return parts.join(" · ");
}

/** Judul pendek utk header ringkasan & pesan WA (paket + pekerjaan bila ada). */
export function shortPackageTitle(ctx: PackageContext): string {
  return ctx.workTitle ? `${ctx.packageName} — ${ctx.workTitle}` : ctx.packageName;
}

const TEST_EXACT = new Set([
  "test",
  "tes",
  "testing",
  "tes123",
  "test123",
  "cek",
  "check",
  "ping",
  "halo",
  "hallo",
  "hai",
  "p",
  "ok",
  "oke",
  "siap",
  ".",
  "..",
  "...",
]);

/**
 * Pesan "noise" yang tidak layak masuk ringkasan: uji coba webhook/sistem dan
 * basa-basi satu kata. Konservatif — hanya menyaring pola jelas supaya pesan
 * operasional asli tidak ikut terbuang. MURNI & unit-tested.
 */
export function isNoiseMessage(body: string, opts?: { fromMe?: boolean }): boolean {
  const raw = body.trim();
  if (raw.length === 0) return true;
  const norm = raw.toLowerCase().replace(/[!?*_~]/g, "").trim();

  // Uji webhook/integrasi sistem (mis. "test webhook MARLIN", "webhook aktif").
  if (/\bwebhook\b/.test(norm)) return true;
  if (/\b(uji|test|tes)\b.*\b(sistem|webhook|integrasi|koneksi|bot)\b/.test(norm)) return true;
  if (/\bmarlin\b.*\b(test|tes|uji|webhook|aktif|terhubung)\b/.test(norm)) return true;

  // Basa-basi/uji satu kata (hanya bila SANGAT pendek — hindari buang pesan asli).
  if (norm.length <= 12 && TEST_EXACT.has(norm)) return true;

  // Pesan dari sistem sendiri yang sangat pendek → tidak informatif.
  if (opts?.fromMe && norm.length <= 3) return true;

  return false;
}

export type TranscriptLine = { timeLabel: string; fromName: string; body: string; hasMedia: boolean };

/** Susun transkrip berbatas karakter; kembalikan penanda truncation. MURNI. */
export function buildTranscript(
  lines: TranscriptLine[],
  maxChars: number,
): { transcript: string; truncated: boolean; used: number } {
  let transcript = "";
  let used = 0;
  for (const m of lines) {
    const line = `[${m.timeLabel}] ${m.fromName}: ${m.body}${m.hasMedia ? " [media]" : ""}\n`;
    if (transcript.length + line.length > maxChars) {
      return { transcript, truncated: true, used };
    }
    transcript += line;
    used++;
  }
  return { transcript, truncated: false, used };
}

/** Format pesan WhatsApp untuk mengirim ringkasan satu grup. MURNI. */
export function formatSummaryForWa(title: string, dateLabel: string, summaryText: string, messageCount: number): string {
  return [
    `*Ringkasan Chat Grup — ${title}*`,
    `${dateLabel} · ${messageCount} pesan`,
    "",
    summaryText.trim(),
    "",
    "_Ringkasan otomatis MARLIN dari percakapan grup. Perlu verifikasi manusia sebelum dijadikan dasar keputusan._",
  ].join("\n");
}

/** Format pesan WhatsApp untuk ringkasan GLOBAL (banyak grup sekaligus). MURNI. */
export function formatGlobalSummaryForWa(
  dateLabel: string,
  items: { title: string; summaryText: string; messageCount: number }[],
  overview: string | null,
): string {
  const out: string[] = [`*Ringkasan Chat Grup Lintas Paket*`, dateLabel, ""];
  if (overview) out.push(overview.trim(), "");
  for (const it of items) {
    out.push(`*${it.title}* (${it.messageCount} pesan)`, it.summaryText.trim(), "");
  }
  out.push("_Ringkasan otomatis MARLIN dari percakapan grup. Perlu verifikasi manusia sebelum dijadikan dasar keputusan._");
  return out.join("\n");
}
