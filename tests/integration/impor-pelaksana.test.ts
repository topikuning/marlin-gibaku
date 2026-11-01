// Impor laporan harian buatan pelaksana → draft laporan harian (DECISIONS 733).
//
// Pengambil teks PDF ditiru dengan potongan teks laporan Modis 1 November
// (tests/fixtures/laporan-pelaksana). Yang dibuktikan dengan DB sungguhan:
//  - pratinjau mencocokkan uraian ke item RAB dan MENAHAN volume di atas sisa;
//  - penyimpanan lewat layanan laporan harian biasa – penjaga sisa RAB tetap
//    menolak walau baris yang ditahan dikirim juga;
//  - tenaga kerja diganti, alat ditambahkan tanpa kembar, cuaca tidak disentuh;
//  - laporan yang sudah dikirim tidak bisa diisi dari berkas;
//  - format tak dikenali tanpa AI → pesan yang jelas, bukan galat mentah.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PotongTeks } from "@/lib/daily-report/impor-pelaksana/bentuk";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const MODIS: PotongTeks[] = JSON.parse(readFileSync("tests/fixtures/laporan-pelaksana/modis-1-nov.json", "utf8"));
let teksTiruan: PotongTeks[] = MODIS;
vi.mock("@/lib/daily-report/impor-pelaksana/teks-pdf", () => ({
  teksHalamanPertama: async () => ({ items: teksTiruan, halaman: 2 }),
}));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { pratinjauImporPelaksana, simpanImporPelaksana, ImporPelaksanaError } = await import(
  "@/lib/daily-report/impor-pelaksana/proses"
);
const { hitungStatus } = await import("@/lib/daily-report/impor-pelaksana/cocok");
import type { FlatNode } from "@/lib/rab/flatten";

const suffix = `ip${Date.now().toString(36)}`;
const TANGGAL = "2026-10-20";
const PDF = Buffer.from("%PDF-1.4 tiruan");
let orgId: string;
let userId: string;
let locationId: string;
let idGalian: string;
let idUrugan: string;

