/**
 * Pembaca respons Messages API Anthropic yang memakai alat `web_search`
 * (DECISIONS 806) – murni.
 *
 * Bentuk bloknya (dokumentasi resmi): `server_tool_use` (kueri), lalu
 * `web_search_tool_result` berisi daftar `web_search_result` {url, title,
 * page_age} – atau, bila gagal, SATU objek `web_search_tool_result_error`
 * {error_code}; teks jawaban di blok `text` yang bisa membawa `citations`
 * bertipe `web_search_result_location` {url, title, cited_text}.
 */
import { normalUrl, type SumberHarga } from "./aturan";

export type HasilPencarian = {
  /** Teks gabungan blok `text`. */
  teks: string;
  /** Alamat yang benar-benar dikembalikan pencarian (kunci = `normalUrl`). */
  ditemukan: Map<string, SumberHarga>;
  /** Kueri yang dijalankan. */
  kueri: string[];
  /** Kode galat pencarian (rate limit, dll.) – pencarian itu tidak berhasil. */
  galat: string[];
  stopReason: string | null;
  model: string | null;
  pencarian: number;
  inputTokens: number;
  outputTokens: number;
};

type Blok = {
  type?: string;
  text?: string;
  name?: string;
  input?: { query?: unknown };
  content?: unknown;
  citations?: { type?: string; url?: string; title?: string }[];
};

function tambah(peta: Map<string, SumberHarga>, url: unknown, judul: unknown) {
  if (typeof url !== "string") return;
  const n = normalUrl(url);
  if (!n || peta.has(n)) return;
  peta.set(n, { url, judul: typeof judul === "string" ? judul : "" });
}

export function bacaHasilPencarian(json: unknown, awal?: HasilPencarian): HasilPencarian {
  const j = (json ?? {}) as {
    model?: string;
    stop_reason?: string;
    content?: Blok[];
    usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
  };
  const h: HasilPencarian = awal
    ? { ...awal, ditemukan: new Map(awal.ditemukan), kueri: [...awal.kueri], galat: [...awal.galat] }
    : { teks: "", ditemukan: new Map(), kueri: [], galat: [], stopReason: null, model: null, pencarian: 0, inputTokens: 0, outputTokens: 0 };
  const teks: string[] = [];
  for (const b of j.content ?? []) {
    if (b.type === "text" && typeof b.text === "string") {
      teks.push(b.text);
      for (const c of b.citations ?? []) if (c.type === "web_search_result_location") tambah(h.ditemukan, c.url, c.title);
    } else if (b.type === "server_tool_use" && b.name === "web_search" && typeof b.input?.query === "string") {
      h.kueri.push(b.input.query);
    } else if (b.type === "web_search_tool_result") {
      if (Array.isArray(b.content)) {
        for (const r of b.content as { type?: string; url?: unknown; title?: unknown }[])
          if (r.type === "web_search_result") tambah(h.ditemukan, r.url, r.title);
      } else if (b.content && typeof b.content === "object") {
        const e = b.content as { error_code?: unknown };
        if (typeof e.error_code === "string") h.galat.push(e.error_code);
      }
    }
  }
  // Teks respons lanjutan (sesudah pause_turn) menyambung teks sebelumnya.
  h.teks = [h.teks, teks.join("")].filter(Boolean).join("");
  h.stopReason = typeof j.stop_reason === "string" ? j.stop_reason : h.stopReason;
  h.model = typeof j.model === "string" ? j.model : h.model;
  h.pencarian += Number(j.usage?.server_tool_use?.web_search_requests ?? 0) || 0;
  h.inputTokens += Number(j.usage?.input_tokens ?? 0) || 0;
  h.outputTokens += Number(j.usage?.output_tokens ?? 0) || 0;
  return h;
}

/** Galat 400 karena pencarian web dimatikan di Console organisasi. */
export function webDimatikan(status: number, body: string): boolean {
  return status === 400 && /web.?search/i.test(body) && /(not enabled|disabled|tidak aktif)/i.test(body);
}
