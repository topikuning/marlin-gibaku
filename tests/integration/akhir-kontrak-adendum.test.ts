// MINGGU KONTRAK IKUT ADENDUM WAKTU (DECISIONS 773) – DB asli.
//
// Keluhan user 2026-11-24: *"sudah adendum waktu, tapi kenapa minggu masih
// sama?! ini efek ke update TS tidak bisa"*. Kontrak SPMK 15 Jul 2026 + 135
// hari (akhir awal 27 Nov, 20 minggu Senin–Minggu); CCO +21 hari → 18 Des,
// 23 minggu. Impor TS 23 minggu ditolak karena penghitung minggu memakai akhir
// AWAL. Yang dijaga: semua pintu yang dipakai impor TS, template, laporan
// periodik, dan kop dokumen menghitung dari akhir yang BERLAKU.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { totalWeeksFor } = await import("@/lib/rab/import");
const { getPeriodBounds, HEADER_LOCATION_SELECT, buildPeriodHeader } = await import("@/lib/periodic-report");

const suffix = `aka${Date.now().toString(36)}`;
const t = (k: string) => new Date(`${k}T00:00:00.000Z`);
let lokasiId = "";
let kontrakId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AKA ${suffix}`, slug: `org-aka-${suffix}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: "PT Uji Adendum" } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket AKA ${suffix}`, stage: "pelaksanaan" } });
  kontrakId = (
    await db.contract.create({
      data: {
        packageId: pkg.id,
        vendorId: vendor.id,
        contractNumber: `KTR/AKA/${suffix}`,
        contractValue: 1_000_000_000n,
        signedDate: t("2026-06-19"),
        durationDays: 135,
        startDate: t("2026-07-15"),
        endDate: t("2026-11-27"),
        weekMode: "senin_minggu",
      },
    })
  ).id;
  lokasiId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Lokasi AKA", slug: `aka-${suffix}`, village: "D", regency: "K", province: "P" },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sebelum adendum waktu", () => {
  it("20 minggu, akhir 27 Nov", async () => {
    expect((await totalWeeksFor(lokasiId)).totalWeeks).toBe(20);
    const b = await getPeriodBounds(lokasiId);
    expect(b?.endDate).toEqual(t("2026-11-27"));
    expect(b?.totalWeeks).toBe(20);
  });
});

describe("sesudah CCO +21 hari", () => {
  beforeAll(async () => {
    await db.contractAmendment.create({
      data: {
        contractId: kontrakId,
        ccoNumber: "CCO-02",
        valueDelta: 0n,
        endDateDelta: 21,
        effectiveDate: t("2026-11-20"),
        reason: "Perpanjangan waktu",
      },
    });
  });

  it("impor TS & baseline: 23 minggu, masa 156 hari", async () => {
    const w = await totalWeeksFor(lokasiId);
    expect(w.totalWeeks).toBe(23);
    expect(w.contractDays).toBe(156);
    expect(w.weekEndFracs).toHaveLength(23);
  });

  it("laporan periodik & template Kurva-S: akhir 18 Des, 23 minggu", async () => {
    const b = await getPeriodBounds(lokasiId);
    expect(b?.endDate).toEqual(t("2026-12-18"));
    expect(b?.totalWeeks).toBe(23);
  });

  it("kop dokumen: masa pelaksanaan 156 hari, selesai 18 Des", async () => {
    const lok = await db.location.findUniqueOrThrow({ where: { id: lokasiId }, select: HEADER_LOCATION_SELECT });
    const kop = buildPeriodHeader(lok, {
      grandTotal: 0,
      startDate: t("2026-07-15"),
      periodeStart: t("2026-07-15"),
      periodeEnd: t("2026-07-19"),
    });
    expect(kop?.masaPelaksanaanHari).toBe(156);
    expect(kop?.contractEnd).toEqual(t("2026-12-18"));
  });

  it("akhir AWAL di kontrak tidak diubah – yang berubah hanya hitungannya", async () => {
    const k = await db.contract.findUniqueOrThrow({ where: { id: kontrakId }, select: { endDate: true, durationDays: true } });
    expect(k.endDate).toEqual(t("2026-11-27"));
    expect(k.durationDays).toBe(135);
  });
});
