// PEMETAAN ITEM TERLAPOR KE ITEM DRAFT ADENDUM SEBELUM AKTIVASI (DECISIONS 754)
// – terhadap DATABASE ASLI.
//
// Permintaan user 2026-11-10: *"intinya sebelum aktif item yang sudah
// terlaporkan, harus bisa dipetakan dengan pekerjaan yang ada di draft
// adendum"* dan *"cukup minta konfirmasi saat aktivasi"*.
//
// Yang dijaga:
// 1. item kontrak yang sudah dilaporkan tapi tidak ada di draft DISEBUT, dengan
//    calon pasangan yang sah saja;
// 2. memasangkan = item draft mewarisi kunci item lama: laporan harian, foto,
//    dan baris draft ikut tanpa satu angka laporan pun berubah; backup volume
//    ikut pindah;
// 3. pasangan bisa dilepas lagi;
// 4. pasangan yang tidak sah ditolak dengan sebabnya;
// 5. aktivasi dengan item yang belum dipasangkan MINTA KONFIRMASI, dan sesudah
//    aktif, realisasi yang dipasangkan ikut terhitung.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let sessionUserId = "";
let sessionOrgId = "";
const role = "site_manager";
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester", username: "tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    hasLocationAccess: async () => true,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const {
  dataPadananDraft,
  belumDipetakan,
  pasangkanItemDraft,
  lepasPadananDraft,
  PadananDraftError,
} = await import("@/lib/rab/padanan-draft");
const { activateDraftAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { cumulativeVolumeByLineage, volumeTidakTerbobotByLineage } = await import("@/lib/progress");
const { ringkasPersetujuan } = await import("@/lib/rab/persetujuan");

const suffix = `pd${Date.now().toString(36)}`;
let orgId = "";
let pembuatId = "";
let pdId = "";
let nLokasi = 0;
const DAY = 86_400_000;
const tgl = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * DAY);

type Lokasi = {
  locationId: string;
  aktifId: string;
  draftId: string;
  /** node draft per lineage awal */
  draft: Record<string, string>;
  /** baris laporan item kontrak I#1 */
  barisLama: string[];
  fotoId: string;
};

/*
 * RAB aktif:  I  PEKERJAAN PONDASI      I#1 Tapak beton menerus (m3, terlapor 4 + 3)
 *                                       I#2 Urugan pasir (m3, terlapor 2)
 *             II PEKERJAAN DINDING      II#1 Pasangan bata (m2)
 * Draft:      I#1 DIHAPUS; I#2 tetap; I#3 BARU Pondasi batu belah (m3, vol 6);
 *             I#4 BARU Plester (m2); II#1 tetap; II#9 BARU Beton kolom (m3).
 */
