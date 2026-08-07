// FOTO GALERI TANPA GPS, PELAPOR MENJAWAB "TIDAK DI LOKASI PROYEK".
//
// Laporan user 2026-08-07: *"laporan harian, masukkan foto ini dari galeri,
// pilih tidak di lokasi proyek, langsung muncul halaman error minta reload"* —
// dengan berkas nyata bernama `IMG20260801WA0035.jpg`, 274 KB, TANPA EXIF.
//
// Perpaduan itu menempuh jalur yang paling jarang dilewati uji: tidak ada
// koordinat EXIF, tidak ada koordinat perangkat (sengaja, karena pelapor
// menyatakan tidak di lokasi), nama berkas bergaya WhatsApp, dan jam jepret
// yang benar-benar tidak diketahui. Cap foto harus tetap terbit — dan kalau
// tidak bisa, ia harus GAGAL DENGAN PESAN, bukan menjatuhkan halaman.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** R2 tiruan yang BERHASIL — supaya jalurnya sampai ke pembuatan cap. */
const rak = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string, body: Buffer | Uint8Array) => {
    rak.set(key, Buffer.from(body));
  },
  r2GetBuffer: async (key: string) => rak.get(key) ?? Buffer.alloc(0),
  r2PresignGet: async (key: string) => `https://contoh/${key}`,
  r2Delete: async (key: string) => {
    rak.delete(key);
  },
  classifyR2Error: (e: unknown) => String(e),
}));

const { db } = await import("@/lib/db");
const { savePhotoForItem } = await import("@/lib/photos");

const suffix = `gal${Date.now().toString(36)}`;
let orgId: string;
let locationId: string;
let userId: string;
let reportId: string;
let itemId: string;
let rabNodeId: string;

/**
 * Berkas ASLI dari laporan user — bukan gambar 8×8 buatan uji, dan sengaja
 * ikut disimpan di repo (`tests/fixtures/`) supaya uji ini jalan di mana pun,
 * termasuk CI. Jangan diganti gambar sintetis: justru ketiadaan EXIF, ukuran
 * 1600×901 progressive, dan nama bergaya WhatsApp itulah bahan ujinya.
 */
const BERKAS = readFileSync(new URL("../fixtures/IMG20260801WA0035.jpg", import.meta.url));

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org GAL ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket GAL ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi GAL ${suffix}`,
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
  rabNodeId = node.id;
  const rep = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-08-05"), status: "draft", createdById: userId },
  });
  reportId = rep.id;
  const item = await db.dailyReportItem.create({
    data: {
      reportId,
      rabNodeId,
      lineageKey: `ln-${suffix}`,
      volumeDone: 1,
      valueDone: 0n,
    },
  });
  itemId = item.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("foto galeri, TIDAK di lokasi proyek, tanpa EXIF", () => {
  it("tersimpan tanpa menjatuhkan halaman", async () => {
    const file = new File([BERKAS], "IMG20260801WA0035.jpg", { type: "image/jpeg" });
    const hasil = await savePhotoForItem({
      locationId,
      reportId,
      reportItemId: itemId,
      file,
      userId,
      locationSlug: `lok-${suffix}`,
      dateKey: "2026-08-05",
      stamp: {
        source: "gallery",
        fallbackMode: "project",
        requireGps: false,
        // Inilah kombinasi yang dilaporkan: pelapor menjawab TIDAK, jadi tidak
        // ada koordinat perangkat sama sekali.
        atSite: false,
        lat: null,
        lng: null,
        locationLat: -6.9,
        locationLng: 110.6,
        takenAt: null,
        workDate: new Date("2026-08-05T00:00:00.000Z"),
        locationLabel: `Lokasi GAL ${suffix}`,
        companyName: "PT Uji",
        reporterName: "Site Manager Uji",
        categoryName: "1. Bangunan Uji",
        workName: "Pekerjaan Galian Tanah s/d 1 m",
      },
    });
    expect(hasil.id).toBeTruthy();

    const foto = await db.photo.findUniqueOrThrow({
      where: { id: hasil.id },
      select: { gpsSource: true, metadataSource: true, r2Key: true, originalKey: true },
    });
    // Koordinatnya BUKAN bukti GPS — ia titik proyek, dan harus bertanda begitu
    // (DECISIONS 197). Kalau ini berubah jadi "device"/"exif", capnya berbohong.
    expect(foto.gpsSource).toBe("project");
    // Berkas ASLI wajib diarsipkan di samping versi ber-cap (DECISIONS 197).
    expect(foto.originalKey).toBeTruthy();
    expect(rak.has(foto.r2Key)).toBe(true);
  });

  it("berkas yang BUKAN gambar tetap tersimpan apa adanya, tanpa cap", async () => {
    // Sengaja: kalau sharp gagal (binari native bermasalah di host, berkas
    // aneh), fotonya TETAP masuk bucket tanpa cap — lebih baik daripada "foto
    // hilang, bucket kosong". Yang dikunci di sini adalah bahwa jalur itu tidak
    // melempar galat mentah yang bisa menjatuhkan halaman.
    const rusak = new File([Buffer.from("bukan gambar sama sekali")], "IMG20260801WA0099.jpg", {
      type: "image/jpeg",
    });
    const hasil = await savePhotoForItem({
        locationId,
        reportId,
        reportItemId: itemId,
        file: rusak,
        userId,
        locationSlug: `lok-${suffix}`,
        dateKey: "2026-08-05",
        stamp: {
          source: "gallery",
          fallbackMode: "project",
          requireGps: false,
          atSite: false,
          lat: null,
          lng: null,
          locationLat: -6.9,
          locationLng: 110.6,
          takenAt: null,
          workDate: new Date("2026-08-05T00:00:00.000Z"),
          locationLabel: `Lokasi GAL ${suffix}`,
          companyName: "PT Uji",
          reporterName: "Site Manager Uji",
          categoryName: "1. Bangunan Uji",
          workName: "Pekerjaan Galian Tanah s/d 1 m",
        },
    });
    expect(hasil.id).toBeTruthy();
    const foto = await db.photo.findUniqueOrThrow({
      where: { id: hasil.id },
      select: { thumbnailKey: true, widthPx: true },
    });
    // Tanpa cap & tanpa thumbnail — dan itu HARUS aman dibaca hilir.
    expect(foto.thumbnailKey).toBeNull();
    expect(foto.widthPx).toBeNull();
  });
});
