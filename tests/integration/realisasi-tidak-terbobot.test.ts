/*
 * REALISASI YANG TIDAK TERBOBOT KARENA PERUBAHAN RAB.
 *
 * Permintaan user 2026-10-04: *"aku ingin ada halaman atau menu untuk melihat
 * item pekerjaan apa saja yang tidak terbobot karena perubahan RAB"*.
 *
 * Kasusnya: kategori DPT ada di RAB awal dan sudah dilaporkan, lalu adendum
 * (lewat impor) menghilangkannya. Baris laporan hariannya TIDAK dihapus, tapi
 * progres hanya menghitung lineage yang ada di RAB aktif – jadi realisasinya
 * diam-diam keluar dari hitungan, dan sampai sekarang tidak ada layar yang
 * menyebutnya.
 *
 * Aturan "tidak terbobot" di sini HARUS sama dengan aturan progres: lineage
 * yang bukan item di revisi aktif, dari laporan ber-status terhitung, basis
 * aktif. Uji rekonsiliasi di bawah menjaganya: terbobot + tidak terbobot =
 * seluruh realisasi.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { cumulativeVolumeByLineage, volumeTidakTerbobotByLineage } = await import("@/lib/progress");
const { realisasiTidakTerbobot } = await import("@/lib/rab/tidak-terbobot");
const { cariItemBerealisasi } = await import("@/lib/rab/riwayat-item");
const { getWorkspaceData } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `tt${Date.now().toString(36)}`;
let locationId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org TT ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `tt-${suffix}`, fullName: "Mandor Uji", passwordHash: "x", role: "super_admin" },
  });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket TT ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor TT ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 200_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi TT", slug: `lokasi-${suffix}`, village: "Desa", regency: "Kab",
      province: "Prov", status: "berjalan", isActive: true,
    },
  });
  locationId = loc.id;

  // REVISI #1 (RAB awal): kategori II + kategori DPT.
  const rev1 = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 150_000_000n },
  });
  const ii1 = await db.rabNode.create({
    data: { revisionId: rev1.id, kind: "kategori", code: "II", name: "PEKERJAAN STRUKTUR", amount: 100_000_000n, lineageKey: "II", sortOrder: 1 },
  });
  const galian1 = await db.rabNode.create({
    data: {
      revisionId: rev1.id, parentId: ii1.id, kind: "item", code: "2.c", name: "Galian tanah biasa",
      volume: 50, unit: "m3", unitPrice: 2_000_000, amount: 100_000_000n, lineageKey: "II#2.c", sortOrder: 2,
    },
  });
  const dpt1 = await db.rabNode.create({
    data: { revisionId: rev1.id, kind: "kategori", code: "VIII", name: "PEKERJAAN DPT", amount: 50_000_000n, lineageKey: "VIII", sortOrder: 3 },
  });
  const sub1 = await db.rabNode.create({
    data: { revisionId: rev1.id, parentId: dpt1.id, kind: "sub", code: "1", name: "Pasangan Batu", amount: 50_000_000n, lineageKey: "VIII#1", sortOrder: 4 },
  });
  const batu1 = await db.rabNode.create({
    data: {
      revisionId: rev1.id, parentId: sub1.id, kind: "item", code: "a", name: "Pasangan batu kali 1:4",
      volume: 40, unit: "m3", unitPrice: 1_250_000, amount: 50_000_000n, lineageKey: "VIII#1#a", sortOrder: 5,
    },
  });

  // Dilaporkan SEBELUM adendum: galian 10 + 5, batu kali 6 + 4,5.
  for (const [tanggal, galian, batu] of [
    ["2026-07-10", 10, 6],
    ["2026-07-14", 5, 4.5],
  ] as const) {
    const d = await getOrCreateDraft(locationId, tanggal, user.id);
    await upsertItem(d.id, { rabNodeId: galian1.id, volumeDone: galian }, user.id);
    await upsertItem(d.id, { rabNodeId: batu1.id, volumeDone: batu }, user.id);
    await submitReport(d.id, user.id);
  }
  // Laporan DRAFT (belum dikirim) – tidak terhitung di progres, jadi tidak
  // boleh ikut disebut "tidak terbobot" juga.
  const draft = await getOrCreateDraft(locationId, "2026-07-20", user.id);
  await upsertItem(draft.id, { rabNodeId: batu1.id, volumeDone: 2 }, user.id);

  // REVISI #2 (adendum): DPT dihilangkan, galian tetap.
  await db.rabRevision.update({
    where: { id: rev1.id },
    data: { status: "digantikan", supersededAt: new Date("2026-08-01T03:00:00Z") },
  });
  const rev2 = await db.rabRevision.create({
    data: { locationId, revisionNo: 2, source: "adendum", status: "aktif", totalValue: 100_000_000n },
  });
  const ii2 = await db.rabNode.create({
    data: { revisionId: rev2.id, kind: "kategori", code: "II", name: "PEKERJAAN STRUKTUR", amount: 100_000_000n, lineageKey: "II", sortOrder: 1 },
  });
  await db.rabNode.create({
    data: {
      revisionId: rev2.id, parentId: ii2.id, kind: "item", code: "2.c", name: "Galian tanah biasa",
      volume: 50, unit: "m3", unitPrice: 2_000_000, amount: 100_000_000n, lineageKey: "II#2.c", sortOrder: 2,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("volumeTidakTerbobotByLineage – aturan yang sama dengan progres", () => {
  it("hanya lineage yang tidak ada di RAB aktif, dari laporan terhitung", async () => {
    const m = await volumeTidakTerbobotByLineage(locationId);
    expect([...m.keys()]).toEqual(["VIII#1#a"]);
    // 6 + 4,5 – laporan draft 2 tidak ikut.
    expect(m.get("VIII#1#a")).toBeCloseTo(10.5, 3);
  });

  it("rekonsiliasi: terbobot + tidak terbobot = seluruh realisasi", async () => {
    const semua = await cumulativeVolumeByLineage(locationId);
    const tidak = await volumeTidakTerbobotByLineage(locationId);
    const aktif = await db.rabNode.findMany({
      where: { kind: "item", revision: { locationId, status: "aktif" } },
      select: { lineageKey: true },
    });
    const terbobot = aktif.reduce((t, n) => t + (semua.get(n.lineageKey) ?? 0), 0);
    const totalSemua = [...semua.values()].reduce((t, v) => t + v, 0);
    const totalTidak = [...tidak.values()].reduce((t, v) => t + v, 0);
    expect(terbobot + totalTidak).toBeCloseTo(totalSemua, 6);
  });
});

describe("realisasiTidakTerbobot – yang ditampilkan halaman", () => {
  it("menyebut item dengan nama, kategori, dan jalur dari revisi tempat ia terakhir ada", async () => {
    const r = await realisasiTidakTerbobot(locationId);
    expect(r).toHaveLength(1);
    const it0 = r[0]!;
    expect(it0.lineageKey).toBe("VIII#1#a");
    expect(it0.name).toBe("Pasangan batu kali 1:4");
    expect(it0.kategori).toBe("VIII. PEKERJAAN DPT");
    expect(it0.jalur).toBe("VIII · 1 · a");
    expect(it0.unit).toBe("m3");
    expect(it0.volume).toBeCloseTo(10.5, 3);
    expect(it0.volumeKontrakTerakhir).toBe(40);
  });

  it("menyebut revisi terakhir yang memuatnya dan kapan ia hilang", async () => {
    const [it0] = await realisasiTidakTerbobot(locationId);
    expect(it0!.terakhirDiRevisi).toBe(1);
    expect(it0!.hilangDiRevisi).toBe(2);
    expect(it0!.hilangPada?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("menyebut berapa laporan yang memuatnya dan rentang tanggal kerjanya", async () => {
    const [it0] = await realisasiTidakTerbobot(locationId);
    expect(it0!.jumlahLaporan).toBe(2);
    expect(it0!.pertama?.toISOString().slice(0, 10)).toBe("2026-07-10");
    expect(it0!.terakhir?.toISOString().slice(0, 10)).toBe("2026-07-14");
  });
});

describe("halaman riwayat input – item yang sudah keluar dari RAB aktif", () => {
  it("tampil dengan NAMA pekerjaannya, bukan kode internal, dan ditandai tidak terbobot", async () => {
    const hit = await cariItemBerealisasi(locationId, "");
    const batu = hit.find((h) => h.lineageKey === "VIII#1#a")!;
    expect(batu.name).toBe("Pasangan batu kali 1:4");
    expect(batu.code).toBe("a");
    expect(batu.unit).toBe("m3");
    expect(batu.terbobot).toBe(false);
    expect(hit.find((h) => h.lineageKey === "II#2.c")!.terbobot).toBe(true);
  });

  it("bisa dicari menurut namanya", async () => {
    const hit = await cariItemBerealisasi(locationId, "batu kali");
    expect(hit.map((h) => h.lineageKey)).toEqual(["VIII#1#a"]);
  });
});

describe("laporan harian per tanggal – barisnya ditandai, bukan tampil seperti item biasa", () => {
  it("item yang tidak ada di RAB aktif membawa penanda; item lain tidak", async () => {
    const w = await getWorkspaceData(`lokasi-${suffix}`, "2026-07-10");
    const items = w!.report!.items;
    expect(items.find((i) => i.lineageKey === "VIII#1#a")!.diLuarRabAktif).toBe(true);
    expect(items.find((i) => i.lineageKey === "II#2.c")!.diLuarRabAktif).toBe(false);
  });
});
