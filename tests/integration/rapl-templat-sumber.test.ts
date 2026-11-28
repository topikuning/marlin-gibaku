// TEMPLAT RAPL SEBAGAI SUMBER KEEMPAT (DECISIONS 802).
//
// Keputusan user 2026-11-28: rincian dari templat referensi dipakai LANGSUNG
// (sekali klik), selalu ditandai "templat"; harga di Excel kosong kecuali
// harga yang sudah disetujui, harga acuan di kolom sebelahnya. Yang dijaga:
//  - item tanpa analisa kontrak/AHSP disetujui/AI diterima diurai templat,
//    koefisien per satuan item (kebutuhan = volume × koefisien);
//  - harga acuan dan perkiraan dari RAB hanya RUJUKAN: tidak masuk biaya;
//    harga yang diisi untuk lokasi (HSD) yang dipakai;
//  - judul kelompok di atas item ikut menentukan ("Pengadaan barang" di bawah
//    tiang menara toren).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { itemUntukRapl, keadaanItemRapl } = await import("@/lib/ahsp/rapl");

const suffix = `rt${Date.now().toString(36)}`;
let lokasiId = "";

const item = (lk: string, parent: string, code: string, name: string, unit: string, volume: number, unitPrice: number, sortOrder: number) => ({
  kind: "item" as const,
  code,
  name,
  volume,
  unit,
  unitPrice,
  amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: lk,
  parentLineageKey: parent,
  sortOrder,
  excelRow: null,
});

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RT ${suffix}`, slug: `org-${suffix}` } });
  const admin = await db.user.create({
    data: { orgId: org.id, username: `rt-${suffix}`, fullName: "Admin RT", passwordHash: "x", role: "super_admin" },
  });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket RT ${suffix}`, stage: "pelaksanaan" } });
  lokasiId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Lokasi RT", slug: `rt-${suffix}`, village: "V", regency: "Bitung", province: "Sulawesi Utara", status: "berjalan" },
    })
  ).id;
  const nodes = [
    { kind: "kategori" as const, code: "I", name: "PEKERJAAN STRUKTUR", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
    item("I#1", "I", "1", "Beton fc' 20 MPa site mix", "m³", 10, 1_500_000, 1),
    item("I#2", "I", "2", "Mesin pembuat es balok 5 ton", "unit", 1, 100_000_000, 2),
    { kind: "grup" as const, code: "3", name: "Tiang menara toren tangki air 2000 liter, t = 4 m", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I#3", parentLineageKey: "I", sortOrder: 3, excelRow: null },
    item("I#3#1", "I#3", "a", "Pengadaan barang", "unit", 1, 10_000_000, 4),
  ];
  const r = await createRevisionFromNodes(lokasiId, nodes, { source: "hps_awal", userId: admin.id, note: "uji" });
  await activateRevision(r.revisionId, admin.id);
  // Harga lokasi untuk SATU komponen templat beton: hanya itu yang berharga.
  await db.hargaSatuanDasar.create({
    data: { locationId: lokasiId, kategori: "bahan", nama: "Semen Portland komposit 50 kg", satuan: "zak", harga: 90_000n, sumber: "Input manual", updatedById: admin.id },
  });
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("templat RAPL sebagai sumber keempat", () => {
  it("beton tanpa analisa lain: diurai templat beton20, kategori MARLIN, acuan katalog sebagai rujukan", async () => {
    const items = await itemUntukRapl(lokasiId);
    const beton = items.find((i) => i.lineageKey === "I#1")!;
    expect(beton.analisa).toMatchObject({ sumber: "templat", templat: "beton20", satuanNorm: beton.satuanNorm });
    const semen = beton.analisa!.komponen.find((k) => k.nama === "Semen Portland komposit 50 kg")!;
    expect(semen).toMatchObject({ kategori: "bahan", satuan: "zak", koefisien: 7.68, hargaAcuan: 88_000 });
    expect(new Set(beton.analisa!.komponen.map((k) => k.kategori))).toEqual(new Set(["bahan", "alat", "upah"]));
  });

  it("biaya hanya dari harga lokasi: semen 76,8 zak × Rp90.000; komponen lain belum berharga walau punya acuan", async () => {
    const per = await keadaanItemRapl(lokasiId);
    const beton = per.item.find((i) => i.lineageKey === "I#1")!;
    expect(beton.sumberAnalisa).toBe("templat");
    expect(beton.komponen.find((k) => k.nama === "Semen Portland komposit 50 kg")).toMatchObject({
      jumlah: 76.8,
      harga: 90_000n,
      biaya: 6_912_000n,
    });
    expect(beton.biaya).toBe(6_912_000n);
    expect(beton.komponenBelumBerharga).toBe(beton.komponen.length - 1);
    expect(beton.lengkap).toBe(false);
  });

  it("barang jadi tak dikenal: satu baris pengadaan, perkiraan 82% harga satuan RAB sebagai rujukan", async () => {
    const items = await itemUntukRapl(lokasiId);
    const mesin = items.find((i) => i.lineageKey === "I#2")!;
    expect(mesin.analisa).toMatchObject({ sumber: "templat", templat: "GEN" });
    expect(mesin.analisa!.komponen).toEqual([
      expect.objectContaining({ kategori: "bahan", nama: "Mesin pembuat es balok 5 ton", koefisien: 1, hargaAcuan: 82_000_000 }),
    ]);
  });

  it("judul kelompok dipakai: 'Pengadaan barang' di bawah tiang menara toren → templat rangka toren", async () => {
    const items = await itemUntukRapl(lokasiId);
    expect(items.find((i) => i.lineageKey === "I#3#1")!.analisa).toMatchObject({ sumber: "templat", templat: "toren_tiang" });
  });
});
