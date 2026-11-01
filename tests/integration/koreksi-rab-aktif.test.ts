/*
 * KOREKSI RAB AKTIF oleh super admin utama = DITIMPA DI TEMPAT (DECISIONS 728).
 *
 * Ketetapan user 2026-11-01: *"pilihan jadikan rab aktif sekarang oleh dan
 * hanya super admin adalah koreksi, bukan adendum"* (pilihan: timpa revisi
 * aktif di tempat) dan *"ini soal keseluruhan lokasi dan proses, jadi jangan
 * kamu perbaiki case by case"*.
 *
 * Yang dibuktikan:
 * - impor "Jadikan RAB AKTIF" pada lokasi ber-RAB aktif menimpa revisi aktif
 *   yang SAMA (tanpa revisi baru): volume, harga, baris baru, baris hilang;
 *   nilai terpasang dan realisasi di atas volume baru ikut menyesuaikan;
 * - baris yang masih dipakai laporan tidak boleh hilang;
 * - tombol draft "Terapkan sebagai koreksi" menimpa RAB aktif dengan isi draft,
 *   draftnya habis, laporan draft jadi resmi;
 * - migrasi data lama: revisi yang dulu diaktifkan lewat jalan pintas menjadi
 *   koreksi di SEMUA lokasi, penomoran MC-0/CCO ikut benar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `kr${Date.now().toString(36)}`;
process.env.SUPER_ADMIN_UTAMA = `akar-${suffix}`;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type UserUji = { id: string; orgId: string; username: string; role: "super_admin" };
let sebagai: UserUji;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sebagai,
    getCurrentUser: async () => sebagai,
    hasLocationAccess: async () => true,
    requireCapability: async () => sebagai,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");
const { activateDraftAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab, grandTotal } = await import("@/lib/rab/flatten");
const { getOrCreateDraft } = await import("@/lib/daily-report/service");
const { tahapRevisi } = await import("@/lib/rab/tahap");
const { GET: unduhCco } = await import("@/app/(app)/lokasi/[slug]/rab/adendum/cco/route");
const { adendumTertunda } = await import("@/lib/package/aktivasi-adendum");

const NAMA = "rab-aktif-situbondo.xlsx";
const ISI = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);
const MIGRASI = readFileSync(
  new URL("../../prisma/migrations/20261101090100_rab_koreksi_lama/migration.sql", import.meta.url).pathname,
  "utf8",
);
/** Semua migrasi data lama 728, berurutan seperti `migrate deploy` menjalankannya. */
const MIGRASI_LAMA = [
  MIGRASI,
  readFileSync(
    new URL("../../prisma/migrations/20261101090200_rab_koreksi_status_cco/migration.sql", import.meta.url).pathname,
    "utf8",
  ),
  readFileSync(
    new URL("../../prisma/migrations/20261101090300_rab_koreksi_hanya_impor/migration.sql", import.meta.url).pathname,
    "utf8",
  ),
];
let orgId: string;
let pkgId: string;
let locationId: string;
let rev1: string;
let akar: UserUji;
let adminBiasa: UserUji;
let nodesBerkas: ReturnType<typeof flattenParsedRab>;

