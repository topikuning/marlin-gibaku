// KATALOG LOKASI DARI BERKAS MASTER DATA KNMP.
//
// Permintaan user 2026-09-06: *"lengkapi data lokasi sekalian, sesuaikan
// kebutuhan marlin ambil data dari sheet master data. ambil hanya yang aktif
// saja. tidak perlu ambil data perusahaan."* — plus teguran terpisah:
// *"kalau ternyata sudah ada impor excelnya, templatenya mana, kok gak ada."*
//
// Empat hal yang dijaga di sini, karena keempatnya menentukan ISI katalog:
//   1. sheet yang dibaca — berkas KNMP punya lima, dan DASHBOARD ada di depan;
//   2. hanya lokasi AKTIF; yang cadangan/drop/batal dilewati dan DIHITUNG;
//   3. data perusahaan tidak pernah ikut, bahkan ketika kolomnya ada;
//   4. templat yang diunduh orang benar-benar dibaca parser ini.
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseMasterLocationXlsx, lokasiAktif, HEADER_TEMPLAT } = await import(
  "@/lib/master-location/import"
);

/** Berkas tiruan berbentuk MASTER DATA KNMP, lengkap dengan sheet pengecoh. */
async function berkasKnmp(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // Sheet pertama sengaja BUKAN daftar lokasi – persis berkas aslinya.
  const dash = wb.addWorksheet("DASHBOARD");
  dash.addRow(["Ringkasan", "Jumlah"]);
  dash.addRow(["Total lokasi", 1271]);

  const ws = wb.addWorksheet("MASTER DATA");
  ws.addRow([
    "ID Lokasi",
    "Provinsi",
    "Kabupaten/Kota",
    "Kecamatan",
    "Desa/Kelurahan",
    "Kampung Nelayan",
    "Wilayah",
    "Klaster",
    "Hasil Pleno",
    "Latitude",
    "Longitude",
    "Status Koordinat",
    "Nama Perusahaan",
    "Nomor Kontak",
    "Calon Penyedia Sumber",
    "Kode Status Lokasi",
    "Status Lokasi",
    "Tahap",
    "Luas Lahan (Ha)",
    "Jumlah Nelayan",
    "Kapal Tanpa Mesin",
    "Kapal Dengan Mesin",
    "Total Kapal",
    "Nilai EE",
  ]);
  for (const r of rows) ws.addRow(r);

  // Sheet perusahaan: kalau parser salah pilih sheet, ujinya harus jatuh.
  const rekap = wb.addWorksheet("REKAP PERUSAHAAN");
  rekap.addRow(["Nama Perusahaan", "Provinsi", "Kabupaten/Kota", "Desa/Kelurahan"]);
  rekap.addRow(["CV. Kalembo Ade Nautama", "Salah", "Salah", "Salah"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const AKTIF = [
  "KNMP-730",
  "Nusa Tenggara Barat",
  "Bima",
  "Sape",
  "Bajo Pulau",
  "Bajo Pulau",
  "Bali dan Nusa Tenggara",
  "BajoPulau",
  "Penyangga",
  -8.5755745,
  119.0354641,
  "VALID",
  "CV. Kalembo Ade Nautama",
  "085126880019",
  "CV. Kalembo Ade Nautama",
  "SL-AKT",
  "Aktif",
  "Tahap II 146",
  0.6,
  484,
  44,
  140,
  184,
  2838404000,
];

const BATAL = [
  "KNMP-999",
  "Jawa Tengah",
  "Rembang",
  "Rembang",
  "Desa Batal",
  "Desa Batal",
  "Jawa",
  "X",
  "Hub",
  -6.7,
  111.4,
  "VALID",
  "PT. Apa Saja",
  "0812",
  "PT. Apa Saja",
  "SL-BTL",
  "Lokasi Batal",
  "Tahap I",
  1,
  10,
  1,
  1,
  2,
  100,
];

describe("sheet yang dibaca", () => {
  it("MASTER DATA, bukan DASHBOARD yang kebetulan berada di depan", async () => {
    const h = await parseMasterLocationXlsx(await berkasKnmp([AKTIF]));
    expect(h.sheet).toBe("MASTER DATA");
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.village).toBe("Bajo Pulau");
  });
});

describe("hanya lokasi aktif", () => {
  it("yang batal dilewati, dan jumlahnya DISEBUT – bukan hilang diam-diam", async () => {
    const h = await parseMasterLocationXlsx(await berkasKnmp([AKTIF, BATAL]));
    expect(h.rows.map((r) => r.village)).toEqual(["Bajo Pulau"]);
    expect(h.tidakAktif).toBe(1);
    expect(h.warnings.join(" ")).toContain("1 lokasi TIDAK aktif");
  });

  it("aturannya sendiri: SL-AKT aktif, kode lain gugur, tanpa kolom status = tidak menyaring", () => {
    expect(lokasiAktif("SL-AKT", "Aktif")).toBe(true);
    expect(lokasiAktif("SL-CAD", "Cadangan")).toBe(false);
    expect(lokasiAktif("SL-DSK", "Drop Sosek")).toBe(false);
    expect(lokasiAktif("", "Aktif")).toBe(true);
    expect(lokasiAktif("", "Tidak Ada Lahan")).toBe(false);
    // Berkas tanpa penanda apa pun tidak boleh dihabisi oleh tebakan.
    expect(lokasiAktif("", "")).toBe(true);
  });
});

describe("data perusahaan", () => {
  it("tidak pernah ikut, walau kolomnya ada di berkas", async () => {
    const h = await parseMasterLocationXlsx(await berkasKnmp([AKTIF]));
    const isi = JSON.stringify(h.rows[0]);
    expect(isi).not.toContain("Kalembo");
    expect(isi).not.toContain("085126880019");
    expect(Object.keys(h.rows[0]!)).not.toContain("candidateVendor");
  });
});

describe("bidang yang dipakai MARLIN", () => {
  it("hanya wilayah, nama kampung, dan koordinat – tidak lebih", async () => {
    const h = await parseMasterLocationXlsx(await berkasKnmp([AKTIF]));
    expect(h.rows[0]).toEqual({
      province: "Nusa Tenggara Barat",
      regency: "Bima",
      district: "Sape",
      village: "Bajo Pulau",
      name: "Bajo Pulau",
      latitude: -8.5755745,
      longitude: 119.0354641,
    });
  });

  it("kolom KNMP lain TIDAK ikut – MARLIN tidak memakainya", async () => {
    // Berkasnya penuh kolom menarik: klaster, hasil pleno, tahap, luas lahan,
    // jumlah nelayan, kapal, nilai EE, ID lokasi. Semuanya sengaja tidak
    // diambil (ketetapan user 2026-09-06: "sesuaikan dengan kebutuhan yang ada
    // di marlin saja"). Katalog yang menyimpan data tak terpakai hanya jadi
    // salinan kedua yang segera basi terhadap berkas aslinya di KKP.
    const h = await parseMasterLocationXlsx(await berkasKnmp([AKTIF]));
    const isi = JSON.stringify(h.rows[0]);
    for (const nilai of ["BajoPulau", "Penyangga", "Tahap II 146", "2838404000", "KNMP-730", "VALID"])
      expect(isi).not.toContain(nilai);
    expect(isi).not.toContain("484"); // jumlah nelayan
  });
});

describe("templat impor", () => {
  it("kolomnya BENAR-BENAR dibaca parser – templat yang meleset lebih buruk daripada tidak ada", async () => {
    // Bangun berkas persis seperti templat yang diunduh orang, lalu impor.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MASTER DATA");
    ws.addRow(HEADER_TEMPLAT.map((h) => h.judul));
    ws.addRow(HEADER_TEMPLAT.map((h) => h.contoh));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const h = await parseMasterLocationXlsx(buf);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toEqual({
      province: "Jawa Tengah",
      regency: "Rembang",
      district: "Rembang",
      village: "Pasar Banggi",
      name: "Pasar Banggi",
      latitude: -6.6893,
      longitude: 111.4123,
    });
    // Templatnya sependek yang dibaca: sembilan kolom, tanpa satu pun hiasan.
    // Templat yang meminta kolom yang tidak dipakai memaksa orang menyiapkan
    // data yang tidak akan pernah dibaca.
    expect(HEADER_TEMPLAT.map((h) => h.judul)).toEqual([
      "Provinsi",
      "Kabupaten/Kota",
      "Kecamatan",
      "Desa/Kelurahan",
      "Kampung Nelayan",
      "Latitude",
      "Longitude",
      "Kode Status Lokasi",
      "Status Lokasi",
    ]);
  });
});

describe("berkas sederhana lama", () => {
  it("tiga kolom tanpa status tetap terbaca – impor lama tidak ikut mati", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["PROVINSI", "KABUPATEN/KOTA", "DESA/KELURAHAN"]);
    ws.addRow(["Jawa Tengah", "Demak", "Betahwalang"]);
    const h = await parseMasterLocationXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(h.rows).toHaveLength(1);
    expect(h.tidakAktif).toBe(0);
    expect(h.warnings.join(" ")).toContain("Kolom status lokasi tidak ada");
  });
});
