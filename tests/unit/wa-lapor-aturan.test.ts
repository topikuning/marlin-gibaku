/*
 * LAPOR LEWAT WHATSAPP – cara MARLIN membaca pesan (DECISIONS 706).
 *
 * Perintah lapor dan pertanyaan untuk Tanya MARLIN datang lewat chat yang
 * sama. Salah baca ke satu arah membuat pertanyaan dijawab "pekerjaan tidak
 * ketemu"; ke arah lain membuat volume tidak tercatat. Yang paling berbahaya:
 * angka di nama pekerjaan terbaca sebagai volume.
 */
import { describe, expect, it } from "vitest";
import {
  bacaAngka,
  bacaPerintah,
  bakuSatuan,
  bentukKata,
  cariPekerjaanWa,
  kelompokPekerjaan,
  teks,
  pisahVolume,
  satuanPerluDisebut,
  sesiBerlaku,
  tawaranBerlaku,
} from "@/lib/waha/lapor-aturan";

describe("bacaPerintah", () => {
  it("lokasi, dengan atau tanpa titik dua", () => {
    expect(bacaPerintah("lokasi Kedung Mutih")).toEqual({ jenis: "lokasi", nama: "Kedung Mutih" });
    expect(bacaPerintah("Lokasi: Matabulu Timur")).toEqual({ jenis: "lokasi", nama: "Matabulu Timur" });
    expect(bacaPerintah("  LOKASI   randu   putih ")).toEqual({ jenis: "lokasi", nama: "randu putih" });
  });

  it("'lokasi' saja / 'daftar lokasi' → daftar bernomor (DECISIONS 710)", () => {
    for (const t of ["lokasi", "Lokasi.", "daftar lokasi", "DAFTAR LOKASI", "list lokasi", "pilih lokasi", "lokasi saya", "lokasiku"]) {
      expect(bacaPerintah(t), t).toEqual({ jenis: "daftar_lokasi" });
    }
    // Pertanyaan tetap untuk Tanya MARLIN; nama lokasi tetap mencari lokasi itu.
    expect(bacaPerintah("daftar lokasi?")).toEqual({ jenis: "tanya" });
    expect(bacaPerintah("lokasi saya mana saja?")).toEqual({ jenis: "tanya" });
    expect(bacaPerintah("lokasi sayangan")).toEqual({ jenis: "lokasi", nama: "sayangan" });
  });

  it("pertanyaan tidak pernah terbaca perintah lapor", () => {
    expect(bacaPerintah("lokasi mana yang deviasinya negatif?")).toEqual({ jenis: "tanya" });
    expect(bacaPerintah("berapa progres kedung mutih")).toEqual({ jenis: "tanya" });
    expect(bacaPerintah("Progres paving minggu ini")).toEqual({ jenis: "tanya" });
    expect(bacaPerintah("pasang paving?")).toEqual({ jenis: "tanya" });
  });

  it("selesai, bantuan, dan balasan angka", () => {
    expect(bacaPerintah("Selesai")).toEqual({ jenis: "selesai" });
    expect(bacaPerintah("lapor")).toEqual({ jenis: "bantuan" });
    expect(bacaPerintah("2")).toEqual({ jenis: "pilih", nomor: 2 });
  });

  it("kata 'lokasinya' bukan perintah lokasi", () => {
    expect(bacaPerintah("lokasinya sudah benar")).toEqual({ jenis: "teks", teks: "lokasinya sudah benar" });
  });
});

describe("bacaAngka", () => {
  it("koma desimal, titik ribuan", () => {
    expect(bacaAngka("12,5")).toBe(12.5);
    expect(bacaAngka("1.250")).toBe(1250);
    expect(bacaAngka("1.250,75")).toBe(1250.75);
    expect(bacaAngka("2.5")).toBe(2.5);
    expect(bacaAngka("20")).toBe(20);
  });
  it("bukan angka → null", () => {
    expect(bacaAngka("1.2.3")).toBeNull();
    expect(bacaAngka("dua")).toBeNull();
  });
});

describe("pisahVolume", () => {
  it("nama + volume + satuan di akhir", () => {
    expect(pisahVolume("pasang paving 20 m2")).toEqual({ nama: "pasang paving", volume: 20, satuan: "m2" });
    expect(pisahVolume("galian tanah 12,5m3")).toEqual({ nama: "galian tanah", volume: 12.5, satuan: "m3" });
    expect(pisahVolume("plester dinding 30 meter persegi")).toEqual({
      nama: "plester dinding",
      volume: 30,
      satuan: "meter persegi",
    });
    expect(pisahVolume("paving 20")).toEqual({ nama: "paving", volume: 20, satuan: null });
  });

  it("hanya volume → nama kosong (untuk pekerjaan yang sedang aktif)", () => {
    expect(pisahVolume("20 m2")).toEqual({ nama: "", volume: 20, satuan: "m2" });
  });

  it("angka yang menempel di nama atau satuan tak dikenal TIDAK jadi volume", () => {
    expect(pisahVolume("kolom K1")).toEqual({ nama: "kolom K1", volume: null, satuan: null });
    expect(pisahVolume("pipa 4 inch")).toEqual({ nama: "pipa 4 inch", volume: null, satuan: null });
    expect(pisahVolume("pasang paving")).toEqual({ nama: "pasang paving", volume: null, satuan: null });
  });

  it("nol bukan volume", () => {
    expect(pisahVolume("paving 0 m2").volume).toBeNull();
  });
});

