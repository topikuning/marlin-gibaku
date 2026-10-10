/*
 * IMPOR RAB PERTAMA TIDAK BOLEH BERHENTI HANYA KARENA SHEET-NYA BUKAN "RAB".
 *
 * Pertanyaan user 2026-10-10: *"kenapa import pertama kali rab, ketika tidak
 * ada sheet rab, proses impor berhenti?"*
 *
 * Pembaca RAB sebenarnya tidak mewajibkan nama "RAB": semua sheet terlihat
 * dicoba, dan bila tidak yakin MARLIN bertanya sheet & kolom mana yang dipakai
 * (DECISIONS 624). Yang berhenti adalah berkas yang DAFTAR SHEET-nya tidak
 * terbaca. Di situ pembaca menyimpulkan "tidak ada sheet", lalu layar menulis
 * *"Sheet "RAB" tidak ditemukan … (tidak ada sheet terlihat)"* – pesan yang
 * menyalahkan nama sheet, padahal sebabnya lain, dan tidak ada jalan lanjut:
 *
 *   1. berkas Excel lama .xls (97-2003) – bukan .xlsx sama sekali;
 *   2. workbook yang menulis `<sheet …></sheet>` (bukan `<sheet …/>`);
 *   3. workbook ber-awalan namespace (`<x:sheet …/>`, keluaran OpenXML SDK);
 *   4. semua sheet disembunyikan.
 *
 * Ditambah satu yang tidak berhenti tapi salah jalan: nama sheet ber-tanda
 * kutip (`&quot;` di XML) tidak cocok dengan nama yang dicari, jadi sheet
 * yang benar tidak pernah dibaca otomatis.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { ImporPerluJawaban, parseHpsBuffer } from "@/lib/rab/hps-parser";
import { namaSheetXlsx } from "@/lib/rab/xlsx-slim";

const FIXTURE = readFileSync(new URL("../fixtures/rab-aktif-situbondo.xlsx", import.meta.url));

/** Fixture asli (sheet "Detail RAB") dengan workbook.xml diubah oleh `ubah`. */
async function varian(ubah: (wbXml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(FIXTURE);
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  zip.file("xl/workbook.xml", ubah(wb));
  return zip.generateAsync({ type: "nodebuffer" });
}

const namai = (nama: string) => (wb: string) => wb.replace(/name="Detail RAB"/, `name="${nama}"`);

async function hasil(buf: Buffer): Promise<{ sheet?: string; tanya?: string; galat?: string }> {
  try {
    return { sheet: (await parseHpsBuffer(buf)).sheetName };
  } catch (e) {
    if (e instanceof ImporPerluJawaban) return { tanya: e.sebab };
    return { galat: e instanceof Error ? e.message : String(e) };
  }
}

describe("sheet RAB bernama lain tetap terbaca otomatis", () => {
  it.each(["HPS", "Sheet1", "BOQ", "Penawaran"])("%s", async (nama) => {
    expect(await hasil(await varian(namai(nama)))).toEqual({ sheet: nama });
  });

  it("nama ber-tanda kutip (&quot; di XML) cocok dan dibaca otomatis", async () => {
    const buf = await varian(namai("HPS &quot;Final&quot;"));
    expect((await namaSheetXlsx(buf)).map((s) => s.nama)).toContain('HPS "Final"');
    expect(await hasil(buf)).toEqual({ sheet: 'HPS "Final"' });
  });
});

describe("bentuk workbook.xml lain yang sah tetap terbaca", () => {
  it("<sheet …></sheet> (tidak self-closing)", async () => {
    const buf = await varian((wb) => namai("HPS")(wb).replace(/<sheet\b([^>]*?)\s*\/>/g, "<sheet$1></sheet>"));
    expect((await namaSheetXlsx(buf)).map((s) => s.nama)).toEqual(["Resume", "Sub Resume", "HPS"]);
    expect(await hasil(buf)).toEqual({ sheet: "HPS" });
  });

  it("awalan namespace <x:sheet …/> (OpenXML SDK)", async () => {
    const buf = await varian((wb) =>
      namai("HPS")(wb)
        .replace(/<(\/?)([A-Za-z]+)([\s>/])/g, (_m, sl: string, tag: string, ekor: string) => `<${sl}x:${tag}${ekor}`)
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        ),
    );
    expect((await namaSheetXlsx(buf)).map((s) => s.nama)).toEqual(["Resume", "Sub Resume", "HPS"]);
    expect(await hasil(buf)).toEqual({ sheet: "HPS" });
  });
});

describe("berkas yang memang tidak bisa dibaca: pesannya menyebut SEBAB yang benar", () => {
  it("Excel lama .xls → minta simpan ulang sebagai .xlsx, tidak menyalahkan nama sheet", async () => {
    const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2048)]);
    const r = await hasil(xls);
    expect(r.galat).toMatch(/\.xls/);
    expect(r.galat).toMatch(/Simpan Sebagai/);
    expect(r.galat).not.toMatch(/Sheet "RAB" tidak ditemukan/);
  });

  it("bukan berkas Excel sama sekali → dikatakan apa adanya", async () => {
    const r = await hasil(Buffer.from("ini bukan berkas excel"));
    expect(r.galat).toMatch(/bukan berkas Excel|rusak/);
    expect(r.galat).not.toMatch(/Sheet "RAB" tidak ditemukan/);
  });

  it("semua sheet disembunyikan → disebut, beserta namanya", async () => {
    const buf = await varian((wb) =>
      wb.replace(/state="visible"/g, 'state="hidden"').replace(/<sheet\b(?![^>]*\bstate=)/g, '<sheet state="hidden"'),
    );
    const r = await hasil(buf);
    expect(r.galat).toMatch(/disembunyikan/);
    expect(r.galat).toMatch(/Detail RAB/);
  });
});

describe("pelacak backup volume membaca daftar sheet yang sama", () => {
  it("<sheet …></sheet> tetap menemukan sheet-nya (bukan 'rumus menunjuk sheet yang tidak ada')", async () => {
    const { BukuRingan } = await import("@/lib/rab/rincian/xlsx-ringan");
    const buf = await varian((wb) => wb.replace(/<sheet\b([^>]*?)\s*\/>/g, "<sheet$1></sheet>"));
    const buku = await BukuRingan.buka(buf);
    expect(buku.cari("Detail RAB")).not.toBeNull();
    expect(buku.cari("Resume")).not.toBeNull();
  });
});