async function siapkan(opts: { barisDraftDiI3?: boolean; nolkanI2?: boolean } = {}): Promise<Lokasi> {
  nLokasi++;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}-${nLokasi}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${nLokasi}`,
      slug: `lok-${suffix}-${nLokasi}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
    },
  });
  const rev = async (no: number, status: "aktif" | "draft", source: "hps_awal" | "adendum") =>
    db.rabRevision.create({ data: { locationId: loc.id, revisionNo: no, source, status, totalValue: 0n } });
  const aktif = await rev(1, "aktif", "hps_awal");
  const draft = await rev(2, "draft", "adendum");
  const node = async (
    revisionId: string,
    lineageKey: string,
    kind: "kategori" | "item",
    name: string,
    parentId: string | null,
    sortOrder: number,
    unit: string | null = null,
    volume: number | null = null,
  ) =>
    db.rabNode.create({
      data: {
        revisionId,
        parentId,
        kind,
        code: lineageKey.split("#").pop()!,
        name,
        unit,
        volume,
        unitPrice: volume == null ? null : 100_000,
        amount: volume == null ? 0n : BigInt(volume * 100_000),
        lineageKey,
        sortOrder,
      },
    });
  const aI = await node(aktif.id, "I", "kategori", "PEKERJAAN PONDASI", null, 0);
  const a1 = await node(aktif.id, "I#1", "item", "Tapak beton menerus", aI.id, 1, "m3", 10);
  const a2 = await node(aktif.id, "I#2", "item", "Urugan pasir", aI.id, 2, "m3", 5);
  const aII = await node(aktif.id, "II", "kategori", "PEKERJAAN DINDING", null, 3);
  await node(aktif.id, "II#1", "item", "Pasangan bata", aII.id, 4, "m2", 40);

  const dI = await node(draft.id, "I", "kategori", "PEKERJAAN PONDASI", null, 0);
  const d2 = await node(draft.id, "I#2", "item", "Urugan pasir", dI.id, 1, "m3", opts.nolkanI2 ? 0 : 5);
  const d3 = await node(draft.id, "I#3", "item", "Pondasi batu belah", dI.id, 2, "m3", 6);
  const d4 = await node(draft.id, "I#4", "item", "Plester", dI.id, 3, "m2", 12);
  const dII = await node(draft.id, "II", "kategori", "PEKERJAAN DINDING", null, 4);
  await node(draft.id, "II#1", "item", "Pasangan bata", dII.id, 5, "m2", 40);
  const d9 = await node(draft.id, "II#9", "item", "Beton kolom", dII.id, 6, "m3", 3);

  const lapor = async (hari: number, isi: { nodeId: string; lineageKey: string; vol: number; basis?: string }[]) => {
    const r = await db.dailyReport.create({
      data: { locationId: loc.id, reportDate: tgl(hari), status: "final", createdById: pembuatId, weather: "cerah" },
    });
    const ids: string[] = [];
    for (const i of isi) {
      const row = await db.dailyReportItem.create({
        data: {
          reportId: r.id,
          rabNodeId: i.nodeId,
          lineageKey: i.lineageKey,
          basis: i.basis ?? "aktif",
          volumeDone: i.vol,
          valueDone: BigInt(i.vol * 100_000),
        },
      });
      ids.push(row.id);
    }
    return { reportId: r.id, ids };
  };
  const h1 = await lapor(0, [
    { nodeId: a1.id, lineageKey: "I#1", vol: 4 },
    { nodeId: a2.id, lineageKey: "I#2", vol: 2 },
  ]);
  const h2 = await lapor(1, [{ nodeId: a1.id, lineageKey: "I#1", vol: 3 }]);
  if (opts.barisDraftDiI3) await lapor(2, [{ nodeId: d3.id, lineageKey: "I#3", vol: 1, basis: "draft_adendum" }]);
  const foto = await db.photo.create({
    data: {
      locationId: loc.id,
      reportId: h1.reportId,
      reportItemId: h1.ids[0],
      r2Key: `uji/${suffix}/${nLokasi}.webp`,
      sha256: `${suffix}-${nLokasi}`,
      bytes: 10,
    },
  });
  return {
    locationId: loc.id,
    aktifId: aktif.id,
    draftId: draft.id,
    draft: { "I#2": d2.id, "I#3": d3.id, "I#4": d4.id, "II#9": d9.id },
    barisLama: [h1.ids[0], h2.ids[0]],
    fotoId: foto.id,
  };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  sessionOrgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `sm-${suffix}`, fullName: "SM Uji", role: "site_manager", passwordHash: "x" },
  });
  pembuatId = u.id;
  sessionUserId = u.id;
  const pd = await db.user.create({
    data: { orgId, username: `pd-${suffix}`, fullName: "PD Uji", role: "program_director", passwordHash: "x" },
  });
  pdId = pd.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, rab_revision_approvals, photos, daily_report_items, daily_reports, rab_nodes, rab_revisions, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("yang belum dipasangkan disebut, dengan calon yang sah saja", () => {
  it("item kontrak terlapor yang tidak ada di draft → satu calon: item baru draft, kategori & satuan sama", async () => {
    const L = await siapkan();
    const d = await dataPadananDraft(L.locationId);
    expect(d.belum.map((x) => x.lineageKey)).toEqual(["I#1"]);
    const i1 = d.belum[0];
    expect(i1.realisasi).toBe(7);
    expect(i1.jumlahLaporan).toBe(2);
    // I#2 item lama, I#4 beda satuan, II#9 beda kategori.
    expect(i1.calon.map((c) => c.nodeId)).toEqual([L.draft["I#3"]]);
    expect(await belumDipetakan(L.draftId)).toHaveLength(1);
  });
});

