// UNDUHAN RAB BERTAUT PADA BERKAS KKP NYATA (DECISIONS 741).
//
// MC-0 Karangmangu (583 item, 35 sheet backup, ANALISA dengan ROUNDUP) diimpor
// lewat aksi impor sungguhan, lalu diunduh bertaut dan SELURUH rumusnya
// dihitung ulang. Yang dijaga:
//  - setiap rumus di setiap sheet bisa dihitung (tidak ada rujukan putus);
//  - tautan tidak mengubah satu angka pun: total hitung ulang = total unduhan
//    tanpa rincian (selisih rekalkulasi Volume × Harga yang sudah ada sebelum
//    fitur ini tetap disebut di Resume, bukan disembunyikan);
//  - hampir seluruh volume & harga tertaut; yang tidak, memang berbeda;
//  - pembulatan akhir analisa (ROUNDUP …,2) dibaca dari rumus berkas.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async () => sesi,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");
const { muatRincianEkspor } = await import("@/lib/rab/rincian/ekspor");
const { buildRabXlsx } = await import("@/lib/export/rab-xlsx");
const { hitungRumus } = await import("@/lib/export/rumus-mini");

const NAMA = "mc0-karangmangu-blok-cco01-tkdn.xlsx";
const isi = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);
const berkas = () => new File([new Uint8Array(isi)], NAMA, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const suffix = `rb${Date.now().toString(36)}`;
let revId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RB ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `rb-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket RB ${suffix}`, stage: "pelaksanaan" } });
  const lok = await db.location.create({
    data: { packageId: pkg.id, name: "Karangmangu", slug: `karangmangu-${suffix}`, village: "Karangmangu", regency: "Rembang", province: "Jawa Tengah", status: "berjalan", isActive: true },
  });
  const fd = new FormData();
  fd.set("locationId", lok.id);
  fd.set("mode", "aktifkan");
  fd.set("file", berkas());
  const pratinjau = await importHps(undefined, fd);
  expect(pratinjau?.error).toBeUndefined();
  const fd2 = new FormData();
  fd2.set("locationId", lok.id);
  fd2.set("mode", "aktifkan");
  fd2.set("file", berkas());
  fd2.set("confirm", "1");
  fd2.set("previewSha", pratinjau!.preview!.sha256);
  const simpan = await importHps(undefined, fd2);
  expect(simpan?.error).toBeUndefined();
  revId = (await db.rabRevision.findFirstOrThrow({ where: { locationId: lok.id, status: "aktif" } })).id;
}, 300_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

async function unduh(denganRincian: boolean) {
  const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: revId } });
  const nodes = await db.rabNode.findMany({ where: { revisionId: revId }, orderBy: { sortOrder: "asc" } });
  const buf = await buildRabXlsx({
    locationName: "Karangmangu",
    packageName: "Paket",
    contractNumber: null,
    vendorName: null,
    ppnPercent: 11,
    revisionNo: rev.revisionNo,
    totalValue: rev.totalValue,
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      kind: n.kind as "kategori" | "item",
      code: n.code,
      name: n.name,
      unit: n.unit,
      volume: n.volume == null ? null : Number(n.volume),
      unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
      amount: n.amount,
      lineageKey: n.lineageKey,
    })),
    ...(denganRincian ? { rincian: await muatRincianEkspor(revId) } : {}),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function penghitung(wb: ExcelJS.Workbook) {
  const memo = new Map<string, number | string | null>();
  const gagal: string[] = [];
  const nilai = (sheet: string, c: number, r: number): number | string | null => {
    const k = `${sheet}|${c}|${r}`;
    if (memo.has(k)) return memo.get(k)!;
    const cell = wb.getWorksheet(sheet)!.getCell(r, c);
    let v: number | string | null = null;
    if (cell.formula) {
      v = hitungRumus(cell.formula, (sh, cc, rr) => nilai(sh ?? sheet, cc, rr));
      if (v == null) gagal.push(`${sheet}!${cell.address} =${cell.formula}`);
    } else {
      const x = cell.value as unknown;
      v = typeof x === "number" || typeof x === "string" ? x : null;
    }
    memo.set(k, v);
    return v;
  };
  return { nilai, gagal };
}

const barisJumlah = (wb: ExcelJS.Workbook) => {
  let r = 0;
  wb.getWorksheet("Detail RAB")!.eachRow((row, i) => {
    if (row.getCell(2).value === "JUMLAH (pra-PPN)") r = i;
  });
  return r;
};

describe("berkas KKP nyata – Karangmangu", () => {
  it("semua rumus terhitung; total sama dengan unduhan tanpa rincian", async () => {
    const wb = await unduh(true);
    const { nilai, gagal } = penghitung(wb);
    for (const ws of wb.worksheets) ws.eachRow((row, i) => row.eachCell((c, k) => void (c.formula && nilai(ws.name, k, i))));
    expect(gagal, gagal.slice(0, 5).join("\n")).toEqual([]);
    // Sel galat di judul kolom berkas (#VALUE!) tidak ikut tersalin sebagai teks.
    const galat: string[] = [];
    for (const ws of wb.worksheets)
      ws.eachRow((row) => row.eachCell((c) => void (typeof c.value === "string" && /^#[A-Z/0]+[!?]?$/.test(c.value) && galat.push(`${ws.name}!${c.address}`))));
    expect(galat.slice(0, 5)).toEqual([]);

    const lama = await unduh(false);
    const tLama = penghitung(lama).nilai("Detail RAB", 6, barisJumlah(lama));
    expect(nilai("Detail RAB", 6, barisJumlah(wb))).toBe(tLama);
  }, 120_000);

  it("hampir semua volume & harga tertaut; yang tidak tertaut memang berbeda dan terdaftar", async () => {
    const wb = await unduh(true);
    const det = wb.getWorksheet("Detail RAB")!;
    let vol = 0;
    let harga = 0;
    let beda = 0;
    det.eachRow((row) => {
      if (row.getCell(3).formula) vol++;
      if (row.getCell(5).formula) harga++;
      if (row.getCell(3).note || row.getCell(5).note) beda++;
    });
    // Angka hasil impor berkas ini (2026-11-05): 533 volume, 531 harga, 4 beda.
    expect(vol).toBeGreaterThanOrEqual(530);
    expect(harga).toBeGreaterThanOrEqual(530);
    expect(beda).toBeLessThanOrEqual(6);
    const teks: string[] = [];
    wb.getWorksheet("Catatan Rincian")!.eachRow((row) => row.eachCell((c) => teks.push(String(c.value))));
    expect(teks.filter((t) => t === "Volume" || t === "Harga satuan")).toHaveLength(beda);
  }, 120_000);

  it("pembulatan akhir analisa dibaca dari rumus berkas (ROUNDUP …,2); Resume Analisa tertaut", async () => {
    const wb = await unduh(true);
    const rumus: string[] = [];
    wb.getWorksheet("Analisa")!.eachRow((row) => row.eachCell((c) => void (c.formula && rumus.push(c.formula))));
    expect(rumus.some((f) => /^ROUNDUP\(F\d+\+F\d+,2\)$/.test(f))).toBe(true);
    let tertaut = 0;
    let angka = 0;
    wb.getWorksheet("Resume Analisa")!.eachRow((row, i) => {
      if (i <= 3) return;
      if (row.getCell(4).formula) tertaut++;
      else angka++;
    });
    expect(tertaut).toBeGreaterThanOrEqual(120);
    expect(angka).toBeLessThanOrEqual(7);
  }, 120_000);
});
