/*
 * "SAMAKAN KURVA-S SEMUA LOKASI DENGAN RAB AKTIF" (DECISIONS 797).
 *
 * Permintaan user 2026-11-27: hitung ulang kurva-S seluruh lokasi sekali klik,
 * karena khawatir masih ada yang bocor sesudah CCO/koreksi; lokasi yang sudah
 * sesuai tidak perlu diapa-apakan.
 *
 * Yang dibuktikan:
 * - lokasi CCO (jadwal masih RAB lama): jadwal per pekerjaan disusun ulang –
 *   Tambatan keluar, Genset masuk, bobot porsi RAB – sementara titik kurva
 *   rencana TIDAK berubah satu angka pun; sumber & profil baseline diwarisi;
 * - lokasi yang sudah sesuai (jadwal impor apa adanya, atau revisi berganti
 *   tapi porsinya identik) tidak mendapat baseline baru;
 * - lokasi tanpa kurva-S disebut, bukan dibuatkan;
 * - klik kedua tidak mengubah apa pun.
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
    // Lintas lokasi: cakupannya seluruh organisasi uji ini saja.
    accessibleLocationIds: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { samakanKurvaSemuaLokasiAction } = await import("@/app/(app)/progress/actions");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `ks${Date.now().toString(36)}`;
const START = "2026-01-05";
const WEEKS = 4;
const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
let pkgId = "";
const lokasi: string[] = [];

/** Lokasi + revisi aktif berkategori `kat` + (opsional) baseline aktif berjadwal `jadwal`. */
async function siapkan(
  nama: string,
  kat: { key: string; name: string; amount: bigint }[],
  jadwal: { key: string; name: string; weekly: number[] }[] | null,
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
  if (!jadwal) return { locationId: loc.id, revisionId: rev.id, baselineId: "" };
  const b = await db.baseline.create({
    data: {
      locationId: loc.id,
      baselineNo: 1,
      source: "auto",
      profil: "lambat",
      status: "aktif",
      rabRevisionId: (lama ?? rev).id,
      contractDays: WEEKS * 7,
    },
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
  return { locationId: loc.id, revisionId: rev.id, baselineId: b.id };
}

const aktif = (locationId: string) =>
  db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    include: { scheduleItems: true, points: { orderBy: { weekNumber: "asc" } } },
  });

let cco: Awaited<ReturnType<typeof siapkan>>;
let sesuai: Awaited<ReturnType<typeof siapkan>>;
let porsiSama: Awaited<ReturnType<typeof siapkan>>;
let tanpa: Awaited<ReturnType<typeof siapkan>>;

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

  // Keadaan BUYAT sesudah CCO: jadwal masih RAB lama.
  cco = await siapkan(
    "Cco",
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
      { key: "XII#2", name: "PEKERJAAN BANGUNAN GENSET", weekly: [0, 0, 0, 0] },
    ],
    true,
  );
  // Sudah sesuai: RAB tidak berubah, bobot impor 20/80 sengaja ≠ RAB (203).
  sesuai = await siapkan(
    "Sesuai",
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
  // Revisi berganti, tapi daftar & porsinya identik dengan jadwal: tidak ada yang perlu disamakan.
  porsiSama = await siapkan(
    "PorsiSama",
    [
      { key: "I", name: "PEKERJAAN PERSIAPAN", amount: 40_000_000n },
      { key: "II", name: "PEKERJAAN STRUKTUR", amount: 60_000_000n },
    ],
    [
      { key: "I", name: "PEKERJAAN PERSIAPAN", weekly: [20, 20, 0, 0] },
      { key: "II", name: "PEKERJAAN STRUKTUR", weekly: [0, 10, 25, 25] },
    ],
    true,
  );
  tanpa = await siapkan("TanpaKurva", [{ key: "I", name: "PEKERJAAN PERSIAPAN", amount: 10_000_000n }], null, false);
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

describe("samakan kurva-S semua lokasi", () => {
  it("hanya lokasi yang tidak sesuai yang disusun ulang; ringkasannya menyebut semuanya", async () => {
    const r = await samakanKurvaSemuaLokasiAction(undefined);
    expect(r?.error).toBeUndefined();
    expect(r?.success).toBe(
      "1 lokasi disamakan dengan RAB aktifnya, 2 lokasi sudah sesuai dan tidak diubah, " +
        "1 lokasi belum punya kurva-S atau jadwal per pekerjaan. Titik kurva-S rencana tidak berubah.",
    );
    expect(r?.disamakan).toEqual([
      { nama: "Cco", baselineNo: 2, keluar: ["PEKERJAAN TAMBATAN PERAHU"], masuk: ["PEKERJAAN BANGUNAN GENSET"] },
    ]);
    expect(r?.gagal).toEqual([]);
  });

  it("lokasi CCO: titik kurva tetap, jadwal ikut RAB aktif, sumber & profil diwarisi, baseline lama tersimpan", async () => {
    const b = (await aktif(cco.locationId))!;
    expect(b.baselineNo).toBe(2);
    expect(b.source).toBe("auto");
    expect(b.profil).toBe("lambat");
    expect(b.rabRevisionId).toBe(cco.revisionId);
    expect(b.points.map((p) => Number(p.plannedPct))).toEqual([10, 40, 80, 100]);
    const jumlah = (w: unknown) => (w as number[]).reduce((s, v) => s + v, 0);
    const baris = new Map(b.scheduleItems.map((s) => [s.lineageKey, s]));
    expect([...baris.keys()].sort()).toEqual(["I", "IV", "XII#2"]);
    expect(jumlah(baris.get("I")!.weekly)).toBeCloseTo(30, 3);
    expect(jumlah(baris.get("IV")!.weekly)).toBeCloseTo(50, 3);
    expect(jumlah(baris.get("XII#2")!.weekly)).toBeCloseTo(20, 3);
    // Kolom tetap menjumlah ke titik kurva yang sama.
    let kum = 0;
    for (let i = 0; i < WEEKS; i++) {
      kum += b.scheduleItems.reduce((s, it) => s + (it.weekly as number[])[i], 0);
      expect(kum).toBeCloseTo([10, 40, 80, 100][i], 3);
    }
    const lama = await db.baseline.findUniqueOrThrow({ where: { id: cco.baselineId } });
    expect(lama.status).toBe("digantikan");
    const lap = await getPeriodReport(cco.locationId, "mingguan", 2);
    expect(lap?.kurvaTakSesuai ?? null).toBeNull();
  });

  it("lokasi yang sudah sesuai tidak mendapat baseline baru", async () => {
    for (const L of [sesuai, porsiSama]) {
      const b = (await aktif(L.locationId))!;
      expect(b.id).toBe(L.baselineId);
      expect(b.baselineNo).toBe(1);
    }
    expect(await aktif(tanpa.locationId)).toBeNull();
  });

  it("klik kedua: tidak ada lagi yang disamakan", async () => {
    const r = await samakanKurvaSemuaLokasiAction(undefined);
    expect(r?.success).toMatch(/^Tidak ada lokasi yang perlu disamakan, 3 lokasi sudah sesuai/);
    expect((await aktif(cco.locationId))!.baselineNo).toBe(2);
  });
});
