// BOLAK-BALIK PENUH: RAB SUNGGUHAN → BASIS DATA → TEMPLATE → IMPOR → AKTIFKAN.
//
// Uji unit sudah menjaga tiap potongannya. Yang TIDAK dijaga siapa pun adalah
// rangkaiannya — dan justru di sambungan antar-potongan cacat 2026-09-12
// bersembunyi: parser benar sendirian, eksportir benar sendirian, tapi kunci
// identitas yang diantar di antara keduanya kehilangan induknya.
//
// Karena itu di sini tidak ada contoh buatan. Yang dipakai RAB Situbondo milik
// user (903 item, 1097 node, delapan baris berkode kembar — bentuk yang bikin
// cacatnya muncul), ditanam ke basis data seperti impor sungguhan, lalu:
//
//   RAB aktif → unduh template → baca balik → bandingkan → jadikan revisi →
//   AKTIFKAN → bandingkan lagi angka yang tersimpan
//
// Yang dibuktikan: sesudah bolak-balik, TIDAK ADA satu pun yang berubah —
// jumlah node, induk tiap node, nilai tiap item, nilai kategori, dan
// `totalValue` revisi. Dan berkas yang user EDIT terbaca persis sebagai
// editannya, tidak lebih.
import ExcelJS from "exceljs";
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
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsWorkbook } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { buildAdendumTemplateXlsx } = await import("@/lib/export/adendum-template-xlsx");
const { parseAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
const { bandingkanTerhadapAktif } = await import("@/lib/rab/diff-parsed");
const { updateDraftItemVolume, createAdendumDraft } = await import("@/lib/rab/adendum");

const suffix = `bb${Date.now().toString(36)}`;
let locationId: string;
let userId: string;
let aktifRevId: string;

const berkas = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;
async function muat(nama: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(berkas(nama));
  return wb;
}

/** Potret struktur+angka satu revisi, dalam bentuk yang bisa dibandingkan apa adanya. */
async function potret(revisionId: string) {
  const nodes = await db.rabNode.findMany({
    where: { revisionId },
    select: { id: true, parentId: true, kind: true, lineageKey: true, volume: true, amount: true },
  });
  const keyById = new Map(nodes.map((n) => [n.id, n.lineageKey]));
  const baris = nodes
    .map((n) => ({
      lineageKey: n.lineageKey,
      induk: n.parentId ? (keyById.get(n.parentId) ?? "?HILANG?") : null,
      kind: n.kind,
      volume: n.volume == null ? null : Number(n.volume),
      amount: n.amount.toString(),
    }))
    .sort((a, b) => a.lineageKey.localeCompare(b.lineageKey));
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { totalValue: true },
  });
  return { baris, totalValue: rev.totalValue.toString() };
}

