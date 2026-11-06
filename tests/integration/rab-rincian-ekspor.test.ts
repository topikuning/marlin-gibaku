// UNDUHAN RAB BERTAUT – pemuat data rincian (DECISIONS 741).
//
// Dibuktikan dengan DB sungguhan bahwa data yang masuk ke sheet Backup Volume,
// Analisa, dan Bahan & Upah sama dengan sumber layar Backup volume & analisa:
//  - backup berkas revisi lama DIWARISI bila volumenya sama (652);
//  - isian MARLIN ikut, berikut pengurangnya;
//  - volume berubah / item baru: tanpa backup, dengan sebab yang bisa dibaca;
//  - analisa diwarisi bila harga satuannya sama; komponen tersambung ke harga
//    dasar walau alamat selnya ditulis dengan "$";
//  - lalu workbook lengkapnya dibangun dari data itu dan totalnya = resmi.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { muatRincianEkspor } = await import("@/lib/rab/rincian/ekspor");
const { buildRabXlsx } = await import("@/lib/export/rab-xlsx");
import type { FlatNode } from "@/lib/rab/flatten";
import type { Prisma } from "@/generated/prisma/client";

const suffix = `re${Date.now().toString(36)}`;
let userId: string;
let locationId: string;
let rev1: string;
let rev2: string;

