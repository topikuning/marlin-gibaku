// TANDA TANGAN KETIK di pemuat tanda tangan (DECISIONS 763) – terhadap DATABASE ASLI.
//
// Permintaan user 2026-11-12: *"jika tanda tangan belum diupload, bisakah kamu
// membuatkan tanda tangan dengan model font handwriting untuk pengisi awal"*.
//
// Yang dijaga:
// 1. slot yang NAMANYA ada tetapi gambarnya belum diunggah mendapat tanda tangan
//    ketik – di PDF/Excel (`muatTtdPdf`) maupun halaman cetak (`muatTtdLaporan`);
// 2. tanda tangan ketiknya milik ORANG di slot itu, bukan nama pihak lain;
// 3. slot tanpa nama tetap kosong, dan stempel tidak pernah dibuatkan;
// 4. jalan walau R2 belum disiapkan (gambar ketik tidak butuh penyimpanan).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { isR2Configured } = await import("@/lib/r2");
const { muatTtdPdf } = await import("@/lib/pdf/ttd-gambar");
const { muatTtdLaporan, penandatanganLokasi } = await import("@/lib/export/ttd-laporan");
const { ttdKetikPng, ttdKetikDataUrl } = await import("@/lib/export/ttd-ketik");

const suffix = `tk${Date.now().toString(36)}`;
let lengkap = "";
let tanpaKonsultan = "";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV Vendor ${suffix}` } });
  const buat = async (tag: string, kontrak: Record<string, string>) => {
    const pkg = await db.package.create({
      data: { orgId: org.id, name: `Paket ${tag} ${suffix}`, stage: "pelaksanaan", pelaksanaName: "Ahmad Mu'min" },
    });
    await db.contract.create({
      data: {
        packageId: pkg.id,
        vendorId: vendor.id,
        contractNumber: `SPK-${tag}-${suffix}`,
        contractValue: 1_000_000_000n,
        signedDate: new Date("2026-08-01"),
        durationDays: 150,
        ...kontrak,
      },
    });
    const loc = await db.location.create({
      data: { packageId: pkg.id, name: `Lokasi ${tag}`, slug: `lok-${tag}-${suffix}`, village: "Desa", regency: "Kab", province: "Prov", isActive: true },
    });
    return loc.id;
  };
  lengkap = await buat("a", {
    ppkName: "Ir. Pejabat Komitmen, M.T.",
    wakilSahName: "Wakil Sah Satu",
    supervisorName: "Pengawas Lapangan Uji",
    supervisorFirm: "PT Konsultan Uji",
    teamLeaderName: "Teguh Ketua",
    coTeamLeaderName: "Sari Koordinator",
    contractorSignerName: "Direktur Uji",
    projectManagerName: "Hadi Manajer",
  });
  // Mingguan diketahui Wakil Sah dan diteken Manajer Proyek; konsultannya (Koordinator TL) kosong.
  tanpaKonsultan = await buat("b", { wakilSahName: "Wakil Kedua", projectManagerName: "PM Kedua" });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("tanda tangan yang belum diunggah diisi tanda tangan ketik", () => {
  it("R2 memang belum disiapkan di lingkungan uji – gambar ketik tidak bergantung padanya", () => {
    expect(isR2Configured()).toBe(false);
  });

  it("PDF & Excel: ketiga pihak bernama mendapat coretan ketik milik ORANGNYA sendiri; stempel tetap kosong", async () => {
    for (const jenis of ["harian", "mingguan", "bulanan"] as const) {
      const t = await muatTtdPdf(lengkap, jenis);
      const p = (await penandatanganLokasi(lengkap, jenis))!.nama;
      for (const [pihak, orang] of [
        ["ppk", p.kkp.nama],
        ["pengawas", p.konsultan!.nama],
        ["penyedia", p.penyedia.nama],
      ] as const) {
        expect(orang, `${jenis}/${pihak}`).toBeTruthy();
        const ttd = t[pihak].ttd;
        expect(ttd?.subarray(0, 4), `${jenis}/${pihak}`).toEqual(PNG);
        // Persis gambar nama orang di slot itu – bukan nama pihak lain.
        expect(ttd!.equals((await ttdKetikPng(orang))!), `${jenis}/${pihak}`).toBe(true);
        expect(t[pihak].stempel, `${jenis}/${pihak}`).toBeNull();
        // Ditandai ketik, supaya penyaji melebarkannya mengikuti nama.
        expect(t[pihak].ttdKetik, `${jenis}/${pihak}`).toBe(true);
      }
    }
  });

  it("orang penyedia mengikuti jenis dokumen: harian = Pelaksana, bulanan = Manajer Proyek, MC = Direktur", async () => {
    const harian = await muatTtdPdf(lengkap, "harian");
    const bulanan = await muatTtdPdf(lengkap, "bulanan");
    const mc = await muatTtdPdf(lengkap, "mc");
    expect(harian.penyedia.ttd!.equals((await ttdKetikPng("Ahmad Mu'min"))!)).toBe(true);
    expect(bulanan.penyedia.ttd!.equals((await ttdKetikPng("Hadi Manajer"))!)).toBe(true);
    expect(mc.penyedia.ttd!.equals((await ttdKetikPng("Direktur Uji"))!)).toBe(true);
    // Nama berbeda → gambar berbeda: kesamaan di atas memang bukti orangnya.
    expect(harian.penyedia.ttd!.equals(mc.penyedia.ttd!)).toBe(false);
  });

  it("halaman cetak: alamat data PNG milik orang di slot itu", async () => {
    const t = await muatTtdLaporan(lengkap, "mingguan");
    for (const pihak of ["ppk", "pengawas", "penyedia"] as const) {
      expect(t[pihak].nama).toBeTruthy();
      expect(t[pihak].ttd?.url, pihak).toMatch(/^data:image\/png;base64,/);
      expect(t[pihak].ttd?.url, pihak).toBe(await ttdKetikDataUrl(t[pihak].nama));
      expect(t[pihak].ttd?.ketik?.rasio, pihak).toBeGreaterThan(2.5);
      expect(t[pihak].stempel).toBeNull();
    }
  });

  it("slot tanpa nama tetap kosong – tidak ada nama yang bisa ditulis", async () => {
    const pdf = await muatTtdPdf(tanpaKonsultan, "mingguan");
    const html = await muatTtdLaporan(tanpaKonsultan, "mingguan");
    expect(html.pengawas.nama).toBeNull();
    expect(pdf.pengawas.ttd).toBeNull();
    expect(html.pengawas.ttd).toBeNull();
    // Pihak lain yang bernama tetap terisi.
    for (const pihak of ["ppk", "penyedia"] as const) {
      expect(pdf[pihak].ttd, pihak).not.toBeNull();
      expect(html[pihak].ttd, pihak).not.toBeNull();
    }
  });

  it("Kurva S paket (DECISIONS 764): coretan PPK kontrak – bukan Wakil Sah – dan tanpa konsultan", async () => {
    const t = await muatTtdPdf(lengkap, "kurva_paket");
    expect(t.ppk.ttd!.equals((await ttdKetikPng("Ir. Pejabat Komitmen, M.T."))!)).toBe(true);
    expect(t.ppk.ttd!.equals((await ttdKetikPng("Wakil Sah Satu"))!)).toBe(false);
    expect(t.pengawas).toMatchObject({ ttd: null, stempel: null });
    expect(t.penyedia.ttd!.equals((await ttdKetikPng("Hadi Manajer"))!)).toBe(true);
    const html = await muatTtdLaporan(lengkap, "kurva_paket");
    expect(html.ppk.nama).toBe("Ir. Pejabat Komitmen, M.T.");
    expect(html.pengawas).toMatchObject({ nama: null, ttd: null });
  });
});
