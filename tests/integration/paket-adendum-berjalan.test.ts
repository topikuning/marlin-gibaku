// DRAFT ADENDUM HARUS TERLIHAT DARI HALAMAN PAKET.
//
// Keluhan user 2026-09-05: *"saat terjadi draft adendum, sama sekali tidak ada
// informasi atau apa pun yang bisa membantu menjelaskan"*. Draft adendum hidup
// di halaman RAB masing-masing LOKASI, sementara yang memutuskan (dan yang
// menandatangani CCO) bekerja dari halaman paket — di sana usulan yang sedang
// menunggu persetujuan sama sekali tidak kelihatan.
//
// Yang diuji: bacaan paket menyebut lokasinya, dampak rupiahnya terhadap RAB
// yang BERLAKU, dan status empat mata yang sama dengan tombol aktivasi —
// termasuk penggugurannya saat draft diubah sesudah disetujui (DECISIONS 234).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { getAdendumBerjalan } = await import("@/lib/package/adendum-berjalan");

const suffix = `pa${Date.now().toString(36)}`;
let orgId: string;
let locationId: string;
let lokasiTenangId: string;
let draftId: string;
let pdId: string;
let smId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PA ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket PA ${suffix}` } });
  const lok = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi Adendum ${suffix}`,
      slug: `lok-ad-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = lok.id;
  const tenang = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi Tanpa Draft ${suffix}`,
      slug: `lok-tenang-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  lokasiTenangId = tenang.id;

  const pd = await db.user.create({
    data: { orgId, username: `pd-${suffix}`, fullName: "PD", passwordHash: "x", role: "program_director" },
  });
  pdId = pd.id;
  const sm = await db.user.create({
    data: { orgId, username: `sm-${suffix}`, fullName: "SM", passwordHash: "x", role: "site_manager" },
  });
  smId = sm.id;

  await db.rabRevision.create({
    data: { locationId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 1_000_000_000n },
  });
  // Lokasi kedua ber-RAB aktif tapi TANPA draft — tidak boleh ikut terbawa.
  await db.rabRevision.create({
    data: { locationId: lokasiTenangId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 500_000_000n },
  });
  const draft = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: 2,
      status: "draft",
      source: "adendum",
      totalValue: 1_150_000_000n,
      note: "Tambah revetment",
    },
  });
  draftId = draft.id;
});

afterAll(async () => {
  await db.rabRevisionApproval.deleteMany({ where: { revisionId: draftId } });
  await db.rabRevision.deleteMany({ where: { locationId: { in: [locationId, lokasiTenangId] } } });
  await db.location.deleteMany({ where: { id: { in: [locationId, lokasiTenangId] } } });
  await db.user.deleteMany({ where: { orgId } });
  await db.package.deleteMany({ where: { orgId } });
  await db.organization.delete({ where: { id: orgId } });
});

describe("bacaan adendum berjalan untuk halaman paket", () => {
  it("menyebut lokasinya, nilai berlaku, nilai draft, dan selisihnya", async () => {
    const h = await getAdendumBerjalan([locationId, lokasiTenangId]);
    expect(h.draft).toHaveLength(1);
    const d = h.draft[0]!;
    expect(d.locationId).toBe(locationId);
    expect(d.nilaiAktif).toBe(1_000_000_000n);
    expect(d.nilaiDraft).toBe(1_150_000_000n);
    expect(d.selisih).toBe(150_000_000n);
    expect(d.note).toBe("Tambah revetment");
    expect(h.totalSelisih).toBe(150_000_000n);
  });

  it("belum disetujui siapa pun → belum siap diaktifkan, kekurangannya disebut", async () => {
    const h = await getAdendumBerjalan([locationId]);
    const d = h.draft[0]!;
    expect(d.setuju.lengkap).toBe(false);
    expect(h.siapAktif).toBe(0);
    expect(d.setuju.kurang.join(" ")).toContain("Program Director");
  });

  it("dua peran berbeda menyetujui → siap diaktifkan", async () => {
    // Suara diberikan PERSIS pada keadaan draft saat ini: `approvedAt` disetel
    // sama dengan `updatedAt` revisi. Memberinya waktu di masa depan membuat
    // uji berikutnya (draft diubah lagi) tidak pernah bisa menggugurkannya.
    const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: draftId }, select: { updatedAt: true } });
    const sesudah = rev.updatedAt;
    for (const [userId, role] of [
      [pdId, "program_director"],
      [smId, "site_manager"],
    ] as const) {
      await db.rabRevisionApproval.create({
        data: { revisionId: draftId, userId, role, totalValue: 1_150_000_000n, approvedAt: sesudah },
      });
    }
    const h = await getAdendumBerjalan([locationId]);
    expect(h.draft[0]!.setuju.lengkap).toBe(true);
    expect(h.siapAktif).toBe(1);
  });

  it("draft diubah SESUDAH disetujui → persetujuannya gugur dan itu dikatakan", async () => {
    // Editor draft selalu menulis ulang totalValue; di sini disimulasikan.
    await db.rabRevision.update({ where: { id: draftId }, data: { totalValue: 1_200_000_000n } });
    const h = await getAdendumBerjalan([locationId]);
    const d = h.draft[0]!;
    expect(d.setuju.lengkap).toBe(false);
    expect(d.suaraGugur).toBe(2);
    expect(d.selisih).toBe(200_000_000n);
    expect(h.siapAktif).toBe(0);
  });
});
