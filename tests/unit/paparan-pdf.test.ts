/*
 * RENDERER PDF PAPARAN 16:9 (DECISIONS 416).
 *
 * PDF resmi hanya diperiksa orang SETELAH terkirim — jadi bentuk dasarnya
 * dijaga mesin: halaman 960×540 konsisten, jumlah slide sesuai perakit,
 * watermark hanya di draf, dan foto yang gagal dimuat tidak menggagalkan
 * seluruh dokumen (placeholder, bukan crash).
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

// R2 sengaja MATI: jalur foto gagal → placeholder harus tetap menghasilkan PDF.
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
  r2PresignGet: async () => {
    throw new Error("R2 mati di uji");
  },
}));

const { renderPaparanPdf, namaBerkasPaparan } = await import("@/lib/paparan/render-pdf");
const { narasiDeterministik, susunSlides } = await import("@/lib/paparan/susun");
const { PAPARAN_TEMPLATE_KEY } = await import("@/lib/paparan/jenis");
import type { PaparanContent, PaparanSnapshot } from "@/lib/paparan/jenis";

function snapshot(): PaparanSnapshot {
  return {
    version: 1,
    paket: { id: "pkg-1", name: "Paket Natuna", packageNumber: null, ownerAgency: "KKP", province: "Kepri" },
    kontrak: {
      contractNumber: "SPK-001",
      workTitle: "Pembangunan Kampung Nelayan Merah Putih Natuna",
      vendorName: "PT Uji Konstruksi",
      contractValue: "15000000000",
      startDateKey: "2026-06-01",
      endDateKey: "2026-10-28",
      durationDays: 150,
      ppkName: "Budi",
      supervisorName: null,
      supervisorFirm: null,
    },
    periode: {
      mingguKe: 6,
      totalMinggu: 22,
      mulaiKey: "2026-07-06",
      akhirKey: "2026-07-12",
      berjalan: false,
      asOfKey: "2026-07-12",
    },
    dataAsOf: "2026-07-12T10:00:00.000Z",
    progres: {
      paket: {
        targetPct: 20.4,
        realisasiPct: 18.1,
        deviasiPp: -2.3,
        realisasiSebelumPct: 15,
        kenaikanPp: 3.1,
        lokasiDihitung: 2,
        lokasiTanpaKurva: 1,
      },
      lokasi: Array.from({ length: 12 }, (_, i) => ({
        locationId: `loc-${i}`,
        slug: `lok-${i}`,
        name: `Lokasi ${i + 1}`,
        regency: "Natuna",
        province: "Kepri",
        targetPct: i === 0 ? null : 20,
        realisasiPct: 10 + i,
        deviasiPp: i === 0 ? null : -10 + i,
        realisasiSebelumPct: 8,
        kenaikanPp: 2,
        grandTotal: "1000000000",
        sourceRefIds: [`lok-${i}:progress`],
      })),
    },
    kelengkapan: {
      diharapkan: 84,
      final: 60,
      diproses: 8,
      draft: 4,
      perluKoreksi: 2,
      hariNihil: 3,
      lokasiTanpaLaporan: ["Lokasi 12"],
    },
    capaian: [
      {
        locationId: "loc-1",
        lokasiNama: "Lokasi 2",
        pekerjaan: "Pasangan batu kali 1:4",
        unit: "m3",
        volume: 25.5,
        sourceRefIds: ["lok-1:laporan"],
      },
    ],
    kegiatan: [
      {
        id: "act-1",
        locationId: "loc-1",
        lokasiNama: "Lokasi 2",
        tanggalKey: "2026-07-08",
        jenis: "Rapat PCM",
        judul: "PCM bersama PPK",
        hasil: "Disepakati jadwal mobilisasi.",
      },
    ],
    kendala: {
      baruMingguIni: [
        {
          id: "i1",
          judul: "Lahan belum clear",
          severity: "tinggi",
          status: "terbuka",
          locationId: "loc-1",
          lokasiNama: "Lokasi 2",
          punyaRecovery: true,
        },
      ],
      terbukaSaatIni: [
        {
          id: "i1",
          judul: "Lahan belum clear",
          severity: "tinggi",
          status: "terbuka",
          locationId: "loc-1",
          lokasiNama: "Lokasi 2",
          punyaRecovery: true,
        },
      ],
      statusTerkini: true,
    },
    pemulihan: [
      {
        issueId: "i1",
        judulKendala: "Lahan belum clear",
        tindakan: "Koordinasi dengan pemilik lahan",
        pic: null,
        targetKey: "2026-07-10",
        status: "berjalan",
        overdue: true,
        lokasiNama: "Lokasi 2",
      },
    ],
    fotoKandidat: [
      {
        id: "f1",
        locationId: "loc-1",
        lokasiNama: "Lokasi 2",
        tanggalKey: "2026-07-08",
        keterangan: "Pasangan batu",
        r2Key: "photos/x.webp",
        thumbnailKey: null,
      },
    ],
    rencanaMingguDepan: null,
    limitations: ["1 lokasi belum punya kurva-S."],
    sourceRefs: [{ id: "paket:rekap", entityType: "package", entityId: "pkg-1", label: "Rekap paket" }],
  };
}

function content(): PaparanContent {
  const s = snapshot();
  return {
    scopeHash: "abc",
    templateKey: PAPARAN_TEMPLATE_KEY,
    templateVersion: 1,
    packageId: "pkg-1",
    weekNumber: 6,
    snapshot: s,
    narasi: narasiDeterministik(s),
    narasiSumber: "deterministik",
    selectedPhotoIds: ["f1"], // fotonya akan GAGAL dimuat (R2 mati) — sengaja
    humanEdits: null,
  };
}

describe("renderPaparanPdf", () => {
  it("menghasilkan PDF sah, halaman = jumlah slide, ukuran 960×540 konsisten", async () => {
    const c = content();
    const buf = await renderPaparanPdf(c, { draf: true });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const teks = buf.toString("latin1");
    const slides = susunSlides(c, { draf: true });
    const pages = (teks.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pages).toBe(slides.length);
    // SEMUA halaman 16:9 — MediaBox seragam (spec §17 tes 26).
    const media = teks.match(/MediaBox \[0 0 (\d+) (\d+)\]/g) ?? [];
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((m) => m.includes("960") && m.includes("540"))).toBe(true);
  });

  it("foto gagal dimuat TIDAK menggagalkan PDF (placeholder)", async () => {
    // R2 dimatikan di mock atas; selectedPhotoIds tetap berisi.
    const buf = await renderPaparanPdf(content(), { draf: true });
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("PDF final (bukan draf) tetap sah dan berhalaman sama", async () => {
    const c = content();
    const draf = await renderPaparanPdf(c, { draf: true });
    const final = await renderPaparanPdf(c, { draf: false });
    expect(final.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pages(final)).toBe(pages(draf));
  });

  it("nama berkas unduhan aman dari karakter aneh", () => {
    const c = content();
    c.snapshot.paket.name = 'Paket "Natuna"/<KKP>';
    expect(namaBerkasPaparan(c, 2)).toBe("Paparan_KKP_Paket_Natuna_KKP_Minggu_6_v2.pdf");
  });
});
