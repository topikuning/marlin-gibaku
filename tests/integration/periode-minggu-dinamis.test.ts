/*
 * PERIODE MINGGU DINAMIS (DECISIONS 708) – dari tombol sampai angka.
 *
 * Permintaan user 2026-10-26: periode minggu sudah berganti dari 7 hari sejak
 * SPMK ke Senin–Minggu, lalu datang permintaan Jumat–Kamis – *"aku tetap butuh
 * dinamis hari start nya"*. Pilihan user: diganti per paket, bawaan kontrak
 * baru diatur di Sistem.
 *
 * Yang dibuktikan:
 *   1. PM mengganti periode paket ke Jumat–Kamis → kurva-S dikonversi dengan
 *      bentuk kalender dipertahankan (Σ utuh), dan RENCANA MINGGUAN ikut
 *      tanggal minggu barunya (dulu tertinggal di rentang lama).
 *   2. Bawaan kontrak baru diatur di Sistem (`system.manage` saja) dan dipakai
 *      saat kontrak dibuat.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let peranUji: "super_admin" | "project_manager" = "project_manager";
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  const pengguna = () => ({ ...penggunaUji(), role: peranUji });
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(peranUji, cap)) throw new asli.ForbiddenError();
      return pengguna();
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { ubahModeMingguAction, convertToContract } = await import("@/lib/package/actions");
const { ubahModeMingguBawaanAction } = await import("@/lib/periode-minggu-actions");
const { getModeMingguBawaan, MODE_MINGGU_BAWAAN_KEY } = await import("@/lib/periode-minggu-setelan");
const { akhirKontrak, totalWeeksBetween, weekDateRange } = await import("@/lib/progress-calc");

const suffix = `pmd${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let pkgId = "";
let locId = "";
let contractId = "";
let planId = "";

function penggunaUji() {
  return {
    id: userId,
    orgId,
    fullName: "Penguji Periode",
    username: `pmd-${suffix}`,
    email: null,
    role: "project_manager" as const,
    mustChangePassword: false,
  };
}

// SPMK Senin 2 Mar 2026, 119 hari. Senin–Minggu: M1 utuh 2–8 Mar.
// Jumat–Kamis: M1 = Senin 2 – Kamis 5 Mar (4 hari), M2 = Jumat 6 – Kamis 12 Mar.
const SPMK = new Date("2026-03-02T00:00:00.000Z");
const END = akhirKontrak(SPMK, 119, true).akhir;
const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);

function form(isi: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  await db.appSetting.deleteMany({ where: { key: MODE_MINGGU_BAWAAN_KEY } });
  const org = await db.organization.create({ data: { name: `Org PMD ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `pmd-${suffix}`, fullName: "Penguji Periode", role: "project_manager", passwordHash: "x" },
  });
  userId = u.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket PMD ${suffix}` } });
  pkgId = pkg.id;
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
  const vendor = await db.vendor.create({ data: { orgId, name: `CV PMD ${suffix}` }, select: { id: true } });
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
      weekMode: "senin_minggu",
    },
    select: { id: true },
  });
  contractId = contract.id;

  // Jadwal user: seluruh bobot di M1 Senin–Minggu (2–8 Mar).
  const kolomLama = totalWeeksBetween(SPMK, END, "senin_minggu");
  const b = await db.baseline.create({
    data: { locationId: locId, baselineNo: 1, source: "manual", status: "aktif", contractDays: 119 },
    select: { id: true },
  });
  const weekly = [100, ...new Array(kolomLama - 1).fill(0)];
  let acc = 0;
  await db.baselinePoint.createMany({
    data: weekly.map((w, i) => ({ baselineId: b.id, weekNumber: i + 1, plannedPct: (acc += w) })),
  });
  await db.baselineScheduleItem.create({
    data: { baselineId: b.id, lineageKey: `lk-${suffix}`, name: "Galian", weightPct: 100, weekly },
  });

  // Rencana M3 dibuat pada grid lama: Senin 16 – Minggu 22 Mar.
  const lama = weekDateRange(SPMK, 3, "senin_minggu", END);
  const plan = await db.weeklyPlan.create({
    data: { locationId: locId, weekNumber: 3, weekStart: lama.start, weekEnd: lama.end, createdById: userId },
    select: { id: true },
  });
  planId = plan.id;
});

describe("ganti periode paket ke Jumat–Kamis", () => {
  it("PM menggantinya; pesan menyebut periode baru dan rencana yang ikut disesuaikan", async () => {
    peranUji = "project_manager";
    const r = await ubahModeMingguAction(undefined, form({ packageId: pkgId, weekMode: "jumat_kamis" }));
    expect(r?.error).toBeUndefined();
    expect(r?.success).toContain("Jumat–Kamis");
    expect(r?.success).toContain("1 rencana mingguan");
    const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { weekMode: true } });
    expect(c.weekMode).toBe("jumat_kamis");
  });

  it("kurva-S dikonversi: M1 Senin–Minggu lama terbelah 4/7 ke M1 baru dan 3/7 ke M2, Σ tetap 100", async () => {
    const aktif = await db.baseline.findFirstOrThrow({
      where: { locationId: locId, status: "aktif" },
      select: {
        source: true,
        points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
        scheduleItems: { select: { weekly: true } },
      },
    });
    expect(aktif.source).toBe("manual");
    expect(aktif.points).toHaveLength(totalWeeksBetween(SPMK, END, "jumat_kamis"));
    const weekly = aktif.scheduleItems[0].weekly as number[];
    expect(weekly[0]).toBeCloseTo((100 * 4) / 7, 4);
    expect(weekly[1]).toBeCloseTo((100 * 3) / 7, 4);
    expect(weekly.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 4);
  });

  it("rencana M3 tetap M3, tanggalnya ikut grid baru: Jumat 13 – Kamis 19 Mar", async () => {
    const p = await db.weeklyPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(p.weekNumber).toBe(3);
    expect(p.weekStart).toEqual(tgl("2026-03-13"));
    expect(p.weekEnd).toEqual(tgl("2026-03-19"));
  });

  it("tercatat di audit dengan periode lama dan baru", async () => {
    const a = await db.auditLog.findFirst({
      where: { action: "contract.week_mode", resourceId: pkgId },
      orderBy: { createdAt: "desc" },
    });
    expect(a?.payload).toMatchObject({ dari: "senin_minggu", ke: "jumat_kamis", rencanaDisesuaikan: 1 });
  });
});

describe("bawaan kontrak baru diatur di Sistem", () => {
  it("hanya yang memegang system.manage yang boleh mengubahnya", async () => {
    peranUji = "project_manager";
    await expect(ubahModeMingguBawaanAction(undefined, form({ weekMode: "kamis_rabu" }))).rejects.toThrow();
    expect(await getModeMingguBawaan()).toBe("senin_minggu");
  });

  it("super admin memilih Kamis–Rabu → kontrak baru tersimpan Kamis–Rabu", async () => {
    peranUji = "super_admin";
    const r = await ubahModeMingguBawaanAction(undefined, form({ weekMode: "kamis_rabu" }));
    expect(r?.ok).toContain("Kamis–Rabu");
    expect(await getModeMingguBawaan()).toBe("kamis_rabu");

    const pkg2 = await db.package.create({ data: { orgId, name: `Paket PMD2 ${suffix}`, stage: "penetapan" } });
    await db.location.create({
      data: {
        packageId: pkg2.id,
        name: `Lok2 ${suffix}`,
        slug: `lok2-${suffix}`,
        village: "Pasir",
        regency: "Kebumen",
        province: "Jawa Tengah",
      },
    });
    const hasil = await convertToContract(
      undefined,
      form({
        packageId: pkg2.id,
        vendorName: `CV Baru ${suffix}`,
        contractNumber: `K2-${suffix}`,
        ppnPercent: "11",
        signedDate: "2026-10-01",
        durationDays: "90",
        contractValue: "500000000",
      }),
    );
    expect(hasil?.error).toBeUndefined();
    const c = await db.contract.findUniqueOrThrow({ where: { packageId: pkg2.id }, select: { weekMode: true } });
    expect(c.weekMode).toBe("kamis_rabu");
  });

  it("nilai yang bukan periode ditolak", async () => {
    peranUji = "super_admin";
    const r = await ubahModeMingguBawaanAction(undefined, form({ weekMode: "rabu_rabu" }));
    expect(r?.error).toBeTruthy();
    expect(await getModeMingguBawaan()).toBe("kamis_rabu");
  });
});
