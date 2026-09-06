// KOORDINAT YANG TIDAK MUNGKIN TIDAK BOLEH MERUNTUHKAN SELURUH IMPOR.
//
// Kejadian nyata 2026-09-06. User mengunggah `lokasi_1270.xlsx` dan layar
// menjawab:
//
//   Invalid `prisma.masterLocation.upsert()` invocation:
//   Value out of range for the type: numeric field overflow
//
// Penyebabnya SATU sel: baris 1044 (desa Aewoe) berisi `lat=-8897010`,
// `lng=121146265` — koordinat yang ditulis tanpa titik desimal. Kolomnya
// `Decimal(10,7)` (tiga digit sebelum titik), jadi Postgres menolak, dan
// 1.270 baris lainnya ikut gagal karena satu sel.
//
// Dua hal yang dijaga berkas ini:
//
//   1. Satu sel rusak TIDAK menjatuhkan impor. Lokasinya tetap masuk — wilayah
//      dan namanya sah — hanya koordinatnya yang dibuang.
//   2. Pembuangannya DIKATAKAN, lengkap dengan barisnya. Koordinat yang hilang
//      diam-diam akan dicari orang berminggu-minggu di berkas yang salah.
//
// Yang TIDAK dilakukan, dan itu disengaja: menebak maksudnya (membagi 10^6).
// Itu mengarang letak kampung nelayan, dan DECISIONS 203 melarangnya — angka
// yang diunggah user dipakai apa adanya atau ditolak dengan sebabnya.
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseMasterLocationXlsx, koordinatSah } = await import("@/lib/master-location/import");

async function berkas(baris: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("MASTER DATA");
  ws.addRow(["Provinsi", "Kabupaten/Kota", "Kecamatan", "Desa/Kelurahan", "Latitude", "Longitude"]);
  for (const b of baris) ws.addRow(b);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("aturan koordinat", () => {
  it("tanpa koordinat sama sekali itu sah – banyak lokasi memang belum diukur", () => {
    expect(koordinatSah(null, null)).toBe(true);
  });

  it("separuh koordinat DITOLAK – lintang tanpa bujur bukan tempat", () => {
    expect(koordinatSah(-6.7, null)).toBe(false);
    expect(koordinatSah(null, 111.4)).toBe(false);
  });

  it("di luar bumi ditolak; di dalam bumi diterima", () => {
    expect(koordinatSah(-8.89701, 121.146265)).toBe(true);
    expect(koordinatSah(-90, 180)).toBe(true);
    // Persis kasus Aewoe: koordinat tanpa titik desimal.
    expect(koordinatSah(-8897010, 121146265)).toBe(false);
    expect(koordinatSah(91, 100)).toBe(false);
    expect(koordinatSah(-6, 181)).toBe(false);
  });
});

describe("impor dengan satu sel rusak", () => {
  it("baris lain tetap masuk lengkap dengan koordinatnya", async () => {
    const h = await parseMasterLocationXlsx(
      await berkas([
        ["Jawa Tengah", "Rembang", "Rembang", "Pasar Banggi", -6.6893, 111.4123],
        ["Nusa Tenggara Timur", "Nagekeo", "Mauponggo", "Aewoe", -8897010, 121146265],
        ["Jawa Timur", "Lamongan", "Brondong", "Blimbing", -6.8747, 112.3121],
      ]),
    );
    expect(h.rows).toHaveLength(3);
    expect(h.rows[0]!.latitude).toBeCloseTo(-6.6893, 4);
    expect(h.rows[2]!.latitude).toBeCloseTo(-6.8747, 4);
  });

  it("yang rusak masuk TANPA koordinat, bukan hilang dan bukan ditebak", async () => {
    const h = await parseMasterLocationXlsx(
      await berkas([["Nusa Tenggara Timur", "Nagekeo", "Mauponggo", "Aewoe", -8897010, 121146265]]),
    );
    const aewoe = h.rows[0]!;
    expect(aewoe.village).toBe("Aewoe");
    expect(aewoe.latitude).toBeNull();
    expect(aewoe.longitude).toBeNull();
    // Bukan -8.89701: menebak titik desimal = mengarang letak kampung nelayan.
    expect(JSON.stringify(aewoe)).not.toContain("8.897");
  });

  it("jumlahnya DIHITUNG dan barisnya DISEBUT", async () => {
    const h = await parseMasterLocationXlsx(
      await berkas([
        ["Jawa Tengah", "Rembang", "Rembang", "Pasar Banggi", -6.6893, 111.4123],
        ["Nusa Tenggara Timur", "Nagekeo", "Mauponggo", "Aewoe", -8897010, 121146265],
        ["Jawa Timur", "Gresik", "Ujungpangkah", "Banyuurip", -6.9, null],
      ]),
    );
    expect(h.koordinatJanggal).toBe(2);
    const pesan = h.warnings.join(" ");
    expect(pesan).toContain("2 baris berkoordinat TIDAK MUNGKIN");
    expect(pesan).toContain("Aewoe");
    expect(pesan).toContain("Banyuurip");
  });

  it("berkas yang seluruhnya waras tidak memunculkan peringatan itu", async () => {
    const h = await parseMasterLocationXlsx(
      await berkas([["Jawa Tengah", "Rembang", "Rembang", "Pasar Banggi", -6.6893, 111.4123]]),
    );
    expect(h.koordinatJanggal).toBe(0);
    expect(h.warnings.join(" ")).not.toContain("TIDAK MUNGKIN");
  });
});
