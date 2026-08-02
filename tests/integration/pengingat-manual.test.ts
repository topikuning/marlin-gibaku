// Tombol admin "Kirim pengingat sekarang" + pratinjaunya (DECISIONS 205).
//
// Permintaan user 2026-08-01: "buat juga satu tombol untuk eksekusi pengingat
// semua orang, dari admin."
//
// Yang diuji bukan cuma "terkirim", tapi tiga hal yang bisa melukai orang:
//   1. tombol ini mengirim WA ke HP orang lapangan → hanya boleh dipegang
//      pengelola sistem;
//   2. ditekan dua kali TIDAK boleh mengirim pesan dobel;
//   3. pratinjaunya harus menunjukkan orang yang SAMA dengan yang benar-benar
//      dikirimi — pratinjau yang meleset lebih buruk daripada tidak ada.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terkirim: { chatId: string; text: string }[] = [];
let wahaAktif = true;
let statusSesi = "WORKING";
vi.mock("@/lib/waha/client", () => ({
  isWahaConfigured: async () => wahaAktif,
  getSessionStatus: async () => ({ name: "default", status: statusSesi }),
  sendText: async (chatId: string, text: string) => {
    terkirim.push({ chatId, text });
    return "MSGID";
  },
}));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Admin" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { kirimPengingatSekarangAction } = await import("@/lib/harian/actions");
const { pratinjauPengingat } = await import("@/lib/harian/pratinjau");
const { jakartaDateKey } = await import("@/lib/format");

const suffix = `pm${Date.now().toString(36)}`;
const NOMOR = "628999000111";
let orgId = "";
let mandorId = "";
let tanpaNomorId = "";
let lokasiId = "";
const hariIni = jakartaDateKey(new Date());

