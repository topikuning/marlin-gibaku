// "BERAPA YANG SUDAH ADA DI SERVER ARSIP?" HARUS ADA ANGKANYA, BUKAN DIJUMLAH SENDIRI.
//
// Pertanyaan user 2026-09-13 atas layar Sistem: *"bagian mana yang menjawab
// bahwa yang sudah berhasil dipindah berapa dan berapa yang sudah di server
// lenovo?"*
//
// Jawaban jujurnya waktu itu: TIDAK ADA. Tiga kartunya melaporkan keadaan
// SALINAN R2 — menunggu dipindahkan, masih punya dua salinan, salinan R2 sudah
// dibuang — dan yang ditanyakan user harus dijumlahkan sendiri di kepala:
// 56 + 0. Layar yang memuat semua bahannya tapi tidak pernah menyebut angka
// yang dicari orang sama saja dengan tidak menjawab.
//
// Yang dijaga di sini: `sudahDiArsip` = masa tenggang + selesai pindah, dengan
// byte-nya, dan tidak ikut menghitung yang masih mengantre atau yang berhenti
// dicoba.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { ringkasArsipAsli } = await import("@/lib/arsip-asli/antrean");

const suffix = `ar${Date.now().toString(36)}`;
let locationId: string;
let reportId: string;

/** Satu foto dengan keadaan arsip yang ditentukan. */
async function foto(keadaan: {
  archivedAt?: Date | null;
  r2PurgedAt?: Date | null;
  bytes: number;
}) {
  return db.photo.create({
    data: {
      locationId,
      reportId,
      r2Key: `f/${crypto.randomUUID()}.webp`,
      originalKey: `o/${crypto.randomUUID()}.jpg`,
      originalBytes: keadaan.bytes,
      originalArchivedAt: keadaan.archivedAt ?? null,
      originalR2PurgedAt: keadaan.r2PurgedAt ?? null,
      sha256: crypto.randomUUID().replace(/-/g, ""),
      bytes: Math.round(keadaan.bytes / 4),
    },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AR ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `ar-${suffix}`, fullName: "T", passwordHash: "x", role: "super_admin" },
  });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket AR ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi AR",
      slug: `lokasi-${suffix}`,
      village: "D",
      regency: "K",
      province: "P",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  const lap = await db.dailyReport.create({
    data: { locationId: loc.id, reportDate: new Date("2026-09-01"), status: "draft", createdById: user.id },
  });
  reportId = lap.id;

  // Tiga keadaan yang nyata, plus satu yang TIDAK boleh ikut terhitung.
  await foto({ bytes: 1_000_000 }); // menunggu
  await foto({ bytes: 2_000_000 }); // menunggu
  await foto({ archivedAt: new Date(), bytes: 4_000_000 }); // masa tenggang
  await foto({ archivedAt: new Date(), r2PurgedAt: new Date(), bytes: 8_000_000 }); // selesai pindah
});

afterAll(async () => {
  await db.photo.deleteMany({ where: { locationId } });
  await db.$disconnect();
});

describe("ringkasan arsip menjawab 'berapa yang sudah di mesin arsip'", () => {
  it("menyebut angkanya sendiri, bukan menyuruh menjumlah dua kartu", async () => {
    const r = await ringkasArsipAsli();
    expect(r.sudahDiArsip, "angka 'sudah di mesin arsip' tidak ada").toBe(r.masaTenggang + r.terarsip);
    expect(r.sudahDiArsip).toBe(2);
  });

  it("byte yang sudah pindah ikut disebut – 'berapa' bukan cuma soal jumlah berkas", async () => {
    const r = await ringkasArsipAsli();
    expect(r.bytesSudahDiArsip).toBe(12_000_000);
  });

  it("yang masih mengantre TIDAK ikut terhitung sudah pindah", async () => {
    const r = await ringkasArsipAsli();
    expect(r.menunggu).toBe(2);
    expect(r.bytesMenunggu).toBe(3_000_000);
    expect(r.sudahDiArsip).not.toBe(r.menunggu + r.masaTenggang + r.terarsip);
  });
});
