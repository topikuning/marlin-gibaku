/*
 * "SIMPAN KURVA MANUAL" MENGIKUTI RAB AKTIF (DECISIONS 795).
 *
 * Keluhan user 2026-11-26: penyesuaian halus %-mingguan sesudah CCO tidak
 * mengubah kategori/item ke RAB baru, malah menampilkan kategori lama – baru
 * benar sesudah "Hitung ulang" lalu disimpan manual lagi.
 *
 * Yang dibuktikan:
 * - RAB berubah sejak jadwal disusun: baris = kategori RAB aktif (Tambatan 0
 *   keluar, Genset baru masuk), bobot = porsi RAB, kolom = kurva manual, dan
 *   laporan tidak lagi melaporkan ketidakcocokan;
 * - RAB tidak berubah: jadwal impor "apa adanya" (bobot ≠ RAB) tetap dipakai.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let sessionUserId = "";
let sessionOrgId = "";
vi.mock("@/lib/auth/session", async () => {
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role: "project_manager", fullName: "PM" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    requireCapability: async () => user(),
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { saveManualBaselineAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `km${Date.now().toString(36)}`;
const START = "2026-01-05";
const WEEKS = 4;
const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
let pkgId = "";
const lokasi: string[] = [];

/** Lokasi + revisi aktif berkategori `kat` + baseline aktif berjadwal `jadwal`. */
async function siapkan(
  nama: string,
  kat: { key: string; name: string; amount: bigint }[],
  jadwal: { key: string; name: string; weekly: number[] }[],
  revisiLain: boolean,
) {
  const loc = await db.location.create({
    data: { packageId: pkgId, name: nama, slug: `${nama.toLowerCase()}-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  lokasi.push(loc.id);
  const lama = revisiLain
    ? await db.rabRevision.create({ data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "digantikan", totalValue: 1n } })
    : null;
  const rev = await db.rabRevision.create({
    data: { locationId: loc.id, revisionNo: lama ? 2 : 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  await db.rabNode.createMany({
    data: kat.map((k, i) => ({ revisionId: rev.id, kind: "kategori" as const, code: k.key.split("#")[0], name: k.name, amount: k.amount, lineageKey: k.key, sortOrder: i })),
  });
  const b = await db.baseline.create({
    data: { locationId: loc.id, baselineNo: 1, source: "manual", status: "aktif", rabRevisionId: (lama ?? rev).id, contractDays: WEEKS * 7 },
  });
  let kum = 0;
  await db.baselinePoint.createMany({
    data: Array.from({ length: WEEKS }, (_, i) => {
      kum += jadwal.reduce((s, j) => s + j.weekly[i], 0);
      return { baselineId: b.id, weekNumber: i + 1, plannedPct: kum };
    }),
  });
  await db.baselineScheduleItem.createMany({
    data: jadwal.map((j) => ({ baselineId: b.id, lineageKey: j.key, name: j.name, weightPct: j.weekly.reduce((s, v) => s + v, 0), weekly: j.weekly })),
  });
  return { locationId: loc.id, baselineId: b.id, revisionId: rev.id };
}

async function simpan(locationId: string, baselineId: string, points: number[]) {
  const fd = new FormData();
  fd.set("baselineId", baselineId);
  fd.set("locationId", locationId);
  fd.set("points", JSON.stringify(points));
  return saveManualBaselineAction(undefined, fd);
}

const aktif = (locationId: string) =>
  db.baseline.findFirstOrThrow({
    where: { locationId, status: "aktif" },
    include: { scheduleItems: true, points: { orderBy: { weekNumber: "asc" } } },
  });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  sessionOrgId = org.id;
  const u = await db.user.create({ data: { orgId: org.id, username: `pm-${suffix}`, fullName: "PM", role: "project_manager", passwordHash: "x" } });
  sessionUserId = u.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  pkgId = pkg.id;
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: d(START),
      durationDays: WEEKS * 7,
      startDate: d(START),
      endDate: new Date(d(START).getTime() + (WEEKS * 7 - 1) * 86_400_000),
    },
  });
});

afterAll(async () => {
  for (const id of lokasi) {
    await db.baselinePoint.deleteMany({ where: { baseline: { locationId: id } } });
    await db.baselineScheduleItem.deleteMany({ where: { baseline: { locationId: id } } });
    await db.baseline.deleteMany({ where: { locationId: id } });
    await db.rabNode.deleteMany({ where: { revision: { locationId: id } } });
    await db.rabRevision.deleteMany({ where: { locationId: id } });
    await db.location.deleteMany({ where: { id } });
  }
});

describe("simpan kurva manual sesudah CCO", () => {
  it("jadwal per pekerjaan disusun ulang dari RAB aktif: Tambatan keluar, Genset masuk, bobot porsi RAB", async () => {
    const L = await siapkan(
      "BuyatCco",
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", amount: 30_000_000n },
        { key: "III", name: "PEKERJAAN TAMBATAN PERAHU", amount: 0n },
        { key: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", amount: 50_000_000n },
        { key: "XII#2", name: "PEKERJAAN BANGUNAN GENSET", amount: 20_000_000n },
      ],
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", weekly: [10, 10, 0, 0] },
        { key: "III", name: "PEKERJAAN TAMBATAN PERAHU", weekly: [0, 10, 20, 0] },
        { key: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", weekly: [0, 10, 20, 20] },
        // Baris nol yang diberikan koreksi/adendum untuk kategori baru (698) – keadaan BUYAT.
        { key: "XII#2", name: "PEKERJAAN BANGUNAN GENSET", weekly: [0, 0, 0, 0] },
        { key: "III#2", name: "PEKERJAAN (kategori III – judul tidak ada di file)", weekly: [0, 0, 0, 0] },
      ],
      true,
    );
    const titik = [5, 30, 70, 100];
    const r = await simpan(L.locationId, L.baselineId, titik);
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/disusun ulang mengikuti RAB aktif/);
    expect(r?.success).toMatch(/tidak ada lagi di RAB: PEKERJAAN TAMBATAN PERAHU/);
    expect(r?.success).toMatch(/dijadwalkan otomatis: PEKERJAAN BANGUNAN GENSET/);

    const b = await aktif(L.locationId);
    expect(b.rabRevisionId).toBe(L.revisionId);
    const baris = new Map(b.scheduleItems.map((s) => [s.lineageKey, s]));
    expect([...baris.keys()].sort()).toEqual(["I", "IV", "XII#2"]);
    const jumlah = (w: unknown) => (w as number[]).reduce((s, v) => s + v, 0);
    expect(jumlah(baris.get("I")!.weekly)).toBeCloseTo(30, 3);
    expect(jumlah(baris.get("IV")!.weekly)).toBeCloseTo(50, 3);
    expect(jumlah(baris.get("XII#2")!.weekly)).toBeCloseTo(20, 3);
    // Kolom mengikuti kurva manual.
    let kum = 0;
    for (let i = 0; i < WEEKS; i++) {
      kum += b.scheduleItems.reduce((s, it) => s + (it.weekly as number[])[i], 0);
      expect(kum).toBeCloseTo(titik[i], 3);
    }
    // Laporan tidak lagi melaporkan ketidakcocokan.
    const lap = await getPeriodReport(L.locationId, "mingguan", 2);
    expect(lap?.kurvaTakSesuai ?? null).toBeNull();
  });

  it("revisi SAMA tetapi isinya dikoreksi di tempat (baseline dibawa CCO lalu koreksi): tetap disusun ulang", async () => {
    const L = await siapkan(
      "BuyatKoreksi",
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", amount: 40_000_000n },
        { key: "III", name: "PEKERJAAN TAMBATAN PERAHU", amount: 0n },
        { key: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", amount: 60_000_000n },
      ],
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", weekly: [10, 10, 0, 0] },
        { key: "III", name: "PEKERJAAN TAMBATAN PERAHU", weekly: [0, 10, 20, 0] },
        { key: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", weekly: [0, 10, 20, 20] },
      ],
      false,
    );
    const r = await simpan(L.locationId, L.baselineId, [5, 30, 70, 100]);
    expect(r?.success).toMatch(/tidak ada lagi di RAB: PEKERJAAN TAMBATAN PERAHU/);
    const b = await aktif(L.locationId);
    expect(b.scheduleItems.map((x) => x.lineageKey).sort()).toEqual(["I", "IV"]);
  });

  it("revisi berganti, daftar pekerjaannya sama (CCO hanya mengubah nilai): bobot ikut porsi RAB baru", async () => {
    const L = await siapkan(
      "NilaiBerubah",
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", amount: 50_000_000n },
        { key: "II", name: "PEKERJAAN STRUKTUR", amount: 50_000_000n },
      ],
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", weekly: [10, 10, 0, 0] },
        { key: "II", name: "PEKERJAAN STRUKTUR", weekly: [0, 20, 30, 30] },
      ],
      true,
    );
    const r = await simpan(L.locationId, L.baselineId, [5, 30, 70, 100]);
    expect(r?.success).toMatch(/disusun ulang mengikuti RAB aktif/);
    const b = await aktif(L.locationId);
    const bobot = new Map(b.scheduleItems.map((x) => [x.lineageKey, Number(x.weightPct)]));
    expect(bobot.get("I")).toBeCloseTo(50, 3);
    expect(bobot.get("II")).toBeCloseTo(50, 3);
  });

  it("RAB tidak berubah: jadwal impor 'apa adanya' (bobot berbeda dari RAB) tetap dipakai", async () => {
    const L = await siapkan(
      "Tetap",
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", amount: 50_000_000n },
        { key: "II", name: "PEKERJAAN STRUKTUR", amount: 50_000_000n },
      ],
      [
        { key: "I", name: "PEKERJAAN PERSIAPAN", weekly: [10, 10, 0, 0] },
        { key: "II", name: "PEKERJAAN STRUKTUR", weekly: [0, 20, 30, 30] },
      ],
      false,
    );
    const r = await simpan(L.locationId, L.baselineId, [5, 30, 70, 100]);
    expect(r?.error).toBeUndefined();
    expect(r?.success).not.toMatch(/disusun ulang/);
    const b = await aktif(L.locationId);
    const bobot = new Map(b.scheduleItems.map((s) => [s.lineageKey, Number(s.weightPct)]));
    expect(bobot.get("I")).toBeCloseTo(20, 3);
    expect(bobot.get("II")).toBeCloseTo(80, 3);
  });
});
