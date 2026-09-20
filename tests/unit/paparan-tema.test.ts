/*
 * TEMA DECK PAPARAN — empat variasi RUPA, isi tak tersentuh.
 *
 * Permintaan user 2026-09-19: "desain layout masih monoton (cuma satu desain)
 * aku butuh beberapa variasi". Yang dijaga di sini:
 *  - registri tema jatuh ke "mataram" untuk kunci apa pun yang tak dikenal;
 *  - susunSlides IDENTIK untuk semua tema (tema tidak boleh menyentuh isi);
 *  - keempat tema menghasilkan PDF sah dengan jumlah halaman sama, tetapi
 *    byte-nya berbeda (kalau sama, "tema" cuma nama);
 *  - artefak lama tanpa ruas tema tetap terender;
 *  - primitif bertema (lib/pdf/deck-primitives.ts) bekerja untuk slide terang
 *    maupun gelap — kontraknya dipakai deck lain (laporan lengkap lokasi).
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

/**
 * Warna yang BENAR-BENAR dipakai menggambar, direkam dari dokumen pdfkit.
 *
 * Membandingkan byte PDF antar tema TIDAK membuktikan apa pun: pdfkit
 * menuliskan CreationDate/ID yang berubah tiap render, jadi dua render yang
 * identik pun berbeda byte — diukur, bukan dikira. Yang membuktikan tema
 * sampai ke gambar adalah warna yang dipanggil ke `fillColor`/`strokeColor`.
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

// R2 MATI: jalur foto jatuh ke placeholder — yang diuji rupa deck, bukan foto.
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
  r2PresignGet: async () => {
    throw new Error("R2 mati di uji");
  },
}));

const { renderPaparanPdf } = await import("@/lib/paparan/render-pdf");
const { narasiDeterministik, susunSlides } = await import("@/lib/paparan/susun");
const { PAPARAN_TEMPLATE_KEY, PAPARAN_TEMPLATE_VERSION } = await import("@/lib/paparan/jenis");
const { TEMA, TEMA_DECK, temaDeck, PILIHAN_TEMA_DECK } = await import("@/lib/paparan/tema");
const prim = await import("@/lib/pdf/deck-primitives");
const { createDeck169Doc, docToBuffer } = await import("@/lib/pdf/document");
import type { PaparanContent, PaparanSnapshot } from "@/lib/paparan/jenis";
import type { TemaDeckKey } from "@/lib/paparan/tema";

function snapshot(): PaparanSnapshot {
  const plan = Array.from({ length: 22 }, (_, i) => Math.round((100 * (i + 1)) / 22));
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
      lokasi: Array.from({ length: 3 }, (_, i) => ({
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
    kelengkapan: { diharapkan: 21, final: 15, diproses: 2, draft: 1, perluKoreksi: 1, hariNihil: 1, lokasiTanpaLaporan: [] },
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
        { id: "i1", judul: "Lahan belum clear", severity: "tinggi", status: "terbuka", locationId: "loc-1", lokasiNama: "Lokasi 2", punyaRecovery: true },
      ],
      terbukaSaatIni: [
        { id: "i1", judul: "Lahan belum clear", severity: "tinggi", status: "terbuka", locationId: "loc-1", lokasiNama: "Lokasi 2", punyaRecovery: true },
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
      { id: "f1", locationId: "loc-1", lokasiNama: "Lokasi 2", tanggalKey: "2026-07-08", keterangan: "Pasangan batu", r2Key: "photos/x.webp", thumbnailKey: null, lineageKey: "I#1" },
    ],
    rencanaMingguDepan: null,
    kurva: {
      totalMinggu: 22,
      planPct: plan,
      jendela: [
        { minggu: 4, realisasiPct: 11.2, kenaikanPp: null },
        { minggu: 5, realisasiPct: 15, kenaikanPp: 3.8 },
        { minggu: 6, realisasiPct: 18.1, kenaikanPp: 3.1 },
      ],
    },
    durasi: { totalHari: 150, hariBerjalan: 42, sisaHari: 108, pctWaktu: 28 },
    kategori: [
      {
        locationId: "loc-1",
        lokasiNama: "Lokasi 2",
        kelompok: [
          { lineageKey: "I", nama: "Pekerjaan Persiapan", realisasiPct: 85, bobotPct: 5 },
          { lineageKey: "II", nama: "Pekerjaan Tanah", realisasiPct: 45, bobotPct: 20 },
          { lineageKey: "III", nama: "Pekerjaan Struktur", realisasiPct: 22, bobotPct: 30 },
          { lineageKey: "IV", nama: "Pekerjaan Arsitektur", realisasiPct: 5, bobotPct: 45 },
        ],
      },
    ],
    limitations: ["1 lokasi belum punya kurva-S."],
    sourceRefs: [{ id: "paket:rekap", entityType: "package", entityId: "pkg-1", label: "Rekap paket" }],
  };
}

function content(tema?: TemaDeckKey): PaparanContent {
  const s = snapshot();
  const c: PaparanContent = {
    scopeHash: "abc",
    templateKey: PAPARAN_TEMPLATE_KEY,
    templateVersion: PAPARAN_TEMPLATE_VERSION,
    packageId: "pkg-1",
    weekNumber: 6,
    snapshot: s,
    narasi: narasiDeterministik(s),
    narasiSumber: "deterministik",
    selectedPhotoIds: ["f1"],
    humanEdits: null,
  };
  if (tema) c.tema = tema;
  return c;
}

const halaman = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

/* ── Registri ───────────────────────────────────────────────────────────── */