const berkas = () =>
  new File([new Uint8Array(ISI)], NAMA, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

async function impor(isian: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("locationId", locationId);
  fd.set("mode", "aktifkan");
  fd.set("file", berkas());
  for (const [k, v] of Object.entries(isian)) fd.set(k, v);
  return (await importHps(undefined, fd)) ?? {};
}

/** Baris laporan harian (status terhitung) langsung ke node tertentu. */
async function laporan(tanggal: string, rabNodeId: string, volume: number, basis = "aktif") {
  const r = await getOrCreateDraft(locationId, tanggal, akar.id);
  await db.dailyReport.update({ where: { id: r.id }, data: { status: "dikirim" } });
  const node = await db.rabNode.findUniqueOrThrow({ where: { id: rabNodeId }, select: { lineageKey: true } });
  return db.dailyReportItem.create({
    data: { reportId: r.id, rabNodeId, lineageKey: node.lineageKey, basis, volumeDone: volume, valueDone: 0n },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KR ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const buat = async (username: string): Promise<UserUji> => {
    const u = await db.user.create({
      data: { orgId: org.id, username, fullName: username, passwordHash: "x", role: "super_admin" },
    });
    return { id: u.id, orgId: org.id, username, role: "super_admin" };
  };
  akar = await buat(`akar-${suffix}`);
  adminBiasa = await buat(`admin-${suffix}`);
  sebagai = akar;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket KR ${suffix}`, stage: "pelaksanaan" } });
  pkgId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor KR ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 5_000_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi KR",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Situbondo",
      province: "Jawa Timur",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  nodesBerkas = flattenParsedRab((await parseHpsBuffer(ISI)).parsed);
  const awal = await createRevisionFromNodes(loc.id, nodesBerkas, { source: "hps_awal", userId: akar.id, note: "kontrak" });
  await activateRevision(awal.revisionId, akar.id);
  rev1 = awal.revisionId;
}, 300_000);

afterAll(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE id = '${orgId}'`).catch(() => null);
  await db.$disconnect();
});

describe("impor \"Jadikan RAB AKTIF\" pada lokasi ber-RAB aktif = koreksi", () => {
  it("super admin biasa: pratinjau menyebut hanya super admin utama; menyimpan ditolak", async () => {
    sebagai = adminBiasa;
    try {
      const pratinjau = await impor();
      expect(pratinjau.preview?.koreksi?.boleh).toBe(false);
      const simpan = await impor({ confirm: "1", previewSha: pratinjau.preview!.sha256, konfirmasi: "KOREKSI #1" });
      expect(simpan.preview?.notice).toMatch(/hanya untuk super admin utama/);
      expect(await db.rabRevision.count({ where: { locationId } })).toBe(1);
    } finally {
      sebagai = akar;
    }
  }, 300_000);

  it("super admin utama: revisi aktif yang SAMA ditimpa – volume, harga, baris baru & hilang; tanpa revisi baru", async () => {
    const items = await db.rabNode.findMany({
      where: { revisionId: rev1, kind: "item", volume: { gt: 2 }, unitPrice: { gt: 0 } },
      orderBy: { sortOrder: "asc" },
      take: 3,
      select: { id: true, lineageKey: true, volume: true, unitPrice: true, amount: true, parentId: true, sortOrder: true },
    });
    const [a, b, c] = items;
    const volA = Number(a!.volume);
    // A: volume RAB aktif dinaikkan, dan realisasinya melebihi volume berkas.
    await db.rabNode.update({ where: { id: a!.id }, data: { volume: volA + 5 } });
    const barisA = await laporan("2026-09-10", a!.id, volA + 3);
    // B: harga satuan RAB aktif kosong, laporannya tercatat Rp 0.
    await db.rabNode.update({ where: { id: b!.id }, data: { unitPrice: null } });
    const barisB = await laporan("2026-09-11", b!.id, 1);
    // C: hilang dari RAB aktif → berkas "menambahkannya".
    await db.rabNode.delete({ where: { id: c!.id } });
    // X: baris yang tidak ada di berkas → dihapus koreksi.
    const x = await db.rabNode.create({
      data: {
        revisionId: rev1,
        parentId: a!.parentId,
        kind: "item",
        code: "zz",
        name: "Baris sisipan uji",
        volume: 1,
        unit: "ls",
        unitPrice: 1000,
        amount: 1000n,
        lineageKey: `${a!.lineageKey}#uji`,
        sortOrder: a!.sortOrder,
      },
    });

    const pratinjau = await impor();
    expect(pratinjau.error, pratinjau.error).toBeUndefined();
    const k = pratinjau.preview!.koreksi!;
    expect(k).toMatchObject({ revisionNo: 1, boleh: true, terhalang: [] });
    expect(k.ringkas).toMatchObject({ tambah: 1, hapus: 1 });
    expect(k.ringkas.volume).toBeGreaterThanOrEqual(1);
    expect(k.ringkas.harga).toBeGreaterThanOrEqual(1);

    // Konfirmasi wajib persis.
    const salah = await impor({ confirm: "1", previewSha: pratinjau.preview!.sha256, konfirmasi: "KOREKSI" });
    expect(salah.preview?.notice).toContain("KOREKSI #1");
    expect(await db.rabNode.count({ where: { id: x.id } })).toBe(1);

    const simpan = await impor({ confirm: "1", previewSha: pratinjau.preview!.sha256, konfirmasi: "koreksi  #1" });
    expect(simpan.error, simpan.error).toBeUndefined();
    expect(simpan.success).toMatch(/dikoreksi/);
    expect(simpan.success).toMatch(/tidak dihitung sebagai adendum\/CCO/);

    // Tidak ada revisi baru; sumbernya tetap RAB kontrak.
    const revisi = await db.rabRevision.findMany({ where: { locationId }, select: { id: true, status: true, source: true } });
    expect(revisi).toEqual([{ id: rev1, status: "aktif", source: "hps_awal" }]);
    // Node A yang SAMA (id tetap), volumenya kembali ke berkas.
    expect(Number((await db.rabNode.findUniqueOrThrow({ where: { id: a!.id } })).volume)).toBe(volA);
    // Realisasi A yang melebihi volume barunya diturunkan.
    expect(Number((await db.dailyReportItem.findUniqueOrThrow({ where: { id: barisA.id } })).volumeDone)).toBeLessThanOrEqual(volA);
    // B: harga kembali, nilai terpasang dihitung ulang.
    const bKini = await db.rabNode.findUniqueOrThrow({ where: { id: b!.id } });
    expect(String(bKini.unitPrice)).toBe(String(b!.unitPrice));
    expect((await db.dailyReportItem.findUniqueOrThrow({ where: { id: barisB.id } })).valueDone).toBe(
      BigInt(Math.round(Number(b!.unitPrice))),
    );
    // C kembali (node baru), X hilang.
    expect(await db.rabNode.count({ where: { revisionId: rev1, lineageKey: c!.lineageKey } })).toBe(1);
    expect(await db.rabNode.count({ where: { id: x.id } })).toBe(0);
    // Nilai revisi = Σ berkas.
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: rev1 } })).totalValue).toBe(grandTotal(nodesBerkas));
    // Jejak lengkap.
    const jejak = await db.auditLog.findFirst({ where: { action: "rab.koreksi", resourceId: rev1 }, select: { payload: true } });
    expect(jejak?.payload).toMatchObject({ revisionNo: 1, berkas: NAMA });
  }, 300_000);

  it("baris yang akan hilang tapi masih dipakai laporan: disebut di pratinjau, menyimpan ditolak, tidak ada yang berubah", async () => {
    const induk = await db.rabNode.findFirstOrThrow({
      where: { revisionId: rev1, kind: "item" },
      orderBy: { sortOrder: "asc" },
      select: { parentId: true, lineageKey: true, sortOrder: true },
    });
    const y = await db.rabNode.create({
      data: {
        revisionId: rev1,
        parentId: induk.parentId,
        kind: "item",
        code: "yy",
        name: "Baris berlaporan uji",
        volume: 2,
        unit: "ls",
        unitPrice: 500,
        amount: 1000n,
        lineageKey: `${induk.lineageKey}#lapor`,
        sortOrder: induk.sortOrder,
      },
    });
    await laporan("2026-09-12", y.id, 1);
    const pratinjau = await impor();
    expect(pratinjau.preview!.koreksi!.terhalang.join(" ")).toMatch(/Baris berlaporan uji/);
    const simpan = await impor({ confirm: "1", previewSha: pratinjau.preview!.sha256, konfirmasi: "KOREKSI #1" });
    expect(simpan.preview?.notice).toMatch(/tidak bisa menghapus/);
    expect(await db.rabNode.count({ where: { id: y.id } })).toBe(1);
    await db.dailyReportItem.deleteMany({ where: { rabNodeId: y.id } });
    await db.rabNode.delete({ where: { id: y.id } });
  }, 300_000);
});

