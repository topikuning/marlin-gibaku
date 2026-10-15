/*
 * UNDUH KURVA-S PAKET – gerbang dan jawaban kosong (DECISIONS 678).
 *
 * Isi dokumennya diuji di `tests/unit/kurva-paket.test.ts` (Σ baris = kurva
 * gabungan) dan dilihat hasil render-nya. Yang diuji di sini: siapa boleh
 * mengunduh, paket organisasi lain tidak bocor, dan paket yang belum punya
 * kurva menjawab kalimat, bukan PDF kosong atau galat 500.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

let actor: SessionUser;
vi.mock("@/lib/auth/session", async (original) => {
  const real = await original<typeof import("@/lib/auth/session")>();
  return { ...real, getCurrentUser: async () => actor, requireUser: async () => actor };
});
const { db } = await import("@/lib/db");
const { GET: pdf } = await import("@/app/api/laporan/kurva-paket/[id]/pdf/route");
const { GET: xlsx } = await import("@/app/api/laporan/kurva-paket/[id]/xlsx/route");

const orgIds: string[] = [];
async function org(role: SessionUser["role"] = "super_admin") {
  const tag = randomUUID();
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgIds.push(o.id);
  const u = await db.user.create({
    data: { orgId: o.id, username: tag, fullName: tag, passwordHash: "x", role, mustChangePassword: false },
  });
  const p = await db.package.create({ data: { orgId: o.id, name: `Paket ${tag.slice(0, 6)}` } });
  await db.location.create({ data: { packageId: p.id, name: tag, slug: tag, village: "D", regency: "K", province: "P" } });
  return { u: u as unknown as SessionUser, p };
}
const minta = (route: typeof pdf, id: string) =>
  route(new Request(`https://marlin.test/api/laporan/kurva-paket/${id}/pdf`), { params: Promise.resolve({ id }) });

let a: Awaited<ReturnType<typeof org>>;
let b: Awaited<ReturnType<typeof org>>;
beforeAll(async () => {
  a = await org();
  b = await org();
  actor = a.u;
});
afterAll(async () => {
  for (const id of orgIds) {
    const paket = await db.package.findMany({ where: { orgId: id }, select: { id: true } });
    await db.location.deleteMany({ where: { packageId: { in: paket.map((p) => p.id) } } });
    await db.package.deleteMany({ where: { orgId: id } });
    await db.auditLog.deleteMany({ where: { user: { orgId: id } } }).catch(() => null);
    await db.user.deleteMany({ where: { orgId: id } });
    await db.organization.delete({ where: { id } });
  }
});

describe("unduh Kurva-S paket", () => {
  it("paket tanpa lokasi berbaseline menjawab sebabnya – PDF maupun Excel", async () => {
    for (const route of [pdf, xlsx]) {
      const res = await minta(route, a.p.id);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toMatch(/belum ada lokasi yang punya baseline/);
    }
  });

  it("paket organisasi lain tidak bisa diunduh", async () => {
    const res = await minta(pdf, b.p.id);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("Paket tidak ditemukan");
  });

  it("peran tanpa izin ekspor laporan ditolak", async () => {
    const pengawas = await org("field_supervisor");
    actor = pengawas.u;
    try {
      const res = await minta(xlsx, pengawas.p.id);
      expect(res.status).toBe(403);
    } finally {
      actor = a.u;
    }
  });
});
