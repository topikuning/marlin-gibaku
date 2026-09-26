// CAP FOTO DI LATAR (DECISIONS 618).
//
// Keluhan user 2026-09-26: *"saat simpan, bisakah kita simpan saja fotonya,
// dan dikerjakan di background tanpa mengganggu user? karena sistem terkesan
// sangat lambat saat menyimpan foto"*.
//
// Yang dijaga:
//  1. Simpan TIDAK menunggu cap: baris lahir `stampPending`, r2Key = berkas asli.
//  2. Latar menukar r2Key ke berkas ber-cap + thumbnail.
//  3. Keluaran (PDF/WA/Drive/snapshot) tidak pernah memakai berkas tanpa cap.
//  4. Perbaikan cap tangan yang terjadi lebih dulu TIDAK ditimpa hasil latar.
//  5. Foto yang ditinggal proses mati dipulihkan dari basis data.
//  6. Berkas asli foto yang masih menunggu tidak ikut arsip dingin/hapus arsip.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const rak = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string, body: Buffer | Uint8Array) => {
    rak.set(key, Buffer.from(body));
  },
  r2GetBuffer: async (key: string) => {
    const b = rak.get(key);
    if (!b) throw new Error(`tidak ada objek ${key}`);
    return b;
  },
  r2PresignGet: async (key: string) => `https://contoh/${key}`,
  r2Delete: async (key: string) => {
    rak.delete(key);
  },
  classifyR2Error: (e: unknown) => String(e),
}));

const { db } = await import("@/lib/db");
const { savePhotoForItem } = await import("@/lib/photos");
const { pastikanFotoBercap, kunciFotoBercap, barisFotoBercap, pulihkanYangTertinggal, antreanCapSelesai } =
  await import("@/lib/photo-stamp/cap-latar");
const { whereArsip } = await import("@/lib/photo-restamp/service");

const suffix = `cl${Date.now().toString(36)}`;
let orgId: string;
let locationId: string;
let userId: string;
let reportId: string;
let itemId: string;

const DASAR = readFileSync(new URL("../fixtures/IMG20260801WA0035.jpg", import.meta.url));
let nomor = 0;
/** Tiap foto uji byte-nya berbeda — dedup (lokasi, sha256) tidak boleh menolak. */
async function fotoBaru(): Promise<File> {
  nomor++;
  const buf = await sharp(DASAR).resize({ width: 1200 + nomor * 7 }).jpeg({ quality: 85 }).toBuffer();
  return new File([buf], `foto-${nomor}.jpg`, { type: "image/jpeg" });
}

