/*
 * RIWAYAT INPUT PER ITEM PEKERJAAN — "pekerjaan ini diinput kapan saja?"
 *
 * **Permintaan user 2026-09-21**, saat pratinjau impor adendum melaporkan
 * *"7 item volumenya turun DI BAWAH yang sudah dikerjakan"*:
 *
 *   *"untuk kasus seperti ini, bagaimana user tau kapan pekerjaan itu diinput?
 *   akan konyol kalau harus cek hari per hari. kamu seharusnya ada fitur cari
 *   item pekerjaan diinputnya kapan saja"*
 *
 * Betul: angka "sudah dikerjakan 51,6" itu hasil penjumlahan lintas laporan
 * harian, dan satu-satunya cara melacaknya adalah membuka laporan hari per
 * hari sampai ketemu. Pada kontrak 150 hari itu bukan pemeriksaan, itu
 * pekerjaan rumah.
 *
 * DUA TANGGAL, dan keduanya dibutuhkan:
 *
 * - `tanggal`   — TANGGAL KERJA (`reportDate`), kapan pekerjaannya dilakukan.
 * - `diinputPada` — kapan barisnya BENAR-BENAR diketik (`createdAt`).
 *
 * Menyamakan keduanya menyembunyikan justru kasus yang paling perlu dilihat:
 * baris bertanggal minggu lalu yang baru diketik hari ini, tepat sebelum
 * adendum diajukan. User menanyakan "diinput kapan" dengan kata-katanya
 * sendiri, jadi yang dijawab harus tanggal input — bukan hanya tanggal kerja.
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
const { riwayatInputItem, cariItemBerealisasi } = await import("@/lib/rab/riwayat-item");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `ri${Date.now().toString(36)}`;
let locationId: string;
let userId: string;
let besiId: string;
let galianId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RI ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `ri-${suffix}`, fullName: "Mandor Uji", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket RI ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor RI ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 200_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi RI",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 125_000_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "II", name: "PEKERJAAN STRUKTUR", amount: 125_000_000n, lineageKey: "II", sortOrder: 1 },
  });
  const besi = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "2.b",
      name: "Pembesian Besi Beton D13-150 mm secara semi mekanis",
      volume: 634.51, unit: "kg", unitPrice: 20_000, amount: 100_000_000n, lineageKey: "II#2.b", sortOrder: 2,
    },
  });
  besiId = besi.id;
  const galian = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "2.c", name: "Galian tanah biasa",
      volume: 50, unit: "m3", unitPrice: 500_000, amount: 25_000_000n, lineageKey: "II#2.c", sortOrder: 3,
    },
  });
  galianId = galian.id;

  // Besi dilaporkan TIGA kali: 20 + 20 + 11,6 = 51,6.
  for (const [tanggal, volume] of [
    ["2026-07-10", 20],
    ["2026-07-14", 20],
    ["2026-08-03", 11.6],
  ] as const) {
    const d = await getOrCreateDraft(locationId, tanggal, userId);
    await upsertItem(d.id, { rabNodeId: besiId, volumeDone: volume }, userId);
    await submitReport(d.id, userId);
  }

  // Galian sekali saja — pembanding supaya "cari" tidak asal mengembalikan semua.
  const d = await getOrCreateDraft(locationId, "2026-07-20", userId);
  await upsertItem(d.id, { rabNodeId: galianId, volumeDone: 7 }, userId);
  await submitReport(d.id, userId);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("riwayatInputItem – satu item, seluruh jejak inputnya", () => {
  it("mengembalikan SEMUA baris laporan untuk item itu, bukan totalnya saja", async () => {
    const r = await riwayatInputItem(locationId, "II#2.b");
    expect(r).not.toBeNull();
    expect(r!.input).toHaveLength(3);
  });

  it("total realisasinya sama dengan angka yang dipakai pratinjau adendum", async () => {
    // 51,6 – angka inilah yang muncul sebagai "sudah dikerjakan 51.6" dan yang
    // membuat user bertanya "diinput kapan".
    const r = await riwayatInputItem(locationId, "II#2.b");
    expect(r!.total).toBeCloseTo(51.6, 3);
  });

  it("tiap baris menyebut TANGGAL KERJA dan KAPAN DIINPUT – dua hal berbeda", async () => {
    const r = await riwayatInputItem(locationId, "II#2.b");
    for (const b of r!.input) {
      expect(b.tanggal).toBeInstanceOf(Date);
      expect(b.diinputPada).toBeInstanceOf(Date);
    }
  });

  it("urut TERBARU DULU – yang dicari orang hampir selalu input terakhir", async () => {
    const r = await riwayatInputItem(locationId, "II#2.b");
    const tanggal = r!.input.map((b) => b.tanggal.toISOString().slice(0, 10));
    expect(tanggal).toEqual(["2026-08-03", "2026-07-14", "2026-07-10"]);
  });

  it("membawa identitas itemnya supaya layar tidak perlu query kedua", async () => {
    const r = await riwayatInputItem(locationId, "II#2.b");
    expect(r!.code).toBe("2.b");
    expect(r!.name).toContain("Pembesian");
    expect(r!.jalur).toContain("II");
    expect(r!.unit).toBe("kg");
    expect(r!.volumeKontrak).toBeCloseTo(634.51, 2);
  });

  it("menyebut pelapornya – 'siapa yang input' selalu jadi pertanyaan berikutnya", async () => {
    const r = await riwayatInputItem(locationId, "II#2.b");
    expect(r!.input[0].pelapor).toBe("Mandor Uji");
  });

  it("tiap baris membawa id laporannya supaya bisa dibuka langsung", async () => {
    const r = await riwayatInputItem(locationId, "II#2.b");
    for (const b of r!.input) expect(b.reportId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("item yang belum pernah dilaporkan mengembalikan riwayat KOSONG, bukan null", async () => {
    // Bedanya penting: null = itemnya tidak ada; kosong = ada tapi belum
    // dikerjakan. Menyamakan keduanya membuat layar bilang "item tidak
    // ditemukan" untuk pekerjaan yang jelas-jelas ada di kontrak.
    const rev = await db.rabRevision.findFirstOrThrow({ where: { locationId, status: "aktif" } });
    const kat = await db.rabNode.findFirstOrThrow({ where: { revisionId: rev.id, lineageKey: "II" } });
    await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "2.z", name: "Belum dikerjakan",
        volume: 5, unit: "m3", unitPrice: 1000, amount: 5000n, lineageKey: "II#2.z", sortOrder: 9,
      },
    });
    const r = await riwayatInputItem(locationId, "II#2.z");
    expect(r).not.toBeNull();
    expect(r!.input).toEqual([]);
    expect(r!.total).toBe(0);
  });

  it("lineageKey yang tidak dikenal sama sekali → null", async () => {
    expect(await riwayatInputItem(locationId, "TIDAK#ADA")).toBeNull();
  });
});

describe("cariItemBerealisasi – pintu masuknya", () => {
  it("mencari menurut NAMA, bukan hanya kode", async () => {
    const hit = await cariItemBerealisasi(locationId, "pembesian");
    expect(hit.map((h) => h.lineageKey)).toContain("II#2.b");
  });

  it("mencari menurut KODE juga – itu yang tercetak di daftar peringatan", async () => {
    const hit = await cariItemBerealisasi(locationId, "2.c");
    expect(hit.map((h) => h.lineageKey)).toContain("II#2.c");
  });

  it("tiap hasil menyebut cacah input dan tanggal input TERAKHIR", async () => {
    const hit = await cariItemBerealisasi(locationId, "pembesian");
    const besi = hit.find((h) => h.lineageKey === "II#2.b")!;
    expect(besi.jumlahInput).toBe(3);
    expect(besi.terakhir?.toISOString().slice(0, 10)).toBe("2026-08-03");
  });

  it("tanpa kata kunci, yang keluar item yang PUNYA realisasi – urut input terbaru", async () => {
    const hit = await cariItemBerealisasi(locationId, "");
    expect(hit.length).toBeGreaterThanOrEqual(2);
    expect(hit[0].lineageKey).toBe("II#2.b"); // input terakhir 3 Agustus
    expect(hit.every((h) => h.jumlahInput > 0)).toBe(true);
  });

  it("pencarian tidak peduli besar-kecil huruf", async () => {
    const a = await cariItemBerealisasi(locationId, "PEMBESIAN");
    expect(a.map((h) => h.lineageKey)).toContain("II#2.b");
  });
});
