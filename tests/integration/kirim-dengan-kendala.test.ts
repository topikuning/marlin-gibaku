// KIRIM LAPORAN + KENDALA DALAM SATU AKSI (DECISIONS 341).
//
// `kirim-kendala.test.ts` sudah membuktikan aturan bacanya secara MURNI. Yang
// tidak bisa dibuktikan di sana adalah hal yang paling berbahaya di fitur ini:
// apa yang terjadi pada BASIS DATA ketika jawabannya cacat.
//
// Kegagalan yang dijaga: pelapor memilih "Ada kendala", judulnya kosong. Kalau
// aksi ini tetap meneruskan pengiriman, laporan berpindah ke `dikirim` tanpa
// kendalanya — pemeriksa membaca hari yang tampak lancar, padahal orangnya
// barusan menyatakan sebaliknya. Tidak ada galat yang terbit, dan tidak ada
// cara menariknya kembali sesudah diverifikasi.
//
// Karena itu yang diperiksa bukan sekadar "aksinya mengembalikan error",
// melainkan **statusnya masih draft** sesudahnya.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async () => pengguna(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");
const { submitReportAction } = await import("@/lib/daily-report/actions");

const suffix = `kk${Date.now().toString(36)}`;
let locationId = "";
let nodeId = "";
let userId = "";

async function pengguna() {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

/** Draft segar + satu item — laporan tanpa item tidak boleh dikirim. */
async function draftBerisi(tanggal: string) {
  const report = await getOrCreateDraft(locationId, tanggal, userId);
  await upsertItem(report.id, { rabNodeId: nodeId, volumeDone: 1, notes: null }, userId);
  return report;
}

function fd(v: Record<string, string>) {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 153,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-11-01"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug: `lok-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `mandor-${suffix}`,
      fullName: "Mandor Uji",
      role: "site_manager",
      passwordHash: "x",
    },
  });
  userId = u.id;

  // Bentuk RAB disalin dari `daily-report-flow.test.ts` — kategori + item leaf,
  // supaya `upsertItem` menemukan node yang sah.
  const rev = await db.rabRevision.create({
    data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI", amount: 100_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kat.id,
      kind: "item",
      code: "1",
      name: "Pasangan batu",
      volume: 100,
      unit: "m3",
      unitPrice: 1_000_000,
      amount: 100_000_000n,
      lineageKey: "I#1",
      sortOrder: 2,
    },
  });
  nodeId = node.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE issues, daily_report_items, daily_report_status_history, daily_reports,
     rab_nodes, rab_revisions, audit_logs, locations, contracts, vendors, packages, users,
     organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  await db.issue.deleteMany({ where: { locationId } });
});

describe('pilihan "tidak ada kendala"', () => {
  it("laporan terkirim, tidak ada kendala tercatat", async () => {
    const r = await draftBerisi("2026-06-02");
    const hasil = await submitReportAction(undefined,
      fd({ reportId: r.id, kendalaPilihan: "tidak_ada" }));
    expect(hasil?.success).toBeTruthy();
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("dikirim");
    expect(await db.issue.count({ where: { reportId: r.id } })).toBe(0);
  });
});

describe('pilihan "ada kendala"', () => {
  it("kendala tercatat DAN laporan terkirim — satu ketukan", async () => {
    const r = await draftBerisi("2026-06-03");
    const hasil = await submitReportAction(undefined,
      fd({
        reportId: r.id,
        kendalaPilihan: "ada",
        kendalaTitle: "hujan deras sejak siang",
        kendalaSeverity: "tinggi",
        kendalaDescription: "cor ditunda",
      }));
    expect(hasil?.success).toBeTruthy();
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("dikirim");
    const issues = await db.issue.findMany({ where: { reportId: r.id } });
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("hujan deras sejak siang");
    expect(issues[0].severity).toBe("tinggi");
    expect(issues[0].description).toBe("cor ditunda");
    // Kendala baru selalu TERBUKA — kalau langsung "selesai", ia tidak akan
    // pernah muncul di tanya-jawab WhatsApp maupun daftar tindakan.
    expect(issues[0].status).toBe("terbuka");
  });

  it('kendala dinyatakan tapi judulnya KOSONG → laporan TIDAK jadi terkirim', async () => {
    // Inti berkas ini. Meneruskan pengiriman di sini menghasilkan laporan yang
    // terbaca lancar padahal orangnya barusan menyatakan sebaliknya.
    const r = await draftBerisi("2026-06-04");
    const hasil = await submitReportAction(undefined,
      fd({ reportId: r.id, kendalaPilihan: "ada", kendalaTitle: "  " }));
    expect(hasil?.error).toBeTruthy();
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("draft");
    expect(await db.issue.count({ where: { reportId: r.id } })).toBe(0);
  });

  it("sesudah judulnya dibetulkan, kiriman yang sama berhasil", async () => {
    // Penolakan tadi tidak boleh meninggalkan laporan dalam keadaan yang tidak
    // bisa dikirim lagi.
    const r = await draftBerisi("2026-06-05");
    await submitReportAction(undefined, fd({ reportId: r.id, kendalaPilihan: "ada", kendalaTitle: "" }));
    const kedua = await submitReportAction(undefined,
      fd({ reportId: r.id, kendalaPilihan: "ada", kendalaTitle: "material telat", kendalaSeverity: "sedang" }));
    expect(kedua?.success).toBeTruthy();
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("dikirim");
    expect(await db.issue.count({ where: { reportId: r.id } })).toBe(1);
  });
});

describe("jalur lama tetap hidup", () => {
  it("kiriman tanpa medan kendala sama sekali tetap berhasil", async () => {
    // Kalau ini mati, setiap pemanggil lain (uji e2e, klien lama) ikut mati —
    // tanpa satu pun jaminan bertambah.
    const r = await draftBerisi("2026-06-06");
    const hasil = await submitReportAction(undefined, fd({ reportId: r.id }));
    expect(hasil?.success).toBeTruthy();
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("dikirim");
  });
});
