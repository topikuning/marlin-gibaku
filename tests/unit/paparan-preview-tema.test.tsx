/*
 * PRATINJAU SLIDE IKUT TEMA — dan tetap berjudul sama.
 *
 * Pratinjau yang tidak ikut tema bukan pratinjau: orang menyetujui deck dari
 * layar ini, lalu mengunduh PDF yang rupanya lain. Yang dijaga:
 *  - keempat tema merender SELURUH jenis slide tanpa melempar;
 *  - warna aksen tiap tema benar-benar sampai ke markup (style inline), dan
 *    aksen tema lain tidak bocor ke sana;
 *  - sampul keempat tema menghasilkan markup yang berbeda (empat bentuk);
 *  - latar gelap hanya muncul pada tema berselang;
 *  - judul <h3> yang dipakai e2e (paparan-kkp.spec.ts) tidak berubah teksnya.
 *
 * Batas uji ini: yang diperiksa markup statis hasil render, bukan tampilan di
 * browser — repo belum punya alat uji DOM/visual.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const { SlidePreview } = await import("@/app/(app)/ai/paparan/[id]/slide-preview");
const { TEMA, TEMA_DECK } = await import("@/lib/paparan/tema");
import type { Slide } from "@/lib/paparan/susun";
import type { TemaDeckKey } from "@/lib/paparan/tema";

/** Satu contoh untuk SETIAP jenis slide — kalau ada jenis baru, ia ikut diuji. */
function semuaSlide(): Slide[] {
  return [
    {
      jenis: "sampul",
      judulKerja: "Pembangunan Kampung Nelayan Merah Putih Natuna",
      subJudul: "Paket Natuna",
      nomorKontrak: "SPK-001",
      pelaksana: "PT Uji Konstruksi",
      mingguKe: 6,
      periodeLabel: "2026-07-06 s.d. 2026-07-12",
      instansi: "KKP",
      berjalan: false,
      draf: true,
      meta: { realisasiPct: 18.1, rencanaPct: 20.4, deviasiPp: -2.3 },
    },
    {
      jenis: "kurva",
      kurva: {
        totalMinggu: 22,
        planPct: Array.from({ length: 22 }, (_, i) => Math.round((100 * (i + 1)) / 22)),
        jendela: [
          { minggu: 4, realisasiPct: 11.2, kenaikanPp: null },
          { minggu: 5, realisasiPct: 15, kenaikanPp: 3.8 },
          { minggu: 6, realisasiPct: 18.1, kenaikanPp: -1.2 },
        ],
      },
      deviasiPp: -2.3,
      mingguKe: 6,
    },
    { jenis: "durasi", d: { totalHari: 150, hariBerjalan: 42, sisaHari: 108, pctWaktu: 28 } },
    {
      jenis: "ringkasan",
      butir: ["Realisasi paket 18,1% terhadap rencana 20,4%."],
      angka: { rencana: 20.4, realisasi: 18.1, deviasi: -2.3, laporanFinal: 60, laporanDiharapkan: 84 },
    },
    {
      jenis: "progres_lokasi",
      baris: [
        {
          locationId: "loc-1",
          slug: "lok-1",
          name: "Lokasi 1",
          regency: "Natuna",
          province: "Kepri",
          targetPct: null,
          realisasiPct: 10,
          deviasiPp: null,
          realisasiSebelumPct: 8,
          kenaikanPp: 2,
          grandTotal: "1000000000",
          sourceRefIds: [],
        },
        {
          locationId: "loc-2",
          slug: "lok-2",
          name: "Lokasi 2",
          regency: "Natuna",
          province: "Kepri",
          targetPct: 20,
          realisasiPct: 11,
          deviasiPp: -9,
          realisasiSebelumPct: 8,
          kenaikanPp: 3,
          grandTotal: "1000000000",
          sourceRefIds: [],
        },
      ],
      bagian: 1,
      totalBagian: 1,
    },
    {
      jenis: "status_kategori",
      lokasiNama: "Lokasi 2",
      baris: [
        { nama: "Pekerjaan Persiapan", realisasiPct: 85 },
        { nama: "Pekerjaan Struktur", realisasiPct: 22 },
      ],
      bagian: 1,
      totalBagian: 1,
    },
    {
      jenis: "capaian",
      butir: ["Pasangan batu kali 25,5 m3."],
      rincian: [
        {
          locationId: "loc-2",
          lokasiNama: "Lokasi 2",
          pekerjaan: "Pasangan batu kali 1:4",
          unit: "m3",
          volume: 25.5,
          sourceRefIds: [],
        },
      ],
    },
    {
      jenis: "kegiatan",
      butir: [],
      rincian: [
        {
          id: "act-1",
          locationId: "loc-2",
          lokasiNama: "Lokasi 2",
          tanggalKey: "2026-07-08",
          jenis: "Rapat PCM",
          judul: "PCM bersama PPK",
          hasil: null,
        },
      ],
    },
    {
      jenis: "foto_pekerjaan",
      judul: "Pekerjaan Persiapan",
      pct: 85,
      foto: [
        {
          id: "f1",
          locationId: "loc-2",
          lokasiNama: "Lokasi 2",
          tanggalKey: "2026-07-08",
          keterangan: "Pasangan batu",
          r2Key: "photos/x.webp",
          thumbnailKey: null,
          caption: "Lokasi 2 · 2026-07-08 · Pasangan batu",
        },
      ],
    },
    {
      jenis: "kendala",
      butir: ["Satu kendala tingkat tinggi masih terbuka."],
      baru: [
        {
          id: "i1",
          judul: "Lahan belum clear",
          severity: "tinggi",
          status: "terbuka",
          locationId: "loc-2",
          lokasiNama: "Lokasi 2",
          punyaRecovery: true,
        },
      ],
      aktif: [],
      statusTerkini: true,
    },
    {
      jenis: "pemulihan",
      baris: [
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
      bagian: 1,
      totalBagian: 1,
    },
    { jenis: "action_plan", butir: ["Kejar rencana kumulatif minggu depan."], dukungan: ["Percepatan izin lahan."] },
    {
      jenis: "lampiran",
      kelengkapan: {
        diharapkan: 84,
        final: 60,
        diproses: 8,
        draft: 4,
        perluKoreksi: 2,
        hariNihil: 3,
        lokasiTanpaLaporan: ["Lokasi 12"],
      },
      lokasiTanpaKurva: 1,
      dataAsOf: "2026-07-12T10:00:00.000Z",
      limitations: ["1 lokasi belum punya kurva-S."],
    },
    { jenis: "penutup", paket: "Paket Natuna", mingguKe: 6, periodeLabel: "2026-07-06 s.d. 2026-07-12" },
  ];
}

function render(slide: Slide, tema: TemaDeckKey, nomor = 1): string {
  return renderToStaticMarkup(
    <SlidePreview slide={slide} nomor={nomor} total={14} thumbUrl={{}} tema={TEMA[tema]} />,
  );
}

describe("SlidePreview bertema", () => {
  it("seluruh jenis slide terender untuk keempat tema", () => {
    const slides = semuaSlide();
    // Kalau `Slide` bertambah jenis, fixture ini harus ikut — bukan diam-diam
    // menguji sebagian.
    expect(new Set(slides.map((s) => s.jenis)).size).toBe(slides.length);
    for (const k of TEMA_DECK) {
      for (const [i, sl] of slides.entries()) {
        const html = render(sl, k, i + 1);
        expect(html.length, `${k}/${sl.jenis}`).toBeGreaterThan(50);
      }
    }
  });

  it("judul <h3> yang dipakai e2e tetap ada apa pun temanya", () => {
    const slides = semuaSlide();
    const ringkasan = slides.find((s) => s.jenis === "ringkasan")!;
    const lampiran = slides.find((s) => s.jenis === "lampiran")!;
    for (const k of TEMA_DECK) {
      expect(render(ringkasan, k)).toContain("Ringkasan Eksekutif");
      // e2e mencocokkan /Lampiran – Kelengkapan Data & Sumber/ (en-dash).
      expect(render(lampiran, k)).toContain("Lampiran – Kelengkapan Data &amp; Sumber");
      expect(render(ringkasan, k)).toMatch(/<h3[^>]*>/);
    }
  });

  it("aksen tiap tema sampai ke style inline, aksen tema lain tidak bocor", () => {
    const ringkasan = semuaSlide().find((s) => s.jenis === "ringkasan")!;
    for (const k of TEMA_DECK) {
      const html = render(ringkasan, k).toLowerCase();
      expect(html, `${k} tidak memakai aksennya sendiri`).toContain(TEMA[k].palet.aksen.toLowerCase());
      for (const lain of TEMA_DECK) {
        if (lain === k) continue;
        // Aksen tema lain hanya boleh muncul bila kebetulan warnanya sama.
        if (TEMA[lain].palet.aksen.toLowerCase() === TEMA[k].palet.aksen.toLowerCase()) continue;
        expect(html, `aksen ${lain} bocor ke ${k}`).not.toContain(TEMA[lain].palet.aksen.toLowerCase());
      }
    }
  });

  it("sampul keempat tema berbeda markup-nya (empat bentuk, bukan empat warna)", () => {
    const sampul = semuaSlide().find((s) => s.jenis === "sampul")!;
    const html = TEMA_DECK.map((k) => render(sampul, k));
    // Bandingkan setelah warna dibuang: yang harus beda adalah STRUKTURNYA.
    const tanpaWarna = html.map((h) => h.replace(/#[0-9a-fA-F]{3,8}/g, ""));
    for (let i = 0; i < tanpaWarna.length; i++) {
      for (let j = i + 1; j < tanpaWarna.length; j++) {
        expect(tanpaWarna[i] === tanpaWarna[j], `${TEMA_DECK[i]} vs ${TEMA_DECK[j]}`).toBe(false);
      }
    }
  });

  it("latar gelap hanya pada tema berselang, dan hanya di jenis slide yang gelap", () => {
    const durasi = semuaSlide().find((s) => s.jenis === "durasi")!;
    const ringkasan = semuaSlide().find((s) => s.jenis === "ringkasan")!;
    /*
     * Yang diperiksa LATAR WADAH slide, bukan ada-tidaknya warna itu di
     * seluruh markup: pada tema merah_putih `palet.gelap` kebetulan sama
     * dengan `palet.primer`, jadi ia memang muncul — sebagai blok judul, bukan
     * sebagai latar.
     */
    const latarWadah = (html: string) => html.toLowerCase().match(/background:(#[0-9a-f]{3,8})/)?.[1] ?? "";
    for (const k of TEMA_DECK) {
      const tema = TEMA[k];
      const harusGelap = tema.berselang;
      expect(latarWadah(render(durasi, k)), `durasi ${k}`).toBe(
        (harusGelap ? tema.palet.gelap : tema.palet.terang).toLowerCase(),
      );
      // Slide ringkasan selalu terang, di tema mana pun.
      expect(latarWadah(render(ringkasan, k)), `ringkasan ${k}`).toBe(tema.palet.terang.toLowerCase());
    }
  });
});
