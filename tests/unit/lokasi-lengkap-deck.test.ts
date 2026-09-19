/*
 * DECK 16:9 LAPORAN LENGKAP LOKASI (DECISIONS 590 + 589).
 *
 * Deck dipakai di rapat: kalau rupanya patah atau slidenya hilang, yang tahu
 * duluan adalah ruangan, bukan yang membuatnya. Jadi bentuk dasarnya dijaga
 * mesin: PDF sah, SEMUA halaman 960×540, susunan slide tidak berubah oleh tema,
 * dan snapshot yang setengah kosong (belum berkontrak, tanpa kurva-S, tanpa
 * kendala) tetap menghasilkan deck — bagian yang datanya tidak ada dilewati,
 * bukan dicetak sebagai nol.
 *
 * R2 sengaja MATI: foto yang gagal dimuat harus jadi placeholder, bukan
 * menggagalkan seluruh deck.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

/**
 * Warna yang BENAR-BENAR dipakai menggambar, direkam dari dokumen pdfkit.
 *
 * Byte PDF antar tema selalu berbeda (pdfkit menulis CreationDate/ID yang
 * berubah tiap render), jadi "byte-nya berbeda" saja tidak membuktikan temanya
 * sampai ke gambar. Yang membuktikannya adalah warna yang dipanggil ke
 * `fillColor`/`strokeColor` — pola yang sama dengan `paparan-tema.test.ts`.
 */
const { WARNA } = vi.hoisted(() => ({ WARNA: [] as string[] }));

vi.mock("@/lib/pdf/document", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/pdf/document")>();
  return {
    ...asli,
    createDeck169Doc: (meta?: { title?: string; author?: string }) => {
      const doc = asli.createDeck169Doc(meta);
      const rekam = <T extends "fillColor" | "strokeColor">(nama: T) => {
        const asal = doc[nama].bind(doc) as (...a: unknown[]) => unknown;
        (doc as unknown as Record<string, unknown>)[nama] = (...a: unknown[]) => {
          if (typeof a[0] === "string") WARNA.push(a[0].toLowerCase());
          return asal(...a);
        };
      };
      rekam("fillColor");
      rekam("strokeColor");
      return doc;
    },
  };
});

vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
  r2PresignGet: async () => {
    throw new Error("R2 mati di uji");
  },
}));

const { DeckBelumTersediaError, renderLaporanLokasiDeck } = await import("@/lib/lokasi-lengkap/render-deck");
const { TEMA, TEMA_DECK } = await import("@/lib/paparan/tema");
const { laporanLokasiFixture } = await import("../fixtures/laporan-lokasi-lengkap");
import type { LaporanLokasiLengkap } from "@/lib/lokasi-lengkap/jenis";

