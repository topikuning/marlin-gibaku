// Ekspor RAB → impor ulang harus utuh (DECISIONS 208).
//
// Laporan user 2026-08-02, dengan RAB Sugihwaras di tangan:
//   1. "penomoran tidak sync, padahal jelas di sistem itu adalah hasil dari
//      negoisasi resmi, di sistem III di kamu II";
//   2. "hasil exportmu jika diimport ulang tidak bisa, karena parser tidak
//      mengenali strukturnya".
//
// Keduanya berasal dari satu keputusan yang salah: ekspor menomori ULANG
// kategori (I, II, III, …) sambil membiarkan kode anak apa adanya. Berkasnya
// jadi bertentangan dengan dirinya sendiri — kategori "II" berisi anak "III.1"
// — sehingga parser membuat kategori hantu dan totalnya jadi 0.
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const { buildRabXlsx } = await import("@/lib/export/rab-xlsx");
const { parseHpsWorkbook } = await import("@/lib/rab/hps-parser");
type RabExportNode = import("@/lib/export/rab-xlsx").RabExportNode;

const n = (
  o: Partial<RabExportNode> & Pick<RabExportNode, "id" | "kind" | "code" | "name" | "amount">,
): RabExportNode => ({ parentId: null, unit: null, volume: null, unitPrice: null, ...o });

/**
 * Meniru RAB Sugihwaras: kode kategori LONCAT (I, III, IV — tanpa II) karena
 * begitulah hasil negosiasi resminya, dan kode anak mengikuti kategorinya.
 */
