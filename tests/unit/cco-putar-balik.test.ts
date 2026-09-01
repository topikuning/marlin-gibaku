// BERKAS CCO TERBITAN MARLIN HARUS BISA DIIMPOR ULANG.
//
// Temuan audit 2026-09-01. `cco-xlsx` menulis semua kolom turunan sebagai
// `{ formula }` TANPA `result`, sementara pembaca Excel mana pun kecuali Excel
// sendiri hanya bisa membaca hasil yang ter-cache. Akibatnya pembuktian
// `volume x harga ~ jumlah` di `deteksiCco` gagal, berkasnya jatuh ke jalur RAB
// biasa, dan totalnya terbaca 0.
//
// Kalau berkasnya dibuka lalu disimpan di Excel dulu, impornya BERHASIL. Jadi
// kegagalannya menimpa persis alur yang paling lazim di lapangan: unduh,
// teruskan lewat WhatsApp, unggah balik tanpa pernah dibuka.
//
// `rab-ekspor-impor-ulang.test.ts` tidak menutup ini: seluruhnya
// `buildRabXlsx` -> `parseHpsWorkbook`, tidak pernah menyentuh jalur CCO.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { deteksiCco } from "@/lib/rab/cco-import";
import type { CcoNode } from "@/lib/rab/cco-rows";

const { buildCcoXlsx } = await import("@/lib/export/cco-xlsx");

const kat = (o: Partial<CcoNode> & Pick<CcoNode, "id" | "code" | "name" | "lineageKey">): CcoNode => ({
  parentId: null, kind: "kategori", unit: null, volume: null, unitPrice: null, amount: 0n, ...o,
});
const item = (o: Partial<CcoNode> & Pick<CcoNode, "id" | "code" | "name" | "lineageKey">): CcoNode => ({
  parentId: "K1", kind: "item", unit: "m3", volume: 0, unitPrice: 0, amount: 0n, ...o,
});

// Lima item: `deteksiCco` sengaja menuntut sedikitnya TIGA baris yang
// membuktikan `volume x harga ~ jumlah` sebelum mau menyimpulkan apa pun, jadi
// berkas contoh harus cukup besar untuk itu.
const ITEM = [
  { code: "1", name: "Galian Tanah", lk: "I#1", v0: 10, vN: 13, h: 1_200_000 },
  { code: "2", name: "Urugan Pasir", lk: "I#2", v0: 5, vN: 5, h: 1_000_000 },
  { code: "3", name: "Pasangan Batu", lk: "I#3", v0: 20, vN: 18, h: 850_000 },
  { code: "4", name: "Beton K-250", lk: "I#4", v0: 8, vN: 12, h: 2_400_000 },
  { code: "5", name: "Bekisting", lk: "I#5", v0: 30, vN: 30, h: 175_000 },
];

const rupiah = (v: number, h: number) => BigInt(Math.round(v * h));

const LAMA: CcoNode[] = [
  kat({ id: "K1", code: "I", name: "PEKERJAAN PERSIAPAN", lineageKey: "I", amount: ITEM.reduce((t, i) => t + rupiah(i.v0, i.h), 0n) }),
  ...ITEM.map((i, n) => item({ id: `A${n}`, code: i.code, name: i.name, lineageKey: i.lk, volume: i.v0, unitPrice: i.h, amount: rupiah(i.v0, i.h) })),
];

const BARU: CcoNode[] = [
  kat({ id: "K1", code: "I", name: "PEKERJAAN PERSIAPAN", lineageKey: "I", amount: ITEM.reduce((t, i) => t + rupiah(i.vN, i.h), 0n) }),
  ...ITEM.map((i, n) => item({ id: `A${n}`, code: i.code, name: i.name, lineageKey: i.lk, volume: i.vN, unitPrice: i.h, amount: rupiah(i.vN, i.h) })),
];

async function berkasCco(): Promise<ExcelJS.Worksheet> {
  const buf = await buildCcoXlsx({
    locationName: "Uji Putar Balik",
    packageName: "Paket uji",
    workTitle: null,
    address: null,
    contractNumber: null,
    vendorName: null,
    ppnPercent: 11,
    ccoNo: 1,
    nilaiTercatatLama: LAMA.filter((n) => n.kind === "item").reduce((a, n) => a + n.amount, 0n),
    nilaiTercatatBaru: BARU.filter((n) => n.kind === "item").reduce((a, n) => a + n.amount, 0n),
    realisasiByLineage: new Map<string, number>(),
    lama: LAMA,
    baru: BARU,
  });
  const wb = new ExcelJS.Workbook();
  // Dimuat APA ADANYA – tidak pernah lewat Excel, persis seperti berkas yang
  // diteruskan lewat WhatsApp lalu diunggah balik.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets[0]!;
}

describe("ekspor CCO lalu impor ulang tanpa pernah dibuka Excel", () => {
  it("deteksiCco mengenalinya – bukan null", async () => {
    const peta = deteksiCco(await berkasCco());
    expect(peta).not.toBeNull();
  });

  it("kolom JUMLAH pada baris item punya hasil ter-cache", async () => {
    const ws = await berkasCco();
    // Hanya kolom JUMLAH pada baris ITEM yang wajib ber-cache: itulah yang
    // dipakai `deteksiCco` membuktikan `volume x harga ~ jumlah`. Kolom BOBOT
    // dan baris JUMLAH/PPN sengaja tidak di-cache - penyebutnya sel TOTAL yang
    // baru ada setelah semua baris ditulis, dan `fullCalcOnLoad` sudah dipasang
    // sehingga Excel menghitungnya saat dibuka.
    const KOL_JUMLAH = [7, 16]; // JUMLAH HARGA MC-0 dan CCO-01
    const tanpaHasil: string[] = [];
    for (const i of ITEM) {
      const r = 10 + ITEM.indexOf(i) + 1; // 10 = baris kategori
      for (const c of KOL_JUMLAH) {
        const v = ws.getCell(r, c).value as { formula?: string; result?: unknown } | null;
        if (v && typeof v === "object" && "formula" in v && v.result === undefined) {
          tanpaHasil.push(`${i.code} baris ${r} kolom ${c}: ${v.formula}`);
        }
      }
    }
    expect(tanpaHasil).toEqual([]);
  });

  it("nilai ter-cache SAMA dengan hasil rumusnya, bukan angka lain", async () => {
    const ws = await berkasCco();
    for (const [n, i] of ITEM.entries()) {
      const r = 11 + n;
      expect(
        (ws.getCell(r, 7).value as { result?: number }).result,
        `${i.name} JUMLAH MC-0`,
      ).toBe(i.v0 * i.h);
      expect(
        (ws.getCell(r, 16).value as { result?: number }).result,
        `${i.name} JUMLAH CCO-01`,
      ).toBe(i.vN * i.h);
    }
  });
});
