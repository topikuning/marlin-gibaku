// PENGHAPUSAN KENDALA TIDAK BOLEH MUNGKIN TANPA JEJAK (DECISIONS 394, AUDIT-01).
//
// Berkas terpisah karena ia perlu MERUSAK penulisan audit, dan mock itu tidak
// boleh mencemari uji kendala lain di berkas sebelah.
//
// Versi pertama `hapusKendala` menulis audit lebih dulu lalu menghapus, dengan
// komentar yang mengaku aman. Itu KELIRU: `audit()` menelan galatnya sendiri,
// jadi kalau tulisannya gagal, penghapusannya tetap jalan dan tidak
// meninggalkan apa-apa. Ketahuan waktu uji gigi — merusak urutannya tidak
// memerahkan satu uji pun.
//
// Yang diuji di sini bukan urutan, melainkan JAMINANNYA: gagal menulis jejak =
// penghapusan dibatalkan.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
    requireUser: async () => penggunaUji(),
    requireCapability: async () => penggunaUji(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

/** Penulisan audit yang bisa dibuat gagal sesuka uji. */
let auditGagal = false;
vi.mock("@/lib/audit", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/audit")>();
  return {
    ...asli,
    auditIn: async (...args: Parameters<typeof asli.auditIn>) => {
      if (auditGagal) throw new Error("audit sengaja digagalkan");
      return asli.auditIn(...args);
    },
  };
});

const { db } = await import("@/lib/db");
const { hapusKendala } = await import("@/lib/issues");

const suffix = `ha${Date.now().toString(36)}`;
let locationId = "";
let userId = "";

async function penggunaUji() {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, orgId: true, username: true, email: true,
      fullName: true, role: true, mustChangePassword: true,
    },
  });
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
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug: `lok-${suffix}`,
      village: "D",
      regency: "K",
      province: "P",
      isActive: true,
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `adm-${suffix}`,
      fullName: "Admin Uji",
      role: "super_admin",
      passwordHash: "x",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE issues, audit_logs, locations, packages, users, organizations
     RESTART IDENTITY CASCADE`,
  );
});

describe("hapusKendala bersifat atomik dengan jejaknya", () => {
  it("REGRESI: jejak gagal ditulis → kendala TIDAK jadi dihapus", async () => {
    const i = await db.issue.create({
      data: { locationId, title: "Salah ketik", severity: "sedang", status: "terbuka" },
    });

    auditGagal = true;
    const r = await hapusKendala(undefined, fd({ issueId: i.id, alasan: "salah ketik" }));
    auditGagal = false;

    expect(r?.error).toBeTruthy();
    // Inilah jaminannya: penghapusan permanen tanpa jejak tidak boleh mungkin.
    expect(await db.issue.findUnique({ where: { id: i.id } })).not.toBeNull();
  });

  it("jejak berhasil ditulis → kendala dihapus, jejaknya ada", async () => {
    const i = await db.issue.create({
      data: { locationId, title: "Salah lokasi", severity: "sedang", status: "terbuka" },
    });
    const r = await hapusKendala(undefined, fd({ issueId: i.id, alasan: "salah lokasi" }));

    expect(r?.error).toBeUndefined();
    expect(await db.issue.findUnique({ where: { id: i.id } })).toBeNull();
    expect(
      await db.auditLog.count({ where: { action: "issue.hapus", resourceId: i.id } }),
    ).toBe(1);
  });
});