const NODES: RabExportNode[] = [
  n({ id: "k1", kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", amount: 3_000_000n }),
  n({ id: "i1", parentId: "k1", kind: "item", code: "1", name: "Buat Bedeng Pekerja", unit: "m²", volume: 2, unitPrice: 1_000_000, amount: 2_000_000n }),
  n({ id: "i2", parentId: "k1", kind: "item", code: "2", name: "Papan Nama Proyek", unit: "bh", volume: 1, unitPrice: 1_000_000, amount: 1_000_000n }),

  n({ id: "k3", kind: "kategori", code: "III", name: "PEKERJAAN TAMBATAN PERAHU", amount: 5_000_000n }),
  n({ id: "s31", parentId: "k3", kind: "sub", code: "III.1", name: "Pekerjaan Struktur", amount: 5_000_000n }),
  n({ id: "i3", parentId: "s31", kind: "item", code: "1", name: "Beton K-250", unit: "m³", volume: 5, unitPrice: 1_000_000, amount: 5_000_000n }),

  n({ id: "k4", kind: "kategori", code: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", amount: 2_000_000n }),
  n({ id: "s41", parentId: "k4", kind: "sub", code: "IV.1", name: "Pekerjaan Turap Beton", amount: 2_000_000n }),
  n({ id: "i4", parentId: "s41", kind: "item", code: "1", name: "Turap", unit: "m¹", volume: 2, unitPrice: 1_000_000, amount: 2_000_000n }),
];

const INPUT = {
  locationName: "Sugihwaras",
  packageName: "KNMP JATENG & DIY",
  contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
  vendorName: "CV Uji",
  ppnPercent: 11,
  revisionNo: 1,
  totalValue: 10_000_000n,
  nodes: NODES,
};

async function ekspor(input = INPUT) {
  const buf = await buildRabXlsx(input);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Nilai sel apa adanya; sel rumus diwakili hasil ter-cache-nya. */
function sel(ws: ExcelJS.Worksheet, row: number, col: number): unknown {
  const v = ws.getCell(row, col).value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  return v;
}

describe("KASUS INTI: kode dari negosiasi resmi tidak boleh dinomori ulang", () => {
  it("kode kategori di ketiga sheet = kode di sistem, termasuk yang loncat", async () => {
    const wb = await ekspor();
    for (const [nama, kolom, mulai] of [
      ["Resume", 1, 6],
      ["Sub Resume", 1, 6],
    ] as const) {
      const ws = wb.getWorksheet(nama)!;
      // Baris kategori pertama ada di baris 6 pada kedua sheet.
      expect(sel(ws, mulai, kolom), `${nama} kategori pertama`).toBe("I");
    }
    const res = wb.getWorksheet("Resume")!;
    expect([sel(res, 6, 1), sel(res, 7, 1), sel(res, 8, 1)]).toEqual(["I", "III", "IV"]);

    const det = wb.getWorksheet("Detail RAB")!;
    const kodeDetail: unknown[] = [];
    det.eachRow((row, i) => {
      if (i > 5) kodeDetail.push(row.getCell(1).value);
    });
    // "II" tidak boleh muncul dari mana pun — di sistem memang tidak ada.
    expect(kodeDetail).toContain("III");
    expect(kodeDetail).not.toContain("II");
  });

  it("kode kategori dan kode anaknya tidak saling bertentangan", async () => {
    // Inti bug lama: kategori ditulis "II" sementara anaknya "III.1".
    const sub = (await ekspor()).getWorksheet("Sub Resume")!;
    // Baris 6 = kategori III? Tidak — urutannya I (6) … lalu blok berikutnya.
    const baris: { kode: string; uraian: string }[] = [];
    sub.eachRow((row, i) => {
      if (i <= 5) return;
      baris.push({ kode: String(row.getCell(1).value ?? ""), uraian: String(row.getCell(2).value ?? "") });
    });
    const idxKat = baris.findIndex((b) => b.uraian === "PEKERJAAN TAMBATAN PERAHU");
    expect(baris[idxKat].kode).toBe("III");
    expect(baris[idxKat + 1].kode).toBe("III.1"); // anak sepakat dengan induknya
    expect(baris[idxKat + 2].uraian).toContain("JUMLAH III");
  });

  it("kategori tanpa kode diberi penanda posisi, bukan dibiarkan kosong", async () => {
    const wb = await ekspor({
      ...INPUT,
      nodes: [n({ id: "k0", kind: "kategori", code: "", name: "PEKERJAAN TANPA KODE", amount: 0n })],
      totalValue: 0n,
    });
    expect(sel(wb.getWorksheet("Resume")!, 6, 1)).toBe("(1)");
  });

  it("suffix dedup internal (#2) tidak bocor ke dokumen resmi", async () => {
    const wb = await ekspor({
      ...INPUT,
      nodes: [n({ id: "k0", kind: "kategori", code: "VI#2", name: "PEKERJAAN ULANG", amount: 0n })],
      totalValue: 0n,
    });
    expect(sel(wb.getWorksheet("Resume")!, 6, 1)).toBe("VI");
  });
});

describe("KASUS INTI: hasil ekspor bisa diimpor ulang", () => {
  it("kategori terbaca lengkap – tanpa kategori hantu", async () => {
    const { parsed } = parseHpsWorkbook(await ekspor());
    expect(parsed.categories.map((c) => c.roman)).toEqual(["I", "III", "IV"]);
    expect(parsed.categories.map((c) => c.name)).toEqual([
      "PEKERJAAN PERSIAPAN",
      "PEKERJAAN TAMBATAN PERAHU",
      "PEKERJAAN DINDING PENAHAN TANAH",
    ]);
    // Bug lama memunculkan baris "PEKERJAAN (kategori III — judul tidak ada di file)".
    expect(parsed.categories.every((c) => !/judul tidak ada/i.test(c.name))).toBe(true);
  });

  it("nilainya utuh – total dan per kategori sama dengan yang diekspor", async () => {
    const { parsed } = parseHpsWorkbook(await ekspor());
    expect(parsed.categories.map((c) => c.total_value)).toEqual([3_000_000, 5_000_000, 2_000_000]);
    expect(parsed.total).toBe(10_000_000);
  });

  it("volume, satuan, dan harga satuan ikut terbawa", async () => {
    const { parsed } = parseHpsWorkbook(await ekspor());
    const persiapan = parsed.categories[0];
    const bedeng = persiapan.direct_items.find((i) => /Bedeng/.test(i.name));
    expect(bedeng).toBeDefined();
    expect(bedeng!.volume).toBe(2);
    expect(bedeng!.unit).toBe("m²");
    expect(bedeng!.unit_price).toBe(1_000_000);
    expect(bedeng!.total_price).toBe(2_000_000);
  });

  it("subkategori tetap jadi subkategori, bukan item lepas", async () => {
    const { parsed } = parseHpsWorkbook(await ekspor());
    const tambatan = parsed.categories[1];
    expect(tambatan.subcategories.map((s) => s.code)).toEqual(["III.1"]);
    expect(tambatan.subcategories[0].name).toBe("Pekerjaan Struktur");
    expect(tambatan.subcategories[0].total_value).toBe(5_000_000);
  });

  it("rincian terdalam berkode lengkap (6.1.a) TIDAK hilang", async () => {
    // Kode "6.1.a" / "6.7.1" adalah bentuk yang DISUSUN parser sendiri dari
    // kode induk + huruf saat impor pertama, lalu ditulis kembali oleh ekspor.
    // Sebelum DECISIONS 208 parser tak mengenalinya: barisnya jatuh ke "other"
    // dan lenyap — volume, satuan, harga satuannya ikut hilang, sementara
    // totalnya tetap terlihat benar karena diambil dari baris grup. Kehilangan
    // yang tidak kelihatan dari angka total justru yang paling berbahaya.
    const nodes: RabExportNode[] = [
      n({ id: "k1", kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", amount: 3_000_000n }),
      n({ id: "g6", parentId: "k1", kind: "grup", code: "6", name: "Pekerjaan Pengadaan SMK3K", amount: 3_000_000n }),
      n({ id: "g61", parentId: "g6", kind: "grup", code: "6.1", name: "Penyiapan RK3K, terdiri atas :", amount: 3_000_000n }),
      n({ id: "a", parentId: "g61", kind: "item", code: "6.1.a", name: "Pembuatan Manual dan Prosedur", unit: "set", volume: 2, unitPrice: 1_000_000, amount: 2_000_000n }),
      n({ id: "b", parentId: "g61", kind: "item", code: "6.1.b", name: "Kartu Identitas Pekerja", unit: "org", volume: 1, unitPrice: 1_000_000, amount: 1_000_000n }),
    ];
    const { parsed } = parseHpsWorkbook(
      await ekspor({ ...INPUT, nodes, totalValue: 3_000_000n }),
    );
    const g6 = parsed.categories[0].direct_items.find((i) => i.code === "6")!;
    const g61 = g6.children.find((i) => i.code === "6.1")!;
    expect(g61.children.map((i) => i.code)).toEqual(["6.1.a", "6.1.b"]);

    const a = g61.children[0];
    expect(a.name).toBe("Pembuatan Manual dan Prosedur");
    expect(a.volume).toBe(2);
    expect(a.unit).toBe("set");
    expect(a.unit_price).toBe(1_000_000);
    expect(parsed.total).toBe(3_000_000);
  });

  it("kode berjenjang menempel ke INDUKNYA, bukan ke baris terakhir yang kebetulan lewat", async () => {
    // Induk ditentukan dari prefix kode, jadi urutan baris tidak perlu ditebak.
    const nodes: RabExportNode[] = [
      n({ id: "k1", kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", amount: 2_000_000n }),
      n({ id: "g6", parentId: "k1", kind: "grup", code: "6", name: "Pekerjaan SMK3K", amount: 2_000_000n }),
      n({ id: "g67", parentId: "g6", kind: "grup", code: "6.7", name: "Fasilitas Sarana Kesehatan", amount: 1_000_000n }),
      n({ id: "x", parentId: "g67", kind: "item", code: "6.7.1", name: "Peralatan P3K", unit: "ls", volume: 1, unitPrice: 1_000_000, amount: 1_000_000n }),
      n({ id: "g68", parentId: "g6", kind: "grup", code: "6.8", name: "Rambu-rambu", amount: 1_000_000n }),
      n({ id: "y", parentId: "g68", kind: "item", code: "6.8.a", name: "Rambu Petunjuk", unit: "bh", volume: 1, unitPrice: 1_000_000, amount: 1_000_000n }),
    ];
    const { parsed } = parseHpsWorkbook(
      await ekspor({ ...INPUT, nodes, totalValue: 2_000_000n }),
    );
    const g6 = parsed.categories[0].direct_items.find((i) => i.code === "6")!;
    const anak = Object.fromEntries(g6.children.map((c) => [c.code, c.children.map((g) => g.code)]));
    expect(anak).toEqual({ "6.7": ["6.7.1"], "6.8": ["6.8.a"] });
    expect(parsed.total).toBe(2_000_000);
  });

  it("baris rekap (JUMLAH pra-PPN) tidak ikut jadi pekerjaan", async () => {
    const { parsed } = parseHpsWorkbook(await ekspor());
    const semua = parsed.categories.flatMap((c) => [
      ...c.direct_items.map((i) => i.name),
      ...c.subcategories.flatMap((s) => s.items.map((i) => i.name)),
    ]);
    expect(semua.some((nm) => /^JUMLAH/i.test(nm))).toBe(false);
  });
});
