// Koreksi susunan lokasi paket BERKONTRAK (DECISIONS 187) — lokasi ketinggalan
// saat input, nilai kontrak sudah benar, jadi BUKAN adendum.
//
// Yang dikunci di sini adalah pagar-pagarnya, karena jalur ini melewati aturan
// "komposisi lokasi terkunci setelah berkontrak": super_admin saja, alasan
// wajib, hanya sampai tahap pelaksanaan, tolak lokasi ganda, nilai kontrak
// tidak tersentuh, dan setiap koreksi meninggalkan jejak audit + histori.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  return {
    requestIp: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new Error(`Tidak punya izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
    accessibleLocationIds: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
  };
});

const { db } = await import("@/lib/db");
const { correctAddLocationAction } = await import("@/lib/package/actions");

const suffix = `kl${Date.now().toString(36)}`;
let orgId = "";
let vendorId = "";
let seq = 0;

/** FormData ringkas untuk action. */
function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Paket + kontrak dengan N lokasi. Nilai kontrak sengaja "sudah benar". */
async function buatPaketBerkontrak(opts: {
  stage?: string;
  lokasi: string[];
  nilai?: bigint;
}) {
  seq += 1;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${seq} ${suffix}`, stage: (opts.stage ?? "pelaksanaan") as never },
  });
  for (const desa of opts.lokasi) {
    await db.location.create({
      data: {
        packageId: pkg.id,
        name: desa,
        slug: `${desa.toLowerCase()}-${suffix}-${seq}`,
        village: desa,
        regency: "Banyuwangi",
        province: "Jawa Timur",
        isActive: true,
      },
    });
  }
  const contract = await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId,
      contractNumber: `K-${seq}-${suffix}`,
      contractValue: opts.nilai ?? 3_000_000_000n,
      ppnPercent: 11,
      signedDate: new Date("2026-05-01T00:00:00Z"),
      durationDays: 150,
    },
  });
  return { pkgId: pkg.id, contractId: contract.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KL ${suffix}`, slug: `kl-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  const u = await db.user.create({
    data: { orgId, username: `kl-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sessionUserId = u.id;
  const v = await db.vendor.create({ data: { orgId, name: `PT Uji ${suffix}` } });
  vendorId = v.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(() => {
  role = "super_admin";
});

const ALASAN = "lokasi ke-3 terlewat saat input kontrak, nilai kontrak sudah mencakup 3 lokasi";

describe("kasus nyata: 3 lokasi terinput 2", () => {
  it("menambah lokasi yang ketinggalan tanpa menyentuh nilai kontrak", async () => {
    const { pkgId, contractId } = await buatPaketBerkontrak({
      lokasi: ["Kedungrejo", "Pesisir"],
      nilai: 3_000_000_000n,
    });

    const res = await correctAddLocationAction(
      undefined,
      fd({
        packageId: pkgId,
        name: "Tanjungsari",
        village: "Tanjungsari",
        regency: "Banyuwangi",
        province: "Jawa Timur",
        reason: ALASAN,
      }),
    );
    expect(res?.error).toBeUndefined();
    expect(res?.success).toMatch(/Tanjungsari/);
    // Peringatan wajib: koreksi belum selesai sampai RAB lokasi baru diimpor.
    expect(res?.warning).toMatch(/RAB/i);

    const locs = await db.location.findMany({ where: { packageId: pkgId }, orderBy: { name: "asc" } });
    expect(locs).toHaveLength(3);
    const baru = locs.find((l) => l.name === "Tanjungsari")!;
    // Paket sudah berkontrak → lokasi koreksi langsung aktif, status persiapan.
    expect(baru.isActive).toBe(true);
    expect(baru.status).toBe("persiapan");

    // NILAI KONTRAK TIDAK BOLEH BERUBAH — inti kenapa ini bukan adendum.
    const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(c.contractValue).toBe(3_000_000_000n);
    expect(await db.contractAmendment.count({ where: { contractId } })).toBe(0);
  });

  it("meninggalkan jejak audit + histori paket yang menyebut alasannya", async () => {
    const { pkgId } = await buatPaketBerkontrak({ lokasi: ["Alfa"] });
    await correctAddLocationAction(
      undefined,
      fd({
        packageId: pkgId,
        name: "Beta",
        village: "Beta",
        regency: "Banyuwangi",
        province: "Jawa Timur",
        reason: ALASAN,
      }),
    );

    const log = await db.auditLog.findFirst({
      where: { action: "package.location_correct_add", resourceId: pkgId },
      select: { payload: true, userId: true },
    });
    expect(log?.userId).toBe(sessionUserId);
    expect(log?.payload).toMatchObject({ sumber: "manual", alasan: ALASAN });

    const hist = await db.packageStageHistory.findFirst({
      where: { packageId: pkgId },
      orderBy: { changedAt: "desc" },
    });
    expect(hist?.note).toMatch(/Koreksi data \(bukan adendum\)/);
    expect(hist?.note).toContain("Beta");
    // Stage tidak berubah — ini koreksi, bukan transisi.
    expect(hist?.fromStage).toBe(hist?.toStage);
  });
});

describe("pagar akses & tahap", () => {
  it("ditolak untuk semua role selain super_admin (termasuk program_director)", async () => {
    const { pkgId } = await buatPaketBerkontrak({ lokasi: ["Gamma"] });
    for (const r of ["program_director", "regional_manager", "project_manager", "site_manager"]) {
      role = r;
      await expect(
        correctAddLocationAction(
          undefined,
          fd({
            packageId: pkgId,
            name: "Delta",
            village: "Delta",
            regency: "Kab",
            province: "Prov",
            reason: ALASAN,
          }),
        ),
      ).rejects.toThrow(/izin/i);
    }
    expect(await db.location.count({ where: { packageId: pkgId } })).toBe(1);
  });

  it("alasan wajib & bermakna (minimal 10 karakter)", async () => {
    const { pkgId } = await buatPaketBerkontrak({ lokasi: ["Epsilon"] });
    for (const reason of ["", "salah"]) {
      const res = await correctAddLocationAction(
        undefined,
        fd({
          packageId: pkgId,
          name: "Zeta",
          village: "Zeta",
          regency: "Kab",
          province: "Prov",
          reason,
        }),
      );
      expect(res?.error).toMatch(/[Aa]lasan/);
    }
    expect(await db.location.count({ where: { packageId: pkgId } })).toBe(1);
  });

  it("paket PRA-KONTRAK diarahkan ke jalur normal, bukan koreksi", async () => {
    seq += 1;
    const pkg = await db.package.create({ data: { orgId, name: `Prospek ${suffix}`, stage: "tender" } });
    const res = await correctAddLocationAction(
      undefined,
      fd({
        packageId: pkg.id,
        name: "Eta",
        village: "Eta",
        regency: "Kab",
        province: "Prov",
        reason: ALASAN,
      }),
    );
    expect(res?.error).toMatch(/belum berkontrak/i);
  });

  it("ditolak setelah serah terima / selesai", async () => {
    for (const stage of ["serah_terima", "selesai"]) {
      const { pkgId } = await buatPaketBerkontrak({ stage, lokasi: ["Theta"] });
      const res = await correctAddLocationAction(
        undefined,
        fd({
          packageId: pkgId,
          name: "Iota",
          village: "Iota",
          regency: "Kab",
          province: "Prov",
          reason: ALASAN,
        }),
      );
      expect(res?.error, stage).toMatch(/pelaksanaan/i);
      expect(await db.location.count({ where: { packageId: pkgId } })).toBe(1);
    }
  });

  it("paket organisasi lain tidak bisa dikoreksi", async () => {
    const lain = await db.organization.create({
      data: { name: `Org lain ${suffix}`, slug: `lain-${suffix}` },
    });
    const pkgLain = await db.package.create({
      data: { orgId: lain.id, name: `Paket lain ${suffix}`, stage: "pelaksanaan" },
    });
    const res = await correctAddLocationAction(
      undefined,
      fd({
        packageId: pkgLain.id,
        name: "Kappa",
        village: "Kappa",
        regency: "Kab",
        province: "Prov",
        reason: ALASAN,
      }),
    );
    expect(res?.error).toMatch(/tidak ditemukan/i);
  });

  it("menolak lokasi yang sudah ada (cegah ganda)", async () => {
    const { pkgId } = await buatPaketBerkontrak({ lokasi: ["Lambda"] });
    const res = await correctAddLocationAction(
      undefined,
      fd({
        packageId: pkgId,
        name: "Lambda",
        village: "Lambda",
        regency: "Banyuwangi",
        province: "Jawa Timur",
        reason: ALASAN,
      }),
    );
    expect(res?.error).toMatch(/sudah ada/i);
    expect(await db.location.count({ where: { packageId: pkgId } })).toBe(1);
  });

  it("isian manual tidak lengkap ditolak sebelum menyentuh DB", async () => {
    const { pkgId } = await buatPaketBerkontrak({ lokasi: ["Mu"] });
    const res = await correctAddLocationAction(
      undefined,
      fd({ packageId: pkgId, name: "Nu", reason: ALASAN }),
    );
    expect(res?.error).toMatch(/katalog|isi nama/i);
    expect(await db.location.count({ where: { packageId: pkgId } })).toBe(1);
  });
});

describe("sumber katalog master", () => {
  it("mengambil data dari katalog & menandai master terpakai", async () => {
    const { pkgId } = await buatPaketBerkontrak({ lokasi: ["Xi"] });
    const master = await db.masterLocation.create({
      data: {
        orgId,
        province: "Jawa Tengah",
        regency: "Pemalang",
        district: "Ulujami",
        village: `Omicron ${suffix}`,
      },
    });

    const res = await correctAddLocationAction(
      undefined,
      fd({ packageId: pkgId, masterLocationId: master.id, reason: ALASAN }),
    );
    expect(res?.error).toBeUndefined();

    const baru = await db.location.findFirstOrThrow({
      where: { packageId: pkgId, village: `Omicron ${suffix}` },
    });
    expect(baru.regency).toBe("Pemalang");
    expect(baru.district).toBe("Ulujami");
    expect(baru.isActive).toBe(true);

    const m = await db.masterLocation.findUniqueOrThrow({ where: { id: master.id } });
    expect(m.assignedLocationId).toBe(baru.id);
  });

  it("menolak lokasi katalog yang sudah dipakai proyek lain", async () => {
    const { pkgId: pkgA } = await buatPaketBerkontrak({ lokasi: ["Pi"] });
    const { pkgId: pkgB } = await buatPaketBerkontrak({ lokasi: ["Rho"] });
    const master = await db.masterLocation.create({
      data: { orgId, province: "Prov", regency: "Kab", village: `Sigma ${suffix}` },
    });
    await correctAddLocationAction(
      undefined,
      fd({ packageId: pkgA, masterLocationId: master.id, reason: ALASAN }),
    );
    const res = await correctAddLocationAction(
      undefined,
      fd({ packageId: pkgB, masterLocationId: master.id, reason: ALASAN }),
    );
    expect(res?.error).toMatch(/sudah dipakai/i);
  });
});
