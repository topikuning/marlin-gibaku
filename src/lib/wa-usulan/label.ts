import type { LeafNodeOption } from "@/lib/daily-report/queries";

/**
 * Nama pekerjaan di pilihan "Pekerjaan" kotak usulan WA (DECISIONS 709).
 *
 * Kode + nama + satuan, ditambah sub-kategori (atau kategori) supaya item
 * bernama sama di bagian berbeda – 7.a / 8.a "Bekesting Kolom" – tidak tampak
 * kembar (keluhan user 2026-10-03, pola formulir laporan). Satuan disebut
 * karena volume usulan dicatat dalam satuan pekerjaan yang dipilih.
 */
export function labelPekerjaanUsulan(
  n: Pick<LeafNodeOption, "code" | "name" | "unit" | "subPath" | "category" | "basis">,
): string {
  const kode = n.code.trim().replace(/\.$/, "");
  const konteks = n.subPath || n.category;
  return (
    `${kode ? `${kode}. ` : ""}${n.name.trim()}${n.unit ? ` (${n.unit})` : ""}` +
    (konteks ? ` – ${konteks}` : "") +
    (n.basis === "draft_adendum" ? " – adendum belum resmi" : "")
  );
}
