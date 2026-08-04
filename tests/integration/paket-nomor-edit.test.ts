// NOMOR PAKET BISA DIKOREKSI SESUDAH BERKONTRAK (DECISIONS 249).
//
// Pertanyaan user 2026-08-04: "nomor itu saat ini bahkan bisa kosong, kenapa di
// halaman paket, nomor tidak ada editnya, apa aku yang terlewat?" — dan
// jawabannya: tidak terlewat, memang tidak ada.
//
// Form tender mengunci diri begitu paket punya kontrak (`praKontrak` false),
// sedangkan paket jalur cepat (bypass) LAHIR langsung berkontrak sehingga form
// itu tidak pernah muncul sekali pun. Akibatnya nomor paket yang kosong pada
// paket berkontrak mustahil diisi lewat UI mana pun.
//
// Yang dijaga berkas ini: jalur koreksinya benar-benar menulis ke basis data,
// DAN mengosongkan kembali tetap mungkin. Yang kedua itu yang mudah salah —
// pola `?? undefined` yang lazim dipakai di action lain justru membuat nilai
// kosong "hilang" sehingga nomor lama bertahan diam-diam, dan pengguna tidak
// punya cara membatalkan isian yang salah.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

let sessionUser = { id: "", orgId: "", role: "super_admin", fullName: "Tester" };

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => sessionUser,
  getCurrentUser: async () => sessionUser,
  requireCapability: async () => sessionUser,
  accessibleLocationIds: async () => null,
  requestIp: async () => null,
}));

const { db } = await import("@/lib/db");
const { editContractAction } = await import("@/lib/package/actions");

const suffix = `pn${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let packageId = "";

/** FormData lengkap; hanya `packageNumber` yang divariasikan tiap kasus. */
function form(packageNumber: string | null): FormData {
  const fd = new FormData();
  fd.set("packageId", packageId);
  fd.set("packageName", `Paket Uji ${suffix}`);
  if (packageNumber !== null) fd.set("packageNumber", packageNumber);
  fd.set("contractNumber", `KTR-${suffix}`);
  fd.set("contractValue", "1000000000");
  fd.set("ppnPercent", "11");
  fd.set("signedDate", "2026-01-05");
  fd.set("durationDays", "180");
  return fd;
}

async function nomorTersimpan(): Promise<string | null> {
  const p = await db.package.findUniqueOrThrow({
    where: { id: packageId },
    select: { packageNumber: true },
  });
  return p.packageNumber;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const u = await db.user.create({
    data: {
      orgId,
      fullName: "Tester",
      username: `tester-${suffix}`,
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = u.id;
  sessionUser = { id: userId, orgId, role: "super_admin", fullName: "Tester" };

  // Paket BERKONTRAK tanpa nomor paket — persis keadaan yang dikeluhkan
  // (jalur bypass melahirkan paket seperti ini).
  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });
  const pkg = await db.package.create({
    data: {
      orgId,
      name: `Paket Uji ${suffix}`,
      packageNumber: null,
      stage: "kontrak",
      hpsValue: 1_000_000_000n,
      createdById: userId,
    },
  });
  packageId = pkg.id;
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR-${suffix}`,
      contractValue: 1_000_000_000n,
      ppnPercent: 11,
      signedDate: new Date("2026-01-05"),
      durationDays: 180,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  await db.package.update({ where: { id: packageId }, data: { packageNumber: null } });
});

describe("koreksi nomor paket lewat form kontrak", () => {
  it("mengisi nomor pada paket yang SUDAH berkontrak", async () => {
    // Inti keluhannya: sebelum ini tidak ada satu pun jalan ke sini.
    const res = await editContractAction(undefined, form("PKT-2026-099"));
    expect(res?.error, res?.error).toBeUndefined();
    expect(await nomorTersimpan()).toBe("PKT-2026-099");
  });

  it("spasi tepi dirapikan, bukan disimpan apa adanya", async () => {
    await editContractAction(undefined, form("  PKT-2026-100  "));
    expect(await nomorTersimpan()).toBe("PKT-2026-100");
  });

  it("dikosongkan kembali BENAR-BENAR mengosongkan", async () => {
    /*
     * Yang paling mudah salah. Kalau nilai kosong diperlakukan "tidak diubah",
     * nomor yang terlanjur salah ketik tidak akan pernah bisa dicabut — dan
     * gejalanya diam: form tampak tersimpan, tapi nilai lamanya bertahan.
     */
    await editContractAction(undefined, form("PKT-SALAH"));
    expect(await nomorTersimpan()).toBe("PKT-SALAH");

    await editContractAction(undefined, form(""));
    expect(await nomorTersimpan()).toBeNull();
  });

  it("field tidak dikirim sama sekali juga berarti kosong", async () => {
    await editContractAction(undefined, form("PKT-SALAH"));
    await editContractAction(undefined, form(null));
    expect(await nomorTersimpan()).toBeNull();
  });

  it("spasi saja dihitung kosong, bukan nomor bernama spasi", async () => {
    await editContractAction(undefined, form("PKT-SALAH"));
    await editContractAction(undefined, form("   "));
    expect(await nomorTersimpan()).toBeNull();
  });

  it("koreksinya tercatat di audit log", async () => {
    // Mengubah identitas paket harus meninggalkan jejak siapa & kapan.
    await editContractAction(undefined, form("PKT-2026-101"));
    const log = await db.auditLog.findFirst({
      where: { action: "contract.edit", resourceType: "package", resourceId: packageId },
      orderBy: { createdAt: "desc" },
      select: { payload: true, userId: true },
    });
    expect(log?.userId).toBe(userId);
    expect((log?.payload as { packageNumber?: string })?.packageNumber).toBe("PKT-2026-101");
  });
});
