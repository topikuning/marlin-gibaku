// BERKAS SALAH DITOLAK DENGAN PESAN YANG BISA DITINDAKLANJUTI.
//
// Berkas tambah/kurang KKP kini DITERIMA (DECISIONS 296); pesan-pesan di sini
// tersisa untuk berkas yang bentuknya mirip tapi angkanya tidak terbukti, dan
// untuk berkas asing yang memang bukan RAB.
//
// Diuji lewat `parseHpsBuffer` — pintu masuk yang sesungguhnya, yang memilih
// sheet dari daftar nama lalu menipiskan berkasnya (DECISIONS 297).
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";

async function xlsx(bangun: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  bangun(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Sheet berbentuk CCO tapi angkanya TIDAK memenuhi volume × harga = jumlah. */
function ccoTakTerbukti(nama: string) {
  return (wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet(nama);
    ws.getRow(1).values = ["NO", "URAIAN", "MC-0", "MC-0", "PEKERJAAN TAMBAH", "PEKERJAAN KURANG", "CCO", "CCO"];
    for (let i = 0; i < 5; i++) ws.getRow(2 + i).values = [`${i + 1}`, "Item", 7, 13, 3, 4, 5, 6];
  };
}

describe("berkas berbentuk CCO tapi angkanya tidak terbukti", () => {
  it("ditolak dengan menyebut SEBABNYA, bukan 'sheet RAB tidak ada'", async () => {
    await expect(parseHpsBuffer(await xlsx(ccoTakTerbukti("CCO-01")))).rejects.toThrow(
      /volume × harga satuan tidak sama dengan jumlah harga/,
    );
    // Pesannya harus menyebut JALAN KELUARNYA, bukan cuma menyalahkan berkas.
    await expect(parseHpsBuffer(await xlsx(ccoTakTerbukti("CCO-01")))).rejects.toThrow(
      /Template Adendum/,
    );
  });

  it("variasi penulisan nomor CCO tetap dikenali", async () => {
    for (const n of ["CCO - 01", "CCO01", "cco-2"]) {
      await expect(parseHpsBuffer(await xlsx(ccoTakTerbukti(n)))).rejects.toThrow(
        /berbentuk dokumen CCO/,
      );
    }
  });
});

describe("berkas asing", () => {
  it("menyebut sheet yang ADA – supaya user tidak menebak", async () => {
    const buf = await xlsx((wb) => {
      wb.addWorksheet("Sheet1").getRow(1).values = ["a"];
      wb.addWorksheet("Rekap Bulanan").getRow(1).values = ["b"];
    });
    await expect(parseHpsBuffer(buf)).rejects.toThrow(/Sheet1, Rekap Bulanan/);
  });

  it("RAB yang sah TETAP diterima – penolakan tidak boleh melebar", async () => {
    // Batasnya penting: pesan bagus tidak ada gunanya kalau berkas yang benar
    // ikut ditolak.
    const buf = await xlsx((wb) => {
      const ws = wb.addWorksheet("RAB");
      ws.getRow(1).values = ["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"];
      ws.getRow(2).values = ["I", "PEKERJAAN PERSIAPAN"];
      ws.getRow(3).values = ["1", "Galian tanah", 10, "m³", 50_000, 500_000];
    });
    const { parsed } = await parseHpsBuffer(buf);
    expect(parsed.categories[0].direct_items[0].name).toBe("Galian tanah");
  });
});
