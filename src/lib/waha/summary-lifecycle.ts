/**
 * Siklus hidup ringkasan chat grup — MURNI (tanpa DB), unit-tested.
 * Prinsip DECISIONS 139: keluaran AI TIDAK PERNAH otomatis final. Alur wajib
 * belum_dibuat → draft_ai → (edited_draft) → final → sent.
 */

import type { MessageClass, Relevance } from "./message-classify";
import { RELEVANCE_ORDER } from "./message-classify";

/** Status tersimpan di DB (enum WaChatSummaryStatus). */
export type SummaryStatus = "draft_ai" | "edited_draft" | "final" | "sent";

/** Status tampilan — termasuk kondisi "belum ada baris ringkasan". */
export type SummaryViewStatus = "belum_dibuat" | SummaryStatus;

export const SUMMARY_STATUS_LABEL: Record<SummaryViewStatus, string> = {
  belum_dibuat: "Belum dibuat",
  draft_ai: "Draf AI",
  edited_draft: "Draf disunting",
  final: "Final",
  sent: "Terkirim",
};

export const SUMMARY_STATUS_TONE: Record<SummaryViewStatus, "neutral" | "info" | "warning" | "success"> = {
  belum_dibuat: "neutral",
  draft_ai: "warning",
  edited_draft: "info",
  final: "success",
  sent: "success",
};

/** Penjelasan satu kalimat — dipakai sebagai subtitle panel kanan. */
export const SUMMARY_STATUS_HINT: Record<SummaryViewStatus, string> = {
  belum_dibuat: "Belum ada draf untuk tanggal ini. Hasilkan draf AI dari bukti percakapan.",
  draft_ai: "Draf mentah dari AI – wajib dibaca & diverifikasi sebelum difinalkan.",
  edited_draft: "Sudah disunting manusia, belum difinalkan.",
  final: "Sudah diverifikasi. Siap dikirim ke kontak WhatsApp.",
  sent: "Sudah dikirim. Menyunting ulang akan mengembalikan status ke draf disunting.",
};

const TRANSITIONS: Record<SummaryViewStatus, SummaryStatus[]> = {
  belum_dibuat: ["draft_ai"],
  draft_ai: ["draft_ai", "edited_draft", "final"],
  edited_draft: ["draft_ai", "edited_draft", "final"],
  // Final boleh diregenerasi (kembali jadi draf) atau disunting lagi.
  final: ["draft_ai", "edited_draft", "sent"],
  sent: ["draft_ai", "edited_draft"],
};

export function canTransition(from: SummaryViewStatus, to: SummaryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Ringkasan hanya boleh dikirim setelah difinalkan (atau kirim ulang). */
export function canSend(status: SummaryViewStatus): boolean {
  return status === "final" || status === "sent";
}

/** Boleh difinalkan bila ada draf yang sudah dilihat manusia. */
export function canFinalize(status: SummaryViewStatus): boolean {
  return status === "draft_ai" || status === "edited_draft";
}

export type TransitionResult = { ok: true; status: SummaryStatus } | { ok: false; error: string };

/** Gerbang transisi — satu-satunya tempat aturan status ringkasan ditegakkan. */
export function transitionSummary(from: SummaryViewStatus, to: SummaryStatus): TransitionResult {
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `Status "${SUMMARY_STATUS_LABEL[from]}" tidak bisa langsung menjadi "${SUMMARY_STATUS_LABEL[to]}".`,
    };
  }
  return { ok: true, status: to };
}

/* ── Keyakinan (confidence) ─────────────────────────────────────────────── */

export type ConfidenceInput = {
  /** Pesan yang benar-benar dipakai jadi bahan ringkasan. */
  usedCount: number;
  /** Pesan yang disaring (uji sistem/konteks rendah). */
  excludedCount: number;
  /** Pesan yang butuh tafsir manusia (lampiran tanpa teks, tanpa kata kunci). */
  needsInterpretationCount: number;
  /** Kiriman resmi MARLIN pada hari itu (data domain — penambat fakta). */
  marlinCount: number;
  /** Transkrip terpotong karena panjang. */
  truncated: boolean;
};

/**
 * Skor keyakinan 0–100. Deterministik & konservatif — AI tidak menilai dirinya
 * sendiri. Sedikit bukti / banyak pesan ambigu ⇒ skor turun.
 */
export function computeConfidence(input: ConfidenceInput): number {
  const { usedCount, excludedCount, needsInterpretationCount, marlinCount, truncated } = input;
  if (usedCount === 0 && marlinCount === 0) return 0;

  let score = 40;
  // Volume bukti: makin banyak pesan terpakai makin yakin (jenuh di 20 pesan).
  score += Math.min(usedCount, 20) * 2; // maks +40
  // Kiriman resmi MARLIN = fakta bernomor, penambat kuat.
  score += Math.min(marlinCount, 4) * 4; // maks +16

  const total = usedCount + excludedCount;
  if (total > 0) {
    const ambiguousRatio = needsInterpretationCount / total;
    score -= Math.round(ambiguousRatio * 25);
    const excludedRatio = excludedCount / total;
    if (excludedRatio > 0.5) score -= 10;
  }
  if (truncated) score -= 10;
  if (usedCount < 3 && marlinCount === 0) score -= 15;

  return Math.max(0, Math.min(100, score));
}

export function confidenceTone(score: number): "success" | "warning" | "danger" {
  if (score >= 70) return "success";
  if (score >= 45) return "warning";
  return "danger";
}

export function confidenceLabel(score: number): string {
  if (score >= 70) return "Tinggi";
  if (score >= 45) return "Sedang";
  return "Rendah";
}

/* ── Urutan bukti untuk prompt ──────────────────────────────────────────── */

/**
 * Urutkan pesan berdasarkan bobot relevansi (tinggi dulu), stabil pada urutan
 * waktu asli untuk relevansi yang sama. Dipakai memilih porsi konteks prompt
 * saat transkrip harus dipotong — kendala tidak boleh kalah oleh basa-basi.
 */
export function orderByRelevance<T extends { class: MessageClass }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const d = RELEVANCE_ORDER[a.item.class.relevance] - RELEVANCE_ORDER[b.item.class.relevance];
      return d !== 0 ? d : a.index - b.index;
    })
    .map((x) => x.item);
}

/** Hitung pesan per tingkat relevansi (untuk KPI panel kiri). */
export function countByRelevance(classes: MessageClass[]): Record<Relevance, number> {
  const out: Record<Relevance, number> = {
    sangat_relevan: 0,
    relevan: 0,
    perlu_interpretasi: 0,
    konteks_rendah: 0,
  };
  for (const c of classes) out[c.relevance]++;
  return out;
}

/* ── Riwayat pengiriman ─────────────────────────────────────────────────── */

export type SummaryDispatch = { at: string; target: string; chatId: string; byId: string | null };

/** Baca kolom Json `dispatches` dengan aman (data lama/bentuk tak terduga → []). */
export function parseDispatches(raw: unknown): SummaryDispatch[] {
  if (!Array.isArray(raw)) return [];
  const out: SummaryDispatch[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.at !== "string" || typeof o.target !== "string") continue;
    out.push({
      at: o.at,
      target: o.target,
      chatId: typeof o.chatId === "string" ? o.chatId : "",
      byId: typeof o.byId === "string" ? o.byId : null,
    });
  }
  return out;
}
