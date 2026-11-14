// LAPORAN HARIAN IKUT SAKELAR TANDA TANGAN KETIK, BAWAAN MATI (DECISIONS 766) –
// terhadap DATABASE ASLI, sampai ke berkas PDF yang benar-benar dikirim.
//
// Permintaan user 2026-11-14: *"untuk fitur tanda tangan yang auto terisi, perlu
// toggle on/off dengan default off. yang kontrolnya ada di lokasi"*, lalu
// *"pastikan laporan harian juga tekontrol dengan toggle on off ini, dan pastikan
// default OFF"*.
//
// Uji pemuat (`ttd-ketik-muat`) menjaga sakelarnya di satu titik. Uji ini
// menjaga UJUNGNYA: laporan harian yang sudah disetujui, penanda tangannya
// bernama semua tanpa coretan diunggah, dirakit lewat jalur yang sama dengan
// unduhan, Drive, dan WhatsApp (`renderHarianKkpPdf`).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));
// R2 mati: tidak ada logo, foto, atau coretan unggahan yang bisa ikut tergambar.
// Gambar apa pun di PDF karenanya PASTI tanda tangan ketik.
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2PresignGet: async () => {
    throw new Error("R2 mati di uji");
  },
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
}));

const { db } = await import("@/lib/db");
const { renderHarianKkpPdf } = await import("@/lib/pdf/harian-kkp");
const { muatTtdLaporan } = await import("@/lib/export/ttd-laporan");
const { getOrCreateDraft, upsertItem, submitReport, approveReport } = await import("@/lib/daily-report/service");

const suffix = `th${Date.now().toString(36)}`;
const HARI = "2026-06-10";
let locationId = "";
let slug = "";

/** Banyaknya gambar (XObject) di PDF – di uji ini hanya tanda tangan ketik. */
const jumlahGambar = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const buatUser = async (nama: string, role: "site_manager" | "project_manager") =>
    (
      await db.user.create({
        data: { orgId: org.id, username: `${nama}-${suffix}`, fullName: nama, passwordHash: "x", role },
        select: { id: true },
      })
    ).id;
  const mandorId = await buatUser("mandor", "site_manager");
  const pmId = await buatUser("pm", "project_manager");

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Vendor ${suffix}` } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan", pelaksanaName: "Ahmad Pelaksana" },
  });
  // Ketiga pihak laporan harian BERNAMA, tidak satu pun mengunggah coretan.
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 21,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-21"),
      ppkName: "Ir. Pejabat Komitmen",
      wakilSahName: "Wakil Sah Harian",
      supervisorName: "Pengawas Harian",
      supervisorFirm: "PT Konsultan Harian",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Harian",
      slug: `harian-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true, slug: true },
  });
  locationId = loc.id;
  slug = loc.slug;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n, createdAt: new Date("2026-05-26") },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN", amount: 100_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kat.id,
      kind: "item",
      code: "1",
      name: "Galian",
      volume: 100,
      unit: "m3",
      unitPrice: 1_000_000,
      amount: 100_000_000n,
      lineageKey: "I#1",
      sortOrder: 2,
    },
    select: { id: true },
  });
  const lap = await getOrCreateDraft(locationId, HARI, mandorId);
  await upsertItem(lap.id, { rabNodeId: item.id, volumeDone: 5 }, mandorId);
  await submitReport(lap.id, mandorId);
  // Disetujui: hanya laporan disetujui/final yang bertanda tangan (DECISIONS 760),
  // jadi tanpa ini PDF tetap kosong dan uji "mati" lolos karena alasan yang salah.
  await approveReport(lap.id, pmId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("laporan harian mengikuti sakelar tanda tangan ketik lokasinya", () => {
  it("BAWAAN MATI: lokasi baru tidak menyalakannya", async () => {
    const l = await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { ttdKetik: true } });
    expect(l.ttdKetik).toBe(false);
  });

  it("mati: PDF harian yang disetujui terbit TANPA tanda tangan ketik; halaman cetak juga", async () => {
    const r = await renderHarianKkpPdf(slug, HARI, { tanpaSampul: true });
    expect(r).not.toBeNull();
    expect(jumlahGambar(r!.buffer)).toBe(0);
    const html = await muatTtdLaporan(locationId, "harian");
    // Nama tetap tercetak – untuk ditandatangani dengan pena.
    expect(html.ppk.nama).toBe("Wakil Sah Harian");
    expect([html.ppk.ttd, html.pengawas.ttd, html.penyedia.ttd]).toEqual([null, null, null]);
  });

  it("nyala: PDF harian yang sama memuat tanda tangan ketik; halaman cetak juga", async () => {
    await db.location.update({ where: { id: locationId }, data: { ttdKetik: true } });
    const r = await renderHarianKkpPdf(slug, HARI, { tanpaSampul: true });
    expect(jumlahGambar(r!.buffer)).toBeGreaterThanOrEqual(3);
    const html = await muatTtdLaporan(locationId, "harian");
    for (const pihak of ["ppk", "pengawas", "penyedia"] as const) {
      expect(html[pihak].ttd?.url, pihak).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("dimatikan lagi: kembali kosong – tidak ada yang tersimpan", async () => {
    await db.location.update({ where: { id: locationId }, data: { ttdKetik: false } });
    const r = await renderHarianKkpPdf(slug, HARI, { tanpaSampul: true });
    expect(jumlahGambar(r!.buffer)).toBe(0);
  });
});
