/*
 * ITEM BERNAMA SAMA DI DUA SARANA HARUS BISA DIBEDAKAN (DECISIONS 748).
 *
 * Laporan user 2026-11-06, memotret PDF ringkasan harian: dua baris
 * "5.b Pekerjaan Pembesian Besi Beton 5 D 10 mm" dan dua foto berjudul sama
 * persis – *"nama pekerjaan sama, ternyata beda sarana/prasarana, kenapa foto
 * dan keterangan itu tidak kamu lengkapi sekalian?"*
 *
 * Kode item hanya unik DI DALAM induknya. Jalurnya (`jalurNodeById`) sudah
 * dipakai layar laporan harian sejak keluhan 2026-09-23 – keluhan ketiga
 * untuk kelas yang sama, sesudah 2026-09-05 – tapi tiga keluaran lain tetap
 * hanya mencetak kode + nama: PDF ringkasan (tabel dan foto), galeri Foto
 * Lapangan, dan pilihan item di Foto Cepat. Uji ini memasang dua sarana
 * dengan item kembar persis dan menuntut ketiganya bisa membedakan.
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
const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");
const { getRingkasHarian } = await import("@/lib/daily-report/ringkas");
const { getPhotoGallery } = await import("@/lib/photos-gallery");
const { getTujuan } = await import("@/lib/foto-cepat/queries");

const suffix = `jk${Date.now().toString(36)}`;
const HARI = "2026-11-06";
const KIOS = "VII. PEKERJAAN BANGUNAN KIOS PERBEKALAN";
const GUDANG = "VIII. PEKERJAAN BANGUNAN GUDANG BEKU";

let userId = "";
let locationId = "";
let slug = "";
let itemKios = "";
let itemGudang = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  userId = (
    await db.user.create({
      data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  slug = `iyok-${suffix}`;
  locationId = (
    await db.location.create({
      data: {
        packageId: pkg.id,
        name: "Iyok",
        slug,
        village: "Iyok",
        regency: "Bolaang Mongondow Timur",
        province: "Sulawesi Utara",
        status: "berjalan",
        isActive: true,
      },
      select: { id: true },
    })
  ).id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 200_000_000n },
  });
  // Dua sarana, masing-masing dengan item "5.b" bernama PERSIS sama.
  let urut = 0;
  for (const [nama, kode] of [
    [KIOS, "VII"],
    [GUDANG, "VIII"],
  ] as const) {
    const kat = await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: kode, name: nama, amount: 100_000_000n, lineageKey: kode, sortOrder: ++urut },
    });
    const item = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: "5.b",
        name: "Pekerjaan Pembesian Besi Beton 5 D 10 mm",
        volume: 1000,
        unit: "kg",
        unitPrice: 100_000,
        amount: 100_000_000n,
        lineageKey: `${kode}#5.b`,
        sortOrder: ++urut,
      },
    });
    if (kode === "VII") itemKios = item.id;
    else itemGudang = item.id;
  }

  const draft = await getOrCreateDraft(locationId, HARI, userId);
  await upsertItem(draft.id, { rabNodeId: itemKios, volumeDone: 11.945 }, userId);
  await upsertItem(draft.id, { rabNodeId: itemGudang, volumeDone: 13.756 }, userId);
  const baris = await db.dailyReportItem.findMany({ where: { reportId: draft.id }, select: { id: true, rabNodeId: true } });
  for (const b of baris) {
    await db.photo.create({
      data: {
        locationId,
        reportId: draft.id,
        reportItemId: b.id,
        r2Key: `uji/${suffix}/${b.rabNodeId}.jpg`,
        sha256: `${suffix}${b.rabNodeId}`,
        bytes: 10,
        gpsSource: "exif",
        exifTakenAt: new Date(`${HARI}T02:15:00.000Z`),
        metadataSource: "exif",
      },
    });
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("PDF ringkasan harian", () => {
  it("tabel pekerjaan menyebut sarana tiap baris kembar", async () => {
    const d = await getRingkasHarian(slug, HARI);
    expect(d!.pekerjaan).toHaveLength(2);
    expect(new Set(d!.pekerjaan.map((p) => `${p.code} ${p.name}`)).size).toBe(1); // namanya memang kembar
    expect(d!.pekerjaan.map((p) => p.jalur).sort()).toEqual([KIOS, GUDANG].sort());
  });

  it("keterangan foto menyebut sarananya, bukan hanya kode + nama", async () => {
    const d = await getRingkasHarian(slug, HARI);
    const foto = d!.foto.filter((f) => f.sumber.startsWith("5.b"));
    expect(foto).toHaveLength(2);
    expect(foto.map((f) => f.sumberJalur).sort()).toEqual([KIOS, GUDANG].sort());
  });
});

describe("galeri Foto Lapangan", () => {
  it("tiap foto membawa sarana item-nya", async () => {
    const g = await getPhotoGallery([locationId], {} as never);
    const jalur = g.groups.flatMap((x) => x.photos).map((p) => p.jalur);
    expect(jalur.sort()).toEqual([KIOS, GUDANG].sort());
  });
});

describe("Foto Cepat – pilihan item tujuan", () => {
  it("dua item kembar tampil dengan label berbeda", async () => {
    const t = await getTujuan(locationId);
    const label = t.laporan.flatMap((l) => l.items.map((i) => i.label));
    expect(label).toHaveLength(2);
    expect(new Set(label).size).toBe(2);
    expect(label.some((l) => l.includes(KIOS))).toBe(true);
    expect(label.some((l) => l.includes(GUDANG))).toBe(true);
  });
});
