// IDENTITAS ITEM TIDAK MENYIMPAN INDUKNYA — INDUK HARUS DITULIS, BUKAN DITEBAK.
//
// `lineageKey` TERLIHAT seperti jalur ("I#6#6.1"), dan karena itu sepanjang
// ini importir template membongkarnya dengan potong-string untuk menemukan
// induk tiap baris. Padahal `flattenParsedRab` memakai "#" untuk DUA hal: ia
// pemisah jalur, DAN akhiran pembeda kode kembar ("17#2" = kode "17" yang
// kedua). Keduanya tidak bisa dibedakan sesudah jadi satu untai.
//
// Pada RAB Situbondo yang sungguhan: 8 dari 1097 node salah induk kalau
// dipotong begitu — `IX#IX.2#17#2` dibaca sebagai anak item `IX#IX.2#17`,
// padahal ia SAUDARA-nya di bawah `IX#IX.2`.
//
// Akibat berantainya panjang, dan semuanya diam: nilai kategori kehilangan
// uang item bersarang (Rp 35 juta di berkas user), `recomputeTotals` ikut
// kehilangannya begitu draft disunting, lalu eksportir — RAB, template
// adendum, dan dokumen CCO — TIDAK menulis baris yang induknya item, jadi
// item itu lenyap dari berkas berikutnya dan terbaca "hilang" saat diimpor.
//
// Yang dijaga di sini: induk yang dibaca template SAMA dengan induk yang
// sebenarnya di RAB aktif.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { parseAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
const { buildAdendumTemplateXlsx } = await import("@/lib/export/adendum-template-xlsx");
const { parseHpsWorkbook } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");

const berkas = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;
async function muat(nama: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(berkas(nama));
  return wb;
}

describe("RAB-ADD-02 · induk baris template", () => {
  it("induk tiap baris SAMA dengan induk di RAB aktif, bukan hasil potong-string", async () => {
    const aktif = flattenParsedRab(parseHpsWorkbook(await muat("rab-aktif-situbondo.xlsx")).parsed);
    const indukAktif = new Map(aktif.map((n) => [n.lineageKey, n.parentLineageKey]));
    const t = parseAdendumTemplate(await muat("template-adendum-situbondo-asli.xlsx"));

    const salah = t.nodes
      .filter((n) => indukAktif.has(n.lineageKey) && indukAktif.get(n.lineageKey) !== n.parentLineageKey)
      .map((n) => `${n.lineageKey}: terbaca "${n.parentLineageKey}", seharusnya "${indukAktif.get(n.lineageKey)}"`);
    expect(salah, `baris salah induk:\n${salah.join("\n")}`).toHaveLength(0);
  });

  it("baris yang induknya ITEM tetap ditulis ke template, tidak lenyap", async () => {
    /*
     * Begitu satu berkas salah-induk pernah diimpor, basis data memang memuat
     * item di bawah item. Eksportir yang hanya menelusuri anak pada baris
     * NON-item akan membuang baris itu tanpa sepatah kata — dan berkas
     * berikutnya sudah kehilangan pekerjaannya, bukan cuma salah jumlah.
     */
    const buf = await buildAdendumTemplateXlsx({
      locationName: "Uji",
      packageName: "Uji",
      contractNumber: null,
      vendorName: null,
      revisionNo: 1,
      revisionId: "rev-1",
      totalValue: 3_000_000n,
      nodes: [
        { id: "k", parentId: null, kind: "kategori", code: "I", name: "PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 3_000_000n, lineageKey: "I" },
        { id: "a", parentId: "k", kind: "item", code: "1", name: "Bekesting balok", unit: "m2", volume: 10, unitPrice: 200_000, amount: 2_000_000n, lineageKey: "I#1" },
        { id: "b", parentId: "a", kind: "item", code: "2", name: "Pembesian balok", unit: "kg", volume: 5, unitPrice: 200_000, amount: 1_000_000n, lineageKey: "I#1#2" },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const t = parseAdendumTemplate(wb);
    const nama = t.nodes.map((n) => n.name);
    expect(nama, "baris di bawah item tidak ikut ditulis ke template").toContain("Pembesian balok");
    const anak = t.nodes.find((n) => n.lineageKey === "I#1#2");
    expect(anak?.parentLineageKey).toBe("I#1");
    const jumlah = (k: string) => t.nodes.filter((n) => n.kind === k).reduce((s, n) => s + n.amount, 0n);
    expect(jumlah("kategori")).toBe(jumlah("item"));
  });
});
