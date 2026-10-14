// KONTRAK TAHUN TUNGGAL SELESAI PALING LAMBAT 31 DESEMBER (DECISIONS 672).
//
// Laporan user 2026-10-13: "spmk 18 september, waktu pelaksanaan 105 hari,
// tapi tanggal selesai jadinya 1 januari, karena ini bukan kontrak multi
// years, ini jadi masalah."
//
// Yang dijaga: aksi SPMK dan koreksi kontrak menulis 31 Desember (dan
// mengatakannya), centang tahun jamak melepas batasnya, dan migrasi membatasi
// kontrak yang telanjur tersimpan 1 Januari – berikut kolom minggu ke-16
// kurva-S yang hanya berisi hari 1 Januari itu.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

let sessionUser = { id: "", orgId: "", role: "super_admin", fullName: "Tester" };
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => sessionUser,
  getCurrentUser: async () => sessionUser,
  requireCapability: async () => sessionUser,
  accessibleLocationIds: async () => null,
  requestIp: async () => null,
}));

const { db } = await import("@/lib/db");
const { startPelaksanaan, editContractAction } = await import("@/lib/package/actions");
const { totalWeeksBetween } = await import("@/lib/progress-calc");

const suffix = `tt${Date.now().toString(36)}`;
const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
const kunci = (t: Date | null | undefined) => (t ? t.toISOString().slice(0, 10) : null);

/** Migrasi dibaca dari berkasnya supaya uji & migrasi tak bisa menyimpang (idempoten, jadi aman diulang). */
const MIGRASI = readFileSync("prisma/migrations/20261013090000_kontrak_tahun_jamak/migration.sql", "utf8")
  .split(/;\s*\n/)
  .map((x) => x.trim())
  .filter((x) => x.replace(/--.*$/gm, "").trim() !== "");

let orgId = "";
let vendorId = "";