describe("satuan", () => {
  it("variasi tulisan disamakan", () => {
    expect(bakuSatuan("M²")).toBe("m2");
    expect(bakuSatuan("Bh")).toBe(bakuSatuan("buah"));
    expect(bakuSatuan("m'")).toBe("m");
    expect(bakuSatuan("Ls")).toBe("ls");
  });
  it("satuan yang diketik tidak dipakai; satuan RAB disebut hanya bila yang diketik berbeda (DECISIONS 709)", () => {
    expect(satuanPerluDisebut(null, "m2")).toBeNull();
    expect(satuanPerluDisebut("m²", "M2")).toBeNull();
    expect(satuanPerluDisebut("m2", "m3")).toBe("m3");
    expect(satuanPerluDisebut("m2", null)).toBeNull();
  });
  it("angka tanpa satuan tetap terbaca sebagai volume", () => {
    expect(pisahVolume("pasang paving 20")).toEqual({ nama: "pasang paving", volume: 20, satuan: null });
  });
});

describe("sesiBerlaku", () => {
  const pagi = new Date("2026-10-26T01:00:00Z"); // 08.00 WIB
  const sesi = { locationId: "lok", mulaiAt: pagi, terakhirAt: pagi, selesaiAt: null };

  it("berlaku dalam 3 jam sejak kiriman terakhir", () => {
    expect(sesiBerlaku(sesi, new Date("2026-10-26T03:59:00Z"))).toBe(true);
    expect(sesiBerlaku(sesi, new Date("2026-10-26T04:01:00Z"))).toBe(false);
  });

  it("tidak menyeberang tengah malam WIB, walau belum 3 jam", () => {
    const malam = new Date("2026-10-26T16:30:00Z"); // 23.30 WIB
    const s = { ...sesi, mulaiAt: malam, terakhirAt: malam };
    expect(sesiBerlaku(s, new Date("2026-10-26T17:10:00Z"))).toBe(false); // 00.10 WIB
  });

  it("diakhiri atau tanpa lokasi → tidak berlaku", () => {
    expect(sesiBerlaku({ ...sesi, selesaiAt: pagi }, pagi)).toBe(false);
    expect(sesiBerlaku({ ...sesi, locationId: null }, pagi)).toBe(false);
    expect(sesiBerlaku(null, pagi)).toBe(false);
  });
});

describe("cariPekerjaanWa", () => {
  const rab = [
    { code: "1", name: "Pemasangan Paving Block", category: "PEKERJAAN JALAN", subPath: "" },
    { code: "2", name: "Penggalian Tanah", category: "PEKERJAAN TANAH", subPath: "" },
    { code: "3", name: "Bekesting Kolom Praktis", category: "PEKERJAAN STRUKTUR", subPath: "" },
    { code: "4", name: "Bekesting Kolom Utama", category: "PEKERJAAN STRUKTUR", subPath: "" },
    { code: "5", name: "Pengecoran Beton Mutu K-225", category: "PEKERJAAN STRUKTUR", subPath: "" },
    { code: "7.a", name: "Pasangan Bata", category: "PEKERJAAN DINDING", subPath: "" },
  ];
  const nama = (r: { semua: { name: string }[]; mendekati: { name: string }[] }) => ({
    semua: r.semua.map((x) => x.name),
    mendekati: r.mendekati.map((x) => x.name),
  });

  it("kata kerja menemukan kata benda RAB (peN-)", () => {
    expect(bentukKata("pasang")).toContain("pemasang");
    expect(bentukKata("gali")).toContain("penggali");
    expect(bentukKata("cor")).toContain("pengecor");
    expect(nama(cariPekerjaanWa(rab, "pasang paving")).semua).toEqual(["Pemasangan Paving Block"]);
    expect(nama(cariPekerjaanWa(rab, "gali tanah")).semua).toEqual(["Penggalian Tanah"]);
    expect(nama(cariPekerjaanWa(rab, "cor beton")).semua).toEqual(["Pengecoran Beton Mutu K-225"]);
  });

  it("angka polos TIDAK cocok ke kode item – ia volume", () => {
    expect(nama(cariPekerjaanWa(rab, "bekesting kolom 3")).semua).toEqual([]);
    expect(nama(cariPekerjaanWa(rab, "bekesting kolom")).semua).toHaveLength(2);
  });

  it("angka yang memang bagian NAMA tetap cocok", () => {
    expect(nama(cariPekerjaanWa(rab, "beton k 225")).semua).toEqual(["Pengecoran Beton Mutu K-225"]);
  });

  it("kode berhuruf yang diketik utuh cocok", () => {
    expect(nama(cariPekerjaanWa(rab, "7.a")).semua).toEqual(["Pasangan Bata"]);
  });

  it("tidak ada yang cocok penuh → yang mendekati, untuk DITAWARKAN", () => {
    const r = nama(cariPekerjaanWa(rab, "pasang batako"));
    expect(r.semua).toEqual([]);
    expect(r.mendekati).toContain("Pasangan Bata");
  });

  it("tidak ada kata yang cocok sama sekali → kosong", () => {
    expect(nama(cariPekerjaanWa(rab, "atap baja ringan"))).toEqual({ semua: [], mendekati: [] });
  });
});