async function simpan() {
  return savePhotoForItem({
    locationId,
    reportId,
    reportItemId: itemId,
    file: await fotoBaru(),
    userId,
    locationSlug: `lok-${suffix}`,
    dateKey: "2026-08-05",
    stamp: {
      source: "camera",
      fallbackMode: "project",
      requireGps: false,
      atSite: true,
      lat: -6.9,
      lng: 110.6,
      locationLat: -6.9,
      locationLng: 110.6,
      takenAt: new Date("2026-08-05T02:00:00.000Z"),
      workDate: new Date("2026-08-05T00:00:00.000Z"),
      locationLabel: `Lokasi CL ${suffix}`,
      companyName: "PT Uji",
      reporterName: "Site Manager Uji",
      categoryName: "1. Bangunan Uji",
      workName: "Pekerjaan Galian Tanah s/d 1 m",
    },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org CL ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket CL ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi CL ${suffix}`,
      slug: `lok-${suffix}`,
      village: "Desa",
      regency: "Kab. Uji",
      province: "Jawa Tengah",
      isActive: true,
      gpsLat: -6.9,
      gpsLng: 110.6,
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      email: `sm-${suffix}@contoh.id`,
      fullName: "Site Manager Uji",
      role: "site_manager",
      passwordHash: "x",
    },
  });
  userId = u.id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 0n },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "item",
      lineageKey: `ln-${suffix}`,
      code: "1.a",
      name: "Pekerjaan Galian Tanah s/d 1 m",
      sortOrder: 1,
      unit: "m3",
    },
  });
  const rep = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-08-05"), status: "draft", createdById: userId },
  });
  reportId = rep.id;
  const item = await db.dailyReportItem.create({
    data: { reportId, rabNodeId: node.id, lineageKey: `ln-${suffix}`, volumeDone: 1, valueDone: 0n },
  });
  itemId = item.id;
});

afterAll(async () => {
  await antreanCapSelesai();
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const baca = (id: string) =>
  db.photo.findUniqueOrThrow({
    where: { id },
    select: { r2Key: true, thumbnailKey: true, originalKey: true, stampPending: true, widthPx: true },
  });

describe("cap foto di latar", () => {
  it("simpan tidak menunggu cap; latar menukar ke berkas ber-cap", async () => {
    const hasil = await simpan();
    const awal = await baca(hasil.id);
    expect(awal.stampPending).toBe(true);
    expect(awal.r2Key).toBe(awal.originalKey);
    expect(awal.thumbnailKey).toBeNull();
    // Foto tetap tampil selama menunggu: berkas aslinya ada di bucket.
    expect(rak.has(awal.r2Key)).toBe(true);

    await pastikanFotoBercap([hasil.id]);
    const akhir = await baca(hasil.id);
    expect(akhir.stampPending).toBe(false);
    expect(akhir.r2Key).not.toBe(akhir.originalKey);
    expect(akhir.r2Key).not.toMatch(/\.asli\./);
    expect(rak.has(akhir.r2Key)).toBe(true);
    expect(akhir.thumbnailKey && rak.has(akhir.thumbnailKey)).toBe(true);
    expect(akhir.widthPx).toBeGreaterThan(0);
    // Berkas asli tetap diarsipkan (DECISIONS 197).
    expect(rak.has(akhir.originalKey!)).toBe(true);
  }, 60_000);

  it("keluaran yang memegang kunci berkas asli mendapat kunci ber-cap", async () => {
    const hasil = await simpan();
    const awal = await baca(hasil.id);
    const kunci = await kunciFotoBercap(awal.r2Key);
    const akhir = await baca(hasil.id);
    expect(kunci).toBe(akhir.r2Key);
    expect(kunci).not.toMatch(/\.asli\./);
  }, 60_000);

  it("snapshot tidak membekukan kunci berkas asli", async () => {
    const hasil = await simpan();
    const awal = await baca(hasil.id);
    const [baris] = await barisFotoBercap([{ id: hasil.id, r2Key: awal.r2Key, thumbnailKey: null }]);
    expect(baris!.r2Key).not.toMatch(/\.asli\./);
    expect(baris!.thumbnailKey).toBeTruthy();
  }, 60_000);

  it("perbaikan cap yang lebih dulu selesai tidak ditimpa hasil latar", async () => {
    const hasil = await simpan();
    // Perbaikan tangan menulis kunci barunya sendiri dan menutup status menunggu.
    await db.photo.update({
      where: { id: hasil.id },
      data: { r2Key: "photos/manual.webp", thumbnailKey: null, stampPending: false },
    });
    await antreanCapSelesai();
    const akhir = await baca(hasil.id);
    expect(akhir.r2Key).toBe("photos/manual.webp");
    // Hasil latar yang basi dibuang, bukan ditinggal memakan bucket.
    const sisa = [...rak.keys()].filter((k) => k.startsWith(akhir.originalKey!.replace(/\.asli\.[^./]+$/, "")));
    expect(sisa).toEqual([akhir.originalKey]);
  }, 60_000);

  it("foto yang ditinggal proses mati dipulihkan dari basis data", async () => {
    const hasil = await simpan();
    await antreanCapSelesai();
    // Tiru proses yang mati sebelum menukar: kembali menunggu, umur 5 menit.
    const awal = await baca(hasil.id);
    await db.photo.update({
      where: { id: hasil.id },
      data: {
        r2Key: awal.originalKey!,
        thumbnailKey: null,
        stampPending: true,
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    });
    expect(await pulihkanYangTertinggal()).toBeGreaterThanOrEqual(1);
    await antreanCapSelesai();
    const akhir = await baca(hasil.id);
    expect(akhir.stampPending).toBe(false);
    expect(akhir.r2Key).not.toMatch(/\.asli\./);
  }, 60_000);

  it("berkas asli foto yang masih menunggu tidak termasuk arsip yang boleh dihapus", async () => {
    const hasil = await simpan();
    const cocok = await db.photo.findMany({
      where: { AND: [whereArsip({}, null, orgId), { id: hasil.id }] },
      select: { id: true },
    });
    expect(cocok).toEqual([]);
    await pastikanFotoBercap([hasil.id]);
    const sesudah = await db.photo.findMany({
      where: { AND: [whereArsip({}, null, orgId), { id: hasil.id }] },
      select: { id: true },
    });
    expect(sesudah.map((s) => s.id)).toEqual([hasil.id]);
  }, 60_000);
});