function jumlahHalaman(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** Snapshot yang belum punya apa-apa: belum berkontrak, tanpa kurva/kendala/kelengkapan. */
function fixtureKosong(): LaporanLokasiLengkap {
  const dasar = laporanLokasiFixture();
  return laporanLokasiFixture({
    identitas: { ...dasar.identitas, kontrak: null, pelaksana: null, gps: null },
    kesimpulan: ["Kemadang belum berkontrak."],
    progres: {
      ...dasar.progres,
      rencanaPct: null,
      deviasiPp: null,
      realisasiPct: 0,
      terverifikasiPct: 0,
      mingguKe: 0,
      totalMinggu: 0,
      punyaRab: false,
      punyaKurva: false,
      nilaiRab: "0",
      nilaiTerpasang: "0",
    },
    mingguan: [],
    kurva: null,
    durasi: null,
    kategori: [],
    kelengkapan: null,
    kendala: {
      ringkas: { terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 0, tertuaHari: null },
      terbuka: [],
      selesaiTerbaru: [],
    },
    kronologi: {
      sejakKey: "2026-09-18",
      babak: [],
      kondisi: {
        ...dasar.kronologi.kondisi,
        kendalaTerbuka: 0,
        kegiatanTerakhir: null,
        hariTanpaKegiatan: null,
        kendalaTertuaHari: null,
      },
      totalPeristiwa: 0,
      dipotong: 0,
    },
    kegiatan: { total: 0, terakhir: [] },
    temuan: {
      ringkas: { total: 0, terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 0, inspeksi: 0, inspeksiTerakhirKey: null },
      terbuka: [],
    },
    administrasi: {
      milestone: [],
      dokumen: { total: 0, kedaluwarsa: 0, segeraKedaluwarsa: 0, perFase: [] },
      surat: { masuk: 0, keluar: 0, perluBalas: 0, lewatTenggatBalas: 0, terakhir: [] },
    },
    foto: { total: 0, kandidat: [] },
    rencanaMingguDepan: null,
    perhatian: [],
    limitations: [],
    sumber: [],
  });
}

describe("renderLaporanLokasiDeck", () => {
  it("fixture penuh → PDF sah, semua halaman 960×540, minimal 12 slide", async () => {
    const pdf = await renderLaporanLokasiDeck(laporanLokasiFixture());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const teks = pdf.toString("latin1");
    const media = teks.match(/MediaBox \[0 0 (\d+) (\d+)\]/g) ?? [];
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((m) => m.includes("960") && m.includes("540"))).toBe(true);
    // Sampul + kesimpulan + kurva + mingguan + kategori + kelengkapan + kendala
    // + kronologi (2 babak) + kegiatan + temuan + administrasi + perhatian +
    // rencana + foto + lampiran + penutup.
    expect(jumlahHalaman(pdf)).toBeGreaterThanOrEqual(12);
  }, 60_000);

  it("keempat tema: jumlah halaman sama, byte berbeda, palet masing-masing benar-benar terpakai", async () => {
    const l = laporanLokasiFixture();
    const hasil = new Map<string, Buffer>();
    for (const k of TEMA_DECK) {
      WARNA.length = 0;
      const buf = await renderLaporanLokasiDeck(l, { tema: k });
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      hasil.set(k, buf);

      const dipakai = new Set(WARNA);
      expect(dipakai.has(TEMA[k].palet.aksen.toLowerCase()), `aksen ${k} tidak terpakai`).toBe(true);
      expect(dipakai.has(TEMA[k].palet.primer.toLowerCase()), `primer ${k} tidak terpakai`).toBe(true);
      // Aksen tema lain tidak boleh bocor (kecuali kebetulan warnanya sama).
      for (const lain of TEMA_DECK) {
        if (lain === k) continue;
        const aksenLain = TEMA[lain].palet.aksen.toLowerCase();
        if (aksenLain === TEMA[k].palet.aksen.toLowerCase()) continue;
        expect(dipakai.has(aksenLain), `aksen ${lain} bocor ke ${k}`).toBe(false);
      }
    }
    // Susunan slide TIDAK tahu tema: jumlah halamannya sama untuk keempatnya.
    const halaman = [...hasil.values()].map(jumlahHalaman);
    expect(new Set(halaman).size, `halaman per tema: ${halaman.join(", ")}`).toBe(1);
    // Rupanya memang berbeda: tidak ada dua tema yang byte-nya identik.
    const isi = [...hasil.values()].map((b) => b.toString("latin1"));
    expect(new Set(isi).size).toBe(TEMA_DECK.length);
  }, 120_000);

  it("fixture tanpa kontrak/kurva/kendala/kelengkapan tidak melempar dan tetap sah", async () => {
    const pdf = await renderLaporanLokasiDeck(fixtureKosong());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Sampul + kesimpulan + lampiran + penutup: yang kosong DILEWATI.
    expect(jumlahHalaman(pdf)).toBeGreaterThanOrEqual(3);
    expect(jumlahHalaman(pdf)).toBeLessThan(jumlahHalaman(await renderLaporanLokasiDeck(laporanLokasiFixture())));
  }, 60_000);

  it("kunci tema asing jatuh ke tema bawaan, bukan galat", async () => {
    const pdf = await renderLaporanLokasiDeck(laporanLokasiFixture(), {
      tema: "neon_ungu" as (typeof TEMA_DECK)[number],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(jumlahHalaman(pdf)).toBe(jumlahHalaman(await renderLaporanLokasiDeck(laporanLokasiFixture())));
  }, 60_000);

  it("DeckBelumTersediaError tetap diekspor – route unduhan & jalur WhatsApp masih menangkapnya", () => {
    expect(new DeckBelumTersediaError("uji")).toBeInstanceOf(Error);
  });
});
