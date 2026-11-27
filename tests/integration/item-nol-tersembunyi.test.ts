// ITEM YANG DINOLKAN TIDAK BISA DIPILIH DI MANA PUN (DECISIONS 798).
//
// Ketetapan user 2026-11-27: "ketika rab baru aktif, item yang sudah 0 masih
// muncul! … ketika dia 0, kecuali dalam konteks perbandingan, maka dia tidak
// muncul sama sekali". Yang dijaga di sini sumber data pemilih pekerjaan:
//  - laporan harian / bot WA / usulan WA (`getLeafNodeOptions`): item dinolkan
//    hilang, KECUALI draft adendum menaikkannya lagi (jalur sisaDraft 742);
//  - templat rekap harian (`getRecapLeaves`): ditandai `dinolkan`;
//  - impor laporan pelaksana (`kandidatImpor`): hilang dari tujuan.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { db } = await import("@/lib/db");
const { getLeafNodeOptions } = await import("@/lib/daily-report/queries");
const { getRecapLeaves } = await import("@/lib/daily-report/recap-import");
const { kandidatImpor } = await import("@/lib/daily-report/impor-pelaksana/proses");

const suffix = `in${Date.now().toString(36)}`;
let userId = "";
let locationId = "";

async function revisi(no: number, status: "aktif" | "draft", items: { lk: string; vol: number }[]) {
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: no, source: no === 1 ? "hps_awal" : "adendum", status, totalValue: 0n, createdById: userId },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", amount: 0n, lineageKey: "I", sortOrder: 0 },
    select: { id: true },
  });
  let urut = 1;
  for (const i of items) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: i.lk.split("#")[1]!,
        name: `Pekerjaan ${i.lk}`,
        unit: "m3",
        volume: i.vol,
        unitPrice: 1000,
        amount: BigInt(Math.round(i.vol * 1000)),
        lineageKey: i.lk,
        sortOrder: urut++,
      },
    });
  }
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Uji", role: "site_manager", passwordHash: "x" },
  });
  userId = u.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Lokasi uji", slug: `lok-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
  // I#1 normal, I#2 dinolkan CCO, I#3 dinolkan tapi draft menaikkannya lagi.
  await revisi(1, "aktif", [
    { lk: "I#1", vol: 10 },
    { lk: "I#2", vol: 0 },
    { lk: "I#3", vol: 0 },
  ]);
  await revisi(2, "draft", [
    { lk: "I#1", vol: 10 },
    { lk: "I#2", vol: 0 },
    { lk: "I#3", vol: 25 },
  ]);
});

afterAll(async () => {
  await db.rabNode.deleteMany({ where: { revision: { locationId } } });
  await db.rabRevision.deleteMany({ where: { locationId } });
  await db.location.deleteMany({ where: { id: locationId } });
});

describe("item dinolkan di pemilih pekerjaan", () => {
  it("laporan harian & WA: I#2 hilang; I#3 tetap karena draft menaikkannya (sisa ke draft)", async () => {
    const opsi = await getLeafNodeOptions(locationId);
    expect(opsi.map((o) => o.lineageKey).sort()).toEqual(["I#1", "I#3"]);
    expect(opsi.find((o) => o.lineageKey === "I#3")).toMatchObject({ basis: "aktif", sisaDraft: 25, volumeDraft: 25 });
  });

  it("templat rekap harian: item dinolkan ditandai", async () => {
    const daun = await getRecapLeaves(locationId);
    expect(daun.filter((d) => !d.dinolkan).map((d) => d.lineageKey)).toEqual(["I#1"]);
  });

  it("impor laporan pelaksana: tujuan tanpa item dinolkan; versi draft I#3 tetap", async () => {
    const k = await kandidatImpor(locationId, null);
    expect(k.map((x) => `${x.basis}|${x.lineageKey}`).sort()).toEqual([
      "aktif|I#1",
      "draft_adendum|I#1",
      "draft_adendum|I#3",
    ]);
  });
});
