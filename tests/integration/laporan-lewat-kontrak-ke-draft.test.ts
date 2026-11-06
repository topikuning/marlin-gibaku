// VOLUME KONTRAK HABIS, DRAFT ADENDUM LEBIH BESAR (DECISIONS 742).
//
// Keluhan user 2026-11-05 (dengan tangkapan layar): "Pekerjaan Urugan Tanah
// mendatangkan" – volume kontrak 317,97 sudah terealisasi penuh, draft adendum
// menaikkannya jadi 3.045,152 tapi belum diaktifkan. Input 200 m³ ditolak
// "Volume melebihi sisa RAB. Sisa yang masih bisa dilaporkan: 0 m³".
// "bukankah dulu aku sudah bilang untuk tetap bisa input dibatasi volume
// adendum meskipun draft?"
//
// Sejak DECISIONS 210 penyimpanan memang sanggup mencatat terhadap draft – tapi
// hanya bila yang dikirim node DRAFT. Daftar pilihan (form, WA) selalu memberi
// node KONTRAK untuk item yang ada di kedua revisi, jadi jalur itu tak pernah
// terbuka. Yang dijaga di sini:
//  - volume di atas sisa kontrak tapi di dalam sisa draft → tercatat terhadap
//    draft adendum (basis draft_adendum, node draft), angka resmi TIDAK naik;
//  - di dalam sisa kontrak → tetap resmi;
//  - di atas sisa draft → ditolak dengan menyebut KEDUA sisa;
//  - daftar pilihan menyebut sisa menurut draft, tanpa menggandakan item.
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
const { upsertItem } = await import("@/lib/daily-report/service");
const { getLeafNodeOptions } = await import("@/lib/daily-report/queries");
const { getLocationProgress, cumulativeVolumeByLineage } = await import("@/lib/progress");

const suffix = `lk${Date.now().toString(36)}`;
let userId = "";
let locationId = "";
const node: Record<string, string> = {};
/** Urugan: kontrak 317,97 (habis), draft 3.045,152 – kasus user. */
const LK_URUG = "I#1";
/** Galian: kontrak 100 (terpakai 95), draft 150 – hari batas. */
const LK_GALI = "I#2";
/** Bekisting: kontrak 50 (habis), draft TIDAK menaikkan. */
const LK_TETAP = "I#3";

async function revisi(no: number, status: "aktif" | "draft", items: { lk: string; vol: number }[]) {
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: no, source: no === 1 ? "hps_awal" : "adendum", status, totalValue: 0n, createdById: userId },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN LEVELLING LAHAN", amount: 0n, lineageKey: "I", sortOrder: 0 },
    select: { id: true },
  });
  let urut = 1;
  for (const i of items) {
    const n = await db.rabNode.create({
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
      select: { id: true },
    });
    node[`${status}|${i.lk}`] = n.id;
  }
}

async function laporan(tanggal: string, status: "draft" | "dikirim") {
  return (
    await db.dailyReport.create({
      data: { locationId, reportDate: new Date(`${tanggal}T00:00:00.000Z`), status, createdById: userId },
      select: { id: true },
    })
  ).id;
}

