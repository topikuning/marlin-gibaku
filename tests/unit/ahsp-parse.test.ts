import { describe, expect, it } from "vitest";
import { AhspParseError, bacaMasterAhsp } from "@/lib/ahsp/parse";

/**
 * Pembaca berkas master AHSP (DECISIONS 317).
 *
 * Yang paling berharga diuji di sini adalah aturan yang datang dari PANDUAN
 * BERKASNYA SENDIRI: kunci pakai `id` bukan `kode` (kode di berkas resmi ada
 * yang duplikat), `supplemental_records` wajib bertanda verifikasi, dan
 * koefisien TIDAK BOLEH dikarang untuk analisa yang komponennya belum
 * terstruktur. Melanggar salah satunya menghasilkan angka uang yang tidak bisa
 * dipertanggungjawabkan saat diperiksa.
 */

const KOMPONEN = [
  { kategori: "upah", nama_material: "Pekerja", koefisien: 0.05, satuan: "OH", urutan: 1 },
  { kategori: "bahan", nama_material: "Semen Portland", koefisien: 3.25, satuan: "kg", urutan: 2 },
  { kategori: "alat", nama_material: "Concrete Mixer", koefisien: 0.083, satuan: "jam", urutan: 3 },
];

function master(over: Record<string, unknown> = {}) {
  return {
    metadata: {
      schema_version: "2.0.0",
      generated_at: "2026-08-16T07:58:05+07:00",
      title: "Master AHSP",
      source_regulation: { name: "SE DJBK 47/2026", subject: "Tata Cara Penyusunan" },
      source_documents: { lampiran_iv: { filename: "IV.pdf", sha256: "abc" } },
    },
    records: [
      {
        id: "ahsp2_a",
        kode: "A.1.01",
        uraian: "1 m2 Pembersihan lahan",
        satuan: "m2",
        bidang: "sumber_daya_air",
        ahsp_type: "Normatif",
        work_group: "persiapan",
        notes: "Biaya Umum dan Keuntungan (10% - 15%) x D.",
        source: { lampiran: "IV", toc_pdf_page: 5, analysis_pdf_page: 1622, analysis_excerpt_id: "lampiran_iv_p1622" },
        components: KOMPONEN,
      },
    ],
    supplemental_records: [],
    ...over,
  };
}