const item = (code: string, name: string, volume: number, unitPrice: number, sortOrder: number): FlatNode => ({
  kind: "item",
  code,
  name,
  volume,
  unit: "m³",
  unitPrice,
  amount: BigInt(Math.round(volume * unitPrice)),
  lineageKey: `I#${code}`,
  parentLineageKey: "I",
  sortOrder,
  excelRow: null,
});

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org IP ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  userId = (await db.user.create({ data: { orgId, username: `ip-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })).id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket IP ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Modis", slug: `modis-${suffix}`, village: "Modis", regency: "Bolsel", province: "Sulut", status: "berjalan", isActive: true },
  });
  locationId = loc.id;
  const galian = item("1", "Pekerjaan Galian Tanah Keras Sedalam 1 m", 100, 50_000, 1);
  const urugan = item("2", "Pekerjaan Urugan Tanah Mendatangkan", 30, 80_000, 2);
  const nodes: FlatNode[] = [
    { kind: "kategori", code: "I", name: "PEKERJAAN TANAH", volume: null, unit: null, unitPrice: null, amount: galian.amount + urugan.amount, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
    galian,
    urugan,
  ];
  const rev = await createRevisionFromNodes(locationId, nodes, { source: "hps_awal", userId, note: "kontrak" });
  await activateRevision(rev.revisionId, userId);
  const n = await db.rabNode.findMany({ where: { revisionId: rev.revisionId, kind: "item" }, select: { id: true, code: true } });
  idGalian = n.find((x) => x.code === "1")!.id;
  idUrugan = n.find((x) => x.code === "2")!.id;
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("pratinjau", () => {
  it("templat dikenali; uraian dicocokkan; volume di atas sisa RAB DITAHAN; tanggal berkas yang lain disebut", async () => {
    const p = await pratinjauImporPelaksana({ locationId, dateKey: TANGGAL, buf: PDF, nama: "Laporan_Harian_1_November_2026.pdf", mime: "application/pdf" });
    expect(p.sumber).toBe("templat_kkp");
    expect(p.baris.map((b) => [b.kandidatId, b.volume])).toEqual([
      [idGalian, 46.08],
      [idUrugan, 40.6],
    ]);
    expect(hitungStatus(p.baris, p.kandidat).map((s) => s.status)).toEqual(["siap", "melebihi"]);
    expect(p.peringatan.join(" ")).toMatch(/1 November 2026, sedangkan laporan yang dibuka 20 Oktober 2026/);
    expect(p.tenaga.workers).toEqual([
      { role: "site_manager", count: 1 },
      { role: "operator", count: 1 },
    ]);
    expect(p.bahan.map((b) => [b.nama, b.jenis, b.qty])).toEqual([["Excavator Pc 200 (Hitachi)", "alat", 1]]);
    expect(p.laporan).toEqual({ ada: false, status: null, bisaDiisi: true, adaTenaga: false });
    // Pratinjau tidak menulis apa pun.
    expect(await db.dailyReport.count({ where: { locationId } })).toBe(0);
  });
});

describe("simpan", () => {
  it("baris siap masuk draft; baris di atas sisa tetap DITOLAK penjaga layanan walau ikut dikirim", async () => {
    const h = await simpanImporPelaksana(
      locationId,
      TANGGAL,
      {
        berkas: "Laporan_Harian_1_November_2026.pdf",
        sumber: "templat_kkp",
        baris: [
          { kandidatId: idGalian, volume: 46.08, uraian: "Pekerjaan Galian Tanah Keras Sedalam 1 M", catatan: "Selasai Dikerjakan" },
          { kandidatId: idUrugan, volume: 40.6, uraian: "Pekerjaan Urugan Tanah Mendatangkan", catatan: null },
        ],
        tenaga: [
          { role: "site_manager", count: 1 },
          { role: "operator", count: 1 },
        ],
        bahan: [{ jenis: "alat", nama: "Excavator Pc 200 (Hitachi)", qty: 1, satuan: "Unit" }],
      },
      userId,
    );
    expect(h.tersimpan).toBe(1);
    expect(h.ditolak).toHaveLength(1);
    expect(h.ditolak[0].pesan).toMatch(/melebihi sisa RAB/i);
    expect([h.tenagaDiganti, h.bahanDitambah, h.galatPelengkap]).toEqual([true, 1, null]);

    const lap = await db.dailyReport.findUniqueOrThrow({
      where: { id: h.reportId },
      select: {
        status: true,
        weatherSource: true,
        items: { select: { rabNodeId: true, volumeDone: true, notes: true, basis: true } },
        workers: { select: { role: true, count: true }, orderBy: { role: "asc" } },
        equipment: { select: { name: true, count: true } },
      },
    });
    expect(lap.status).toBe("draft");
    expect(lap.items.map((i) => [i.rabNodeId, Number(i.volumeDone), i.basis])).toEqual([[idGalian, 46.08, "aktif"]]);
    expect(lap.items[0].notes).toBe("Dari laporan pelaksana: Pekerjaan Galian Tanah Keras Sedalam 1 M (Selasai Dikerjakan)");
    expect(lap.workers).toEqual([
      { role: "site_manager", count: 1 },
      { role: "operator", count: 1 },
    ]);
    expect(lap.equipment).toEqual([{ name: "Excavator Pc 200 (Hitachi)", count: 1 }]);
    // Cuaca tidak dikirim impor – tetap kosong, tidak ditimpa.
    expect(lap.weatherSource).toBeNull();
    const jejak = await db.auditLog.findFirstOrThrow({ where: { action: "daily_report.impor_pelaksana", resourceId: h.reportId } });
    expect(jejak.payload).toMatchObject({ tersimpan: 1, ditolak: 1, tenagaDiganti: true, bahanDitambah: 1 });
  });

  it("impor kedua: alat bernama sama tidak digandakan; tenaga null = tidak diubah; item yang sama DIGANTI, bukan ditambah", async () => {
    const h = await simpanImporPelaksana(
      locationId,
      TANGGAL,
      {
        berkas: "ulang.pdf",
        sumber: "templat_kkp",
        baris: [{ kandidatId: idGalian, volume: 50, uraian: "Galian", catatan: null }],
        tenaga: null,
        bahan: [{ jenis: "alat", nama: "excavator pc 200 (hitachi)", qty: 1, satuan: "Unit" }],
      },
      userId,
    );
    expect([h.tersimpan, h.bahanDitambah]).toEqual([1, 0]);
    const lap = await db.dailyReport.findUniqueOrThrow({
      where: { id: h.reportId },
      select: { items: { select: { volumeDone: true } }, workers: true, equipment: true },
    });
    expect(lap.items.map((i) => Number(i.volumeDone))).toEqual([50]);
    expect(lap.workers).toHaveLength(2);
    expect(lap.equipment).toHaveLength(1);
  });

  it("pratinjau sesudah impor menyebut item yang sudah ada di laporan (akan diganti)", async () => {
    const p = await pratinjauImporPelaksana({ locationId, dateKey: TANGGAL, buf: PDF, nama: "x.pdf", mime: "application/pdf" });
    expect(p.kandidat.find((k) => k.id === idGalian)?.diLaporan).toBe(50);
    expect(p.laporan).toMatchObject({ ada: true, status: "draft", bisaDiisi: true, adaTenaga: true });
  });
});

describe("batas", () => {
  it("laporan yang sudah dikirim: pratinjau menyebutnya, simpan ditolak", async () => {
    const tanggal = "2026-10-19";
    const lap = await db.dailyReport.create({
      data: { locationId, reportDate: new Date(`${tanggal}T00:00:00.000Z`), status: "dikirim", createdById: userId },
    });
    const p = await pratinjauImporPelaksana({ locationId, dateKey: tanggal, buf: PDF, nama: "x.pdf", mime: "application/pdf" });
    expect(p.laporan.bisaDiisi).toBe(false);
    expect(p.peringatan[0]).toMatch(/sudah dikirim/);
    await expect(
      simpanImporPelaksana(locationId, tanggal, { berkas: "x.pdf", sumber: "templat_kkp", baris: [], tenaga: null, bahan: [] }, userId),
    ).rejects.toBeInstanceOf(ImporPelaksanaError);
    expect(await db.dailyReportItem.count({ where: { reportId: lap.id } })).toBe(0);
  });

  it("bukan PDF ditolak; format tak dikenali tanpa AI → pesan yang jelas", async () => {
    await expect(
      pratinjauImporPelaksana({ locationId, dateKey: TANGGAL, buf: PDF, nama: "laporan.xlsx", mime: "application/vnd.ms-excel" }),
    ).rejects.toThrow(/Baru berkas PDF/);
    teksTiruan = [{ s: "SURAT JALAN MATERIAL", x: 50, y: 60, w: 120 }];
    try {
      await expect(
        pratinjauImporPelaksana({ locationId, dateKey: TANGGAL, buf: PDF, nama: "lain.pdf", mime: "application/pdf" }),
      ).rejects.toThrow(/Format laporan ini belum dikenali MARLIN\. AI belum disiapkan/);
    } finally {
      teksTiruan = MODIS;
    }
  });
});
