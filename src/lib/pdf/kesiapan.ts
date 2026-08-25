import "server-only";
import { CONTENT_BOTTOM, PAGE_MARGIN, CONTENT_WIDTH, createA4Doc, docToBuffer, ensureSpace, PDF_COLORS, PDF_FONT, reportHeader, sanitizeText, stampFooters } from "./document";
import type { KesiapanPaket } from "@/lib/kesiapan/builder";
import { KESIAPAN_VERDICT_LABEL } from "@/lib/kesiapan/rules";
import { formatPct, formatTanggal } from "@/lib/format";

/**
 * LAPORAN KESIAPAN termin/PHO/FHO/close-out → PDF A4 (DECISIONS 426).
 * Menuangkan hasil `kesiapanPortofolio()` APA ADANYA — verdict & alasan dari
 * rule engine, tidak dihitung ulang di sini.
 */

const VERDICT_COLOR: Record<string, string> = {
  siap: "#16a34a",
  siap_catatan: "#d97706",
  belum_siap: "#dc2626",
};
const SYARAT_TAG: Record<string, { label: string; color: string }> = {
  lolos: { label: "[OK]", color: "#16a34a" },
  peringatan: { label: "[PERHATIAN]", color: "#d97706" },
  gagal: { label: "[BELUM]", color: "#dc2626" },
};

export async function buildKesiapanPdf(paket: KesiapanPaket[], dibuatOleh: string): Promise<Buffer> {
  const doc = createA4Doc({ title: "Laporan Kesiapan", author: "MARLIN" });
  reportHeader(doc, "MARLIN", `Dibuat ${formatTanggal(new Date())} oleh ${sanitizeText(dibuatOleh)}`, "Laporan Kesiapan");

  doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.inkMuted)
    .text(
      "Kesiapan termin / PHO / FHO / close-out per paket dari mesin aturan. Progress terverifikasi = laporan disetujui + final (level internal).",
      PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH },
    );
  doc.moveDown(0.8);

  if (paket.length === 0) {
    doc.fontSize(9).text("Tidak ada paket dalam pelaksanaan/serah terima di lingkup Anda.", PAGE_MARGIN, doc.y);
  }

  for (const p of paket) {
    ensureSpace(doc, 90);
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(PDF_COLORS.primary)
      .text(sanitizeText(p.packageName), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.inkMuted)
      .text(
        `Progress dilaporkan ${formatPct(p.progressDilaporkanPct)} · terverifikasi ${formatPct(p.progressTerverifikasiPct)} · ${p.lokasi.length} lokasi`,
        PAGE_MARGIN, doc.y + 1, { width: CONTENT_WIDTH },
      );
    doc.moveDown(0.4);

    for (const k of p.kartu) {
      ensureSpace(doc, 40);
      doc.font(PDF_FONT.bold).fontSize(9).fillColor(PDF_COLORS.ink)
        .text(k.judul, PAGE_MARGIN + 8, doc.y, { continued: true, width: CONTENT_WIDTH - 8 });
      doc.fillColor(VERDICT_COLOR[k.verdict] ?? PDF_COLORS.ink)
        .text(`  ${KESIAPAN_VERDICT_LABEL[k.verdict].toUpperCase()}`);
      for (const s of k.syarat) {
        ensureSpace(doc, 18);
        const tag = SYARAT_TAG[s.status];
        doc.font(PDF_FONT.bold).fontSize(7.5).fillColor(tag.color)
          .text(tag.label, PAGE_MARGIN + 16, doc.y, { continued: true });
        doc.font(PDF_FONT.regular).fillColor(PDF_COLORS.ink)
          .text(` ${sanitizeText(s.label)} – ${sanitizeText(s.detail)}`, { width: CONTENT_WIDTH - 24 });
      }
      doc.moveDown(0.35);
    }

    // Garis pemisah antar paket.
    if (doc.y < CONTENT_BOTTOM - 12) {
      doc.moveTo(PAGE_MARGIN, doc.y + 2).lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 2)
        .lineWidth(0.5).strokeColor("#e2e8f0").stroke();
      doc.moveDown(0.6);
    }
  }

  stampFooters(doc, "MARLIN – Laporan Kesiapan");
  return docToBuffer(doc);
}
