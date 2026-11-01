import "server-only";
import type { PotongTeks } from "./bentuk";

/**
 * Teks halaman pertama PDF beserta letaknya (DECISIONS 733). Halaman lain
 * (dokumentasi foto) tidak dibaca. Koordinat y dihitung dari ATAS halaman,
 * dibulatkan 0,1 titik – cukup untuk membedakan baris tabel.
 */
export async function teksHalamanPertama(data: Uint8Array): Promise<{ items: PotongTeks[]; halaman: number }> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const page = await pdf.getPage(1);
  const tinggi = page.getViewport({ scale: 1 }).height;
  const isi = await page.getTextContent();
  const items: PotongTeks[] = [];
  for (const i of isi.items) {
    if (!("str" in i) || !i.str.trim()) continue;
    items.push({
      s: i.str,
      x: Math.round(i.transform[4] * 10) / 10,
      y: Math.round((tinggi - i.transform[5]) * 10) / 10,
      w: Math.round(i.width * 10) / 10,
    });
  }
  return { items, halaman: pdf.numPages };
}