describe("registri tema deck", () => {
  it("kunci tak dikenal / kosong jatuh ke mataram", () => {
    expect(temaDeck("ngawur").key).toBe("mataram");
    expect(temaDeck(undefined).key).toBe("mataram");
    expect(temaDeck(null).key).toBe("mataram");
    expect(temaDeck("").key).toBe("mataram");
    expect(temaDeck("bakau").key).toBe("bakau");
  });

  it("empat tema, empat bentuk sampul yang berbeda, pilihan Combobox lengkap", () => {
    expect(TEMA_DECK).toHaveLength(4);
    const sampul = new Set(TEMA_DECK.map((k) => TEMA[k].sampul));
    expect(sampul.size).toBe(4);
    expect(PILIHAN_TEMA_DECK.map((p) => p.value)).toEqual([...TEMA_DECK]);
    for (const p of PILIHAN_TEMA_DECK) {
      expect(p.label.length).toBeGreaterThan(0);
      // Deskripsi tema dibaca orang di Combobox → en-dash, bukan em-dash
      // (DECISIONS 385). Ditulis lewat kode karakter supaya berkas uji ini
      // sendiri tidak memuat em-dash yang dilarangnya.
      expect(p.deskripsi).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

/* ── Isi tak tersentuh ──────────────────────────────────────────────────── */

describe("tema tidak menyentuh isi", () => {
  it("susunSlides identik untuk content dengan tema apa pun", () => {
    const acuan = JSON.stringify(susunSlides(content(), { draf: true }));
    for (const k of TEMA_DECK) {
      expect(JSON.stringify(susunSlides(content(k), { draf: true }))).toBe(acuan);
    }
  });
});

/* ── PDF ────────────────────────────────────────────────────────────────── */

describe("renderPaparanPdf bertema", () => {
  it("keempat tema: PDF sah, jumlah halaman sama, dan paletnya benar-benar terpakai", async () => {
    const jumlahSlide = susunSlides(content(), { draf: true }).length;
    for (const k of TEMA_DECK) {
      WARNA.length = 0;
      const buf = await renderPaparanPdf(content(k), { draf: true });
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(halaman(buf), `halaman ${k}`).toBe(jumlahSlide);

      const dipakai = new Set(WARNA);
      // Warna pokok tema ini HARUS tergambar.
      expect(dipakai.has(TEMA[k].palet.aksen.toLowerCase()), `aksen ${k} tidak terpakai`).toBe(true);
      expect(dipakai.has(TEMA[k].palet.primer.toLowerCase()), `primer ${k} tidak terpakai`).toBe(true);
      // Aksen tema LAIN tidak boleh bocor (kecuali kebetulan warnanya sama).
      for (const lain of TEMA_DECK) {
        if (lain === k) continue;
        const aksenLain = TEMA[lain].palet.aksen.toLowerCase();
        if (aksenLain === TEMA[k].palet.aksen.toLowerCase()) continue;
        expect(dipakai.has(aksenLain), `aksen ${lain} bocor ke ${k}`).toBe(false);
      }
    }
  }, 60_000);

  it("tema berselang punya slide gelap, tema tanpa selang tidak pernah memakai latar gelapnya", async () => {
    for (const k of TEMA_DECK) {
      WARNA.length = 0;
      await renderPaparanPdf(content(k), { draf: true });
      const dipakai = new Set(WARNA);
      const p = TEMA[k].palet;
      if (TEMA[k].berselang) {
        expect(dipakai.has(p.gelap.toLowerCase()), `${k} seharusnya punya slide gelap`).toBe(true);
        expect(dipakai.has(p.gelapKartu.toLowerCase()), `${k} kartu gelap`).toBe(true);
      } else {
        // Latar gelap tidak dipakai — kecuali warnanya kebetulan sama dengan
        // primer, yang memang tergambar sebagai blok judul/pita.
        if (p.gelap.toLowerCase() !== p.primer.toLowerCase()) {
          expect(dipakai.has(p.gelap.toLowerCase()), `${k} tidak boleh punya slide gelap`).toBe(false);
        }
        expect(dipakai.has(p.terang.toLowerCase()), `${k} latar terang`).toBe(true);
      }
    }
  }, 60_000);

  it("artefak lama TANPA ruas tema tetap dirender (= mataram)", async () => {
    const c = content();
    expect("tema" in c).toBe(false);
    const buf = await renderPaparanPdf(c, { draf: false });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(halaman(buf)).toBe(susunSlides(c, { draf: false }).length);
  });

  it("kunci tema asing di artefak (versi lain) tidak menggagalkan render", async () => {
    const c = { ...content(), tema: "neon_ungu" as TemaDeckKey };
    const buf = await renderPaparanPdf(c, { draf: true });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

/* ── Primitif bertema ───────────────────────────────────────────────────── */

describe("deck-primitives", () => {
  it("buatDeckCtx memuat ukuran DECK_169 dan tema", () => {
    const doc = createDeck169Doc();
    const ctx = prim.buatDeckCtx(doc, TEMA.terang);
    expect(ctx.W).toBe(960);
    expect(ctx.H).toBe(540);
    expect(ctx.MX).toBe(52);
    expect(ctx.CW).toBe(960 - 52 * 2);
    expect(ctx.tema.key).toBe("terang");
    doc.end();
  });

  it("slideGelap: berselang → ganjil gelap; tanpa selang → selalu terang", () => {
    expect(prim.slideGelap(TEMA.mataram, 0)).toBe(false);
    expect(prim.slideGelap(TEMA.mataram, 1)).toBe(true);
    expect(prim.slideGelap(TEMA.mataram, 2)).toBe(false);
    expect(prim.slideGelap(TEMA.bakau, 3)).toBe(true);
    for (let i = 0; i < 6; i++) {
      expect(prim.slideGelap(TEMA.terang, i)).toBe(false);
      expect(prim.slideGelap(TEMA.merah_putih, i)).toBe(false);
    }
    expect(prim.bingkaiGelap(TEMA.mataram)).toBe(true);
    expect(prim.bingkaiGelap(TEMA.terang)).toBe(false);
  });

  it("potongTeks memotong ke satu baris dengan elipsis, teks pendek utuh", () => {
    const doc = createDeck169Doc();
    const ctx = prim.buatDeckCtx(doc, TEMA.mataram);
    doc.fontSize(11);
    expect(prim.potongTeks(ctx, "Pendek", 400)).toBe("Pendek");
    const panjang = prim.potongTeks(ctx, "Pekerjaan Sondir termasuk Pelaporan termasuk mobilisasi Alat dan Personil", 120);
    expect(panjang.endsWith("…")).toBe(true);
    expect(doc.widthOfString(panjang)).toBeLessThanOrEqual(120);
    doc.end();
  });

  it("judulSlide mengembalikan y isi di bawah judul untuk ketiga gaya, terang & gelap", () => {
    for (const k of TEMA_DECK) {
      const doc = createDeck169Doc();
      const ctx = prim.buatDeckCtx(doc, TEMA[k]);
      for (const gelap of [false, true]) {
        prim.latarSlide(ctx, gelap);
        const y = prim.judulSlide(ctx, "Ringkasan Eksekutif", gelap);
        expect(y).toBeGreaterThan(60);
        expect(y).toBeLessThan(140);
      }
      doc.end();
    }
  });

  it("sampul + penutup keempat tema terender dengan palet masing-masing", async () => {
    for (const k of TEMA_DECK) {
      WARNA.length = 0;
      const doc = createDeck169Doc();
      const ctx = prim.buatDeckCtx(doc, TEMA[k]);
      prim.renderSampulDeck(ctx, {
        eyebrow: "PAPARAN MINGGUAN · MINGGU KE-6",
        judul: "Pembangunan Kampung Nelayan Merah Putih Natuna",
        subJudul: "Paket Natuna",
        meta: [
          { label: "Periode", nilai: "2026-07-06 s.d. 2026-07-12" },
          { label: "Realisasi", nilai: "18,1%" },
          { label: "Deviasi", nilai: "-2,3 pp", warna: TEMA[k].palet.merah },
        ],
        barisBawah: ["KKP", "SPK-001", "PT Uji"],
        draf: true,
      });
      doc.addPage();
      prim.renderPenutupDeck(ctx, { judul: "Terima Kasih", sub: "Tetap Semangat" });
      const buf = await docToBuffer(doc);
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(halaman(buf)).toBe(2);
      /*
       * Bahwa keempat sampul berbeda TATA LETAKNYA diperiksa di dua tempat
       * lain: `paparan-preview-tema.test.tsx` (markup pratinjau, strukturnya
       * dibandingkan setelah warna dibuang) dan verifikasi visual PDF→PNG.
       * Di sini yang bisa dijamin mesin adalah paletnya benar-benar dipakai.
       */
      const dipakai = new Set(WARNA);
      expect(dipakai.has(TEMA[k].palet.aksen.toLowerCase()), `aksen ${k}`).toBe(true);
      expect(dipakai.has(TEMA[k].palet.primer.toLowerCase()), `primer ${k}`).toBe(true);
    }
  });

  it("kartuAngka / tabel / butirList / chip / footer / watermark bekerja di slide terang & gelap", async () => {
    for (const k of TEMA_DECK) {
      const doc = createDeck169Doc();
      const ctx = prim.buatDeckCtx(doc, TEMA[k]);
      for (const gelap of [false, true]) {
        if (gelap) doc.addPage();
        prim.latarSlide(ctx, gelap);
        let y = prim.judulSlide(ctx, "Uji Primitif", gelap);
        y = prim.kartuAngka(
          ctx,
          [
            { label: "Rencana", nilai: "20,4%" },
            { label: "Realisasi", nilai: "18,1%" },
            { label: "Deviasi", nilai: "-2,3 pp", warna: TEMA[k].palet.merah },
          ],
          y,
          gelap,
        );
        const y2 = prim.tabel(
          ctx,
          [
            { label: "Lokasi", w: 400 },
            { label: "Realisasi", w: 200, align: "right" },
            { label: "Status", w: ctx.CW - 600 },
          ],
          [
            ["Lokasi 1", "10,0%", "lengkap"],
            ["Lokasi 2 dengan nama yang sangat panjang sekali sampai melewati batas kolom", "11,0%", "belum ada kurva-S"],
          ],
          y,
          gelap,
        );
        expect(y2).toBeGreaterThan(y + 24 * 3);
        const y3 = prim.butirList(ctx, ["Butir satu", "Butir dua"], ctx.MX, y2, ctx.CW, gelap);
        expect(y3).toBeGreaterThan(y2);
        const y4 = prim.butirList(ctx, ["Langkah satu", "Langkah dua"], ctx.MX, y3, ctx.CW, gelap, { bernomor: true });
        expect(y4).toBeGreaterThan(y3);
        const w1 = prim.chip(ctx, ctx.MX, y4, "Deviasi: -2,3 pp", { warna: TEMA[k].palet.merah, gelap });
        expect(w1).toBeGreaterThan(20);
        const w2 = prim.chip(ctx, ctx.MX + w1 + 8, y4, "OK", {});
        expect(w2).toBeGreaterThan(10);
        prim.chip(ctx, ctx.MX + w1 + w2 + 16, y4, "Apa adanya", { warna: "#123456", teksWarna: "#ffffff" });
        prim.watermarkDraf(ctx, gelap);
        prim.footerSlide(ctx, "Paket Natuna · Minggu ke-6", gelap ? 2 : 1, 2, gelap);
      }
      const buf = await docToBuffer(doc);
      expect(halaman(buf)).toBe(2);
    }
  });

  it("gambarKurva: menerima null di realisasi, deret kosong, dan minggu di luar jangkauan", async () => {
    const doc = createDeck169Doc();
    const ctx = prim.buatDeckCtx(doc, TEMA.merah_putih);
    prim.latarSlide(ctx, false);
    const y = prim.judulSlide(ctx, "Kurva-S", false);
    const k = { x: ctx.MX + 34, y: y + 20, w: ctx.CW - 44, h: 260 };
    prim.gambarKurva(
      ctx,
      { ...k, planPct: [0, 10, 30, 60, 100], actualPct: [0, 8, null, 40, null], mingguSekarang: 4 },
      false,
    );
    doc.addPage();
    prim.latarSlide(ctx, true);
    prim.gambarKurva(ctx, { ...k, planPct: [], actualPct: [], mingguSekarang: 0 }, true);
    doc.addPage();
    prim.gambarKurva(
      ctx,
      { ...k, planPct: [0, 50, 100], actualPct: [null, null, null], mingguSekarang: 99, labelRencana: "Rencana", labelRealisasi: "Realisasi" },
      false,
    );
    const buf = await docToBuffer(doc);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(halaman(buf)).toBe(3);
  });
});
