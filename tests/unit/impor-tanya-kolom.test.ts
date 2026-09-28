// IMPOR BERTANYA, BUKAN MENOLAK (DECISIONS 624).
//
// Teguran user 2026-09-27: *"kenapa kamu tidak lempar pertanyaan ke user? sheet
// mana yang dipakai ambil dari kolom mana, begitu kan lebih jelas. daripada
// error gak jelas!"*. Berkas yang tidak bisa dipastikan menghasilkan
// PERTANYAAN – daftar sheet terlihat + kolom terlihat (judul & contoh) – dan
// jawaban user dipakai apa adanya.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ImporPerluJawaban, parseHpsBuffer } from "@/lib/rab/hps-parser";

async function xlsx(bangun: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  bangun(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Sheet RAB berjudul kolom tak lazim: tidak ada VOL/SAT/HARGA yang dikenali. */
function berkasAneh(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("RAB");
  ws.getRow(1).values = ["NO", "URAIAN", "BANYAKNYA", "UKURAN", "RAHASIA", "NILAI PER UNIT", "NILAI"];
  ws.getRow(2).values = ["I", "PEKERJAAN PERSIAPAN"];
  const item: [string, string, number, string, number][] = [
    ["1", "Pagar sementara", 100, "m", 375_000],
    ["2", "Direksi keet", 1, "unit", 25_000_000],
    ["3", "Papan nama", 2, "bh", 1_500_000],
    ["4", "Air kerja", 6, "bln", 800_000],
  ];
  item.forEach(([k, n, v, s, h], i) => {
    ws.getRow(3 + i).values = [k, n, v, s, 999_999_999, h, v * h];
  });
  ws.getColumn(5).hidden = true;
  wb.addWorksheet("REKAP").getRow(1).values = ["rekap"];
}

async function tanyaDari(buf: Buffer, opsi = {}): Promise<ImporPerluJawaban> {
  try {
    await parseHpsBuffer(buf, opsi);
  } catch (e) {
    if (e instanceof ImporPerluJawaban) return e;
    throw e;
  }
  throw new Error("seharusnya bertanya");
}

describe("berkas yang tidak bisa dipastikan → pertanyaan", () => {
  it("menyebut sebab, sheet yang terlihat, dan kolom terlihat beserta judul & contohnya", async () => {
    const t = await tanyaDari(await xlsx(berkasAneh));
    expect(t.sebab.length).toBeGreaterThan(10);
    expect(t.pilihan.sheets).toEqual(["RAB", "REKAP"]);
    expect(t.pilihan.sheet).toBe("RAB");
    const huruf = t.pilihan.kolom.map((k) => k.huruf);
    expect(huruf).toEqual(expect.arrayContaining(["C", "D", "F", "G"]));
    // Kolom tersembunyi TIDAK ditawarkan.
    expect(huruf).not.toContain("E");
    const g = t.pilihan.kolom.find((k) => k.huruf === "G")!;
    expect(g.label).toBe("NILAI");
    expect(g.contoh[0]).toBe("37.500.000");
  });

  it("jawaban kolom dipakai apa adanya – harga satuan dari kolomnya sendiri", async () => {
    const h = await parseHpsBuffer(await xlsx(berkasAneh), {
      sheet: "RAB",
      kolom: { vol: 3, unit: 4, price: 6, amount: 7 },
    });
    const item = h.parsed.categories[0]!.direct_items;
    expect(item.map((i) => [i.volume, i.unit, i.unit_price, i.total_price])).toEqual([
      [100, "m", 375_000, 37_500_000],
      [1, "unit", 25_000_000, 25_000_000],
      [2, "bh", 1_500_000, 3_000_000],
      [6, "bln", 800_000, 4_800_000],
    ]);
    expect(h.priceColumn.label).toMatch(/pilihan Anda/);
    expect(h.pilihan?.usulan).toEqual({ vol: 3, unit: 4, price: 6, amount: 7 });
  });

  it("kolom tersembunyi yang dipilih → ditanyakan ulang dengan sebabnya, tidak dibaca", async () => {
    const t = await tanyaDari(await xlsx(berkasAneh), {
      sheet: "RAB",
      kolom: { vol: 3, unit: 4, price: 5, amount: 7 },
    });
    expect(t.sebab).toMatch(/disembunyikan di Excel/);
    expect(t.pilihan.sheet).toBe("RAB");
  });

  it("sheet pilihan user yang tidak ada/tersembunyi ditolak dengan menyebut namanya", async () => {
    await expect(parseHpsBuffer(await xlsx(berkasAneh), { sheet: "Hantu" })).rejects.toThrow(/Hantu/);
  });
});
