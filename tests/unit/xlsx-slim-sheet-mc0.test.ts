// PENIPIS DAN PEMBACA HARUS SEPAKAT SHEET MANA YANG DIPAKAI.
//
// Dilaporkan user 2026-09-12: mengimpor "MC 0 A TAMBAKAGUNG …" (2,8 MB) ke
// draft adendum berakhir dengan *"Gagal mengirim – server menolak permintaan
// ini … An unexpected response was received from the server."* Pesan itu bukan
// dari MARLIN: tidak ada aksi server yang mengembalikannya. Itu tanda
// prosesnya MATI sebelum sempat menjawab — persis OOM yang sudah pernah
// dicatat DECISIONS 297 untuk berkas KKP 40+ sheet.
//
// Penipis workbook (`slimRabWorkbook`) ada supaya itu tidak terjadi: ia
// memangkas berkas jadi satu sheet sebelum exceljs memuatnya. Tapi daftar
// "sheet isi" yang dipakainya LEBIH SEMPIT daripada yang dipakai pembacanya:
//
//   penipis : nama persis "RAB", atau pola "CCO-1"
//   pembaca : "RAB", MANA PUN yang mengandung "rab", sheet berbentuk CCO, …
//
// Akibatnya berkas yang sheet isinya bernama "RAB MC 0" atau "Rekap RAB"
// dilewati penipis — seluruh 40+ sheet dimuat — lalu mati kehabisan memori.
// Berkas yang JUSTRU paling butuh ditipiskan adalah yang paling mungkin luput.
//
// Yang dijaga: apa pun yang akan dibaca pembaca, ditipiskan lebih dulu.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { slimRabWorkbook, namaSheetXlsx } = await import("@/lib/rab/xlsx-slim");

/** Workbook banyak sheet; satu di antaranya sheet isi dengan nama `namaIsi`. */
async function banyakSheet(namaIsi: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const n of ["Cover", "Vol Lantai 1", "Vol Lantai 2", "AHSP", "Upah"]) {
    const ws = wb.addWorksheet(n);
    for (let r = 1; r <= 50; r++) ws.getCell(r, 1).value = `${n} baris ${r}`;
  }
  const isi = wb.addWorksheet(namaIsi);
  isi.getCell(1, 1).value = "NO";
  isi.getCell(1, 2).value = "URAIAN PEKERJAAN";
  isi.getCell(2, 1).value = "I";
  isi.getCell(2, 2).value = "PEKERJAAN PERSIAPAN";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function sheetSesudahDitipiskan(namaIsi: string): Promise<string[]> {
  const ramping = await slimRabWorkbook(await banyakSheet(namaIsi));
  return (await namaSheetXlsx(ramping)).map((s) => s.nama);
}

describe("penipis xlsx mengenali sheet isi yang sama dengan pembacanya", () => {
  it("nama persis RAB ditipiskan (yang sudah berjalan)", async () => {
    expect(await sheetSesudahDitipiskan("RAB")).toEqual(["RAB"]);
  });

  for (const nama of ["RAB MC 0", "Rekap RAB", "RAB Revisi", "rab adendum"]) {
    it(`sheet "${nama}" ikut ditipiskan – pembaca memang akan memakainya`, async () => {
      const sesudah = await sheetSesudahDitipiskan(nama);
      expect(
        sesudah,
        `berkas dengan sheet "${nama}" dimuat UTUH – inilah yang mematikan proses pada berkas KKP besar`,
      ).toEqual([nama]);
    });
  }

  it("tanpa satu pun sheet yang dikenali, berkas dibiarkan apa adanya", async () => {
    // Bukan kegagalan: pembaca punya jalur deteksi berbasis ISI (bentuk CCO)
    // yang tidak bisa dilihat dari nama. Yang penting ia tidak salah pangkas.
    const sesudah = await sheetSesudahDitipiskan("Lampiran 3");
    expect(sesudah.length).toBeGreaterThan(1);
  });
});
