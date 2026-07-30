import { TYPE_LABEL, TYPE_SHORT } from "@/lib/documents-meta";
import { formatTanggal } from "@/lib/format";
import type { DocumentType } from "@/generated/prisma/enums";

/**
 * Nama TAMPILAN dokumen — diturunkan dari data, bukan dari judul yang diketik
 * pengunggah. Orang lapangan mengunggah dengan judul apa adanya ("scan",
 * "IMG_0231", "dokumen") sehingga daftar dokumen tidak bisa dibedakan satu
 * dengan lainnya. Nama tampilan selalu memuat: istilah dokumen · desa/paket ·
 * tanggal · nomor, plus penanda "berkas ke-n" bila ada beberapa berkas sejenis
 * untuk konteks yang sama (dokumen KKP sering discan terpisah per lembar).
 *
 * MURNI (tanpa DB/network/Date.now) — aman dipakai di server & client component.
 * Judul yang diketik TIDAK dibuang: ia turun menjadi keterangan sekunder bila
 * benar-benar menambah informasi.
 */

export type DocumentLabelInput = {
  type: DocumentType;
  /** Judul yang diketik pengunggah (boleh kosong/asal). */
  title?: string | null;
  docNumber?: string | null;
  docDate?: Date | null;
  /** Konteks dokumen; lokasi lebih spesifik daripada paket. */
  locationName?: string | null;
  packageName?: string | null;
  /** Urutan berkas dalam grup sejenis (1-based) — lihat documentSequence(). */
  index?: number;
  total?: number;
};

export type DocumentLabel = {
  /** Nama utama untuk tautan/judul kolom. */
  name: string;
  /** Judul asli pengunggah bila menambah informasi; null bila mubazir. */
  secondary: string | null;
};

/** Kunci pembanding: huruf & angka saja, huruf kecil. */
function normalizeForCompare(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

/** Nomor dokumen sering panjang ("027/PPK-KNMP/V/2026") — dipendekkan di label. */
function shortNumber(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed.length <= 28 ? trimmed : `${trimmed.slice(0, 27)}…`;
}

/**
 * Judul dianggap mubazir bila tidak menambah apa pun di atas nama turunan:
 * sama dengan istilah/label jenis dokumen, atau isinya sudah termuat di nama
 * (mis. judul "SPMK Kedungrejo" saat nama "SPMK · Kedungrejo · 12 Mei 2026"),
 * atau hanya nama berkas hasil scan tanpa makna.
 */
const MEANINGLESS_TITLE = /^(scan|scanned|dokumen|document|file|berkas|foto|image|img|photo|untitled|new doc)[\s_-]*\d*$/i;

function isRedundantTitle(title: string, name: string, type: DocumentType): boolean {
  const t = normalizeForCompare(title);
  if (!t) return true;
  if (MEANINGLESS_TITLE.test(title.trim())) return true;
  if (t === normalizeForCompare(TYPE_SHORT[type]) || t === normalizeForCompare(TYPE_LABEL[type])) return true;
  const n = normalizeForCompare(name);
  return n.includes(t);
}

/**
 * Bentuk nama tampilan + keterangan sekunder. Tidak pernah mengembalikan string
 * kosong: paling minimal berisi istilah jenis dokumen.
 */
export function documentDisplayName(input: DocumentLabelInput): DocumentLabel {
  const parts: string[] = [TYPE_SHORT[input.type]];

  const scope = input.locationName?.trim() || input.packageName?.trim() || "";
  if (scope) parts.push(scope);
  if (input.docDate) parts.push(formatTanggal(input.docDate));
  const number = input.docNumber?.trim();
  if (number) parts.push(`No. ${shortNumber(number)}`);

  let name = parts.join(" · ");
  if (input.total !== undefined && input.total > 1 && input.index !== undefined) {
    name += ` (berkas ${input.index}/${input.total})`;
  }

  const title = input.title?.trim() ?? "";
  return { name, secondary: title && !isRedundantTitle(title, name, input.type) ? title : null };
}

// ─── Urutan berkas dalam grup sejenis ────────────────────────────────

export type DocumentSequenceInput = {
  id: string;
  type: DocumentType;
  locationId?: string | null;
  packageId?: string | null;
  docNumber?: string | null;
  docDate?: Date | null;
  uploadedAt: Date;
};

export type DocumentSequence = { index: number; total: number };

/**
 * Nomori berkas yang konteksnya sama supaya tetap bisa dibedakan tanpa memaksa
 * pengunggah menamai manual. Grup = jenis + lokasi/paket + nomor + tanggal;
 * urutan di dalam grup mengikuti waktu unggah (naik) sehingga stabil — berkas
 * baru selalu mendapat nomor terakhir, nomor berkas lama tidak bergeser.
 * Grup berisi satu berkas TIDAK diberi penanda.
 */
export function documentSequence(
  rows: readonly DocumentSequenceInput[],
): Map<string, DocumentSequence> {
  const groups = new Map<string, DocumentSequenceInput[]>();
  for (const row of rows) {
    const key = [
      row.type,
      row.locationId ?? row.packageId ?? "",
      row.docNumber?.trim().toLowerCase() ?? "",
      row.docDate ? row.docDate.toISOString().slice(0, 10) : "",
    ].join("|");
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out = new Map<string, DocumentSequence>();
  for (const bucket of groups.values()) {
    const ordered = [...bucket].sort(
      (a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime() || a.id.localeCompare(b.id),
    );
    ordered.forEach((row, i) => out.set(row.id, { index: i + 1, total: ordered.length }));
  }
  return out;
}

/** Gabungan praktis: satu daftar dokumen → nama tampilan per baris. */
export function documentDisplayNames<
  T extends DocumentSequenceInput & Omit<DocumentLabelInput, "index" | "total">,
>(rows: readonly T[]): Map<string, DocumentLabel> {
  const seq = documentSequence(rows);
  const out = new Map<string, DocumentLabel>();
  for (const row of rows) {
    const s = seq.get(row.id);
    out.set(row.id, documentDisplayName({ ...row, index: s?.index, total: s?.total }));
  }
  return out;
}
