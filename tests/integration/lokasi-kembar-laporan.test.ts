// PENDETEKSI LOKASI GANDA YANG TERLANJUR ADA.
//
// Guard hanya menutup pintu ke depan. Pertanyaan lanjutan user 2026-09-16 —
// *"masalah ini terlanjur ada bagaimana memperbaikinya"* — menuntut lebih dulu
// dijawabnya "yang mana", dan dua golongannya tidak boleh tercampur: nama
// kembar DI SATU PAKET merusak pemilahan berkas Drive (perbaikannya: ganti
// nama), sementara satu desa yang terdaftar dua kali memecah angkanya
// (perbaikannya: keputusan orang, bukan otomatis).
//
// Yang paling mudah salah adalah yang KETIGA: nama sama di paket berbeda untuk
// desa yang memang berbeda. Itu lumrah dan tidak merusak apa pun; melaporkannya
// membuat dua golongan nyata tenggelam.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { laporanLokasiKembar, usulNamaPembeda } = await import("@/lib/package/lokasi-kembar");

const suffix = `lk${Date.now().toString(36)}`;
let orgId = "";
let paketA = "";
let paketB = "";
let kembarBerRab = "";

async function buatLokasi(o: {
  packageId: string;
  name: string;
  village: string;
  district?: string | null;
  regency: string;
}) {
  return (
    await db.location.create({
      data: {
        packageId: o.packageId,
        name: o.name,
        slug: `${o.name}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase().replace(/\s+/g, "-"),
        village: o.village,
        district: o.district ?? null,
        regency: o.regency,
        province: "Jawa Tengah",
      },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;
  paketA = (await db.package.create({ data: { orgId, name: `Paket A ${suffix}` } })).id;
  paketB = (await db.package.create({ data: { orgId, name: `Paket B ${suffix}` } })).id;

  // (1) Nama kembar di SATU paket – dan desanya pun berbeda.
  kembarBerRab = await buatLokasi({ packageId: paketA, name: "Sukamaju", village: "Sukamaju", district: "Wedung", regency: "Demak" });
  await buatLokasi({ packageId: paketA, name: "SUKAMAJU", village: "Sukamaju", district: "Sayung", regency: "Demak" });

  // (2) Satu desa, dua lokasi, paket berbeda – namanya justru TIDAK sama.
  await buatLokasi({ packageId: paketA, name: "Tanjung Pura", village: "Tanjungpura", district: "Kejaksan", regency: "Cirebon" });
  await buatLokasi({ packageId: paketB, name: "KNMP Tanjungpura", village: "Tanjung Pura", district: null, regency: "Cirebon" });

  // (3) Nama sama, paket berbeda, desa berbeda – ini BUKAN masalah.
  await buatLokasi({ packageId: paketA, name: "Pesisir", village: "Pesisir", district: "Gebang", regency: "Cirebon" });
  await buatLokasi({ packageId: paketB, name: "Pesisir", village: "Pesisir", district: "Juwana", regency: "Pati" });

  // Data yang menempel: dipakai untuk memutuskan mana yang boleh dilepas.
  await db.rabRevision.create({
    data: { locationId: kembarBerRab, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 1_000n },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("laporan lokasi kembar", () => {
  it("nama kembar di satu paket terdeteksi, lengkap dengan yang mana yang berisi", async () => {
    const r = await laporanLokasiKembar(orgId);
    expect(r.sePaket).toHaveLength(1);
    const anggota = r.sePaket[0].anggota;
    expect(anggota).toHaveLength(2);
    const berisi = anggota.find((a) => a.id === kembarBerRab);
    if (!berisi) throw new Error("lokasi ber-RAB tidak ada di kelompok");
    expect(berisi.punyaRab).toBe(true);
    expect(berisi.kosong).toBe(false);
    expect(anggota.find((a) => a.id !== kembarBerRab)!.kosong).toBe(true);
  });

  it("satu desa yang terdaftar dua kali terdeteksi walau namanya beda", async () => {
    const r = await laporanLokasiKembar(orgId);
    const desa = r.desaGanda.map((g) => g.anggota.map((a) => a.village).sort());
    expect(desa).toContainEqual(["Tanjung Pura", "Tanjungpura"]);
  });

  it("nama sama di paket berbeda untuk desa berbeda TIDAK dilaporkan", async () => {
    const r = await laporanLokasiKembar(orgId);
    const semua = [...r.sePaket, ...r.desaGanda].flatMap((g) => g.anggota.map((a) => a.name));
    expect(semua).not.toContain("Pesisir");
  });

  it("usul nama pembeda memakai kecamatan bila ada", async () => {
    const r = await laporanLokasiKembar(orgId);
    const a = r.sePaket[0].anggota.find((x) => x.district)!;
    expect(usulNamaPembeda(a)).toBe(`${a.name} (${a.district})`);
  });
});