describe("cariPekerjaanWa – menambah kata tidak pernah memperlebar tebakan (DECISIONS 713)", () => {
  // Kasus nyata user 2026-10-27: "dolken" 15 cocok, "pasang dolken" 115.
  const pemasangan = Array.from({ length: 100 }, (_, i) => ({
    code: String(i + 1),
    name: `Pemasangan Item ${i + 1}`,
    category: i % 2 ? "GUDANG BEKU" : "BALAI PERTEMUAN",
    subPath: "",
  }));
  const dolken = Array.from({ length: 15 }, (_, i) => ({
    code: `D${i + 1}`,
    name: "Dolken Kayu Galam",
    category: ["GUDANG BEKU", "BALAI PERTEMUAN", "DERMAGA"][i % 3],
    subPath: "1. Pekerjaan Pondasi",
  }));
  const bedeng = [{ code: "1", name: "Buat Bedeng Pekerja Dan Gudang", category: "PEKERJAAN PERSIAPAN", subPath: "" }];
  const rab = [...pemasangan, ...dolken, ...bedeng];

  it("'pasang dolken' (tidak ada yang memuat keduanya) → 15 dolken, bukan 115", () => {
    const r = cariPekerjaanWa(rab, "pasang dolken");
    expect(r.semua).toEqual([]);
    expect(r.mendekati).toHaveLength(15);
    expect(r.mendekati.every((o) => o.name.includes("Dolken"))).toBe(true);
    expect(r.mendekati.length).toBeLessThanOrEqual(cariPekerjaanWa(rab, "dolken").semua.length);
  });

  it("'pasang bedeng' → Buat Bedeng saja, bukan 100 item Pemasangan", () => {
    expect(cariPekerjaanWa(rab, "pasang bedeng").mendekati.map((o) => o.name)).toEqual(["Buat Bedeng Pekerja Dan Gudang"]);
  });

  it("kelompok untuk petunjuk: kategori terbanyak dulu, dengan jumlahnya", () => {
    expect(kelompokPekerjaan(dolken)).toEqual([
      { nama: "BALAI PERTEMUAN", jumlah: 5 },
      { nama: "DERMAGA", jumlah: 5 },
      { nama: "GUDANG BEKU", jumlah: 5 },
    ]);
    // Semua di satu kategori → dikelompokkan menurut sub-kategori.
    const satu = [
      { code: "1", name: "A", category: "GUDANG", subPath: "1. Pondasi › a" },
      { code: "2", name: "B", category: "GUDANG", subPath: "2. Atap" },
      { code: "3", name: "C", category: "GUDANG", subPath: "1. Pondasi › b" },
    ];
    expect(kelompokPekerjaan(satu)).toEqual([
      { nama: "1. Pondasi", jumlah: 2 },
      { nama: "2. Atap", jumlah: 1 },
    ]);
  });

  it("balasan terlalu banyak menyebut kelompok dan contoh kata yang bisa ditambahkan", () => {
    const b = teks.terlaluBanyakPekerjaan("pasang", 100, kelompokPekerjaan(pemasangan));
    expect(b).toMatch(/Ada 100 pekerjaan yang cocok dengan "pasang"/);
    expect(b).toMatch(/– BALAI PERTEMUAN \(50\)\n– GUDANG BEKU \(50\)/);
    expect(b).toMatch(/Mis\. \*pasang balai\*\./);
  });
});

describe("tawaranBerlaku", () => {
  it("3 jam, hari yang sama", () => {
    const t = new Date("2026-10-26T01:00:00Z");
    expect(tawaranBerlaku(t, new Date("2026-10-26T02:00:00Z"))).toBe(true);
    expect(tawaranBerlaku(t, new Date("2026-10-26T05:00:00Z"))).toBe(false);
    expect(tawaranBerlaku(new Date("2026-10-26T16:50:00Z"), new Date("2026-10-26T17:05:00Z"))).toBe(false);
  });
});

describe("Tanya MARLIN mati (DECISIONS 714)", () => {
  it("bantuan dan 'pekerjaan tidak ketemu' tidak menjanjikan jawaban pertanyaan selama Tanya mati", () => {
    expect(teks.bantuan(true)).toMatch(/akhiri dengan tanda tanya/);
    expect(teks.bantuan(false)).not.toMatch(/tanda tanya/);
    expect(teks.pekerjaanTidakAda("bekisting", "Matabulu", true)).toMatch(/akhiri dengan tanda tanya/);
    expect(teks.pekerjaanTidakAda("bekisting", "Matabulu", false)).not.toMatch(/tanda tanya/);
  });
});
