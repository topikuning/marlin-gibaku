import { promptDefault } from "@/lib/ai/prompt-registry";
/**
 * Perapian teks bebas laporan kegiatan lapangan (catatan / kendala / solusi).
 *
 * Lapisan MURNI — tanpa jaringan & tanpa DB, supaya penjaganya bisa diuji
 * tanpa memanggil model. Panggilan providernya ada di `rewrite-service.ts`.
 *
 * ALUR (DECISIONS 179): perapian TIDAK mengganggu saat mengetik. Orang lapangan
 * mengisi semuanya dulu; pilihan "Rapikan bahasa" / "Bahasa teknis" muncul saat
 * MENFINALKAN kegiatan, sekali untuk seluruh teks bebas, dengan pratinjau
 * asli-vs-usulan per bagian yang bisa dicentang satu per satu.
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

/** Dua gaya yang ditawarkan saat finalisasi. */
export type RewriteStyle = "rapi" | "teknis";

export const REWRITE_STYLE_LABEL: Record<RewriteStyle, string> = {
  rapi: "Rapikan bahasa",
  teknis: "Bahasa teknis",
};

export const REWRITE_STYLE_HINT: Record<RewriteStyle, string> = {
  rapi: "Bahasa Indonesia baku yang lugas – kalimat lapangan dirapikan seperlunya.",
  teknis: "Register teknis laporan konstruksi (kalimat pasif, istilah baku pekerjaan sipil).",
};

const STYLE_INSTRUCTION: Record<RewriteStyle, string> = {
  rapi: promptDefault("kegiatan.rewrite.rapi"),
  teknis: promptDefault("kegiatan.rewrite.teknis"),
};


const FIELD_INSTRUCTION: Record<RewriteField, string> = {
  notes:
    "Catatan pelaksanaan kegiatan: tulis apa yang dikerjakan/dibahas dan hasilnya, urut dan lugas.",
  kendala:
    "Kendala lapangan: tulis hambatan apa adanya, tanpa memperhalus dan tanpa menuduh pihak tertentu.",
  solusi:
    "Tindak lanjut: tulis langkah yang disepakati atau dilakukan; jangan menjanjikan hal yang tidak tertulis di teks asli.",
};

export const REWRITE_SYSTEM_PROMPT = promptDefault("kegiatan.rewrite.system");

/** Penanda bagian pada mode gabungan (satu panggilan untuk semua teks bebas). */
export const SECTION_MARK: Record<RewriteField, string> = {
  notes: "[CATATAN]",
  kendala: "[KENDALA]",
  solusi: "[TINDAK_LANJUT]",
};

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
 * Prompt GABUNGAN: seluruh teks bebas kegiatan dalam satu panggilan (hemat
 * kuota & konsisten gayanya), dibalas dengan penanda bagian yang diurai
 * deterministik oleh `parseBatchRewrite`.
 */
export function buildBatchRewritePrompt(input: {
  fields: { field: RewriteField; text: string }[];
  style: RewriteStyle;
  kindLabel?: string | null;
  title?: string | null;
  /** Instruksi gaya dari Sistem → Prompt AI; kosong = bawaan registri. */
  styleInstruction?: string | null;
}): string {
  const lines: string[] = [];
  if (input.kindLabel) lines.push(`Jenis kegiatan: ${input.kindLabel}`);
  if (input.title) lines.push(`Judul kegiatan: ${input.title}`);
  lines.push(input.styleInstruction?.trim() || STYLE_INSTRUCTION[input.style], "");
  lines.push("Rapikan SETIAP bagian di bawah. Balas dengan penanda bagian yang sama persis:");
  lines.push(input.fields.map((f) => SECTION_MARK[f.field]).join(" "), "");
  for (const f of input.fields) {
    lines.push(`${SECTION_MARK[f.field]} ${REWRITE_FIELD_LABEL[f.field]} – ${FIELD_INSTRUCTION[f.field]}`);
    lines.push(f.text.trim(), "");
  }
  return lines.join("\n");
}

