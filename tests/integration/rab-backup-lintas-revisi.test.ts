// BACKUP VOLUME & ANALISA LINTAS REVISI (DECISIONS baru 2026-10-07).
//
// Permintaan user: *"rab non aktif (rab awal) yang sudah di cco … ke depannya
// tetap harus ada sumber informasi backup volumenya, kemudian yang sudah di cco
// juga ketahuan backup volumenya … bukan sekedar simpan file saja"*.
//
// Skenario: RAB awal Karangmangu (berkas KKP, backup tertaut) → CCO lewat
// editor (tanpa berkas) yang mengubah volume satu item dan menambah satu item.
// Yang dijaga:
//   1. item yang volumenya sama mewarisi backup RAB awal; yang berubah dan
//      yang baru disebut "belum", tidak diberi backup lama;
//   2. analisa kontrak ikut diwarisi bila harga satuannya sama – RAPL tidak
//      kehilangan analisa kontrak begitu CCO tanpa berkas diaktifkan;
//   3. backup diisi di MARLIN untuk item yang berubah, hasilnya dihitung dan
//      selisihnya terhadap volume RAB disebut; angka RAB tidak tersentuh;
//   4. hanya pemegang rab.manage yang boleh mengisi;
//   5. Template Adendum MARLIN di arsip ditelusuri, tidak lagi dilewati.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const KKP = readFileSync(new URL("../fixtures/mc0-karangmangu-blok-cco01-tkdn.xlsx", import.meta.url).pathname);
const TEMPLATE = readFileSync(new URL("../fixtures/template-adendum-situbondo.xlsx", import.meta.url).pathname);
const suffix = `bl${Date.now().toString(36)}`;
const KUNCI_TEMPLATE = `rab-import/${suffix}/template.xlsx`;
vi.mock("@/lib/penyimpanan/berkas", async (asli) => ({
  ...(await asli<typeof import("@/lib/penyimpanan/berkas")>()),
  ambilBerkas: async (kunci: string) => {
    if (kunci === KUNCI_TEMPLATE) return TEMPLATE;
    throw new Error(`objek tidak ada: ${kunci}`);
  },
}));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async (cap: string) => {
      if (!can(sesi.role as never, cap as never)) throw new asli.ForbiddenError(`Tanpa izin: ${cap}`);
      return sesi;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { bacaRincian, gantiKunci } = await import("@/lib/rab/rincian/baca");
const { simpanRincian } = await import("@/lib/rab/rincian/simpan");
const { sumberBackupRevisi } = await import("@/lib/rab/rincian/sumber-backup");
const { analisaKontrakLokasi } = await import("@/lib/ahsp/analisa-kontrak");
const { tambahBarisBackupAction, hapusBarisBackupAction } = await import("@/lib/rab/rincian/isian-actions");
const { periksaRevisi } = await import("@/lib/rab/rincian/arsip");

let orgId = "";
let adminId = "";
let lokasiId = "";
let rev1 = "";
let rev2 = "";
let lkBerubah = "";
let lkTetap = "";
let lkBaru = "";
let lkAnalisa = "";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org BL ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  adminId = (
    await db.user.create({ data: { orgId, username: `bl-${suffix}`, fullName: "Admin BL", passwordHash: "x", role: "super_admin" } })
  ).id;
  sesi = { id: adminId, orgId, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId, name: `Paket BL ${suffix}`, stage: "pelaksanaan" } });
  lokasiId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Karangmangu", slug: `km-${suffix}`, village: "K", regency: "Rembang", province: "Jawa Tengah", status: "berjalan" },
    })
  ).id;

  // RAB awal dari berkas KKP + rinciannya.
  const parse = await parseHpsBuffer(KKP);
  const nodes = flattenParsedRab(parse.parsed);
  const r1 = await createRevisionFromNodes(lokasiId, nodes, { source: "hps_awal", userId: adminId, note: "awal" });
  await activateRevision(r1.revisionId, adminId);
  rev1 = r1.revisionId;
  const items = nodes.filter((n) => n.kind === "item" && n.excelRow != null);
  const rinci = await bacaRincian(KKP, {
    sheetRab: parse.sheetName,
    kolom: parse.kolom,
    items: items.map((n) => ({ kunci: String(n.excelRow), excelRow: n.excelRow!, unitPrice: n.unitPrice })),
  });
  await simpanRincian(rev1, gantiKunci(rinci, new Map(items.map((n) => [String(n.excelRow), n.lineageKey]))), {
    asal: "impor",
    documentId: null,
    userId: adminId,
  });

  // CCO lewat editor: item baris 104 (8,7 m³) jadi 9,5; satu item baru.
  const berubah = items.find((n) => n.excelRow === 104)!;
  const tetap = items.find((n) => n.excelRow === 75)!;
  lkBerubah = berubah.lineageKey;
  lkTetap = tetap.lineageKey;
  lkAnalisa = tetap.lineageKey;
  const ubah = nodes.map((n) =>
    n.lineageKey === lkBerubah ? { ...n, volume: 9.5, amount: BigInt(Math.round(9.5 * (n.unitPrice ?? 0))) } : n,
  );
  lkBaru = `${berubah.parentLineageKey}#+B1`;
  ubah.push({
    ...berubah,
    code: "B1",
    name: "Item baru CCO",
    lineageKey: lkBaru,
    volume: 3,
    amount: BigInt(Math.round(3 * (berubah.unitPrice ?? 0))),
    sortOrder: 99_999,
    excelRow: null,
  });
  const r2 = await createRevisionFromNodes(lokasiId, ubah, { source: "adendum", userId: adminId, note: "CCO editor" });
  await activateRevision(r2.revisionId, adminId);
  rev2 = r2.revisionId;
}, 300_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("backup volume lintas revisi", () => {
  it("volume sama → diwarisi; berubah & baru → belum, dengan sebabnya", async () => {
    const { peta, ringkas } = await sumberBackupRevisi(rev2);
    expect(peta.get(lkTetap)).toMatchObject({ jenis: "warisan", dari: "berkas", revisionId: rev1, revisionNo: 1 });
    expect(peta.get(lkBerubah)).toMatchObject({ jenis: "belum", sebab: "volume_berubah", sebelumnya: { revisionId: rev1 } });
    expect(peta.get(lkBaru)).toMatchObject({ jenis: "belum", sebab: "baru" });
    expect(ringkas.berkas).toBe(0);
    expect(ringkas.warisan).toBeGreaterThan(500);
    expect(ringkas.volumeBerubah).toBe(1);
    expect(ringkas.baru).toBe(1);
    // RAB awal yang sudah digantikan tetap punya sumbernya sendiri.
    expect((await sumberBackupRevisi(rev1)).peta.get(lkBerubah)).toMatchObject({ jenis: "berkas", revisionId: rev1 });
  }, 60_000);

  it("analisa kontrak diwarisi revisi CCO tanpa berkas (harga sama)", async () => {
    const a = await analisaKontrakLokasi(lokasiId);
    expect(a.get(lkAnalisa)).toMatchObject({ kode: "2.2.2.1.2", warisan: true, revisionNo: 1 });
    expect(a.size).toBeGreaterThan(400);
  }, 60_000);

  it("backup diisi di MARLIN untuk item yang berubah; angka RAB tidak tersentuh", async () => {
    const sebelum = await db.rabNode.findUniqueOrThrow({ where: { revisionId_lineageKey: { revisionId: rev2, lineageKey: lkBerubah } } });
    const r = await tambahBarisBackupAction(
      undefined,
      fd({ revisionId: rev2, lineageKey: lkBerubah, uraian: "Revetment segmen A", jumlah: "2", panjang: "12,5", lebar: "0,4", tinggi: "0,95" }),
    );
    expect(r?.error, r?.error).toBeUndefined();
    const kosong = await tambahBarisBackupAction(undefined, fd({ revisionId: rev2, lineageKey: lkBerubah, uraian: "Tanpa angka" }));
    expect(kosong?.error).toMatch(/paling tidak satu angka/);
    const salah = await tambahBarisBackupAction(
      undefined,
      fd({ revisionId: rev2, lineageKey: lkBerubah, uraian: "Salah", panjang: "dua" }),
    );
    expect(salah?.error).toMatch(/panjang/);

    const { peta } = await sumberBackupRevisi(rev2);
    expect(peta.get(lkBerubah)).toEqual({ jenis: "isian", revisionId: rev2, revisionNo: 2 });
    const sesudah = await db.rabNode.findUniqueOrThrow({ where: { revisionId_lineageKey: { revisionId: rev2, lineageKey: lkBerubah } } });
    expect(sesudah.volume?.toString()).toBe(sebelum.volume?.toString());
    expect(await db.auditLog.count({ where: { action: "rab.backup_isian.tambah", resourceId: rev2 } })).toBe(1);

    const baris = await db.rabBackupIsian.findFirstOrThrow({ where: { revisionId: rev2, lineageKey: lkBerubah } });
    const h = await hapusBarisBackupAction(undefined, fd({ id: baris.id }));
    expect(h?.error).toBeUndefined();
    expect((await sumberBackupRevisi(rev2)).peta.get(lkBerubah)).toMatchObject({ jenis: "belum" });
  }, 60_000);

  it("peran tanpa rab.manage tidak bisa mengisi backup", async () => {
    const w = await db.user.create({ data: { orgId, username: `wp-${suffix}`, fullName: "Wakil", passwordHash: "x", role: "wakil_ppk" } });
    sesi = { id: w.id, orgId, role: "wakil_ppk" };
    try {
      const r = await tambahBarisBackupAction(undefined, fd({ revisionId: rev2, lineageKey: lkBaru, uraian: "Coba", panjang: "1" }));
      expect(r?.error).toMatch(/izin/i);
    } finally {
      sesi = { id: adminId, orgId, role: "super_admin" };
    }
  });
});