describe("bacaMasterAhsp", () => {
  it("membaca entri beserta komponen & rujukan halamannya", () => {
    const m = bacaMasterAhsp(master(), "SE_DJBK_47_2026");
    expect(m.entries).toHaveLength(1);
    const e = m.entries[0];
    expect(e).toMatchObject({
      externalId: "ahsp2_a",
      kode: "A.1.01",
      satuan: "m2",
      bidang: "sumber_daya_air",
      ahspType: "Normatif",
      perluVerifikasi: false,
      lampiran: "IV",
      tocPdfPage: 5,
      analysisPdfPage: 1622,
      excerptId: "lampiran_iv_p1622",
    });
    expect(e.components.map((c) => c.kategori)).toEqual(["upah", "bahan", "alat"]);
    expect(e.components[1].koefisien).toBe(3.25);
  });

  it("identitas sumber diambil dari regulasinya, bukan judul berkas", () => {
    const m = bacaMasterAhsp(master(), "SE_DJBK_47_2026");
    expect(m.sumber.name).toBe("SE DJBK 47/2026");
    expect(m.sumber.schemaVersion).toBe("2.0.0");
    expect(m.sumber.generatedAt.getUTCFullYear()).toBe(2026);
  });

  it("supplemental_records DITANDAI perlu verifikasi – panduan berkasnya menuntut itu", () => {
    const m = bacaMasterAhsp(
      master({
        supplemental_records: [
          { id: "supp_a", kode: "A.3.01", uraian: "Angkut tanah", satuan: "-", bidang: "sumber_daya_air", components: [] },
        ],
      }),
      "X",
    );
    const supp = m.entries.find((e) => e.externalId === "supp_a")!;
    expect(supp.perluVerifikasi).toBe(true);
    expect(m.entries.find((e) => e.externalId === "ahsp2_a")!.perluVerifikasi).toBe(false);
    expect(m.ringkas.perluVerifikasi).toBe(1);
    expect(m.ringkas.kanonik).toBe(1);
  });

  it("KODE duplikat tetap jadi entri terpisah – kuncinya id, bukan kode", () => {
    // Berkas resminya memang memuat kode yang dipakai beberapa analisa berbeda.
    // Memakai kode sebagai kunci akan menggabungkan analisa yang tidak sama.
    const m = bacaMasterAhsp(
      master({
        records: [
          { id: "x1", kode: "A.3.03.1", uraian: "Galian tanah biasa", satuan: "m3", bidang: "sumber_daya_air", components: [] },
          { id: "x2", kode: "A.3.03.1", uraian: "Galian tanah cadas", satuan: "m3", bidang: "sumber_daya_air", components: [] },
        ],
      }),
      "X",
    );
    expect(m.entries).toHaveLength(2);
    expect(m.entries.map((e) => e.uraian)).toEqual(["Galian tanah biasa", "Galian tanah cadas"]);
  });

  it("id ganda: yang PERTAMA menang, kanonik tidak boleh kalah oleh supplemental", () => {
    const m = bacaMasterAhsp(
      master({
        supplemental_records: [
          { id: "ahsp2_a", kode: "ZZZ", uraian: "Versi supplemental", satuan: "m2", bidang: "x", components: [] },
        ],
      }),
      "X",
    );
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].uraian).toBe("1 m2 Pembersihan lahan");
    expect(m.entries[0].perluVerifikasi).toBe(false);
  });

  it("analisa TANPA komponen disimpan apa adanya – koefisien tidak dikarang", () => {
    // 435 analisa resmi belum punya komponen terstruktur; semuanya membawa
    // rujukan halaman. Mengisinya dengan tebakan adalah kebohongan yang
    // paling mahal di seluruh fitur ini.
    const m = bacaMasterAhsp(
      master({
        records: [
          {
            id: "kosong",
            kode: "A.1.02",
            uraian: "Pasangan batu kosong",
            satuan: "m3",
            bidang: "sumber_daya_air",
            source: { lampiran: "IV", analysis_pdf_page: 1622, analysis_excerpt_id: "lampiran_iv_p1622" },
            components: [],
          },
        ],
      }),
      "X",
    );
    expect(m.entries[0].components).toEqual([]);
    expect(m.entries[0].excerptId).toBe("lampiran_iv_p1622");
    expect(m.ringkas.tanpaKomponen).toBe(1);
  });

  it("komponen cacat DIBUANG, bukan diselundupkan sebagai koefisien 0", () => {
    const m = bacaMasterAhsp(
      master({
        records: [
          {
            id: "cacat",
            kode: "A",
            uraian: "U",
            satuan: "m",
            bidang: "x",
            components: [
              { kategori: "bahan", nama_material: "Semen", koefisien: 2, satuan: "kg", urutan: 1 },
              { kategori: "bahan", nama_material: "Tanpa koefisien", koefisien: null, satuan: "kg", urutan: 2 },
              { kategori: "upah", nama_material: "   ", koefisien: 1, urutan: 3 },
            ],
          },
        ],
      }),
      "X",
    );
    // Yang dibuang HANYA yang tidak bisa dipakai menghitung: tanpa koefisien,
    // tanpa nama. Kategori TIDAK termasuk syarat — lihat uji berikutnya.
    expect(m.entries[0].components).toHaveLength(1);
    expect(m.entries[0].components[0].nama).toBe("Semen");
  });

  it("kategori BARU disimpan dan dilaporkan, TIDAK dibuang", () => {
    /*
     * Dulu kategori disaring daftar putih {upah, bahan, alat}. Terbitan AHSP 5.0
     * menambahkan `fasilitas` (Base Camp, Barak, Gudang pada analisa
     * "Fasilitas") — dan dengan saringan itu 6 komponen RESMI lenyap tanpa
     * suara. Kategori pada terbitan berikutnya akan lenyap dengan cara yang
     * sama, dan tidak ada yang akan tahu. DECISIONS 324.
     */
    const m = bacaMasterAhsp(
      master({
        records: [
          {
            id: "baru",
            kode: "A.1.08.2a",
            uraian: "Fasilitas",
            satuan: "m2",
            bidang: "sumber_daya_air",
            components: [
              { kategori: "bahan", nama_material: "Semen", koefisien: 2, satuan: "kg", urutan: 1 },
              { kategori: "fasilitas", nama_material: "Base Camp", koefisien: 12, satuan: "m2", urutan: 2 },
            ],
          },
        ],
      }),
      "X",
    );
    expect(m.entries[0].components).toHaveLength(2);
    expect(m.entries[0].components[1].kategori).toBe("fasilitas");
    // Dilaporkan supaya kemunculannya TERLIHAT, bukan cuma diam-diam diterima.
    expect(m.ringkas.kategoriLain).toEqual({ fasilitas: 1 });
    expect(m.ringkas.komponen).toEqual({ upah: 0, bahan: 1, alat: 0 });
  });

  it("satuan '-' dipertahankan apa adanya – itu penanda 'belum terbaca'", () => {
    const m = bacaMasterAhsp(
      master({ records: [{ id: "s", kode: "A", uraian: "U", satuan: "-", bidang: "x", components: [] }] }),
      "X",
    );
    expect(m.entries[0].satuan).toBe("-");
  });

  it("ringkasan menghitung, bukan menebak", () => {
    const m = bacaMasterAhsp(master(), "X");
    expect(m.ringkas).toMatchObject({
      total: 1,
      komponen: { upah: 1, bahan: 1, alat: 1 },
      bidang: { sumber_daya_air: 1 },
    });
  });

  it("berkas tanpa `records` DITOLAK, bukan menghasilkan basis kosong", () => {
    expect(() => bacaMasterAhsp(master({ records: [] }), "X")).toThrow(AhspParseError);
    expect(() => bacaMasterAhsp(null, "X")).toThrow(AhspParseError);
  });
});
