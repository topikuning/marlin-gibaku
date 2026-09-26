// PERIKSA PENYIMPANAN R2 HARUS SELESAI PADA BUCKET SUNGGUHAN.
//
// Laporan user 2026-09-26 (tangkapan layar /sistem, "Halaman ini berhenti":
// *An unexpected response was received from the server*): *"periksa
// penyimpanan R2 selalu bermasalah, sepertinya terlalu besar"*.
//
// Penyebabnya bukan ukuran bucket, melainkan penyaring JSON: SATU kueri per
// kandidat yatim per kolom JSON – ribuan kandidat × dua puluhan kolom = puluhan
// ribu pemindaian tabel dalam satu permintaan, jauh melewati batas waktu proxy.
// Janjinya tetap sama: kunci yang hidup di dalam JSON (snapshot laporan final)
// TIDAK pernah disebut yatim – termasuk bila ia tertulis sebagai URL.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const suffix = `ra${Date.now().toString(36)}`;
const TUA = new Date(Date.now() - 30 * 86_400_000);
const JUMLAH = 3000;
const kunciLepas = Array.from({ length: JUMLAH }, (_, i) => `photos/${suffix}/2026-08-01/lepas-${i}.webp`);
const kunciSnapshot = `photos/${suffix}/2026-08-01/di-snapshot.webp`;
const kunciUrl = `photos/${suffix}/2026-08-01/di-url dengan spasi.webp`;
const kunciBertingkat = `photos/${suffix}/2026-08-01/bertingkat.webp`;
const terhapus: string[][] = [];

vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2List: async () => ({
    obyek: [...kunciLepas, kunciSnapshot, kunciUrl, kunciBertingkat].map((key) => ({ key, bytes: 1000, diubah: TUA })),
    terpotong: false,
  }),
  r2HapusBanyak: async (keys: string[]) => {
    terhapus.push(keys);
    return { terhapus: keys.length, gagal: [] as string[] };
  },
}));

const { db } = await import("@/lib/db");
const { auditR2, kunciYatim } = await import("@/lib/r2-audit");

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RA ${suffix}`, slug: `org-${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket RA ${suffix}` } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: `Lokasi RA ${suffix}`, slug: `lok-${suffix}`, village: "Desa", regency: "Kab", province: "Jawa Tengah", isActive: true },
  });
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `u-${suffix}`,
      email: `u-${suffix}@contoh.id`,
      fullName: "Uji",
      role: "site_manager",
      passwordHash: "x",
    },
  });
  await db.dailyReport.create({
    data: {
      locationId: loc.id,
      reportDate: new Date("2026-08-01"),
      status: "draft",
      createdById: u.id,
      // Snapshot laporan final membekukan kunci foto; yang kedua tertulis
      // sebagai URL ber-presign (ter-encode, dengan query string).
      finalSnapshot: {
        foto: [
          { r2Key: kunciSnapshot },
          { url: `https://r2.contoh/${encodeURI(kunciUrl)}?X-Amz-Signature=abc` },
        ],
        // JSON yang disimpan sebagai TEKS di dalam JSON – tanda kutipnya ber-escape.
        catatan: JSON.stringify({ lampiran: [{ note: 'kata "kutip" a/b', r2Key: kunciBertingkat }] }),
      },
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("audit R2 pada ribuan kandidat yatim", () => {
  it("selesai dalam hitungan detik, dan kunci di dalam JSON tidak disebut yatim", async () => {
    const mulai = Date.now();
    const hasil = await auditR2();
    const lama = Date.now() - mulai;
    expect(hasil.yatimObyek).toBe(JUMLAH);
    const yatim = await kunciYatim();
    expect(yatim.has(kunciSnapshot)).toBe(false);
    expect(yatim.has(kunciUrl)).toBe(false);
    expect(yatim.has(kunciBertingkat)).toBe(false);
    expect(yatim.has(kunciLepas[0]!)).toBe(true);
    expect(lama).toBeLessThan(10_000);
  }, 300_000);
});
