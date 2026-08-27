/**
 * Konteks percakapan yang aman dikirim ke model.
 *
 * Riwayat hanya dipakai untuk melengkapi rujukan seperti "yang tadi" atau
 * "kalau minggu lalu?". Pesan terbaru selalu menang; riwayat tidak pernah
 * memperluas scope data yang sudah diputuskan server.
 */
export type AiConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Bersihkan JSON riwayat yang tersimpan sebelum masuk prompt. */
export function sanitizeConversationHistory(value: unknown): AiConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is AiConversationTurn =>
        !!turn &&
        typeof turn === "object" &&
        ((turn as { role?: unknown }).role === "user" || (turn as { role?: unknown }).role === "assistant") &&
        typeof (turn as { content?: unknown }).content === "string",
    )
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2_000) }))
    .slice(-8);
}

function ringkasIsi(content: string, maxChars: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function conversationContextBlock(
  turns: readonly AiConversationTurn[],
  opts: { maxTurns?: number; maxChars?: number } = {},
): string {
  const maxTurns = opts.maxTurns ?? 8;
  const maxChars = opts.maxChars ?? 6_000;
  if (turns.length === 0 || maxTurns <= 0 || maxChars <= 0) return "";

  const selected = turns.slice(-maxTurns);
  const footer =
    "Gunakan riwayat hanya untuk melengkapi bagian yang benar-benar hilang. Jangan menyalin scope, tanggal, atau maksud lama bila pesan terbaru menggantinya.";
  const lines: string[] = [
    "RIWAYAT PERCAKAPAN (hanya konteks; pertanyaan terbaru selalu menang):",
  ];
  let used = lines[0].length + footer.length + 2;
  for (const turn of selected) {
    const label = turn.role === "user" ? "Penanya" : "MARLIN";
    const remaining = maxChars - used - label.length - 4;
    if (remaining < 20) break;
    const line = `${label}: ${ringkasIsi(turn.content, remaining)}`;
    lines.push(line);
    used += line.length + 1;
  }
  lines.push(footer);
  return lines.join("\n");
}
