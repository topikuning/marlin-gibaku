// GERBANG EMPAT MATA AKTIVASI ADENDUM (DECISIONS 234).
//
// Keputusan user 2026-08-03: "pengaktifan adendum harus dua orang, program
// director dan satu orang di level yang ditugaskan bisa AM/SM/PM, bahkan super
// admin pun tidak boleh mengaktifkan sendiri."
//
// Aturannya sendiri diuji murni di tests/unit/adendum-persetujuan.test.ts.
// Yang diuji DI SINI: gerbangnya benar-benar terpasang di jalur database —
// termasuk penggugurannya saat draft berubah, dan pengecualian HPS awal.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Siapa yang sedang login saat server action dipanggil. */
let sesi = "sa";

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
const { pastikanBolehAktivasi, setujuiRevisi, cabutPersetujuan, ringkasPersetujuan, PersetujuanError } =
  await import("@/lib/rab/persetujuan");
const { activateDraftAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");

const suffix = `em${Date.now().toString(36)}`;
let locationId: string;
let orgId: string;
const orang: Record<string, { id: string; role: never }> = {};

/** Pengguna sesi saat ini, dibaca dari DB supaya bentuknya persis SessionUser. */
async function pengguna() {
  return db.user.findUniqueOrThrow({
    where: { id: orang[sesi]!.id },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

async function buatUser(tag: string, role: string) {
  const u = await db.user.create({
    data: { orgId, username: `${tag}-${suffix}`, fullName: tag.toUpperCase(), passwordHash: "x", role: role as never },
  });
  orang[tag] = { id: u.id, role: role as never };
  return u.id;
}

/** Revisi + satu node, supaya totalValue-nya nyata. */
async function buatRevisi(no: number, status: "aktif" | "draft") {
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: no,
      status,
      source: no === 1 ? "hps_awal" : "adendum",
      totalValue: 1_000_000n * BigInt(no),
      createdById: orang.pd!.id,
    },
  });
  return rev;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org EM ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket EM ${suffix}` } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Lokasi EM", slug: `lokasi-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
  await buatUser("pd", "program_director");
  await buatUser("am", "regional_manager");
  await buatUser("pm", "project_manager");
  await buatUser("sm", "site_manager");
  await buatUser("sa", "super_admin");
  await buatUser("mandor", "field_supervisor");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  await db.rabRevision.deleteMany({ where: { locationId } });
});

describe("KASUS INTI: adendum butuh dua tanda tangan", () => {
  it("tanpa persetujuan → aktivasi ditolak", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
  });

  it("PD saja → masih ditolak, pesannya menyebut yang kurang", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(/Area Manager/i);
  });

  it("SM saja → masih ditolak, pesannya menyebut Program Director", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.sm!);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(/Program Director/i);
  });

  it("PD + SM → lolos", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();
  });
});

describe("super admin tidak bisa mengaktifkan sendiri", () => {
  it("super_admin ditolak saat mencoba menandatangani", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(setujuiRevisi(draft.id, orang.sa!)).rejects.toThrow(/tidak berhak/i);
  });

  it("super_admin + PD tidak cukup — kursi penugasan tetap kosong", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await expect(setujuiRevisi(draft.id, orang.sa!)).rejects.toThrow();
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
  });

  it("mandor juga ditolak", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(setujuiRevisi(draft.id, orang.mandor!)).rejects.toThrow(/tidak berhak/i);
  });
});

describe("HPS awal bukan adendum", () => {
  it("belum ada RAB aktif → aktivasi tidak menuntut persetujuan", async () => {
    const draft = await buatRevisi(1, "draft");
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();
  });
});

describe("draft berubah → persetujuan gugur", () => {
  it("mengubah totalValue menggugurkan suara yang sudah masuk", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.am!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();

    // Editor menulis ulang totalValue tiap mutasi → updatedAt bergerak.
    await new Promise((r) => setTimeout(r, 10));
    await db.rabRevision.update({ where: { id: draft.id }, data: { totalValue: 9_999_999n } });

    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
    const r = await ringkasPersetujuan(draft.id);
    expect(r.berlaku).toHaveLength(0);
    expect(r.gugur.map((g) => g.nama).sort()).toEqual(["AM", "PD"]);
  });

  it("menyetujui ulang setelah perubahan memulihkan kelayakan", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.pm!);
    await new Promise((r) => setTimeout(r, 10));
    await db.rabRevision.update({ where: { id: draft.id }, data: { totalValue: 5_000_000n } });
    await new Promise((r) => setTimeout(r, 10));

    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.pm!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();
  });
});

describe("cabut persetujuan", () => {
  it("mencabut mengembalikan kunci", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();

    await cabutPersetujuan(draft.id, orang.pd!);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(/Program Director/i);
  });

  it("mencabut yang belum pernah diberikan ditolak jelas", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(cabutPersetujuan(draft.id, orang.sm!)).rejects.toThrow(/belum menyetujui/i);
  });
});

describe("GERBANGNYA TERPASANG di server action, bukan cuma ada", () => {
  // Aturan yang benar tapi tidak dipanggil sama saja dengan tidak ada. Blok ini
  // menembak activateDraftAction — jalur yang betul-betul dipakai tombol UI —
  // supaya menghapus satu baris `pastikanBolehAktivasi` membuat uji ini merah.
  const aktifkan = async (revisionId: string) => {
    const fd = new FormData();
    fd.set("revisionId", revisionId);
    return activateDraftAction(undefined, fd);
  };

  it("super_admin menekan Aktifkan tanpa persetujuan → ditolak, draft tetap draft", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    sesi = "sa";
    const hasil = await aktifkan(draft.id);
    expect(hasil?.error).toMatch(/butuh persetujuan DUA orang/i);
    expect(hasil?.success).toBeUndefined();
    const sesudah = await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(sesudah.status).toBe("draft");
  });

  it("pesan penolakan menyebut peran yang kurang, bukan 'Terjadi kesalahan'", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    sesi = "sa";
    const hasil = await aktifkan(draft.id);
    expect(hasil?.error).toMatch(/Area Manager/i);
    expect(hasil?.error).not.toMatch(/^Terjadi kesalahan/);
  });

  it("dengan PD + SM → aktivasi lolos gerbang dan revisi benar-benar aktif", async () => {
    const lama = await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    sesi = "sa";
    const hasil = await aktifkan(draft.id);
    // Regenerate baseline boleh gagal di lingkungan uji (tak ada kontrak/jadwal);
    // yang diuji di sini adalah GERBANGNYA, jadi cukup pastikan penolakan empat
    // mata tidak muncul dan status revisi benar-benar berpindah.
    expect(hasil?.error ?? "").not.toMatch(/butuh persetujuan/i);
    const sesudah = await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(sesudah.status).toBe("aktif");
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: lama.id } })).status).not.toBe("aktif");
  });
});

describe("satu orang = satu tanda tangan", () => {
  it("menyetujui dua kali tidak mengisi dua kursi", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.sm!);
    await setujuiRevisi(draft.id, orang.sm!);
    expect(await db.rabRevisionApproval.count({ where: { revisionId: draft.id } })).toBe(1);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
  });
});