/** Template yang benar-benar diunduh user: dibangun dari node basis data. */
async function unduhTemplate(revisionId: string) {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { revisionNo: true, totalValue: true },
  });
  const nodes = await db.rabNode.findMany({
    where: { revisionId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      parentId: true,
      kind: true,
      code: true,
      name: true,
      unit: true,
      volume: true,
      unitPrice: true,
      amount: true,
      lineageKey: true,
    },
  });
  const buf = await buildAdendumTemplateXlsx({
    locationName: "Situbondo",
    packageName: "Pesisir",
    contractNumber: null,
    vendorName: null,
    revisionNo: rev.revisionNo,
    revisionId,
    totalValue: rev.totalValue,
    nodes: nodes.map((n) => ({
      ...n,
      volume: n.volume == null ? null : Number(n.volume),
      unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
    })),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Sisi aktif dalam bentuk yang dipakai `bandingkanTerhadapAktif`. */
async function sisiAktif(revisionId: string) {
  const nodes = await db.rabNode.findMany({
    where: { revisionId },
    select: {
      id: true,
      parentId: true,
      lineageKey: true,
      kind: true,
      code: true,
      name: true,
      unit: true,
      volume: true,
      unitPrice: true,
      amount: true,
    },
  });
  const keyById = new Map(nodes.map((n) => [n.id, n.lineageKey]));
  return nodes.map((n) => ({
    lineageKey: n.lineageKey,
    parentLineageKey: n.parentId ? (keyById.get(n.parentId) ?? null) : null,
    kind: n.kind,
    code: n.code,
    name: n.name,
    unit: n.unit,
    volume: n.volume == null ? null : Number(n.volume),
    unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
    amount: n.amount,
  }));
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org BB ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      username: `bb-${suffix}`,
      fullName: "Tester",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket BB ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor BB ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 3_723_269_226n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi BB",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  // RAB SUNGGUHAN user ditanam lewat jalur impor yang sebenarnya.
  const nodes = flattenParsedRab(parseHpsWorkbook(await muat("rab-aktif-situbondo.xlsx")).parsed);
  const hasil = await createRevisionFromNodes(locationId, nodes, {
    source: "hps_awal",
    userId,
    note: "RAB kontrak",
  });
  await activateRevision(hasil.revisionId, userId);
  aktifRevId = hasil.revisionId;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("RAB-ADD · bolak-balik penuh dengan RAB sungguhan", () => {
  it("RAB masuk basis data utuh: 903 item, nilai sama dengan berkasnya", async () => {
    const item = await db.rabNode.count({ where: { revisionId: aktifRevId, kind: "item" } });
    expect(item).toBe(903);
    const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: aktifRevId } });
    expect(rev.totalValue).toBe(3_723_269_226n);
  });

  it("UNDUH → IMPOR BALIK tanpa menyentuh apa pun = nol perubahan di pratinjau", async () => {
    const wb = await unduhTemplate(aktifRevId);
    const t = parseAdendumTemplate(wb);
    const beda = bandingkanTerhadapAktif(await sisiAktif(aktifRevId), t.nodes, new Map());

    expect(beda.itemBaru, "item baru palsu").toHaveLength(0);
    expect(beda.itemHilang, "item hilang palsu").toHaveLength(0);
    expect(beda.volumeBerubah, "volume bergeser padahal tidak disentuh").toHaveLength(0);
    expect(beda.hargaBerubah).toHaveLength(0);
    expect(beda.jumlahTetap).toBe(903);
    expect(beda.totalBaru, "nilai kontrak bergeser padahal tidak ada yang diubah").toBe(
      beda.totalAktif,
    );
  });

  it("UNDUH → IMPOR → AKTIFKAN: struktur dan angka tersimpan sama persis", async () => {
    /*
     * Inilah yang benar-benar dilakukan user, dan inilah yang dulu merusak
     * data: bukan pratinjaunya, melainkan revisi yang ditulis SESUDAH disetujui.
     * Induk yang salah baca akan tertulis ke basis data sebagai induk yang
     * salah — dan sejak itu tiap unduhan berikutnya kehilangan barisnya.
     */
    const sebelum = await potret(aktifRevId);

    const t = parseAdendumTemplate(await unduhTemplate(aktifRevId));
    const hasil = await createRevisionFromNodes(locationId, t.nodes, {
      source: "adendum",
      userId,
      note: "bolak-balik",
    });
    await activateRevision(hasil.revisionId, userId);
    const sesudah = await potret(hasil.revisionId);

    expect(sesudah.baris).toHaveLength(sebelum.baris.length);
    expect(sesudah.baris, "struktur atau angka bergeser sesudah bolak-balik").toEqual(sebelum.baris);
    expect(sesudah.totalValue).toBe(sebelum.totalValue);

    aktifRevId = hasil.revisionId;
  });

  it("menyunting SATU volume tidak menggeser nilai item lain sepeser pun", async () => {
    /*
     * `recomputeTotals` dulu berhenti pada baris item, jadi baris yang punya
     * anak membuang anaknya dari `totalValue` — dan itu terjadi pada suntingan
     * PERTAMA, sebelum ada yang sempat curiga.
     */
    const { revisionId } = await createAdendumDraft(locationId, userId, {});
    const awal = await db.rabRevision.findUniqueOrThrow({ where: { id: revisionId } });

    const target = await db.rabNode.findFirstOrThrow({
      where: { revisionId, kind: "item", volume: { gt: 0 } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, volume: true, unitPrice: true, amount: true },
    });
    const volumeBaru = Number(target.volume) * 2;
    await updateDraftItemVolume(locationId, revisionId, target.id, volumeBaru, userId);

    const sesudah = await db.rabRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const node = await db.rabNode.findUniqueOrThrow({ where: { id: target.id } });
    const selisihItem = node.amount - target.amount;

    expect(
      sesudah.totalValue - awal.totalValue,
      "total revisi bergeser lebih dari perubahan item yang disunting",
    ).toBe(selisihItem);

    await db.rabNode.deleteMany({ where: { revisionId } });
    await db.rabRevision.delete({ where: { id: revisionId } });
  });

  it("UNDUHAN KEDUA, sesudah bolak-balik, masih memuat 903 item – tidak ada yang menguap", async () => {
    /*
     * Kerusakan yang paling sulit ketahuan: bukan unduhan pertama, melainkan
     * yang BERIKUTNYA. Induk salah baca menulis item di bawah item, lalu
     * eksportir — yang dulu hanya menelusuri anak pada baris judul — membuang
     * baris itu tanpa suara. Berkas kedua sudah kehilangan pekerjaannya, dan
     * impornya melaporkannya sebagai "item hilang" yang tidak pernah dihapus
     * siapa pun.
     */
    const t = parseAdendumTemplate(await unduhTemplate(aktifRevId));
    expect(t.nodes.filter((n) => n.kind === "item")).toHaveLength(903);
    const beda = bandingkanTerhadapAktif(await sisiAktif(aktifRevId), t.nodes, new Map());
    expect(beda.itemHilang, "baris menguap dari unduhan kedua").toHaveLength(0);
    expect(beda.itemBaru).toHaveLength(0);
    expect(beda.totalBaru).toBe(beda.totalAktif);
  });

  it("berkas yang user EDIT terbaca persis sebagai editannya, tidak lebih", async () => {
    // Berkas ini template terbitan MARLIN yang user isi sendiri kolom volumenya.
    const t = parseAdendumTemplate(await muat("template-adendum-situbondo.xlsx"));
    const beda = bandingkanTerhadapAktif(await sisiAktif(aktifRevId), t.nodes, new Map());

    expect(beda.itemBaru, "editan volume terbaca sebagai item baru").toHaveLength(0);
    expect(beda.itemHilang, "editan volume terbaca sebagai item hilang").toHaveLength(0);
    expect(beda.hargaBerubah, "harga kontrak ikut bergeser").toHaveLength(0);
    expect(beda.volumeBerubah.length, "editan volumenya tidak terbaca").toBeGreaterThan(0);
    expect(beda.volumeBerubah.length + beda.jumlahTetap).toBe(903);
    expect(t.volumeNegatif).toHaveLength(0);
    expect(t.itemBaru).toHaveLength(0);
    expect(t.dihapus).toHaveLength(0);
  });
});
