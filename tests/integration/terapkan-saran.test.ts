// Draft saran AI harus BISA menjadi data domain nyata (DECISIONS 195).
//
// Keluhan user 2026-08-01: menekan "Draft recovery" hanya menaikkan angka KPI —
// di halaman lokasi tidak ada apa pun. Memang: saveSuggestionAction hanya
// membuat AiArtifact kind "saran" yang tak pernah ditampilkan/dieksekusi.
// Prinsip DECISIONS 133 tetap: AI tidak menulis Issue/Recovery sendiri —
// penulisan HANYA lewat terapkanSaranAction yang dipicu manusia ber-izin.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let role = "project_manager";
let sessionUserId = "";
let sessionOrgId = "";
let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => scopedLocations,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async (_u: unknown, locationId: string) => {
      if (scopedLocations !== null && !scopedLocations.includes(locationId)) {
        throw new ForbiddenError("Tidak punya akses ke lokasi ini");
      }
    },
  };
});

const { db } = await import("@/lib/db");
const { terapkanSaranAction } = await import("@/lib/ai-hub/actions");

const suffix = `ts${Date.now().toString(36)}`;
let locId = "";
let locLainId = "";

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

async function buatDraft(over: Record<string, unknown> = {}) {
  const a = await db.aiArtifact.create({
    data: {
      kind: "saran",
      status: "draft",
      title: "Deviasi jadwal berat",
      structuredContent: {
        title: "Deviasi jadwal berat",
        detail: "Realisasi 12% vs rencana 68% – perlu percepatan mobilisasi.",
        category: "schedule",
        severity: "kritis",
        locationId: locId,
        locationName: "Alfa",
        suggestKind: "recovery",
        ...over,
      },
      createdById: sessionUserId,
    },
    select: { id: true },
  });
  return a.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  sessionOrgId = org.id;
  const user = await db.user.create({
    data: { orgId: org.id, username: `pm-${suffix}`, fullName: "PM", role: "project_manager", passwordHash: "x" },
  });
  sessionUserId = user.id;

  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  const l1 = await db.location.create({
    data: { packageId: pkg.id, name: "Alfa", slug: `alfa-${suffix}`, village: "Alfa", regency: "K", province: "P" },
  });
  const l2 = await db.location.create({
    data: { packageId: pkg.id, name: "Beta", slug: `beta-${suffix}`, village: "Beta", regency: "K", province: "P" },
  });
  locId = l1.id;
  locLainId = l2.id;
});

afterAll(async () => {
  await db.recoveryAction.deleteMany({ where: { issue: { locationId: { in: [locId, locLainId] } } } });
  await db.issue.deleteMany({ where: { locationId: { in: [locId, locLainId] } } });
  await db.aiArtifact.deleteMany({ where: { createdById: sessionUserId } });
  // audit_logs append-only (AUDIT-01) — sengaja tidak dibersihkan.
  await db.location.deleteMany({ where: { id: { in: [locId, locLainId] } } });
  await db.package.deleteMany({ where: { orgId: sessionOrgId } });
  // User & organisasi SENGAJA dibiarkan: audit_logs merujuk user dan tabel itu
  // append-only, jadi menghapus user memicu UPDATE terlarang di sana.
  await db.$disconnect();
});

beforeEach(async () => {
  role = "project_manager";
  scopedLocations = null;
  await db.recoveryAction.deleteMany({ where: { issue: { locationId: { in: [locId, locLainId] } } } });
  await db.issue.deleteMany({ where: { locationId: { in: [locId, locLainId] } } });
  await db.aiArtifact.deleteMany({ where: { createdById: sessionUserId } });
});