const item = (code: string, name: string, volume: number, unitPrice: number, sortOrder: number): FlatNode => ({
  kind: "item",
  code,
  name,
  volume,
  unit: "m3",
  unitPrice,
  amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: `I#${code}`,
  parentLineageKey: "I",
  sortOrder,
  excelRow: null,
});
const kategori = (anak: FlatNode[]): FlatNode => ({
  kind: "kategori",
  code: "I",
  name: "PEKERJAAN",
  volume: null,
  unit: null,
  unitPrice: null,
  amount: anak.reduce((t, n) => t + n.amount, 0n),
  lineageKey: "I",
  parentLineageKey: null,
  sortOrder: 0,
  excelRow: null,
});
const json = (x: unknown) => x as Prisma.InputJsonValue;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RE ${suffix}`, slug: `org-${suffix}` } });
  userId = (
    await db.user.create({ data: { orgId: org.id, username: `re-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket RE ${suffix}`, stage: "pelaksanaan" } });
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Kios", slug: `kios-${suffix}`, village: "Kios", regency: "Demak", province: "Jateng", status: "berjalan", isActive: true },
    })
  ).id;

  // Revisi 1: A (backup berkas + analisa), B (isian), C (tanpa apa pun).
  const A1 = item("1", "Pasangan batu", 12.5, 115000, 1);
  const B1 = item("2", "Galian", 4, 20000, 2);
  const C1 = item("3", "Urugan", 10, 20000, 3);
  rev1 = (await createRevisionFromNodes(locationId, [kategori([A1, B1, C1]), A1, B1, C1], { source: "hps_awal", userId, note: "kontrak" })).revisionId;
  await activateRevision(rev1, userId);
  await db.rabRincianRevisi.create({
    data: {
      revisionId: rev1,
      asal: "impor",
      sheetRab: "RAB",
      kolomVolume: 3,
      kolomHarga: 5,
      ringkasan: json({}),
      kepala: json({ "7. Vol Kios": { 2: "Uraian", 13: "Volume" } }),
      tersembunyiDibaca: [],
    },
  });
  await db.rabBackupVolume.create({
    data: {
      revisionId: rev1,
      lineageKey: "I#1",
      status: "tertaut",
      nilaiRab: 12.5,
      rumusRab: "'7. Vol Kios'!M82",
      sumber: json([{ sheet: "7. Vol Kios", sel: "M82", tersembunyi: false, nilai: 12.5 }]),
      perantara: json([]),
      baris: json([
        { sheet: "7. Vol Kios", baris: 80, sel: [{ kolom: 13, huruf: "M", nilai: 5, rumus: null }] },
        { sheet: "7. Vol Kios", baris: 81, sel: [{ kolom: 13, huruf: "M", nilai: 7.5, rumus: null }] },
        { sheet: "7. Vol Kios", baris: 82, sel: [{ kolom: 13, huruf: "M", nilai: 12.5, rumus: "SUM(M80:M81)" }] },
      ]),
    },
  });
  await db.rabBackupIsian.createMany({
    data: [
      { revisionId: rev1, lineageKey: "I#2", urutan: 1, uraian: "Pondasi", jumlah: 2, panjang: 2.5, dibuatOlehId: userId },
      { revisionId: rev1, lineageKey: "I#2", urutan: 2, uraian: "Bongkar", jumlah: 1, panjang: 1, kurang: true, dibuatOlehId: userId },
    ],
  });
  await db.rabHargaDasar.createMany({
    data: [
      { revisionId: rev1, sheet: "Bahan & Upah", sel: "C10", baris: 10, nama: "Pekerja", satuan: "OH", harga: 100000 },
      { revisionId: rev1, sheet: "Bahan & Upah", sel: "C11", baris: 11, nama: "Semen", satuan: "kg", harga: 5000 },
    ],
  });
  const a1 = await db.rabAnalisa.create({
    data: {
      revisionId: rev1,
      kunciBlok: "ANALISA!5",
      sheet: "ANALISA",
      barisAwal: 5,
      barisAkhir: 12,
      kode: "A.4.1",
      uraian: "Pasangan batu kali",
      hargaSatuan: 115000,
      overhead: 0.15,
      perantara: json([]),
      baris: json([]),
      komponen: {
        create: [
          { urutan: 1, baris: 7, kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 0.5, harga: 100000, jumlah: 50000, sumberSheet: "Bahan & Upah", sumberSel: "C$10" },
          { urutan: 2, baris: 9, kategori: "bahan", nama: "Semen", satuan: "kg", koefisien: 10, harga: 5000, jumlah: 50000, sumberSheet: "Bahan & Upah", sumberSel: "$C$11" },
        ],
      },
    },
  });
  await db.rabItemAnalisa.create({ data: { revisionId: rev1, lineageKey: "I#1", analisaId: a1.id, cara: "rumus" } });

  // Revisi 2 (adendum, tanpa berkas): A sama, B volume berubah, C tetap, D baru.
  const A2 = item("1", "Pasangan batu", 12.5, 115000, 1);
  const B2 = item("2", "Galian", 5, 20000, 2);
  const C2 = item("3", "Urugan", 10, 20000, 3);
  const D2 = item("4", "Pekerjaan baru", 1, 500000, 4);
  rev2 = (await createRevisionFromNodes(locationId, [kategori([A2, B2, C2, D2]), A2, B2, C2, D2], { source: "adendum", userId, note: "adendum" }))
    .revisionId;
  await activateRevision(rev2, userId);
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("muatRincianEkspor", () => {
  it("backup diwarisi, isian ikut, volume berubah & item baru diberi sebab", async () => {
    const r = await muatRincianEkspor(rev2);
    const per = new Map(r.item.map((i) => [i.lineageKey, i]));

    const A = per.get("I#1")!;
    expect(A.backup).toMatchObject({ jenis: "berkas", asal: { revisionNo: 1, warisan: true }, nilaiRab: 12.5, rumusRab: "'7. Vol Kios'!M82" });
    expect(A.backup?.jenis === "berkas" && A.backup.baris).toHaveLength(3);
    expect(A.backup?.jenis === "berkas" && A.backup.kepala["7. Vol Kios"]).toEqual({ 2: "Uraian", 13: "Volume" });

    expect(per.get("I#2")!.backup).toBeNull();
    expect(per.get("I#2")!.sebabTanpaBackup).toMatch(/Volume berubah/);
    expect(per.get("I#4")!.backup).toBeNull();
    expect(per.get("I#4")!.sebabTanpaBackup).toMatch(/Item baru/);

    // Di revisi 1 sendiri, B memakai isiannya.
    const r1 = await muatRincianEkspor(rev1);
    const B = r1.item.find((i) => i.lineageKey === "I#2")!;
    expect(B.backup).toMatchObject({ jenis: "isian", asal: { revisionNo: 1, warisan: false } });
    expect(B.backup?.jenis === "isian" && B.backup.baris.map((x) => [x.uraian, x.kurang])).toEqual([
      ["Pondasi", false],
      ["Bongkar", true],
    ]);
  });

  it("analisa diwarisi; komponen tersambung ke harga dasar walau alamatnya ber-$", async () => {
    const r = await muatRincianEkspor(rev2);
    const A = r.item.find((i) => i.lineageKey === "I#1")!;
    expect(A.analisaId).not.toBeNull();
    const a = r.analisa.find((x) => x.id === A.analisaId)!;
    expect(a).toMatchObject({ kode: "A.4.1", hargaSatuan: 115000, overhead: 0.15, asal: { revisionNo: 1, warisan: true } });
    expect(a.komponen.map((k) => k.hargaDasar)).toEqual([`${rev1}|Bahan & Upah|C10`, `${rev1}|Bahan & Upah|C11`]);
    expect(r.hargaDasar.map((h) => h.asalSel)).toEqual(["Bahan & Upah!C10 · revisi #1", "Bahan & Upah!C11 · revisi #1"]);
    expect(r.item.find((i) => i.lineageKey === "I#4")!.analisaId).toBeNull();
  });

  it("dibangun jadi workbook: volume & harga A tertaut, total sama dengan resmi", async () => {
    const r = await muatRincianEkspor(rev2);
    const nodes = await db.rabNode.findMany({ where: { revisionId: rev2 }, orderBy: { sortOrder: "asc" } });
    const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: rev2 } });
    const buf = await buildRabXlsx({
      locationName: "Kios",
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
      rincian: r,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const det = wb.getWorksheet("Detail RAB")!;
    let rA = 0;
    det.eachRow((row, i) => {
      if (row.getCell(2).value === "Pasangan batu") rA = i;
    });
    expect(det.getCell(rA, 3).formula).toMatch(/^ROUND\('Backup Volume'!C\d+,3\)$/);
    expect(det.getCell(rA, 5).formula).toMatch(/^ROUND\('Resume Analisa'!D\d+,2\)$/);
  });
});