const punyaKita = () => terkirim.filter((t) => t.chatId === NOMOR);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  sessionOrgId = org.id;
  sessionUserId = (
    await db.user.create({
      data: { orgId, username: `adm-${suffix}`, fullName: "Admin", role: "super_admin", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  mandorId = (
    await db.user.create({
      data: {
        orgId,
        username: `md-${suffix}`,
        fullName: "Paijo Sutrisno",
        role: "field_supervisor",
        passwordHash: "x",
        waNumber: NOMOR,
      },
      select: { id: true },
    })
  ).id;
  tanpaNomorId = (
    await db.user.create({
      data: { orgId, username: `nw-${suffix}`, fullName: "Tanpa Nomor", role: "site_manager", passwordHash: "x" },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId, name: `CV ${suffix}` }, select: { id: true } });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  await db.contract.create({
    data: {
      package: { connect: { id: pkg.id } },
      vendor: { connect: { id: vendor.id } },
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000n,
      signedDate: new Date("2026-01-01"),
      durationDays: 200,
      startDate: new Date("2026-01-05"),
      endDate: new Date("2026-12-31"),
    },
  });
  const l = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Pengaradan",
      slug: `pengaradan-${suffix}`,
      village: "Pengaradan",
      regency: "Brebes",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  lokasiId = l.id;
  await db.locationAssignment.create({ data: { userId: mandorId, locationId: lokasiId } });
  await db.locationAssignment.create({ data: { userId: tanpaNomorId, locationId: lokasiId } });
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  terkirim.length = 0;
  wahaAktif = true;
  statusSesi = "WORKING";
  role = "super_admin";
  await db.dailyReminderLog.deleteMany({ where: { userId: { in: [mandorId, tanpaNomorId] } } });
});

describe("KASUS INTI: admin bisa menagih semua orang tanpa menunggu penjadwal", () => {
  it("satu tekan → pesan benar-benar terkirim ke penanggung jawab", async () => {
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(res?.error).toBeUndefined();
    expect(res?.success).toMatch(/terkirim/i);
    expect(punyaKita()).toHaveLength(1);
    expect(punyaKita()[0].text).toContain("Pengaradan");
  });

  it("ditekan DUA KALI tidak mengirim pesan dobel ke HP orang lapangan", async () => {
    await kirimPengingatSekarangAction(undefined, new FormData());
    const res2 = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(punyaKita()).toHaveLength(1);
    // Dan itu DIKATAKAN, bukan diam-diam terlihat seperti gagal.
    expect(res2?.success).toMatch(/sudah dikirim hari ini/i);
  });

  it("tercatat di audit — pengiriman ke orang lain harus punya jejak pelakunya", async () => {
    await kirimPengingatSekarangAction(undefined, new FormData());
    const log = await db.auditLog.findFirst({
      where: { action: "reminder.manual_send", userId: sessionUserId },
      orderBy: { createdAt: "desc" },
      select: { userId: true, payload: true },
    });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(sessionUserId);
    expect((log!.payload as { terkirim?: number }).terkirim).toBeGreaterThanOrEqual(1);
  });
});

describe("pagar tombol", () => {
  it("peran tanpa system.manage DITOLAK — bukan cuma menunya disembunyikan", async () => {
    for (const r of ["project_manager", "site_manager", "field_supervisor", "wakil_ppk"]) {
      role = r;
      const res = await kirimPengingatSekarangAction(undefined, new FormData());
      expect(res?.error).toMatch(/izin/i);
      expect(punyaKita()).toHaveLength(0);
    }
  });

  it("WAHA mati → ditolak dengan alasan, dan TIDAK menghanguskan jatah hari ini", async () => {
    wahaAktif = false;
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(res?.error).toMatch(/WAHA|WhatsApp/i);
    expect(await db.dailyReminderLog.count({ where: { userId: mandorId, dateKey: hariIni } })).toBe(0);

    // Setelah WAHA hidup, pengiriman hari ini masih bisa dilakukan.
    wahaAktif = true;
    await kirimPengingatSekarangAction(undefined, new FormData());
    expect(punyaKita()).toHaveLength(1);
  });
});

describe("sesi WhatsApp mati = kegagalan senyap, harus dikatakan", () => {
  it("tombol menolak dengan menyebut status sesinya, tanpa mengunci hari itu", async () => {
    statusSesi = "SCAN_QR_CODE";
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(res?.error).toMatch(/SCAN_QR_CODE/);
    expect(punyaKita()).toHaveLength(0);
    expect(await db.dailyReminderLog.count({ where: { userId: mandorId, dateKey: hariIni } })).toBe(0);
  });

  it("pratinjau menyebut status sesi supaya admin tahu SEBELUM menekan", async () => {
    statusSesi = "FAILED";
    expect((await pratinjauPengingat(orgId)).sesiStatus).toBe("FAILED");
    statusSesi = "WORKING";
    expect((await pratinjauPengingat(orgId)).sesiStatus).toBe("WORKING");
  });
});

describe("pratinjau menunjukkan yang SAMA dengan yang akan dikirim", () => {
  it("menyebut nama, lokasi, dan keadaan laporannya", async () => {
    const p = await pratinjauPengingat(orgId);
    const kita = p.akanDitagih.find((x) => x.nama === "Paijo Sutrisno");
    expect(kita).toBeDefined();
    expect(kita!.lokasi).toContain("Pengaradan");
    expect(kita!.adaDraft[0]).toBe(false); // belum ada laporan sama sekali
  });

  it("penanggung jawab TANPA nomor WA disebut namanya — 'terkirim 1' bukan berarti semua tertagih", async () => {
    const p = await pratinjauPengingat(orgId);
    expect(p.tanpaNomor).toContain("Tanpa Nomor");
  });

  it("setelah dikirim, orangnya pindah dari 'akan ditagih' ke 'sudah dikirim'", async () => {
    await kirimPengingatSekarangAction(undefined, new FormData());
    const p = await pratinjauPengingat(orgId);
    expect(p.akanDitagih.some((x) => x.nama === "Paijo Sutrisno")).toBe(false);
    const sudah = p.sudahDikirim.find((x) => x.nama === "Paijo Sutrisno");
    expect(sudah).toBeDefined();
    expect(sudah!.status).toBe("sukses");
  });

  it("laporan yang sudah dikirim lapangan → orangnya tidak ditagih lagi", async () => {
    const laporan = await db.dailyReport.create({
      data: {
        locationId: lokasiId,
        reportDate: new Date(`${hariIni}T00:00:00.000Z`),
        status: "dikirim",
        createdById: mandorId,
        submittedById: mandorId,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    try {
      const p = await pratinjauPengingat(orgId);
      expect(p.akanDitagih.some((x) => x.nama === "Paijo Sutrisno")).toBe(false);
      const res = await kirimPengingatSekarangAction(undefined, new FormData());
      expect(res?.error).toBeUndefined();
      expect(punyaKita()).toHaveLength(0);
    } finally {
      await db.dailyReport.delete({ where: { id: laporan.id } });
    }
  });
});
