// LAPORAN HARI NIHIL YANG SUDAH FINAL HARUS TETAP MENYATAKANNYA.
//
// Cabang pratinjau `getKkpDailyData` merakit noActivity/noActivityReason/
// noActivityNote dari baris laporan; cabang FINAL merakit dokumennya dari
// `finalSnapshot`, yang tidak pernah membekukan ketiganya. Akibatnya blanko
// resmi — layar cetak, PDF harian, Excel, berkas mingguan, unggahan Drive —
// kehilangan baris "TIDAK ADA KEGIATAN" tepat pada versi FINAL, satu-satunya
// yang dikirim ke KKP; yang tersisa kolom realisasi kosong. DECISIONS 396
// melarang persis itu: "blanko yang dibiarkan kosong terbaca seperti ada yang
// lupa mengisi". Audit 2026-09-15 (A-1).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));
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
const { getKkpDailyData } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, setHariNihil, submitReport, approveReport, finalizeReport } = await import(
  "@/lib/daily-report/service"
);

const suffix = `nf${Date.now().toString(36)}`;
const HARI = "2026-06-10";

let orgId = "";
let mandorId = "";
let pmId = "";
let adminId = "";
let slug = "";
let reportId = "";

async function buatUser(nama: string, role: "site_manager" | "project_manager" | "super_admin") {
  return (
    await db.user.create({
      data: { orgId, username: `${nama}-${suffix}`, fullName: nama, passwordHash: "x", role },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org NF ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  mandorId = await buatUser("Mandor", "site_manager");
  pmId = await buatUser("PM", "project_manager");
  adminId = await buatUser("Admin", "super_admin");

  const vendor = await db.vendor.create({ data: { orgId, name: `PT Vendor NF ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId, name: `Paket NF ${suffix}`, stage: "pelaksanaan" } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `SPK-NF-${suffix}`,
      contractValue: 125_000_000n, signedDate: new Date("2026-05-25"), durationDays: 21,
      startDate: new Date("2026-06-01"), endDate: new Date("2026-06-21"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi Nihil", slug: `nihil-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
    select: { id: true, slug: true },
  });
  slug = loc.slug;

  const rev = await db.rabRevision.create({
    data: {
      locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif",
      totalValue: 125_000_000n, createdAt: new Date("2026-05-26"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: 125_000_000n, lineageKey: "I", sortOrder: 1,
    },
  });
  await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });

  const lap = await getOrCreateDraft(loc.id, HARI, mandorId);
  reportId = lap.id;
  await setHariNihil(lap.id, { nihil: true, alasan: "hujan", catatan: "deras sejak subuh" }, mandorId);
  await submitReport(lap.id, mandorId);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("pernyataan nihil bertahan melewati finalisasi", () => {
  it("pratinjau menyatakan hari nihil berikut sebabnya", async () => {
    const d = await getKkpDailyData(slug, HARI);
    if (!d) throw new Error("blanko harian tidak terbentuk");
    expect(d.noActivity).toBe(true);
    expect(d.noActivityReason).toBe("hujan");
    expect(d.noActivityNote).toBe("deras sejak subuh");
  });

  it("SESUDAH final, dokumen yang sama masih menyatakannya", async () => {
    await approveReport(reportId, pmId);
    await finalizeReport(reportId, adminId);

    const d = await getKkpDailyData(slug, HARI);
    if (!d) throw new Error("blanko harian tidak terbentuk");
    expect(d.isFinal).toBe(true);
    // Inti cacatnya: ketiganya dulu undefined di cabang final, jadi blanko
    // resmi mencetak kolom realisasi kosong tanpa satu kata penjelasan.
    expect(d.noActivity).toBe(true);
    expect(d.noActivityReason).toBe("hujan");
    expect(d.noActivityNote).toBe("deras sejak subuh");
  });
});