describe("Template Adendum MARLIN di arsip", () => {
  it("ditelusuri, tidak lagi dilewati sebagai template_adendum", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(TEMPLATE as unknown as ArrayBuffer);
    const { parseAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
    const nodes = parseAdendumTemplate(wb).nodes;
    const pkg = await db.package.findFirstOrThrow({ where: { orgId } });
    const lok = await db.location.create({
      data: { packageId: pkg.id, name: "Situbondo", slug: `sit-${suffix}`, village: "S", regency: "Situbondo", province: "Jawa Timur" },
    });
    const r = await createRevisionFromNodes(lok.id, nodes, { source: "adendum", userId: adminId, note: "template" });
    const doc = await db.document.create({
      data: {
        orgId,
        packageId: pkg.id,
        locationId: lok.id,
        phase: "adendum",
        type: "hps",
        title: "Template",
        r2Key: KUNCI_TEMPLATE,
        fileName: "template.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: TEMPLATE.length,
        sha256: "x",
        uploadedById: adminId,
      },
    });
    await db.rabRevision.update({ where: { id: r.revisionId }, data: { sourceDocumentId: doc.id } });
    const h = await periksaRevisi(r.revisionId, adminId);
    expect(h.status).toBe("siap");
    expect(h.itemCocok).toBe(h.itemRevisi);
    // Template ini: sebagian Volume Adendum diketik, sebagian berumus ke
    // BERKAS LAIN ([1]RAB!I78) yang tidak diunggah – dilaporkan apa adanya.
    expect(h.ringkasan!.volumeAngkaLangsung + h.ringkasan!.volumeTidakTerbaca).toBe(h.itemRevisi);
    expect(h.ringkasan!.volumeAngkaLangsung).toBeGreaterThan(0);
    const bv = await db.rabBackupVolume.count({ where: { revisionId: r.revisionId } });
    expect(bv).toBe(0); // periksa tidak menyimpan
  }, 120_000);
});