let hariIni = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  userId = (
    await db.user.create({
      data: { orgId: org.id, username: `u-${suffix}`, fullName: "Uji", role: "super_admin", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" }, select: { id: true } });
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Uji Lewat", slug: `uji-lewat-${suffix}`, village: "V", regency: "K", province: "P", status: "berjalan", isActive: true },
      select: { id: true },
    })
  ).id;
  await revisi(1, "aktif", [
    { lk: LK_URUG, vol: 317.97 },
    { lk: LK_GALI, vol: 100 },
    { lk: LK_TETAP, vol: 50 },
  ]);
  await revisi(2, "draft", [
    { lk: LK_URUG, vol: 3045.152 },
    { lk: LK_GALI, vol: 150 },
    { lk: LK_TETAP, vol: 50 },
  ]);
  // Realisasi resmi yang sudah dikirim: urugan habis, galian sisa 5, bekisting habis.
  const lalu = await laporan("2026-10-01", "dikirim");
  for (const [lk, v] of [
    [LK_URUG, 317.97],
    [LK_GALI, 95],
    [LK_TETAP, 50],
  ] as const) {
    await db.dailyReportItem.create({
      data: { reportId: lalu, rabNodeId: node[`aktif|${lk}`]!, lineageKey: lk, basis: "aktif", volumeDone: v, valueDone: BigInt(Math.round(v * 1000)) },
    });
  }
  hariIni = await laporan("2026-11-05", "draft");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("daftar pilihan menyebut sisa menurut draft adendum", () => {
  it("item kontrak yang dinaikkan draft: satu pilihan, sisa kontrak 0, sisa draft 2.727,182", async () => {
    const opsi = await getLeafNodeOptions(locationId);
    const urug = opsi.filter((o) => o.lineageKey === LK_URUG);
    expect(urug).toHaveLength(1);
    expect(urug[0]).toMatchObject({ id: node[`aktif|${LK_URUG}`], basis: "aktif", remaining: 0, sisaDraft: 2727.182, volumeDraft: 3045.152 });
  });

  it("draft yang tidak menaikkan volume: tidak ada sisa draft", async () => {
    const opsi = await getLeafNodeOptions(locationId);
    expect(opsi.find((o) => o.lineageKey === LK_TETAP)?.sisaDraft ?? null).toBeNull();
  });
});

describe("penyimpanan: di atas sisa kontrak, di dalam sisa draft → draft adendum", () => {
  it("kasus user: 200 m³ atas urugan yang kontraknya habis tercatat terhadap draft adendum", async () => {
    const item = await upsertItem(hariIni, { rabNodeId: node[`aktif|${LK_URUG}`]!, volumeDone: 200 }, userId);
    expect(item.basis).toBe("draft_adendum");
    expect(item.rabNodeId).toBe(node[`draft|${LK_URUG}`]);
    expect(Number(item.volumeDone)).toBe(200);
  });

  it("hari batas: 10 m³ dengan sisa kontrak 5 → seluruhnya ke draft; 5 m³ → tetap resmi", async () => {
    const lewat = await upsertItem(hariIni, { rabNodeId: node[`aktif|${LK_GALI}`]!, volumeDone: 10 }, userId);
    expect(lewat.basis).toBe("draft_adendum");
    const pas = await upsertItem(hariIni, { rabNodeId: node[`aktif|${LK_GALI}`]!, volumeDone: 5 }, userId);
    expect(pas.basis).toBe("aktif");
    expect(pas.rabNodeId).toBe(node[`aktif|${LK_GALI}`]);
  });

  it("di atas sisa draft: ditolak dengan menyebut sisa kontrak DAN sisa draft", async () => {
    await expect(upsertItem(hariIni, { rabNodeId: node[`aktif|${LK_URUG}`]!, volumeDone: 2727.183 }, userId)).rejects.toThrow(
      /sisa kontrak: 0 m3.*draft adendum: 2\.727,182 m3/i,
    );
  });

  it("draft tidak menaikkan volume: tetap ditolak seperti dulu", async () => {
    await expect(upsertItem(hariIni, { rabNodeId: node[`aktif|${LK_TETAP}`]!, volumeDone: 1 }, userId)).rejects.toThrow(/melebihi sisa/i);
  });

  it("angka resmi tidak naik oleh baris yang dialihkan ke draft", async () => {
    await db.dailyReport.update({ where: { id: hariIni }, data: { status: "dikirim" } });
    try {
      // Galian terakhir disimpan 5 m³ basis aktif → resmi 100; urugan tetap 317,97.
      const resmi = await cumulativeVolumeByLineage(locationId);
      expect(resmi.get(LK_URUG)).toBe(317.97);
      expect(resmi.get(LK_GALI)).toBe(100);
      const semua = await cumulativeVolumeByLineage(locationId, undefined, "semua");
      expect(semua.get(LK_URUG)).toBe(517.97);
      const p = await getLocationProgress(locationId);
      expect(p.realizedValue).toBe(BigInt(Math.round((317.97 + 100 + 50) * 1000)));
    } finally {
      await db.dailyReport.update({ where: { id: hariIni }, data: { status: "draft" } });
    }
  });
});

/*
 * PERTANYAAN USER 2026-11-05: "bagaimana jika draft kemudian ganti volumenya
 * lebih kecil atau dihapus, sudah termitigasi juga?" Dicoba dulu pada DB uji:
 * sesudah laporan DIKIRIM, mengecilkan/menghapus memang ditolak. Dua celah:
 *  - laporan yang BELUM dikirim tidak dihitung, jadi volume draft bisa
 *    dikecilkan di bawahnya dan item draft-nya bisa dicoba dihapus;
 *  - draft yang diganti berkas baru bervolume lebih kecil memindahkan baris
 *    laporan diam-diam.
 */
describe("draft dikecilkan, dihapus, atau diganti sesudah ada laporan atasnya", () => {
  it("volume draft tidak bisa dikecilkan di bawah yang sudah dilaporkan, walau laporannya belum dikirim", async () => {
    const { updateDraftItemVolume } = await import("@/lib/rab/adendum");
    const draftId = (await db.rabRevision.findFirstOrThrow({ where: { locationId, status: "draft" } })).id;
    // Terlapor urugan: 317,97 (kontrak, dikirim) + 200 (draft, laporan hari ini BELUM dikirim).
    await expect(updateDraftItemVolume(locationId, draftId, node[`draft|${LK_URUG}`]!, 400, userId)).rejects.toThrow(
      /517,97.*belum dikirim/,
    );
    await expect(updateDraftItemVolume(locationId, draftId, node[`draft|${LK_URUG}`]!, 517.97, userId)).resolves.toBeDefined();
    await updateDraftItemVolume(locationId, draftId, node[`draft|${LK_URUG}`]!, 3045.152, userId);
  });

  it("item draft yang hanya dilaporkan di laporan belum dikirim: ditolak dengan kalimat MARLIN, bukan galat basis data", async () => {
    const { addDraftItem, removeDraftNode } = await import("@/lib/rab/adendum");
    const draftId = (await db.rabRevision.findFirstOrThrow({ where: { locationId, status: "draft" } })).id;
    const induk = (await db.rabNode.findFirstOrThrow({ where: { revisionId: draftId, kind: "kategori" } })).id;
    const baru = await addDraftItem(locationId, draftId, induk, { code: "9", name: "Pekerjaan baru", unit: "m3", volume: 10, unitPrice: 1000 }, userId);
    await upsertItem(hariIni, { rabNodeId: baru.nodeId, volumeDone: 2 }, userId);
    await expect(removeDraftNode(locationId, draftId, baru.nodeId, userId)).rejects.toThrow(/sudah punya realisasi di laporan harian/);
  });

  it("draft diganti berkas yang volumenya di bawah yang sudah dilaporkan: disebut, tidak diam-diam", async () => {
    const { gantiDraftLama } = await import("@/lib/rab/import");
    const lama = (await db.rabRevision.findFirstOrThrow({ where: { locationId, status: "draft" } })).id;
    const no = (await db.rabRevision.count({ where: { locationId } })) + 1;
    await revisi(no, "draft", [
      { lk: LK_URUG, vol: 400 },
      { lk: LK_GALI, vol: 150 },
      { lk: LK_TETAP, vol: 50 },
      { lk: "I#9", vol: 10 },
    ]);
    const baruId = (await db.rabRevision.findFirstOrThrow({ where: { locationId, revisionNo: no } })).id;
    const h = await gantiDraftLama(lama, baruId, userId);
    expect(h.diAtasVolumeBaru).toEqual([expect.objectContaining({ lineageKey: LK_URUG, terlapor: 517.97, volumeBaru: 400 })]);
  });
});
