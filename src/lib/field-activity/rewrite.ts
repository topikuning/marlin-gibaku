/**
 * Perapian teks bebas laporan kegiatan lapangan (catatan / kendala / solusi).
 *
 * Lapisan MURNI — tanpa jaringan & tanpa DB, supaya penjaganya bisa diuji
 * tanpa memanggil model. Panggilan providernya ada di `rewrite-service.ts`.
 *
 * PRINSIP: AI di sini hanya MERAPIKAN BAHASA. Ia tidak boleh menambah fakta,
 * mengubah angka, menyimpulkan sebab, atau memperhalus kabar buruk. Karena
 * model bisa saja melanggar itu tanpa diminta, hasilnya TIDAK dipercaya
 * begitu saja: `verifyRewrite` memeriksa hasil secara deterministik dan
 * menolak usulan yang menyelundupkan angka/persentase baru atau melar terlalu
 * jauh dari aslinya. Usulan juga TIDAK PERNAH langsung tersimpan — pengguna
 * yang memutuskan memakai atau membuang (DECISIONS 178).
 */

export type RewriteField = "notes" | "kendala" | "solusi";

export const REWRITE_FIELD_LABEL: Record<RewriteField, string> = {
  notes: "Catatan kegiatan",
  kendala: "Kendala",
  solusi: "Tindak lanjut",
};

/** Panjang maksimal teks yang dilayani (samakan dgn maxLength textarea). */
export const REWRITE_MAX_CHARS = 2000;
/** Di bawah ini tidak usah dirapikan — belum ada yang bisa dirapikan. */
export const REWRITE_MIN_CHARS = 12;

const FIELD_INSTRUCTION: Record<RewriteField, string> = {
  notes:
    "Catatan pelaksanaan kegiatan: tulis apa yang dikerjakan/dibahas dan hasilnya, urut dan lugas.",
  kendala:
    "Kendala lapangan: tulis hambatan apa adanya, tanpa memperhalus dan tanpa menuduh pihak tertentu.",
  solusi:
    "Tindak lanjut: tulis langkah yang disepakati atau dilakukan; jangan menjanjikan hal yang tidak tertulis di teks asli.",
};

export const REWRITE_SYSTEM_PROMPT = [
  "Anda editor bahasa untuk laporan proyek konstruksi pemerintah di Indonesia.",
  "Tugas Anda HANYA merapikan tulisan lapangan menjadi bahasa Indonesia baku yang formal dan enak dibaca.",
  "",
  "ATURAN MUTLAK:",
  "1. JANGAN menambah informasi apa pun yang tidak ada di teks asli — tidak ada angka baru, tanggal baru, nama baru, penyebab baru, maupun kesimpulan baru.",
  "2. Angka, satuan, tanggal, nama orang/instansi, dan istilah teknis disalin PERSIS seperti aslinya.",
  "3. Jangan memperhalus atau menghilangkan kabar buruk. Kendala tetap ditulis sebagai kendala.",
  "4. Singkatan lapangan yang jelas boleh dipanjangkan (mis. 'dgn' → 'dengan'), tetapi istilah teknis dan singkatan resmi dibiarkan.",
  "5. Bila teks asli terlalu pendek atau tidak jelas, rapikan seadanya. JANGAN mengarang pelengkap.",
  "6. Balas HANYA teks hasil perapian. Tanpa pengantar, tanpa penjelasan, tanpa tanda kutip pembungkus, tanpa penanda markdown.",
  "7. Panjang hasil sepadan dengan aslinya — merapikan, bukan mengarang paragraf baru.",
].join("\n");

export type RewriteContext = {
  field: RewriteField;
  text: string;
  /** Label jenis kegiatan (mis. "Rapat Koordinasi") — konteks gaya, bukan fakta baru. */
  kindLabel?: string | null;
  /** Judul kegiatan, bila ada. */
  title?: string | null;
};

export function buildRewritePrompt(ctx: RewriteContext): string {
  const lines = [`BAGIAN YANG DIRAPIKAN: ${REWRITE_FIELD_LABEL[ctx.field]}`];
  if (ctx.kindLabel) lines.push(`Jenis kegiatan: ${ctx.kindLabel}`);
  if (ctx.title) lines.push(`Judul kegiatan: ${ctx.title}`);
  lines.push(FIELD_INSTRUCTION[ctx.field]);
  lines.push("", "=== TEKS ASLI ===", ctx.text.trim());
  return lines.join("\n");
}

/**
 * Bersihkan balasan model: buang pembungkus kutip/markdown yang kadang muncul,
 * rapikan spasi, potong ke batas kolom.
 */
export function cleanRewrite(raw: string): string {
  let t = raw.trim();
  // Buang blok kode ```…``` bila model membungkusnya.
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();
  // Buang tanda kutip pembungkus penuh.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) {
    t = t.slice(1, -1).trim();
  }
  // Penanda markdown di awal baris (bullet/heading/penebalan) tidak dipakai di
  // blanko KKP — teks laporan dicetak polos.
  t = t
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]|#{1,6}|\d+[.)])\s+/, (m) => (/\d/.test(m) ? m.trim() + " " : "")))
    .join("\n");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.slice(0, REWRITE_MAX_CHARS).trim();
}

/** Semua angka pada teks (termasuk desimal koma/titik & persen). */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

export type RewriteVerdict = { ok: boolean; problems: string[] };

/**
 * Penjaga deterministik: usulan ditolak bila menyelundupkan fakta baru.
 * Sengaja konservatif — lebih baik menolak usulan bagus daripada meloloskan
 * angka karangan ke dokumen yang ditandatangani.
 */
export function verifyRewrite(original: string, rewritten: string): RewriteVerdict {
  const problems: string[] = [];
  const out = rewritten.trim();
  if (out.length === 0) {
    return { ok: false, problems: ["Hasil kosong."] };
  }

  // 1. Angka baru yang tidak ada di teks asli.
  const before = new Set(numbersIn(original));
  const added = [...new Set(numbersIn(out))].filter((n) => !before.has(n));
  if (added.length > 0) {
    problems.push(`Ada angka yang tidak ada di teks asli: ${added.slice(0, 5).join(", ")}.`);
  }

  // 2. Angka asli yang HILANG — perapian tidak boleh membuang data.
  const after = new Set(numbersIn(out));
  const dropped = [...before].filter((n) => !after.has(n));
  if (dropped.length > 0) {
    problems.push(`Ada angka dari teks asli yang hilang: ${dropped.slice(0, 5).join(", ")}.`);
  }

  // 3. Melar terlalu jauh = mengarang, bukan merapikan.
  const limit = Math.max(120, Math.round(original.trim().length * 2.2));
  if (out.length > limit) {
    problems.push("Hasil jauh lebih panjang dari teks asli (mengarang, bukan merapikan).");
  }

  // 4. Model membalas dengan komentar, bukan teks laporan.
  if (/^(baik|tentu|berikut|maaf|sebagai model|saya tidak)\b/i.test(out)) {
    problems.push("Model membalas dengan pengantar, bukan teks laporan.");
  }

  return { ok: problems.length === 0, problems };
}

/** Alasan teks tidak perlu/boleh dirapikan (null = boleh diproses). */
export function rewriteInputProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < REWRITE_MIN_CHARS) return "Teks masih terlalu pendek untuk dirapikan.";
  if (t.length > REWRITE_MAX_CHARS) return `Teks melebihi ${REWRITE_MAX_CHARS} karakter.`;
  return null;
}
