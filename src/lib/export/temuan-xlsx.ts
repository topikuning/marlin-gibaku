import "server-only";
import ExcelJS from "exceljs";
import type { BarisTemuan } from "@/lib/findings/queries";
import { formatTanggal } from "@/lib/format";
import { FINDING_STATUS_LABEL } from "@/lib/lifecycle";

/**
 * REGISTER TEMUAN → .xlsx (DECISIONS 426). Menuangkan baris papan temuan APA
 * ADANYA — tidak menghitung apa pun; sumber barisnya `papanTemuan()` yang
 * sudah tersaring scope + saringan pengguna.
 */

const SEVERITY_LABEL: Record<string, string> = {
  kritis: "Kritis",
  tinggi: "Tinggi",
  sedang: "Sedang",
  rendah: "Rendah",
};
const CATEGORY_LABEL: Record<string, string> = {
  mutu: "Mutu",
  volume: "Volume",
  k3: "K3",
  administrasi: "Administrasi",
  jadwal: "Jadwal",
  lingkungan: "Lingkungan",
  lainnya: "Lainnya",
};

const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const thin = { style: "thin" as const };
const box: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };

export async function buildTemuanXlsx(baris: BarisTemuan[], dibuatOleh: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Register Temuan", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const judul = ws.addRow(["REGISTER TEMUAN"]);
  judul.font = { bold: true, size: 14 };
  ws.addRow([`Dibuat ${formatTanggal(new Date())} oleh ${dibuatOleh} – ${baris.length} temuan`]);
  ws.addRow([]);

  const kolom = [
    "No",
    "Judul",
    "Lokasi",
    "Kategori",
    "Tingkat",
    "Status",
    "Tanggal Temuan",
    "Tenggat",
    "Lewat Tenggat",
    "Dibuka Ulang",
    "PIC Tindak Lanjut",
    "Jumlah Bukti",
    "Dicatat Oleh",
  ];
  const head = ws.addRow(kolom);
  head.eachCell((c) => {
    c.font = { bold: true, size: 10 };
    c.fill = HEAD_FILL;
    c.border = box;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  baris.forEach((t, i) => {
    const r = ws.addRow([
      i + 1,
      t.title,
      t.locationName,
      CATEGORY_LABEL[t.category] ?? t.category,
      SEVERITY_LABEL[t.severity] ?? t.severity,
      FINDING_STATUS_LABEL[t.status],
      formatTanggal(t.findingDate),
      t.dueDate ? formatTanggal(t.dueDate) : "-",
      t.lewatTenggat ? "YA" : "-",
      t.reopenCount > 0 ? `${t.reopenCount}x` : "-",
      t.assignedName ?? "-",
      t.buktiCount,
      t.raisedByName,
    ]);
    r.eachCell((c) => {
      c.border = box;
      c.font = { size: 10 };
      c.alignment = { vertical: "top", wrapText: true };
    });
  });

  const widths = [5, 42, 24, 13, 9, 20, 13, 13, 8, 8, 20, 8, 20];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
