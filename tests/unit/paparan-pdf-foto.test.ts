/*
 * JALUR FOTO BERHASIL pada renderer paparan — uji yang SEHARUSNYA ada sejak awal.
 *
 * Kenapa berkas terpisah: `paparan-pdf.test.ts` mematikan R2 di level modul,
 * jadi ia hanya pernah menempuh jalur GAGAL (placeholder). Akibatnya bug nyata
 * lolos ke produksi — `doc.image(Buffer)` melempar
 * "fs.readFileSync is not a function" karena bundle pdfkit yang di-vendor
 * (assets/pdfkit-standalone.cjs) MENSTUB `fs`; gambar harus dioper sebagai
 * DATA URI base64 (DECISIONS 129). Uji ini menempuh jalur itu sungguhan:
 * R2 menyala, buffer gambar nyata, dan PDF diperiksa benar-benar memuat
 * XObject gambar — bukan sekadar "tidak melempar".
 */
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

/** Dua gambar BERBEDA: pdfkit menyatukan gambar identik jadi satu XObject. */
async function gambarUji(biru: number): Promise<Buffer> {
  return sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 32, g: 120, b: biru } } })
    .png()
    .toBuffer();
}
const fotoAsli = new Map<string, Buffer>([
  ["photos/a.webp", await gambarUji(200)],
  ["photos/b.webp", await gambarUji(40)],
]);

vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2GetBuffer: async (key: string) => {
    const b = fotoAsli.get(key);
    if (!b) throw new Error(`kunci tak dikenal: ${key}`);
    return b;
  },
  r2PresignGet: async () => "https://contoh.invalid/foto",
}));

const { renderPaparanPdf } = await import("@/lib/paparan/render-pdf");
const { narasiDeterministik } = await import("@/lib/paparan/susun");
const { PAPARAN_TEMPLATE_KEY, PAPARAN_TEMPLATE_VERSION } = await import("@/lib/paparan/jenis");
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
        lokasiTanpaKurva: 0,
      },
      lokasi: [
        {
          locationId: "loc-1",
          slug: "lok-1",
          name: "Lokasi 1",
          regency: "Natuna",
          province: "Kepri",
          targetPct: 20,
          realisasiPct: 18,
          deviasiPp: -2,
          realisasiSebelumPct: 15,
          kenaikanPp: 3,
          grandTotal: "1000000000",
          sourceRefIds: ["lok-1:progress"],
        },
      ],
    },
    kelengkapan: {
      diharapkan: 7,
      final: 7,
      diproses: 0,
      draft: 0,
      perluKoreksi: 0,
      hariNihil: 0,
      lokasiTanpaLaporan: [],
    },
    capaian: [],
    kegiatan: [],
    kendala: { baruMingguIni: [], terbukaSaatIni: [], statusTerkini: true },
    pemulihan: [],
    fotoKandidat: [
      {
        id: "f1",
        locationId: "loc-1",
        lokasiNama: "Lokasi 1",
        tanggalKey: "2026-07-08",
        keterangan: "Pasangan batu kali sisi utara",
        r2Key: "photos/a.webp",
        thumbnailKey: "photos/a-thumb.webp",
        lineageKey: null,
      },
      {
        id: "f2",
        locationId: "loc-1",
        lokasiNama: "Lokasi 1",
        tanggalKey: "2026-07-09",
        keterangan: "Bekisting kolom",
        r2Key: "photos/b.webp",
        thumbnailKey: null,
        lineageKey: null,
      },
    ],
    rencanaMingguDepan: null,
    limitations: [],
    sourceRefs: [{ id: "paket:rekap", entityType: "package", entityId: "pkg-1", label: "Rekap paket" }],
  };
}

function content(): PaparanContent {
  const s = snapshot();
  return {
    scopeHash: "abc",
    templateKey: PAPARAN_TEMPLATE_KEY,
    templateVersion: PAPARAN_TEMPLATE_VERSION,
    packageId: "pkg-1",
    weekNumber: 6,
    snapshot: s,
    narasi: narasiDeterministik(s),
    narasiSumber: "deterministik",
    selectedPhotoIds: ["f1", "f2"],
    humanEdits: null,
  };
}

/** Jumlah XObject gambar yang benar-benar tertanam di dokumen. */
function jumlahGambar(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;
}

describe("renderPaparanPdf – foto sungguhan lewat bundle pdfkit yang di-vendor", () => {
  it("menanam foto ke PDF (bukan diam-diam jatuh ke placeholder)", async () => {
    const buf = await renderPaparanPdf(content(), { draf: true });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    // Dua foto dipilih → dua XObject gambar. Nol berarti jalur foto gagal
    // diam-diam; inilah yang dulu lolos karena R2 selalu dimatikan di uji.
    expect(jumlahGambar(buf)).toBeGreaterThanOrEqual(2);
  });

  it("tanpa foto terpilih tidak ada XObject gambar sama sekali", async () => {
    const tanpa = await renderPaparanPdf({ ...content(), selectedPhotoIds: [] }, { draf: true });
    expect(jumlahGambar(tanpa)).toBe(0);
  });

  it("PDF final juga menanam foto", async () => {
    const buf = await renderPaparanPdf(content(), { draf: false });
    expect(jumlahGambar(buf)).toBeGreaterThanOrEqual(2);
  });
});
