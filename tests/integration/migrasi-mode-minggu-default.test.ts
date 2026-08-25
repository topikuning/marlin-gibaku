// DEFAULT MODE MINGGU = SENIN–MINGGU (DECISIONS 429).
//
// Kesepakatan user 2026-08-25: perhitungan laporan mingguan default adalah
// Senin–Minggu dengan M1 menyesuaikan, dan SEMUA kontrak yang masih
// tujuh_hari dikonversi otomatis saat deploy — user tidak mengubah satu-satu.
//
// Yang dibuktikan di sini:
//   1. Kontrak baru tanpa weekMode eksplisit → default DB = senin_minggu.
//   2. terapkanDefaultSeninMinggu() mengonversi kontrak tujuh_hari beserta
//      baselinenya lewat jalur konversi 427d (bentuk kalender & provenance
//      dipertahankan, Σ utuh), lalu menulis penanda.
//   3. Jalan kedua = no-op (penanda menang) — kontrak yang KELAK sengaja
//      dikembalikan ke tujuh_hari tidak dipaksa balik.
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { terapkanDefaultSeninMinggu } = await import("@/lib/migrasi/mode-minggu-default");
const { weekEndFractions } = await import("@/lib/progress-calc");

const suffix = `mmd${Date.now().toString(36)}`;
let contractId: string;
let locId: string;

// SPMK Kamis 2026-03-05, 119 hari → tujuh_hari 17 kolom, senin_minggu 18.
const SPMK = new Date("2026-03-05T00:00:00.000Z");
const END = new Date(SPMK.getTime() + 118 * 86_400_000);
const TOTAL_LAMA = 17;

beforeAll(async () => {
  // DB uji dipakai lintas run: penanda dari run sebelumnya dibersihkan supaya
  // migrasi benar-benar berjalan (bukan langsung "sudah").
  await db.appSetting.deleteMany({ where: { key: "migrasi.mode_minggu_default_senin" } });
  const org = await db.organization.create({ data: { name: `Org MMD ${suffix}`, slug: `org-${suffix}` } });
  await db.user.create({
    data: {
      orgId: org.id,
      username: `admin-${suffix}`,
      fullName: "Admin Migrasi",
      role: "super_admin",
      passwordHash: "x",
    },
  });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket MMD ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lok ${suffix}`,
      slug: `lok-${suffix}`,
      village: "Pasir",
      regency: "Kebumen",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV MMD ${suffix}` }, select: { id: true } });
  const contract = await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000_000n,
      ppnPercent: 11,
      signedDate: SPMK,
      durationDays: 119,
      startDate: SPMK,
      endDate: END,
      weekMode: "tujuh_hari",
    },
    select: { id: true },
  });
  contractId = contract.id;

  // Baseline jadwal user (manual): seluruh bobot kategori di minggu-1 lama
  // (Kamis–Rabu) — konversi harus membelahnya 4/7 + 3/7 ke grid baru.
  const b = await db.baseline.create({
    data: { locationId: locId, baselineNo: 1, source: "manual", status: "aktif", contractDays: 119 },
    select: { id: true },
  });
  const weekly = [100, ...new Array(TOTAL_LAMA - 1).fill(0)];
  let acc = 0;
  await db.baselinePoint.createMany({
    data: weekly.map((w, i) => ({ baselineId: b.id, weekNumber: i + 1, plannedPct: (acc += w) })),
  });
  await db.baselineScheduleItem.create({
    data: { baselineId: b.id, lineageKey: `lk-${suffix}`, name: "Galian", weightPct: 100, weekly },
  });
});

describe("default DB kontrak baru", () => {
  it("kontrak tanpa weekMode eksplisit tersimpan senin_minggu", async () => {
    // Kontrak 1:1 dengan paket → butuh paket kedua.
    const c = await db.contract.findUnique({
      where: { id: contractId },
      select: { vendorId: true, package: { select: { orgId: true } } },
    });
    const pkg2 = await db.package.create({
      data: { orgId: c!.package.orgId, name: `Paket MMD2 ${suffix}` },
      select: { id: true },
    });
    const baru = await db.contract.create({
      data: {
        packageId: pkg2.id,
        vendorId: c!.vendorId,
        contractNumber: `K2-${suffix}`,
        contractValue: 1n,
        ppnPercent: 11,
        signedDate: SPMK,
        durationDays: 30,
      },
      select: { id: true, weekMode: true },
    });
    expect(baru.weekMode).toBe("senin_minggu");
    await db.contract.delete({ where: { id: baru.id } });
  });
});

describe("terapkanDefaultSeninMinggu", () => {
  it("mengonversi kontrak tujuh_hari + baselinenya, bentuk kalender dipertahankan", async () => {
    const r = await terapkanDefaultSeninMinggu();
    expect(r.status).toBe("selesai");
    expect(r.kontrak).toBeGreaterThanOrEqual(1);

    const c = await db.contract.findUnique({ where: { id: contractId }, select: { weekMode: true } });
    expect(c?.weekMode).toBe("senin_minggu");

    const frBaru = weekEndFractions(SPMK, END, "senin_minggu");
    const aktif = await db.baseline.findFirst({
      where: { locationId: locId, status: "aktif" },
      select: {
        baselineNo: true,
        source: true,
        points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
        scheduleItems: { select: { weekly: true } },
      },
    });
    expect(aktif?.baselineNo).toBe(2);
    // Provenance dipertahankan: hasil konversi jadwal user tidak menyamar "auto".
    expect(aktif?.source).toBe("manual");
    expect(aktif?.points).toHaveLength(frBaru.length);
    // Minggu-1 lama (Kamis–Rabu, bobot 100) terbelah 4/7 + 3/7 di grid baru.
    const weekly = aktif!.scheduleItems[0].weekly as number[];
    expect(weekly[0]).toBeCloseTo((100 * 4) / 7, 4);
    expect(weekly[1]).toBeCloseTo((100 * 3) / 7, 4);
    expect(weekly.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 4);
    // Kurva berakhir 100 dan monoton.
    const pts = aktif!.points.map((p) => Number(p.plannedPct));
    expect(pts[pts.length - 1]).toBeCloseTo(100, 4);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThanOrEqual(pts[i - 1] - 1e-9);
  });

  it("jalan kedua no-op: kontrak yang sengaja dikembalikan ke tujuh_hari tidak dipaksa balik", async () => {
    await db.contract.update({ where: { id: contractId }, data: { weekMode: "tujuh_hari" } });
    const r = await terapkanDefaultSeninMinggu();
    expect(r.status).toBe("sudah");
    const c = await db.contract.findUnique({ where: { id: contractId }, select: { weekMode: true } });
    expect(c?.weekMode).toBe("tujuh_hari");
    const versi = await db.baseline.count({ where: { locationId: locId } });
    expect(versi).toBe(2);
  });
});