describe("KASUS INTI: draft recovery menjadi Kendala + aksi pemulihan NYATA", () => {
  it("membuat Issue di lokasi + RecoveryAction, dan draft keluar dari antrean", async () => {
    const id = await buatDraft();
    const res = await terapkanSaranAction(undefined, fd({ artifactId: id, picName: "Pak Budi", dueDate: "2026-08-15" }));
    expect(res?.error).toBeUndefined();
    expect(res?.ok).toMatch(/Kendala \+ aksi pemulihan dibuat/i);

    // Yang dulu TIDAK terjadi: sekarang benar-benar ada di lokasi.
    const issue = await db.issue.findFirst({
      where: { locationId: locId },
      select: { id: true, title: true, description: true, severity: true, status: true, raisedById: true },
    });
    expect(issue).not.toBeNull();
    expect(issue!.title).toBe("Deviasi jadwal berat");
    expect(issue!.severity).toBe("kritis");
    expect(issue!.raisedById).toBe(sessionUserId);
    // Kendala dgn aksi pemulihan langsung berstatus ditangani.
    expect(issue!.status).toBe("ditangani");

    const recovery = await db.recoveryAction.findFirst({
      where: { issueId: issue!.id },
      select: { description: true, picName: true, dueDate: true },
    });
    expect(recovery).not.toBeNull();
    expect(recovery!.picName).toBe("Pak Budi");
    expect(recovery!.dueDate?.toISOString().slice(0, 10)).toBe("2026-08-15");

    // Draft ditandai selesai + ditautkan ke issue → tidak lagi "menunggu".
    const artifact = await db.aiArtifact.findUnique({
      where: { id },
      select: { status: true, structuredContent: true },
    });
    expect(artifact!.status).toBe("terkirim");
    expect((artifact!.structuredContent as { issueId?: string }).issueId).toBe(issue!.id);
  });

  it("draft action (bukan recovery) hanya membuat Kendala terbuka", async () => {
    const id = await buatDraft({ suggestKind: "action", severity: "sedang" });
    const res = await terapkanSaranAction(undefined, fd({ artifactId: id }));
    expect(res?.ok).toMatch(/Kendala dibuat/i);
    const issue = await db.issue.findFirstOrThrow({ where: { locationId: locId }, select: { id: true, status: true } });
    expect(issue.status).toBe("terbuka");
    expect(await db.recoveryAction.count({ where: { issueId: issue.id } })).toBe(0);
  });

  it("mencatat audit ke resource issue dengan tautan artefaknya", async () => {
    const id = await buatDraft();
    await terapkanSaranAction(undefined, fd({ artifactId: id }));
    const log = await db.auditLog.findFirst({
      where: { action: "ai.saran.terapkan" },
      orderBy: { createdAt: "desc" },
      select: { resourceType: true, payload: true },
    });
    expect(log?.resourceType).toBe("issue");
    expect(log?.payload).toMatchObject({ artifactId: id, locationId: locId, recovery: true });
  });
});

describe("pagar", () => {
  it("tanpa izin Kendala ditolak – AI tidak boleh jadi pintu belakang", async () => {
    const id = await buatDraft();
    role = "exec_viewer"; // punya ai.generate, TIDAK punya issue.manage
    const res = await terapkanSaranAction(undefined, fd({ artifactId: id }));
    expect(res?.error).toMatch(/izin/i);
    expect(await db.issue.count({ where: { locationId: locId } })).toBe(0);
  });

  it("lokasi di luar penugasan ditolak", async () => {
    const id = await buatDraft();
    scopedLocations = [locLainId];
    const res = await terapkanSaranAction(undefined, fd({ artifactId: id }));
    expect(res?.error).toMatch(/akses/i);
    expect(await db.issue.count({ where: { locationId: locId } })).toBe(0);
  });

  it("draft yang sudah diterapkan tidak bisa diterapkan dua kali", async () => {
    const id = await buatDraft();
    await terapkanSaranAction(undefined, fd({ artifactId: id }));
    const res2 = await terapkanSaranAction(undefined, fd({ artifactId: id }));
    expect(res2?.error).toMatch(/sudah ditindaklanjuti/i);
    expect(await db.issue.count({ where: { locationId: locId } })).toBe(1);
  });

  it("draft tanpa lokasi ditolak dengan pesan yang mengarahkan", async () => {
    const id = await buatDraft({ locationId: null });
    const res = await terapkanSaranAction(undefined, fd({ artifactId: id }));
    expect(res?.error).toMatch(/tidak menunjuk lokasi/i);
  });

  it("artefak laporan (bukan saran) tidak bisa dipakai lewat aksi ini", async () => {
    const a = await db.aiArtifact.create({
      data: { kind: "laporan", status: "draft", title: "Laporan", structuredContent: {}, createdById: sessionUserId },
      select: { id: true },
    });
    const res = await terapkanSaranAction(undefined, fd({ artifactId: a.id }));
    expect(res?.error).toMatch(/tidak ditemukan/i);
  });
});