describe("item kontrak yang volumenya 0 di draft (DECISIONS 756)", () => {
  /*
   * Keluhan user 2026-11-10 (tangkapan layar: pratinjau menawarkan 6 item, panel
   * draft hanya 1): *"bisa jadi item yang jadi 0 dan sudah dikerjakan juga perlu
   * dipetakan, kenapa di konsep baru pencocokan tadi ini tidak ada, dan malah
   * hilang"*. Saat aktivasi laporannya diturunkan jadi 0 (DECISIONS 742/745).
   */
  it("disebut di panel bersama yang hilang, dengan calon yang sah, dan ikut di konfirmasi aktivasi", async () => {
    const L = await siapkan({ nolkanI2: true });
    const d = await dataPadananDraft(L.locationId);
    expect(d.belum.map((x) => [x.lineageKey, x.sebab])).toEqual([
      ["I#1", "hilang"],
      ["I#2", "dinolkan"],
    ]);
    const i2 = d.belum.find((x) => x.lineageKey === "I#2")!;
    expect(i2.realisasi).toBe(2);
    expect(i2.calon.map((c) => c.nodeId)).toEqual([L.draft["I#3"]]);
    expect((await belumDipetakan(L.draftId)).map((x) => x.lineageKey)).toEqual(["I#1", "I#2"]);
  });

  it("dipasangkan: item baru mewarisi kuncinya, baris draft bervolume 0 memakai kunci lain; dilepas: keduanya kembali", async () => {
    const L = await siapkan({ nolkanI2: true });
    await pasangkanItemDraft({ locationId: L.locationId, revisionId: L.draftId, lineageLama: "I#2", nodeIdDraft: L.draft["I#3"], userId: pembuatId });
    const [n3, n2] = await Promise.all([
      db.rabNode.findUniqueOrThrow({ where: { id: L.draft["I#3"] } }),
      db.rabNode.findUniqueOrThrow({ where: { id: L.draft["I#2"] } }),
    ]);
    expect([n3.lineageKey, n3.lineageSemula]).toEqual(["I#2", "I#3"]);
    expect([n2.lineageKey, n2.lineageTergeser, Number(n2.volume)]).toEqual(["I#2~2", "I#2", 0]);
    expect((await belumDipetakan(L.draftId)).map((x) => x.lineageKey)).toEqual(["I#1"]);
    const d = await dataPadananDraft(L.locationId);
    expect(d.sudah.map((x) => [x.nodeId, x.namaLama])).toEqual([[L.draft["I#3"], "Urugan pasir"]]);

    await lepasPadananDraft({ locationId: L.locationId, revisionId: L.draftId, nodeIdDraft: L.draft["I#3"], userId: pembuatId });
    const [m3, m2] = await Promise.all([
      db.rabNode.findUniqueOrThrow({ where: { id: L.draft["I#3"] } }),
      db.rabNode.findUniqueOrThrow({ where: { id: L.draft["I#2"] } }),
    ]);
    expect([m3.lineageKey, m3.lineageSemula]).toEqual(["I#3", null]);
    expect([m2.lineageKey, m2.lineageTergeser]).toEqual(["I#2", null]);
    expect((await belumDipetakan(L.draftId)).map((x) => x.lineageKey)).toEqual(["I#1", "I#2"]);
  });

  it("aktivasi sesudah dipasangkan: laporannya TIDAK diturunkan jadi 0, ikut ke item penggantinya", async () => {
    const L = await siapkan({ nolkanI2: true });
    await pasangkanItemDraft({ locationId: L.locationId, revisionId: L.draftId, lineageLama: "I#2", nodeIdDraft: L.draft["I#3"], userId: pembuatId });
    for (const [userId, r] of [[pembuatId, "site_manager"], [pdId, "program_director"]] as const) {
      await db.rabRevisionApproval.create({
        data: { revisionId: L.draftId, userId, role: r, totalValue: 0n, approvedAt: new Date(Date.now() + 1000) },
      });
    }
    const f = new FormData();
    f.set("revisionId", L.draftId);
    f.set("konfirmasiBelumDipetakan", "1"); // I#1 sengaja tidak dipasangkan
    const r = await activateDraftAction(undefined, f);
    expect(r?.success, r?.error).toBeTruthy();
    expect((await cumulativeVolumeByLineage(L.locationId)).get("I#2")).toBe(2);
    const baris = await db.dailyReportItem.findMany({ where: { lineageKey: "I#2", report: { locationId: L.locationId } } });
    expect(baris.map((b) => Number(b.volumeDone))).toEqual([2]);
  });

  it("tanpa dipasangkan: konfirmasi aktivasi mengatakan laporannya akan diturunkan jadi 0", async () => {
    const L = await siapkan({ nolkanI2: true });
    for (const [userId, r] of [[pembuatId, "site_manager"], [pdId, "program_director"]] as const) {
      await db.rabRevisionApproval.create({
        data: { revisionId: L.draftId, userId, role: r, totalValue: 0n, approvedAt: new Date(Date.now() + 1000) },
      });
    }
    const f = new FormData();
    f.set("revisionId", L.draftId);
    const r = await activateDraftAction(undefined, f);
    expect(r?.error).toMatch(/Urugan pasir \(volume 0 di draft/);
    expect(r?.error).toMatch(/diturunkan menjadi 0/);
  });
});

describe("memasangkan", () => {
  it("item draft mewarisi kunci item lama; laporan, foto, dan baris draft ikut; persetujuan gugur", async () => {
    const L = await siapkan({ barisDraftDiI3: true });
    await db.rabBackupVolume.create({
      data: { revisionId: L.draftId, lineageKey: "I#3", status: "cocok", nilaiRab: 6, sumber: {}, perantara: [], baris: [] },
    });
    // Dua persetujuan SEBELUM pemetaan.
    for (const [userId, r] of [[pembuatId, "site_manager"], [pdId, "program_director"]] as const) {
      await db.rabRevisionApproval.create({ data: { revisionId: L.draftId, userId, role: r, totalValue: 0n } });
    }
    expect((await ringkasPersetujuan(L.draftId)).lengkap).toBe(true);

    const h = await pasangkanItemDraft({
      locationId: L.locationId,
      revisionId: L.draftId,
      lineageLama: "I#1",
      nodeIdDraft: L.draft["I#3"],
      userId: pembuatId,
    });
    expect(h.barisDraftDipindah).toBe(1);

    const n3 = await db.rabNode.findUniqueOrThrow({ where: { id: L.draft["I#3"] } });
    expect(n3.lineageKey).toBe("I#1");
    expect(n3.lineageSemula).toBe("I#3");
    // Laporan & foto lama tidak disentuh sama sekali.
    const lama = await db.dailyReportItem.findMany({ where: { id: { in: L.barisLama } } });
    expect(lama.map((r) => [r.lineageKey, Number(r.volumeDone)])).toEqual([
      ["I#1", 4],
      ["I#1", 3],
    ]);
    expect((await db.photo.findUniqueOrThrow({ where: { id: L.fotoId } })).reportItemId).toBe(L.barisLama[0]);
    // Baris yang dilaporkan terhadap item draft ikut kunci barunya.
    const barisDraft = await db.dailyReportItem.findMany({ where: { rabNodeId: L.draft["I#3"] } });
    expect(barisDraft.map((r) => r.lineageKey)).toEqual(["I#1"]);
    // Backup volume item draft ikut (FK ON UPDATE CASCADE).
    const bv = await db.rabBackupVolume.findMany({ where: { revisionId: L.draftId } });
    expect(bv.map((b) => b.lineageKey)).toEqual(["I#1"]);

    expect(await belumDipetakan(L.draftId)).toHaveLength(0);
    const d = await dataPadananDraft(L.locationId);
    expect(d.sudah.map((x) => [x.nodeId, x.namaLama])).toEqual([[L.draft["I#3"], "Tapak beton menerus"]]);
    // Isi draft berubah → persetujuan yang lama gugur, harus disetujui ulang.
    expect((await ringkasPersetujuan(L.draftId)).lengkap).toBe(false);
  });

  it("dilepas lagi: kunci item draft kembali, item lama kembali di daftar yang belum dipasangkan", async () => {
    const L = await siapkan({ barisDraftDiI3: true });
    await pasangkanItemDraft({ locationId: L.locationId, revisionId: L.draftId, lineageLama: "I#1", nodeIdDraft: L.draft["I#3"], userId: pembuatId });
    await lepasPadananDraft({ locationId: L.locationId, revisionId: L.draftId, nodeIdDraft: L.draft["I#3"], userId: pembuatId });
    const n3 = await db.rabNode.findUniqueOrThrow({ where: { id: L.draft["I#3"] } });
    expect([n3.lineageKey, n3.lineageSemula]).toEqual(["I#3", null]);
    const barisDraft = await db.dailyReportItem.findMany({ where: { rabNodeId: L.draft["I#3"] } });
    expect(barisDraft.map((r) => r.lineageKey)).toEqual(["I#3"]);
    expect((await belumDipetakan(L.draftId)).map((x) => x.lineageKey)).toEqual(["I#1"]);
  });
});

describe("pasangan yang tidak sah ditolak dengan sebabnya", () => {
  const coba = async (L: Lokasi, lineageLama: string, nodeIdDraft: string) =>
    pasangkanItemDraft({ locationId: L.locationId, revisionId: L.draftId, lineageLama, nodeIdDraft, userId: pembuatId });

  it("beda satuan, beda kategori, item lama, item yang masih ada di draft", async () => {
    const L = await siapkan();
    await expect(coba(L, "I#1", L.draft["I#4"])).rejects.toThrow(/satuan/);
    await expect(coba(L, "I#1", L.draft["II#9"])).rejects.toThrow(/Beda kategori/);
    await expect(coba(L, "I#1", L.draft["I#2"])).rejects.toThrow(/item kontrak lama/);
    await expect(coba(L, "I#2", L.draft["I#3"])).rejects.toThrow(/masih ada di draft/);
    await expect(coba(L, "I#1", L.draft["I#4"])).rejects.toBeInstanceOf(PadananDraftError);
  });

  it("satu laporan yang memuat KEDUANYA ditolak, tanggalnya disebut", async () => {
    const L = await siapkan();
    const r = await db.dailyReport.findFirstOrThrow({ where: { locationId: L.locationId, reportDate: tgl(1) } });
    await db.dailyReportItem.create({
      data: {
        reportId: r.id,
        rabNodeId: L.draft["I#3"],
        lineageKey: "I#3",
        basis: "draft_adendum",
        volumeDone: 1,
        valueDone: 100_000n,
      },
    });
    await expect(coba(L, "I#1", L.draft["I#3"])).rejects.toThrow(/2 Oktober 2026/);
  });
});

describe("aktivasi", () => {
  const aktifkan = async (draftId: string, konfirmasi = false) => {
    const f = new FormData();
    f.set("revisionId", draftId);
    if (konfirmasi) f.set("konfirmasiBelumDipetakan", "1");
    return activateDraftAction(undefined, f);
  };
  const setujuiBerdua = async (draftId: string) => {
    for (const [userId, r] of [[pembuatId, "site_manager"], [pdId, "program_director"]] as const) {
      await db.rabRevisionApproval.upsert({
        where: { revisionId_userId: { revisionId: draftId, userId } },
        update: { approvedAt: new Date(Date.now() + 1000) },
        create: { revisionId: draftId, userId, role: r, totalValue: 0n, approvedAt: new Date(Date.now() + 1000) },
      });
    }
  };

  it("masih ada yang belum dipasangkan → minta konfirmasi, draft tetap draft", async () => {
    const L = await siapkan();
    await setujuiBerdua(L.draftId);
    const r = await aktifkan(L.draftId);
    expect(r?.error).toMatch(/Tapak beton menerus/);
    expect(r?.error).toMatch(/konfirmasi/i);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: L.draftId } })).status).toBe("draft");
  });

  it("dikonfirmasi → aktif; realisasi yang tidak dipasangkan disebut di kabarnya", async () => {
    const L = await siapkan();
    await setujuiBerdua(L.draftId);
    const r = await aktifkan(L.draftId, true);
    expect(r?.success, r?.error).toBeTruthy();
    expect(r?.success).toMatch(/1 item .*tidak dipasangkan/);
    expect([...(await volumeTidakTerbobotByLineage(L.locationId)).keys()]).toEqual(["I#1"]);
  });

  it("sesudah dipasangkan → aktif tanpa konfirmasi; realisasinya ikut terhitung", async () => {
    const L = await siapkan();
    await pasangkanItemDraft({ locationId: L.locationId, revisionId: L.draftId, lineageLama: "I#1", nodeIdDraft: L.draft["I#3"], userId: pembuatId });
    await setujuiBerdua(L.draftId);
    const r = await aktifkan(L.draftId);
    expect(r?.success, r?.error).toBeTruthy();
    expect((await volumeTidakTerbobotByLineage(L.locationId)).size).toBe(0);
    // Volume draft 6 < realisasi 7: kelebihannya dipotong saat aktivasi (DECISIONS 745), dan dikatakan.
    expect((await cumulativeVolumeByLineage(L.locationId)).get("I#1")).toBe(6);
    expect(r?.success).toMatch(/diturunkan/i);
    // Foto tetap menempel di baris laporannya.
    expect((await db.photo.findUniqueOrThrow({ where: { id: L.fotoId } })).reportItemId).toBe(L.barisLama[0]);
  });
});
