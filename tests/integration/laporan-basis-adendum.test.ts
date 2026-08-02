// Laporan progres terhadap DRAFT adendum (DECISIONS 210).
//
// Permintaan user 2026-08-02: "dalam realita di lapangan, seringkali pekerjaan
// itu dikerjakan dulu baru adendumnya dibuat … jadi kita bisa buat rab posisi
// draft tapi progress atas draft itu tetap bisa dibuat laporannya."
//
// Yang paling berbahaya dari fitur ini bukan angka draftnya, tapi ANGKA RESMI:
// kalau laporan terhadap adendum yang belum disetujui ikut menggerakkan
// progres resmi, termin bisa ditagih atas pekerjaan yang belum punya dasar
// kontrak. Karena itu uji pertama di sini menjaga hal itu.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { upsertItem } = await import("@/lib/daily-report/service");
const { getLocationProgress, getProgresDraftAdendum, cumulativeVolumeByLineage } = await import(
  "@/lib/progress"
);

const suffix = `ba${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let locationId = "";
let reportId = "";
/** Item yang ADA di RAB aktif (volume 100) dan di draft dinaikkan jadi 150. */
let nodeAktifId = "";
let nodeDraftNaikId = "";
/** Item yang HANYA ada di draft — pekerjaan tambah yang belum ada dasarnya. */
let nodeDraftBaruId = "";

const LK_NAIK = "I#1";
const LK_BARU = "I#9";

async function buatRevisi(
  revisionNo: number,
  status: "aktif" | "draft",
  items: { lineageKey: string; code: string; volume: number; harga: number }[],
) {
  const totalNilai = items.reduce((t, i) => t + BigInt(Math.round(i.volume * i.harga)), 0n);
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo,
      source: revisionNo === 1 ? "hps_awal" : "adendum",
      status,
      totalValue: totalNilai,
      createdById: userId,
    },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN PERSIAPAN",
      amount: totalNilai,
      lineageKey: "I",
      sortOrder: 0,
    },
    select: { id: true },
  });
  const ids: Record<string, string> = {};
  let urut = 1;
  for (const i of items) {
    const n = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: i.code,
        name: `Pekerjaan ${i.code}`,
        volume: i.volume,
        unit: "m3",
        unitPrice: i.harga,
        amount: BigInt(Math.round(i.volume * i.harga)),
        lineageKey: i.lineageKey,
        sortOrder: urut++,
      },
      select: { id: true },
    });
    ids[i.lineageKey] = n.id;
  }
  return { revisionId: rev.id, ids };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: { orgId, username: `u-${suffix}`, fullName: "Uji", role: "super_admin", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Uji Basis",
      slug: `uji-basis-${suffix}`,
      village: "V",
      regency: "K",
      province: "P",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;

  const aktif = await buatRevisi(1, "aktif", [{ lineageKey: LK_NAIK, code: "1", volume: 100, harga: 10_000 }]);
  nodeAktifId = aktif.ids[LK_NAIK];

  const draft = await buatRevisi(2, "draft", [
    { lineageKey: LK_NAIK, code: "1", volume: 150, harga: 10_000 },
    { lineageKey: LK_BARU, code: "9", volume: 50, harga: 10_000 },
  ]);
  nodeDraftNaikId = draft.ids[LK_NAIK];
  nodeDraftBaruId = draft.ids[LK_BARU];

  const rep = await db.dailyReport.create({
    data: {
      locationId,
      reportDate: new Date("2026-08-01T00:00:00.000Z"),
      status: "draft",
      createdById: userId,
    },
    select: { id: true },
  });
  reportId = rep.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("KASUS INTI: laporan atas adendum yang belum sah TIDAK menggerakkan angka resmi", () => {
  it("item yang hanya ada di draft bisa dilaporkan, dan bertanda draft_adendum", async () => {
    const item = await upsertItem(reportId, { rabNodeId: nodeDraftBaruId, volumeDone: 20 }, userId);
    expect(item.basis).toBe("draft_adendum");
    expect(item.lineageKey).toBe(LK_BARU);
  });

  it("volume di ATAS batas RAB aktif bisa dilaporkan lewat draft — itu memang inti masalahnya", async () => {
    // RAB aktif membatasi 100; draft menaikkan jadi 150. Lewat item draft,
    // 130 masih sah — dan itulah pekerjaan yang di lapangan sudah jalan.
    const item = await upsertItem(reportId, { rabNodeId: nodeDraftNaikId, volumeDone: 130 }, userId);
    expect(item.basis).toBe("draft_adendum");
    expect(Number(item.volumeDone)).toBe(130);
  });

  it("progres RESMI tidak ikut naik walau laporannya sudah dikirim", async () => {
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "dikirim" } });
    const resmi = await getLocationProgress(locationId);
    // Semua baris di laporan ini basis draft → nol yang masuk hitungan resmi.
    expect(resmi.realizedValue).toBe(0n);
    expect(resmi.realizedPct).toBe(0);
  });

  it("kumulatif volume default (untuk guard & sisa RAB) juga hanya basis aktif", async () => {
    expect((await cumulativeVolumeByLineage(locationId)).get(LK_NAIK) ?? 0).toBe(0);
    expect((await cumulativeVolumeByLineage(locationId, undefined, "semua")).get(LK_NAIK)).toBe(130);
  });
});

describe("laporan berbasis draft menunjukkan angkanya sendiri", () => {
  it("terpasang dihitung memakai RAB draft, mencakup kedua basis", async () => {
    const p = (await getProgresDraftAdendum(locationId))!;
    expect(p.revisionNo).toBe(2);
    // Draft: item naik 150×10.000 = 1.500.000; item baru 50×10.000 = 500.000.
    expect(p.grandTotal).toBe(2_000_000n);
    // Terpasang: 130/150 × 1.500.000 = 1.300.000 · 20/50 × 500.000 = 200.000.
    expect(p.realizedValue).toBe(1_500_000n);
    expect(p.barisBasisDraft).toBe(2);
    // Angka resmi ikut dibawa sebagai pembanding — supaya pembaca tidak
    // mengira ini menggantikan angka kontrak.
    expect(p.realizedValueResmi).toBe(0n);
  });

  it("lokasi tanpa draft → null, bukan angka nol yang menyesatkan", async () => {
    const lain = await db.location.create({
      data: {
        packageId: (await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { packageId: true } }))
          .packageId,
        name: "Tanpa Draft",
        slug: `tanpa-draft-${suffix}`,
        village: "V",
        regency: "K",
        province: "P",
        status: "berjalan",
      },
      select: { id: true },
    });
    expect(await getProgresDraftAdendum(lain.id)).toBeNull();
  });
});

describe("pagar yang tetap berlaku", () => {
  it("item dari revisi yang SUDAH DIGANTIKAN tetap ditolak", async () => {
    const lama = await buatRevisi(3, "draft", [
      { lineageKey: "Z#1", code: "1", volume: 10, harga: 1_000 },
    ]);
    await db.rabRevision.update({ where: { id: lama.revisionId }, data: { status: "digantikan" } });
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "draft" } });
    await expect(
      upsertItem(reportId, { rabNodeId: lama.ids["Z#1"], volumeDone: 1 }, userId),
    ).rejects.toThrow(/digantikan/i);
  });

  it("lewat item AKTIF, batas volume kontrak tetap ditegakkan", async () => {
    await expect(
      upsertItem(reportId, { rabNodeId: nodeAktifId, volumeDone: 101 }, userId),
    ).rejects.toThrow(/melebihi sisa RAB/i);
  });

  it("lewat item DRAFT, batasnya volume draft — dan tetap ditegakkan", async () => {
    await expect(
      upsertItem(reportId, { rabNodeId: nodeDraftNaikId, volumeDone: 151 }, userId),
    ).rejects.toThrow(/melebihi sisa RAB/i);
  });
});
