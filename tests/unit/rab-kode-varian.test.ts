import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsBuffer, rapikanKode } from "@/lib/rab/hps-parser";
import { flattenParsedRab } from "@/lib/rab/flatten";
import { samakanLineage } from "@/lib/rab/cocok-lineage";

/**
 * Nomor rincian VARIAN PELAKSANA dikenali sebagai item yang sama dengan RAB
 * asli (DECISIONS 726). Kasus user 2026-10-31: RAB asli "6.8" + "6.8.a … 6.8.d",
 * berkas CCO pelaksana "6.8." + "a … d". Tiap pelaksana menulisnya lain.
 */

type Baris = (string | number | null)[];
async function baca(header: Baris, rows: Baris[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  const { parsed, warnings } = await parseHpsBuffer(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  return { nodes: flattenParsedRab(parsed), warnings };
}

const HEADER = ["No", "Uraian", null, null, "Vol", "Sat", "Harga Satuan", "Jumlah Harga", "TKDN"];
const kepala: Baris[] = [
  ["VI", "PEKERJAAN SMKK", null, null, null, null, null, null, null],
  ["6", "Fasilitas", null, null, null, null, null, null, null],
];
const RINCIAN = ["Rambu Petunjuk", "Rambu Larangan", "Rambu Peringatan", "Rambu Kewajiban"];
const rincian = (kode: (huruf: string) => string): Baris[] =>
  RINCIAN.map((nama, i) => [kode("abcd"[i]), nama, null, null, 2, "bh", 100, 200, 1]);
const RAB_ASLI: Baris[] = [
  ...kepala,
  ["6.8", "Rambu-rambu ukuran min. 90x90, terdiri atas :", null, null, null, null, null, null, null],
  ...rincian((h) => `6.8.${h}`),
];
const ccoSatuKolom = (kode: (huruf: string) => string): Baris[] => [
  ...kepala,
  ["6.8.", "Rambu-rambu ukuran min. 90x90, terdiri atas :", null, null, null, null, null, null, null],
  ...rincian(kode),
];

const asli = await baca(HEADER, RAB_ASLI);
const lama = asli.nodes.map((n) => ({
  lineageKey: n.lineageKey,
  parentLineageKey: n.parentLineageKey,
  kind: n.kind,
  code: n.code,
  name: n.name,
  unit: n.unit,
}));
const kunciAsli = asli.nodes.filter((n) => n.kind === "item").map((n) => n.lineageKey);

function harusSama(b: Awaited<ReturnType<typeof baca>>) {
  const c = samakanLineage(b.nodes, lama);
  expect(c.nodes.filter((n) => n.kind === "item").map((n) => n.lineageKey)).toEqual(kunciAsli);
  expect(c.nodes.filter((n) => n.kind === "item").map((n) => n.name)).toEqual(RINCIAN);
  // Tidak ada yang terbaca baru, tidak ada "nomor bergeser", tidak ada baris yang dibuang.
  expect(c.itemBaruAsli).toEqual([]);
  expect(c.digeser).toEqual([]);
  expect(b.warnings.filter((w) => /PERHATIAN/.test(w))).toEqual([]);
}

describe("rapikanKode", () => {
  it.each([
    ["a.", "a"],
    ["a)", "a"],
    ["(a)", "a"],
    ["d.1)", "d.1"],
    ["6.8.a.", "6.8.a"],
    ["6.8 a", "6.8.a"],
    ["6.8.", "6.8"],
    ["1.", "1"],
    ["II.1.", "II.1"],
    [" a ", "a"],
  ])("%j → %j", (masuk, keluar) => expect(rapikanKode(masuk)).toBe(keluar));

  it("angka berkurung TIDAK dirapikan: '1)' bisa rincian di bawah huruf, bukan item utama nomor 1", () => {
    expect(rapikanKode("1)")).toBe("1)");
  });

  it("teks yang bukan kode dikembalikan apa adanya", () => {
    expect(rapikanKode("PROYEK")).toBe("PROYEK");
    expect(rapikanKode("Rambu Petunjuk")).toBe("Rambu Petunjuk");
  });
});

describe("berkas CCO pelaksana: '6.8.' + huruf = '6.8.a' RAB asli", () => {
  it("huruf di kolom yang sama (kasus user)", async () => harusSama(await baca(HEADER, ccoSatuKolom((h) => h))));
  it.each([
    ["a.", (h: string) => `${h}.`],
    ["a)", (h: string) => `${h})`],
    ["(a)", (h: string) => `(${h})`],
    ["6.8.a.", (h: string) => `6.8.${h}.`],
    ["6.8 a", (h: string) => `6.8 ${h}`],
  ])("tulisan %s", async (_n, kode) => harusSama(await baca(HEADER, ccoSatuKolom(kode))));

  it("huruf di kolom sendiri, uraian di kolom sesudahnya", async () => {
    const header = ["No", null, "Uraian", null, "Vol", "Sat", "Harga Satuan", "Jumlah Harga", "TKDN"];
    const rows: Baris[] = [
      ["VI", null, "PEKERJAAN SMKK", null, null, null, null, null, null],
      ["6", null, "Fasilitas", null, null, null, null, null, null],
      ["6.8.", null, "Rambu-rambu ukuran min. 90x90, terdiri atas :", null, null, null, null, null, null],
      ...RINCIAN.map((nama, i): Baris => [null, "abcd"[i], nama, null, 2, "bh", 100, 200, 1]),
    ];
    harusSama(await baca(header, rows));
  });

  it("huruf BESAR: dipasangkan ke item yang sama, tidak dilaporkan sebagai nomor bergeser", async () =>
    harusSama(await baca(HEADER, ccoSatuKolom((h) => h.toUpperCase()))));

  it("huruf besar + nama diganti: tetap ketemu lewat nomornya, dan beda namanya disebut", async () => {
    const rows = ccoSatuKolom((h) => h.toUpperCase());
    rows[3] = ["A", "Rambu Petunjuk Arah", null, null, 2, "bh", 100, 200, 1];
    const c = samakanLineage((await baca(HEADER, rows)).nodes, lama);
    expect(c.itemBaruAsli).toEqual([]);
    expect(c.namaBerbeda.map((x) => [x.lineageKey, x.name])).toEqual([[kunciAsli[0], "Rambu Petunjuk Arah"]]);
  });

  it("'1)' tetap tidak dihitung, tapi DISEBUT – tidak diangkat jadi item utama, tidak hilang diam-diam", async () => {
    for (const kode of ["1)", "(1)"]) {
      const b = await baca(HEADER, ccoSatuKolom((h) => (h === "a" ? kode : h)));
      expect(b.nodes.some((n) => n.name === "Rambu Petunjuk")).toBe(false);
      expect(b.warnings.filter((w) => w.includes(`berkode "${kode}"`))).toHaveLength(1);
    }
  });
});
