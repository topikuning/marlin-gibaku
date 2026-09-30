/*
 * HAPUS REVISI RAB KELIRU (DECISIONS 636).
 *
 * Permintaan user 2026-09-30: adendum yang "terlanjur diaktifkan sebagai
 * adendum, tapi sebenarnya itu bukan adendum yang benar" dihapus dari riwayat
 * lokasi, supaya perbandingan RAB aktif dengan RAB sebelumnya tidak membandingkan
 * dengan kekeliruan. Hanya super admin UTAMA. Keputusan user:
 *  - hapus TOTAL (revisi, item, kurva-S turunannya), ringkasan ke audit;
 *  - laporan harian yang menunjuk item revisi itu DIPINDAH ke item berkode sama
 *    di revisi penggantinya; tanpa padanan → ditolak;
 *  - pemangkasan volume yang dipicu aktivasinya DIKEMBALIKAN, lalu batas volume
 *    RAB aktif diterapkan ulang;
 *  - revisi yang sudah melahirkan CCO DITOLAK (beresi CCO dulu).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `hr${Date.now().toString(36)}`;
process.env.SUPER_ADMIN_UTAMA = `akar-${suffix}`;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type UserUji = { id: string; orgId: string; username: string; role: "super_admin" };
let sebagai: UserUji | null = null;
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  return {
    requireCapability: async (cap: string) => {
      if (!sebagai || !can(sebagai.role, cap as never)) throw new Error("FORBIDDEN");
      return sebagai;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { ringkasHapusRevisi } = await import("@/lib/rab/hapus-revisi");
const { hapusRevisiKeliruAction } = await import("@/lib/rab/hapus-revisi-actions");

let akar: UserUji;
let adminBiasa: UserUji;
let locationId = "";
let contractId = "";
const rev: Record<string, string> = {};
const node: Record<string, string> = {};
let itemLaporan = "";

async function revisi(no: number, source: "hps_awal" | "adendum", status: "aktif" | "digantikan", volA: number, dgnC = false) {
  const r = await db.rabRevision.create({
    data: { locationId, revisionNo: no, source, status, totalValue: BigInt(volA * 1000 + 5 * 2000) },
  });
  const buat = (lineageKey: string, code: string, name: string, volume: number, unitPrice: number, sortOrder: number) =>
    db.rabNode.create({
      data: { revisionId: r.id, kind: "item", lineageKey, code, name, volume, unitPrice, amount: BigInt(volume * unitPrice), sortOrder, unit: "m3" },
    });
  node[`${no}A`] = (await buat("A", "1.a", "Galian", volA, 1000, 1)).id;
  node[`${no}B`] = (await buat("B", "1.b", "Urugan", 5, 2000, 2)).id;
  if (dgnC) node[`${no}C`] = (await buat("C", "1.c", "Pagar sementara", 2, 500, 3)).id;
  await db.baseline.create({
    data: { locationId, baselineNo: no, source: "auto", status: status === "aktif" ? "aktif" : "digantikan", rabRevisionId: r.id, contractDays: 90 },
  });
  return r.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const buat = async (username: string): Promise<UserUji> => {
    const u = await db.user.create({ data: { orgId: org.id, username, fullName: username, passwordHash: "x", role: "super_admin" } });
    return { id: u.id, orgId: org.id, username, role: "super_admin" };
  };
  akar = await buat(`akar-${suffix}`);
  adminBiasa = await buat(`admin-${suffix}`);
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  contractId = (
    await db.contract.create({
      data: { packageId: pkg.id, vendorId: vendor.id, contractNumber: `K-${suffix}`, contractValue: 100_000n, signedDate: new Date("2026-08-01") },
    })
  ).id;
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Kedung", slug: `kedung-${suffix}`, village: "D", regency: "K", province: "P", status: "berjalan", isActive: true },
    })
  ).id;

  // #1 kontrak → #2 adendum KELIRU (Galian dipangkas jadi 4) → #3 adendum benar (Galian 12, aktif).
  rev.r1 = await revisi(1, "hps_awal", "digantikan", 10);
  rev.r2 = await revisi(2, "adendum", "digantikan", 4);
  rev.r3 = await revisi(3, "adendum", "aktif", 12);

  // Laporan final yang diisi saat #2 aktif: Galian 6 m3, lalu dipangkas jadi 4 oleh aktivasi #2.
  const lap = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-09-02"), status: "final", createdById: akar.id },
  });
  itemLaporan = (
    await db.dailyReportItem.create({
      data: { reportId: lap.id, rabNodeId: node["2A"], lineageKey: "A", volumeDone: 4, valueDone: 4000n },
    })
  ).id;
  await db.auditLog.create({
    data: {
      userId: akar.id,
      action: "rab.adendum_sesuaikan_realisasi",
      resourceType: "rab_revision",
      resourceId: rev.r2,
      payload: {
        locationId,
        lineageKey: "A",
        item: "1.a Galian",
        volumeBaru: 4,
        totalSebelum: 6,
        totalSesudah: 4,
        baris: [{ tanggal: "2026-09-02", status: "final", dari: 6, ke: 4 }],
      },
    },
  });
});

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("ringkasan & penolakan", () => {
  it("revisi aktif dan RAB kontrak awal tidak bisa dihapus", async () => {
    expect((await ringkasHapusRevisi(rev.r3)).alasanTolak.join(" ")).toMatch(/aktif/i);
    expect((await ringkasHapusRevisi(rev.r1)).alasanTolak.join(" ")).toMatch(/kontrak awal/i);
  });

  it("ringkasan menyebut pengganti, laporan yang dipindah, kurva-S, dan pemulihan volume", async () => {
    const r = await ringkasHapusRevisi(rev.r2);
    expect(r.alasanTolak).toEqual([]);
    expect(r.pengganti?.revisionNo).toBe(3);
    expect(r.laporanDipindah).toBe(1);
    expect(r.kurvaS).toBe(1);
    expect(r.pemulihan).toEqual([expect.objectContaining({ tanggal: "2026-09-02", sekarang: 4, kembaliKe: 6 })]);
  });

  it("revisi yang sudah melahirkan CCO DITOLAK", async () => {
    const cco = await db.contractAmendment.create({
      data: { contractId, ccoNumber: "CCO-1", valueDelta: 0n, endDateDelta: 0, effectiveDate: new Date("2026-09-01"), reason: "uji" },
    });
    await db.rabRevision.update({ where: { id: rev.r2 }, data: { amendmentId: cco.id } });
    expect((await ringkasHapusRevisi(rev.r2)).alasanTolak.join(" ")).toMatch(/CCO-1/);
    await db.rabRevision.update({ where: { id: rev.r2 }, data: { amendmentId: null } });
  });
});

describe("hapus revisi keliru", () => {
  it("super admin BIASA ditolak", async () => {
    sebagai = adminBiasa;
    const r = await hapusRevisiKeliruAction(undefined, fd({ revisionId: rev.r2, konfirmasi: "HAPUS #2" }));
    expect(r?.error).toMatch(/super admin utama/);
    expect(await db.rabRevision.count({ where: { id: rev.r2 } })).toBe(1);
  });

  it("konfirmasi yang salah ketik ditolak", async () => {
    sebagai = akar;
    const r = await hapusRevisiKeliruAction(undefined, fd({ revisionId: rev.r2, konfirmasi: "HAPUS 2" }));
    expect(r?.error).toMatch(/HAPUS #2/);
  });

  it("super admin utama: revisi & kurva-S hilang, laporan pindah ke pengganti, volume dipulihkan", async () => {
    sebagai = akar;
    const r = await hapusRevisiKeliruAction(undefined, fd({ revisionId: rev.r2, konfirmasi: "HAPUS #2" }));
    expect(r?.success, r?.error).toMatch(/Revisi #2 dihapus/);

    expect(await db.rabRevision.count({ where: { id: rev.r2 } })).toBe(0);
    expect(await db.rabNode.count({ where: { revisionId: rev.r2 } })).toBe(0);
    expect(await db.baseline.count({ where: { rabRevisionId: rev.r2 } })).toBe(0);

    const item = await db.dailyReportItem.findUniqueOrThrow({ where: { id: itemLaporan } });
    expect(item.rabNodeId).toBe(node["3A"]);
    // Dikembalikan ke 6 (masih di bawah volume RAB aktif 12 → tidak dipangkas lagi).
    expect(Number(item.volumeDone)).toBe(6);
    expect(item.valueDone).toBe(6_000n);

    // Revisi lain utuh; jejaknya tercatat.
    expect(await db.rabRevision.count({ where: { locationId } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "rab.revisi_hapus_keliru", resourceId: locationId } })).toBe(1);
  });

  it("laporan yang itemnya TIDAK ada di revisi pengganti → penghapusan ditolak dan item disebut", async () => {
    const r4 = await revisi(4, "adendum", "digantikan", 12, true);
    await db.rabRevision.update({ where: { id: rev.r3 }, data: { revisionNo: 5 } });
    const lap = await db.dailyReport.create({
      data: { locationId, reportDate: new Date("2026-09-10"), status: "final", createdById: akar.id },
    });
    await db.dailyReportItem.create({
      data: { reportId: lap.id, rabNodeId: node["4C"], lineageKey: "C", volumeDone: 1, valueDone: 500n },
    });
    const ringkas = await ringkasHapusRevisi(r4);
    expect(ringkas.alasanTolak.join(" ")).toMatch(/Pagar sementara/);
    sebagai = akar;
    const r = await hapusRevisiKeliruAction(undefined, fd({ revisionId: r4, konfirmasi: "HAPUS #4" }));
    expect(r?.error).toMatch(/Pagar sementara/);
    expect(await db.rabRevision.count({ where: { id: r4 } })).toBe(1);
  });
});
