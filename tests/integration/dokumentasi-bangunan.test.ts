/*
 * DOKUMENTASI FOTO PER BANGUNAN DI DRIVE – shortcut (DECISIONS 666).
 *
 * Drive ditiru (pencatat panggilan); basis datanya sungguhan. Yang dibuktikan:
 * shortcut ke foto laporan harian dibuat di "6. DOKUMENTASI/<Lokasi>/<Bangunan>",
 * tidak pernah dobel, ikut pindah saat bangunannya berganti nama di revisi
 * aktif, dan dibuang saat laporannya tidak lagi final.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

type Panggilan = { op: string; arg: Record<string, unknown> };
const panggilan: Panggilan[] = [];
let urut = 0;
vi.mock("@/lib/gdrive/client", async (asli) => ({
  ...(await asli<typeof import("@/lib/gdrive/client")>()),
  ensureFolderPath: async (root: string, path: string[]) => `${root}/${path.join("/")}`,
  buatPintasan: async (arg: Record<string, unknown>) => {
    panggilan.push({ op: "buat", arg });
    return `pintas-${++urut}`;
  },
  ubahPintasan: async (id: string, arg: Record<string, unknown>) => {
    panggilan.push({ op: "ubah", arg: { id, ...arg } });
  },
  buangPintasan: async (id: string) => {
    panggilan.push({ op: "buang", arg: { id } });
  },
}));

const { db } = await import("@/lib/db");
const { sinkronDokumentasiLaporan, isiDokumentasi } = await import("@/lib/gdrive/dokumentasi");

const suffix = `dk${Date.now().toString(36)}`;
const SLUG = `lokasi-dok-${suffix}`;
let reportId = "";
let katAktifId = "";
let fotoItem = "";
let fotoMaterial = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
    select: { id: true },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan", driveFolderId: "ROOT" },
    select: { id: true },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Kedung Uji", slug: SLUG,
      village: "V", regency: "K", province: "P", status: "berjalan", isActive: true,
    },
    select: { id: true },
  });
  const rev = await db.rabRevision.create({
    data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 1_000_000n },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "II", name: "PEKERJAAN BALAI NELAYAN", amount: 1_000_000n, lineageKey: "II", sortOrder: 1 },
    select: { id: true },
  });
  katAktifId = kat.id;
  const sub = await db.rabNode.create({
    data: { revisionId: rev.id, parentId: kat.id, kind: "grup", code: "A", name: "STRUKTUR", amount: 1_000_000n, lineageKey: "II#A", sortOrder: 2 },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: sub.id, kind: "item", code: "1", name: "Pasangan batu kali",
      volume: 10, unit: "m3", unitPrice: 100_000, amount: 1_000_000n, lineageKey: "II#A#1", sortOrder: 3,
    },
    select: { id: true },
  });
  const rep = await db.dailyReport.create({
    data: {
      locationId: loc.id, reportDate: new Date("2026-09-27T00:00:00.000Z"), status: "final",
      finalizedAt: new Date("2026-09-27T10:00:00Z"), createdById: user.id,
    },
    select: { id: true },
  });
  reportId = rep.id;
  const ri = await db.dailyReportItem.create({
    data: { reportId: rep.id, rabNodeId: item.id, lineageKey: "II#A#1", basis: "aktif", volumeDone: 1, valueDone: 100_000n, reportedById: user.id },
    select: { id: true },
  });
  const mat = await db.dailyReportMaterial.create({ data: { reportId: rep.id, name: "Semen PCC 50kg" }, select: { id: true } });
  const foto = (data: Record<string, unknown>, n: number) =>
    db.photo.create({
      data: {
        locationId: loc.id, reportId: rep.id, r2Key: `foto/${suffix}-${n}.jpg`, sha256: `h${n}`, bytes: 10,
        createdAt: new Date(`2026-09-27T0${n}:00:00Z`), ...data,
      },
      select: { id: true },
    });
  fotoItem = (await foto({ reportItemId: ri.id }, 1)).id;
  fotoMaterial = (await foto({ reportMaterialId: mat.id }, 2)).id;
  // Foto tanpa item/material/alat: tidak punya bangunan, tidak dibuatkan shortcut.
  await foto({}, 3);

  // Unggahan foto ke folder laporan harian, dengan photoId (sejak 666).
  for (const [photoId, n] of [[fotoItem, 1], [fotoMaterial, 2]] as const) {
    await db.gDriveUpload.create({
      data: {
        packageId: pkg.id, locationId: loc.id, kind: "laporan_harian", refKey: `${SLUG}:2026-09-27`,
        fileName: `2026-09-27 Kedung Uji 0${n}.jpg`, fileId: `drive-${n}`, status: "sukses", photoId,
        createdAt: new Date("2026-09-27T11:00:00Z"),
      },
    });
  }
});

afterAll(async () => {
  await db.gDrivePintasanFoto.deleteMany({ where: { reportId } });
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(() => {
  panggilan.length = 0;
});

describe("shortcut dokumentasi per bangunan", () => {
  it("pengisi berkala menemukan laporan final yang belum punya shortcut", async () => {
    const h = await isiDokumentasi({ batasMs: 60_000, jedaMs: 0 });
    expect(h.laporan).toBeGreaterThanOrEqual(1);
    const buat = panggilan.filter((p) => p.op === "buat").map((p) => p.arg);
    expect(buat).toEqual(
      expect.arrayContaining([
        {
          folderId: "ROOT/6. DOKUMENTASI/Kedung Uji/II PEKERJAAN BALAI NELAYAN",
          name: "2026-09-27 – Pasangan batu kali – 01",
          targetId: "drive-1",
        },
        {
          folderId: "ROOT/6. DOKUMENTASI/Kedung Uji/Material Masuk",
          name: "2026-09-27 – Semen PCC 50kg – 02",
          targetId: "drive-2",
        },
      ]),
    );
    // Foto ketiga tanpa bangunan → tidak ada shortcut.
    expect(await db.gDrivePintasanFoto.count({ where: { reportId } })).toBe(2);
  });

  it("dijalankan lagi tanpa perubahan → tidak ada panggilan Drive, tidak dobel", async () => {
    const h = await sinkronDokumentasiLaporan(reportId);
    expect(h).toMatchObject({ dibuat: 0, dipindah: 0, dibuang: 0 });
    expect(panggilan).toEqual([]);
  });

  it("bangunan berganti nama di revisi aktif → shortcut DIPINDAH, bukan dibuat baru", async () => {
    await db.rabNode.update({ where: { id: katAktifId }, data: { name: "PEKERJAAN BALAI NELAYAN TERPADU" } });
    const h = await sinkronDokumentasiLaporan(reportId);
    expect(h.dipindah).toBe(1);
    expect(panggilan).toEqual([
      {
        op: "ubah",
        arg: {
          id: expect.stringMatching(/^pintas-/),
          name: "2026-09-27 – Pasangan batu kali – 01",
          dariFolder: "ROOT/6. DOKUMENTASI/Kedung Uji/II PEKERJAAN BALAI NELAYAN",
          keFolder: "ROOT/6. DOKUMENTASI/Kedung Uji/II PEKERJAAN BALAI NELAYAN TERPADU",
        },
      },
    ]);
  });

  it("laporan dibuka kembali (tidak final) → shortcut-nya dibuang", async () => {
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "perlu_koreksi" } });
    const h = await sinkronDokumentasiLaporan(reportId);
    expect(h.dibuang).toBe(2);
    expect(panggilan.map((p) => p.op)).toEqual(["buang", "buang"]);
    expect(await db.gDrivePintasanFoto.count({ where: { reportId } })).toBe(0);
  });
});