async function paket(nama: string, kontrak: Record<string, unknown>) {
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${nama} ${suffix}`, stage: "kontrak" } });
  const c = await db.contract.create({
    data: {
      packageId: pkg.id, vendorId, contractNumber: `KTR-${nama}-${suffix}`, contractValue: 1_000_000_000n,
      signedDate: d("2026-09-10"), durationDays: 105, ...kontrak,
    },
  });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: `Lok ${nama}`, slug: `lok-${nama}-${suffix}`, village: "Desa", regency: "Kab", province: "Prov" },
  });
  return { pkg, c, loc };
}

/** Baseline 16 minggu (grid lama sampai 1 Januari): kumulatif + satu baris matriks. */
async function baseline16(locationId: string) {
  const b = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", contractDays: 105 },
  });
  const kumulatif = Array.from({ length: 16 }, (_, i) => (i === 15 ? 100 : Math.round(((i + 1) / 16) * 97.5 * 1000) / 1000));
  await db.baselinePoint.createMany({
    data: kumulatif.map((p, i) => ({ baselineId: b.id, weekNumber: i + 1, plannedPct: p })),
  });
  const weekly = Array.from({ length: 16 }, (_, i) => (i === 14 ? 1.25 : i === 15 ? 0.4 : 0.5));
  await db.baselineScheduleItem.create({
    data: { baselineId: b.id, lineageKey: "I", name: "PERSIAPAN", weightPct: 8.15, weekly },
  });
  return b.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const user = await db.user.create({
    data: { orgId, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sessionUser = { ...sessionUser, id: user.id, orgId };
  vendorId = (await db.vendor.create({ data: { orgId, name: `PT ${suffix}` } })).id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("aksi SPMK & koreksi kontrak", () => {
  it("SPMK 18 September + 105 hari, tahun tunggal → selesai 31 Desember, dan pesannya mengatakan itu", async () => {
    const { pkg, c } = await paket("spmk", {});
    const res = await startPelaksanaan(pkg.id, "2026-09-18");
    expect(res?.success).toMatch(/dibatasi 31 Desember 2026.*1 Januari 2027/);
    const k = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(kunci(k.startDate)).toBe("2026-09-18");
    expect(kunci(k.endDate)).toBe("2026-12-31");
  });

  it("koreksi kontrak: centang tahun jamak melepas batas, hapus centang mengembalikannya", async () => {
    const { pkg, c } = await paket("koreksi", { startDate: d("2026-09-18"), endDate: d("2026-12-31") });
    const form = (tahunJamak: boolean) => {
      const fd = new FormData();
      fd.set("packageId", pkg.id);
      fd.set("packageName", pkg.name);
      fd.set("contractNumber", c.contractNumber);
      fd.set("contractValue", "1000000000");
      fd.set("ppnPercent", "11");
      fd.set("signedDate", "2026-09-10");
      fd.set("durationDays", "105");
      fd.set("startDate", "2026-09-18");
      if (tahunJamak) fd.set("tahunJamak", "1");
      return fd;
    };
    await editContractAction(undefined, form(true));
    let k = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect([k.tahunJamak, kunci(k.endDate)]).toEqual([true, "2027-01-01"]);

    const res = await editContractAction(undefined, form(false));
    expect(res?.success).toMatch(/dibatasi 31 Desember 2026/);
    k = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect([k.tahunJamak, kunci(k.endDate)]).toEqual([false, "2026-12-31"]);
  });
});

describe("migrasi: kontrak yang telanjur tersimpan 1 Januari", () => {
  it("dibatasi 31 Desember; kolom minggu ke-16 digabung ke minggu ke-15 tanpa mengubah Σ bobot", async () => {
    const lama = { startDate: d("2026-09-18"), endDate: d("2027-01-01") };
    const tunggal = await paket("mig", { ...lama, weekMode: "tujuh_hari" });
    const jamak = await paket("jamak", { ...lama, weekMode: "tujuh_hari", tahunJamak: true });
    const senin = await paket("senin", { ...lama, weekMode: "senin_minggu" });
    const bTunggal = await baseline16(tunggal.loc.id);
    const bJamak = await baseline16(jamak.loc.id);
    const bSenin = await baseline16(senin.loc.id);

    await db.$transaction(async (tx) => {
      for (const sql of MIGRASI) await tx.$executeRawUnsafe(sql);
    });

    const akhir = async (id: string) => kunci((await db.contract.findUniqueOrThrow({ where: { id } })).endDate);
    expect(await akhir(tunggal.c.id)).toBe("2026-12-31");
    expect(await akhir(jamak.c.id)).toBe("2027-01-01");
    expect(await akhir(senin.c.id)).toBe("2026-12-31");

    // Jumlah kolom = penghitung yang dipakai laporan (totalWeeksBetween).
    const titik = async (id: string) =>
      (await db.baselinePoint.findMany({ where: { baselineId: id }, orderBy: { weekNumber: "asc" } })).map((p) => Number(p.plannedPct));
    const tTunggal = await titik(bTunggal);
    expect(tTunggal).toHaveLength(totalWeeksBetween(d("2026-09-18"), d("2026-12-31"), "tujuh_hari"));
    expect(tTunggal).toHaveLength(15);
    expect(tTunggal.at(-1)).toBe(100);
    expect(await titik(bJamak)).toHaveLength(16);
    // Senin–Minggu: 31 Desember dan 1 Januari ada di minggu kalender yang sama.
    expect(await titik(bSenin)).toHaveLength(totalWeeksBetween(d("2026-09-18"), d("2026-12-31"), "senin_minggu"));
    expect(await titik(bSenin)).toHaveLength(16);

    const weekly = async (id: string) =>
      (await db.baselineScheduleItem.findFirstOrThrow({ where: { baselineId: id } })).weekly as number[];
    const w = await weekly(bTunggal);
    expect(w).toHaveLength(15);
    expect(w[14]).toBeCloseTo(1.65, 10);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5 * 14 + 1.25 + 0.4, 10);
    expect(await weekly(bJamak)).toHaveLength(16);

    // Idempoten: dijalankan lagi tidak memangkas apa pun.
    await db.$transaction(async (tx) => {
      for (const sql of MIGRASI) await tx.$executeRawUnsafe(sql);
    });
    expect(await titik(bTunggal)).toHaveLength(15);
    expect(await weekly(bTunggal)).toHaveLength(15);
  });
});