describe("tombol draft: \"Terapkan sebagai koreksi\" dan \"Aktifkan tanpa persetujuan\" (CCO)", () => {
  let draftId: string;
  let draftNo: number;
  let lineageD: string;
  let volumeDraft: number;

  beforeAll(async () => {
    const draft = await createRevisionFromNodes(locationId, nodesBerkas, { source: "adendum", userId: akar.id, note: "draft" });
    draftId = draft.revisionId;
    draftNo = draft.revisionNo;
    const d = await db.rabNode.findFirstOrThrow({
      where: { revisionId: draftId, kind: "item", volume: { gt: 2 } },
      orderBy: { sortOrder: "desc" },
    });
    lineageD = d.lineageKey;
    volumeDraft = Number(d.volume) + 2;
    await db.rabNode.update({
      where: { id: d.id },
      data: { volume: volumeDraft, amount: BigInt(Math.round(volumeDraft * Number(d.unitPrice ?? 0))) },
    });
    // Pekerjaan yang dilaporkan lebih dulu terhadap draft (DECISIONS 210).
    await laporan("2026-09-15", d.id, 1, "draft_adendum");
  }, 300_000);

  const terapkan = (isian: Record<string, string>) => {
    const fd = new FormData();
    fd.set("revisionId", draftId);
    for (const [k, v] of Object.entries(isian)) fd.set(k, v);
    return activateDraftAction(undefined, fd);
  };

  it("draft yang menghapus baris berlaporan: koreksi ditolak, RAB aktif & draft tidak berubah", async () => {
    // Baris aktif yang punya laporan (dari uji impor di atas: item A).
    const berlaporan = await db.dailyReportItem.findFirstOrThrow({
      where: { basis: "aktif", rabNode: { revisionId: rev1 } },
      select: { lineageKey: true },
    });
    const kedua = await createRevisionFromNodes(
      locationId,
      nodesBerkas.filter((n) => n.lineageKey !== berlaporan.lineageKey),
      { source: "adendum", userId: akar.id, note: "draft keliru" },
    );
    const fd = new FormData();
    fd.set("revisionId", kedua.revisionId);
    fd.set("tanpaPersetujuan", "1");
    fd.set("cara", "koreksi");
    fd.set("konfirmasi", `KOREKSI #${kedua.revisionNo}`);
    const res = await activateDraftAction(undefined, fd);
    expect(res?.error).toMatch(/tidak bisa menghapus/);
    expect(await db.rabNode.count({ where: { revisionId: rev1, lineageKey: berlaporan.lineageKey } })).toBe(1);
    await db.rabRevision.delete({ where: { id: kedua.revisionId } });
  }, 300_000);

  it("dokumen draft pertama sesudah kontrak = MC-0, bukan CCO (dulu nomor revisi − 1)", async () => {
    const res = await unduhCco(new Request("http://x/") as never, { params: Promise.resolve({ slug: `lokasi-${suffix}` }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(`MC-0_lokasi-${suffix}.xlsx`);
  }, 300_000);

  it("tanpa permintaan jalan pintas tetap tertahan dua persetujuan", async () => {
    const res = await terapkan({});
    expect(res?.error).toMatch(/persetujuan|Program Director/i);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("draft");
  });

  it("super admin biasa ditolak; konfirmasi yang tidak persis ditolak", async () => {
    sebagai = adminBiasa;
    try {
      expect((await terapkan({ tanpaPersetujuan: "1", cara: "koreksi", konfirmasi: `KOREKSI #${draftNo}` }))?.error).toMatch(/super admin utama/);
      expect((await terapkan({ tanpaPersetujuan: "1", konfirmasi: `AKTIFKAN #${draftNo}` }))?.error).toMatch(/super admin utama/);
    } finally {
      sebagai = akar;
    }
    expect((await terapkan({ tanpaPersetujuan: "1", cara: "koreksi", konfirmasi: "koreksi" }))?.error).toContain(`KOREKSI #${draftNo}`);
    // Kalimat koreksi tidak membuka jalan pintas CCO, dan sebaliknya.
    expect((await terapkan({ tanpaPersetujuan: "1", konfirmasi: `KOREKSI #${draftNo}` }))?.error).toContain(`AKTIFKAN #${draftNo}`);
    expect((await terapkan({ tanpaPersetujuan: "1", cara: "koreksi", konfirmasi: `AKTIFKAN #${draftNo}` }))?.error).toContain(`KOREKSI #${draftNo}`);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("draft");
  });

  it("super admin utama: isi draft menimpa RAB aktif, draft habis, laporan draft jadi resmi, tanpa revisi baru", async () => {
    const res = await terapkan({ tanpaPersetujuan: "1", cara: "koreksi", konfirmasi: `KOREKSI #${draftNo}` });
    expect(res?.error, res?.error).toBeUndefined();
    expect(res?.success).toMatch(/diterapkan sebagai koreksi/);
    const revisi = await db.rabRevision.findMany({ where: { locationId }, select: { id: true, status: true } });
    expect(revisi).toEqual([{ id: rev1, status: "aktif" }]);
    const d = await db.rabNode.findUniqueOrThrow({ where: { revisionId_lineageKey: { revisionId: rev1, lineageKey: lineageD } } });
    expect(Number(d.volume)).toBe(volumeDraft);
    const baris = await db.dailyReportItem.findFirstOrThrow({ where: { lineageKey: lineageD, report: { locationId } } });
    expect(baris).toMatchObject({ rabNodeId: d.id, basis: "aktif" });
    expect(await db.auditLog.count({ where: { action: "rab.koreksi_dari_draft", resourceId: draftId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "rab.aktivasi_tanpa_persetujuan", resourceId: draftId } })).toBe(0);
  }, 300_000);

  /*
   * Pilihan user 2026-11-01: "super admin utama tetap boleh aktifkan CCO".
   * Draft adendum yang diaktifkan dengan `AKTIFKAN #N` tetap ADENDUM – revisi
   * baru, tahap MC-0, menunggu nomor CCO paket – bukan koreksi.
   */
  it("super admin utama: AKTIFKAN #N mengaktifkan draft sebagai adendum (MC-0) tanpa dua persetujuan", async () => {
    const cco = await createRevisionFromNodes(locationId, nodesBerkas, { source: "adendum", userId: akar.id, note: "CCO" });
    const fd = new FormData();
    fd.set("revisionId", cco.revisionId);
    fd.set("tanpaPersetujuan", "1");
    fd.set("konfirmasi", `AKTIFKAN #${cco.revisionNo}`);
    const res = await activateDraftAction(undefined, fd);
    expect(res?.error, res?.error).toBeUndefined();
    const revisi = await db.rabRevision.findMany({
      where: { locationId },
      orderBy: { revisionNo: "asc" },
      select: { id: true, revisionNo: true, source: true, status: true, awaitingCco: true },
    });
    expect(revisi.map((r) => [r.id, r.source, r.status, r.awaitingCco])).toEqual([
      [rev1, "hps_awal", "digantikan", false],
      [cco.revisionId, "adendum", "aktif", true],
    ]);
    expect(tahapRevisi(revisi).get(cco.revisionId)!.label).toBe("MC-0");
    const jejak = await db.auditLog.findFirstOrThrow({
      where: { action: "rab.aktivasi_tanpa_persetujuan", resourceId: cco.revisionId },
      select: { payload: true },
    });
    expect(jejak.payload).toMatchObject({ jalur: "tombol_aktifkan" });
  }, 300_000);
});

describe("migrasi data lama: jalan pintas super admin = koreksi, di semua lokasi", () => {
  it("adendum yang diaktifkan tanpa persetujuan jadi koreksi; adendum biasa & draft tidak tersentuh; tahap ikut benar", async () => {
    const lok = await db.location.create({
      data: { packageId: pkgId, name: "Lokasi lama", slug: `lama-${suffix}`, village: "D", regency: "K", province: "P", isActive: true },
    });
    const buat = (revisionNo: number, source: "hps_awal" | "adendum", status: "aktif" | "digantikan" | "draft") =>
      db.rabRevision.create({
        data: { locationId: lok.id, revisionNo, source, status, totalValue: 1n, awaitingCco: source === "adendum", createdById: akar.id },
      });
    const r1 = await buat(1, "hps_awal", "digantikan");
    const r2 = await buat(2, "adendum", "digantikan"); // dulu "Jadikan RAB AKTIF" super admin
    const r3 = await buat(3, "adendum", "aktif"); // adendum dengan dua persetujuan
    const r4 = await buat(4, "adendum", "draft");
    for (const r of [r2, r4]) {
      await db.auditLog.create({
        data: { userId: akar.id, action: "rab.aktivasi_tanpa_persetujuan", resourceType: "rab_revision", resourceId: r.id, payload: { jalur: "impor" } },
      });
    }
    // Sebelum migrasi: draft adendum pertama sesudah koreksi tercetak salah.
    const sebelum = tahapRevisi(await db.rabRevision.findMany({ where: { locationId: lok.id } }));
    expect(sebelum.get(r3.id)!.label).toBe("CCO-01");

    for (let i = 0; i < 2; i++) for (const sql of MIGRASI_LAMA) await db.$executeRawUnsafe(sql); // idempoten

    const kini = await db.rabRevision.findMany({
      where: { locationId: lok.id },
      orderBy: { revisionNo: "asc" },
      select: { id: true, revisionNo: true, source: true, status: true, awaitingCco: true },
    });
    expect(kini.map((r) => [r.revisionNo, r.source, r.awaitingCco])).toEqual([
      [1, "hps_awal", false],
      [2, "koreksi", false],
      [3, "adendum", true],
      [4, "adendum", true],
    ]);
    const tahap = tahapRevisi(kini);
    expect([r1, r2, r3, r4].map((r) => tahap.get(r.id)!.label)).toEqual(["RAB kontrak", "Koreksi", "MC-0", "CCO-01"]);
  });

  /*
   * Koreksi tidak mengubah status CCO: ia mewarisi status revisi yang
   * dikoreksinya. Dulu impor jalan pintas tidak pernah menandai "menunggu
   * CCO", tombol draft jalan pintas selalu menandainya. Kalau semuanya disetel
   * "tidak menunggu", adendum sah sebelumnya yang belum ber-CCO hilang dari
   * selisih CCO berikutnya.
   */
  it("aturan jalur: impor = koreksi yang mewarisi status CCO; tombol draft = tetap adendum; yang sudah ber-CCO tidak disentuh", async () => {
    const kontrak = await db.contract.findFirstOrThrow({ where: { packageId: pkgId }, select: { id: true } });
    const cco = await db.contractAmendment.create({
      data: { contractId: kontrak.id, ccoNumber: `CCO-${suffix}`, valueDelta: 0n, endDateDelta: 0, effectiveDate: new Date("2026-08-01"), reason: "uji" },
    });
    const lokasi = (nama: string) =>
      db.location.create({
        data: { packageId: pkgId, name: nama, slug: `${nama}-${suffix}`, village: "D", regency: "K", province: "P", isActive: true },
      });
    const A = await lokasi("tertunda");
    const B = await lokasi("ber-cco");
    const buat = (
      locationId: string,
      revisionNo: number,
      source: "hps_awal" | "adendum",
      status: "aktif" | "digantikan",
      awaitingCco: boolean,
      amendmentId: string | null = null,
    ) =>
      db.rabRevision.create({
        data: { locationId, revisionNo, source, status, totalValue: BigInt(revisionNo) * 1000n, awaitingCco, amendmentId, createdById: akar.id },
      });
    const pintas = (id: string, jalur: string) =>
      db.auditLog.create({
        data: { userId: akar.id, action: "rab.aktivasi_tanpa_persetujuan", resourceType: "rab_revision", resourceId: id, payload: { jalur } },
      });
    // A: kontrak → adendum dua persetujuan, belum ber-CCO → dua koreksi jalan pintas.
    const a1 = await buat(A.id, 1, "hps_awal", "digantikan", false);
    const a2 = await buat(A.id, 2, "adendum", "digantikan", true);
    const a3 = await buat(A.id, 3, "adendum", "digantikan", false); // impor: dulu tak ditandai menunggu
    const a4 = await buat(A.id, 4, "adendum", "aktif", true); // tombol draft: dulu selalu ditandai
    await pintas(a3.id, "impor");
    await pintas(a4.id, "tombol_aktifkan");
    // B: koreksi jalan pintas yang sudah tersapu ke CCO paket.
    await buat(B.id, 1, "hps_awal", "digantikan", false);
    const b2 = await buat(B.id, 2, "adendum", "aktif", false, cco.id);
    await pintas(b2.id, "impor");
    // C: draft adendum yang diaktifkan lewat tombol lalu sudah dicatat dalam CCO paket.
    const C = await lokasi("tombol-cco");
    await buat(C.id, 1, "hps_awal", "digantikan", false);
    const c2 = await buat(C.id, 2, "adendum", "aktif", false, cco.id);
    await pintas(c2.id, "tombol_aktifkan");
    // D: koreksi impor SESUDAH adendum lewat tombol yang belum ber-CCO – status
    // CCO-nya harus mengikuti adendum itu, yang baru kembali di 090300.
    const D = await lokasi("tombol-lalu-impor");
    await buat(D.id, 1, "hps_awal", "digantikan", false);
    const d2 = await buat(D.id, 2, "adendum", "digantikan", true);
    const d3 = await buat(D.id, 3, "adendum", "aktif", false);
    await pintas(d2.id, "tombol_aktifkan");
    await pintas(d3.id, "impor");

    for (let i = 0; i < 2; i++) for (const sql of MIGRASI_LAMA) await db.$executeRawUnsafe(sql); // idempoten

    const kini = async (locationId: string) =>
      (
        await db.rabRevision.findMany({
          where: { locationId },
          orderBy: { revisionNo: "asc" },
          select: { id: true, revisionNo: true, source: true, status: true, awaitingCco: true, amendmentId: true },
        })
      ).map((r) => [r.revisionNo, r.source, r.awaitingCco, r.amendmentId]);
    expect(await kini(A.id)).toEqual([
      [1, "hps_awal", false, null],
      [2, "adendum", true, null],
      [3, "koreksi", true, null],
      [4, "adendum", true, null],
    ]);
    expect(await kini(B.id)).toEqual([
      [1, "hps_awal", false, null],
      [2, "koreksi", false, cco.id],
    ]);
    expect(await kini(C.id)).toEqual([
      [1, "hps_awal", false, null],
      [2, "adendum", false, cco.id],
    ]);
    expect(await kini(D.id)).toEqual([
      [1, "hps_awal", false, null],
      [2, "adendum", true, null],
      [3, "koreksi", true, null],
    ]);
    // Uang: selisih CCO berikutnya dihitung dari RAB kontrak, jadi adendum #2 ikut.
    const tertunda = await adendumTertunda(pkgId);
    expect(tertunda.revisi.filter((r) => r.locationId === A.id).map((r) => [r.revisionId, r.totalAktif, r.totalDraft])).toEqual([
      [a4.id, 1000n, 4000n],
    ]);
    expect(tertunda.revisi.some((r) => r.locationId === B.id)).toBe(false);
    const tahap = tahapRevisi(await db.rabRevision.findMany({ where: { locationId: A.id } }));
    expect([a1, a2, a3, a4].map((r) => tahap.get(r.id)!.label)).toEqual(["RAB kontrak", "MC-0", "Koreksi", "CCO-01"]);
    const tahapD = tahapRevisi(await db.rabRevision.findMany({ where: { locationId: D.id } }));
    expect([d2, d3].map((r) => tahapD.get(r.id)!.label)).toEqual(["MC-0", "Koreksi"]);
  });
});
