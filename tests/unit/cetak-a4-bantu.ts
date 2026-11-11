import type ExcelJS from "exceljs";

/**
 * Ringkasan pengaturan cetak tiap sheet, untuk uji Excel (DECISIONS 762):
 * `{ "Detail RAB": "A4 portrait 1×n" }`. "1×n" = satu halaman ke samping,
 * ke bawah sebanyak perlunya; "1×1" = satu halaman utuh.
 */
export function ringkasCetak(wb: ExcelJS.Workbook): Record<string, string> {
  return Object.fromEntries(
    wb.worksheets.map((ws) => {
      const p = ws.pageSetup;
      const kertas = p.paperSize === 9 ? "A4" : `kertas ${String(p.paperSize ?? "bawaan printer")}`;
      const muat = p.fitToPage ? `${p.fitToWidth}×${p.fitToHeight ? p.fitToHeight : "n"}` : "tanpa muat";
      return [ws.name, `${kertas} ${p.orientation ?? "portrait"} ${muat}`];
    }),
  );
}