/**
 * Urai balasan bergabung menjadi per bagian. Bagian yang tidak muncul di
 * balasan tidak dikarang — cukup absen (pemanggil mempertahankan teks asli).
 */
export function parseBatchRewrite(raw: string): Partial<Record<RewriteField, string>> {
  const out: Partial<Record<RewriteField, string>> = {};
  const marks = Object.entries(SECTION_MARK) as [RewriteField, string][];
  for (const [field, mark] of marks) {
    const start = raw.indexOf(mark);
    if (start < 0) continue;
    const after = start + mark.length;
    // Bagian berakhir di penanda berikutnya (mana pun yang paling dekat).
    let end = raw.length;
    for (const [, other] of marks) {
      const idx = raw.indexOf(other, after);
      if (idx >= 0 && idx < end) end = idx;
    }
    const body = cleanRewrite(raw.slice(after, end));
    if (body) out[field] = body;
  }
  return out;
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

export type RewriteVerdict = {
  /** false HANYA bila tidak ada yang bisa ditampilkan (hasil kosong). */
  ok: boolean;
  problems: string[];
  /** Catatan yang WAJIB tampil bersama usulan; pengguna yang memutuskan. */
  warnings: string[];
};

/**
 * Pemeriksa usulan — MENANDAI, BUKAN MEMBLOKIR (keputusan user 29 Juli 2026,
 * DECISIONS 181).
 *
 * Versi pertama memblokir usulan yang lebih panjang dari 2,2× teks asli. Itu
 * salah arah: teks lapangan pendek ("cor kolom 12 titik") memang WAJAR memanjang
 * saat dibakukan, sehingga seluruh usulan tertolak walau benar. Dan yang lebih
 * penting: usulan TIDAK PERNAH tersimpan sendiri — pengguna melihat asli vs
 * usulan berdampingan lalu mencentang. Jadi tugas lapisan ini memberi tahu apa
 * yang perlu diperiksa, bukan memutuskan untuk pengguna.
 *
 * Satu-satunya alasan usulan tidak ditampilkan: hasilnya kosong (tak ada yang
 * bisa diputuskan). Sisanya — angka baru, angka hilang, hasil memanjang,
 * balasan berupa pengantar model — muncul sebagai CATATAN di sebelah usulan.
 */
export function verifyRewrite(original: string, rewritten: string): RewriteVerdict {
  const warnings: string[] = [];
  const out = rewritten.trim();
  const asli = original.trim();
  if (out.length === 0) {
    return { ok: false, problems: ["Hasil kosong."], warnings: [] };
  }

  const before = new Set(numbersIn(asli));
  const after = new Set(numbersIn(out));

  const added = [...after].filter((n) => !before.has(n));
  if (added.length > 0) {
    warnings.push(
      `Ada angka yang tidak ada di teks asli: ${added.slice(0, 5).join(", ")}. Periksa sebelum dipakai.`,
    );
  }

  const dropped = [...before].filter((n) => !after.has(n));
  if (dropped.length > 0) {
    warnings.push(`Angka dari teks asli tidak muncul lagi: ${dropped.slice(0, 5).join(", ")}.`);
  }

  // Memanjang itu normal saat membakukan kalimat pendek; hanya diberi catatan
  // bila selisihnya besar sekali.
  if (out.length > Math.max(400, asli.length * 3)) {
    warnings.push("Hasil jauh lebih panjang dari teks asli – periksa apakah ada tambahan yang tidak Anda maksud.");
  }

  if (/^(baik|tentu|berikut|maaf|sebagai model|saya tidak)\b/i.test(out)) {
    warnings.push("Hasil dimulai seperti pengantar model, bukan teks laporan.");
  }

  return { ok: true, problems: [], warnings };
}

/** Alasan teks tidak perlu/boleh dirapikan (null = boleh diproses). */
export function rewriteInputProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < REWRITE_MIN_CHARS) return "Teks masih terlalu pendek untuk dirapikan.";
  if (t.length > REWRITE_MAX_CHARS) return `Teks melebihi ${REWRITE_MAX_CHARS} karakter.`;
  return null;
}
