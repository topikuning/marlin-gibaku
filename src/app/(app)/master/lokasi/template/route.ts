import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { HEADER_TEMPLAT } from "@/lib/master-location/import";

export const dynamic = "force-dynamic";

/**
 * TEMPLAT IMPOR KATALOG LOKASI.
 *
 * Teguran user 2026-09-06: *"kalau ternyata sudah ada impor excelnya,
 * templatenya mana, kok gak ada."* Betul — impornya ada sejak lama, tapi
 * satu-satunya cara mengetahui kolom yang dibaca adalah menebak atau membaca
 * kodenya. Templat yang tidak disediakan sama saja dengan syarat yang
 * dirahasiakan.
 *
 * Header di sini TIDAK ditulis ulang: ia diambil dari `HEADER_TEMPLAT` yang
 * sama dengan yang dipakai parser, dan dijaga uji supaya keduanya tidak pernah
 * berselisih. Templat yang tidak cocok dengan pembacanya lebih buruk daripada
 * tidak ada templat.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "package.bypass"))
    return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";

  const ws = wb.addWorksheet("MASTER DATA");
  ws.addRow(HEADER_TEMPLAT.map((h) => h.judul));
  ws.addRow(HEADER_TEMPLAT.map((h) => h.contoh));
  ws.getRow(1).font = { bold: true, size: 10 };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  HEADER_TEMPLAT.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.max(12, Math.min(28, h.judul.length + 6));
  });
  // Baris contoh diberi latar berbeda supaya tidak ikut terkirim sebagai data
  // sungguhan tanpa disadari.
  ws.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };

  const info = wb.addWorksheet("PETUNJUK");
  info.addRow(["Kolom", "Wajib?", "Keterangan"]);
  info.getRow(1).font = { bold: true, size: 10 };
  for (const h of HEADER_TEMPLAT) {
    info.addRow([h.judul, h.catatan.startsWith("WAJIB") ? "WAJIB" : "opsional", h.catatan]);
  }
  info.addRow([]);
  info.addRow(["Catatan", "", "Baris ke-2 pada sheet MASTER DATA adalah CONTOH – hapus sebelum mengimpor."]);
  info.addRow([
    "Hanya yang aktif",
    "",
    "Baris dengan Kode Status Lokasi selain SL-AKT (cadangan, drop, batal, ditolak) TIDAK diimpor.",
  ]);
  info.addRow([
    "Tanpa data perusahaan",
    "",
    "Nama/kontak/calon penyedia tidak dibaca sama sekali – katalog ini data lokasi.",
  ]);
  info.addRow([
    "Koordinat",
    "",
    "Isi lintang DAN bujur, atau kosongkan keduanya. Yang kosong tetap tersimpan dengan status Perlu verifikasi.",
  ]);
  info.addRow([
    "Impor ulang",
    "",
    "Baris yang sudah ada diperbarui, bukan digandakan. Koordinat yang sudah terisi tidak ditimpa kosong.",
  ]);
  info.getColumn(1).width = 26;
  info.getColumn(2).width = 10;
  info.getColumn(3).width = 90;
  info.getColumn(3).alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Templat_Katalog_Lokasi_MARLIN.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
