/*
 * PRATINJAU IMPOR RAB: SUB-KATEGORI IKUT TAMPIL, DAN ADENDUM DIADU KANAN-KIRI.
 *
 * **Permintaan user 2026-09-21**:
 *
 * 1. *"bukan hanya kategori harusnya munculkan juga sub kategorinya, berapa
 *    jumlahnya"*
 * 2. *"saat impor adendum harusnya kamu memunculkan perbandingan kanan kiri ->
 *    Item | jumlah kontrak | jumlah draft adendum. ini akan mudah untuk mengecek
 *    perubahannya."*
 *
 * Yang sudah ada — `itemBaru`, `volumeBerubah`, `hargaBerubah` — menjawab
 * pertanyaan "apa yang berubah" per JENIS perubahan. Yang diminta user lain:
 * satu tabel yang bisa dibaca berdampingan, karena begitulah orang memeriksa
 * adendum — angka kontrak di kiri, angka draft di kanan, mata turun satu kolom.
 *
 * Dua fungsi murni inilah yang memutuskan ISI kedua tampilan itu, jadi di
 * sinilah keduanya dikunci; komponennya hanya memformat.
 */
import { describe, expect, it } from "vitest";

const { pohonRingkas } = await import("@/lib/rab/pohon-ringkas");
const { bandingkanPerItem } = await import("@/lib/rab/diff-parsed");

type Flat = {
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  amount: bigint;
  lineageKey: string;
  parentLineageKey: string | null;
  sortOrder: number;
  volume: number | null;
  unit: string | null;
  unitPrice: number | null;
  excelRow: number | null;
};

const n = (
  kind: Flat["kind"],
  code: string,
  name: string,
  amount: bigint,
  lineageKey: string,
  parentLineageKey: string | null,
  sortOrder: number,
): Flat => ({
  kind,
  code,
  name,
  amount,
  lineageKey,
  parentLineageKey,
  sortOrder,
  volume: null,
  unit: null,
  unitPrice: null,
  excelRow: null,
});

/** I ── I.1 (a, b) ── I.2 (c) · II ── (d langsung di kategori). */
const POHON: Flat[] = [
  n("kategori", "I", "PEKERJAAN PERSIAPAN", 300n, "I", null, 1),
  n("sub", "I.1", "Mobilisasi", 200n, "I.1", "I", 2),
  n("item", "I.1.a", "Sewa direksi keet", 120n, "I.1.a", "I.1", 3),
  n("item", "I.1.b", "Papan nama", 80n, "I.1.b", "I.1", 4),
  n("sub", "I.2", "K3", 100n, "I.2", "I", 5),
  n("item", "I.2.a", "APD", 100n, "I.2.a", "I.2", 6),
  n("kategori", "II", "PEKERJAAN REVETMENT", 500n, "II", null, 7),
  n("item", "II.a", "Pasang batu", 500n, "II.a", "II", 8),
];

describe("pohonRingkas – kategori DAN sub-kategorinya", () => {
  it("sub-kategori ikut keluar, tidak hanya kategori", () => {
    const baris = pohonRingkas(POHON);
    expect(baris.map((b) => b.code)).toEqual(["I", "I.1", "I.2", "II"]);
  });

  it("tiap baris membawa jumlah rupiahnya", () => {
    const baris = pohonRingkas(POHON);
    expect(baris.find((b) => b.code === "I.1")?.total).toBe(200n);
    expect(baris.find((b) => b.code === "II")?.total).toBe(500n);
  });

  it("tiap baris menyebut BERAPA item di bawahnya – termasuk lewat sub", () => {
    // "berapa jumlahnya" dijawab dua arah: rupiahnya DAN cacahnya. Kategori I
    // punya tiga item, semuanya lewat sub; kalau cacahnya hanya menghitung anak
    // langsung, kategori berjenjang akan terbaca kosong.
    const baris = pohonRingkas(POHON);
    expect(baris.find((b) => b.code === "I")?.jumlahItem).toBe(3);
    expect(baris.find((b) => b.code === "I.1")?.jumlahItem).toBe(2);
    expect(baris.find((b) => b.code === "II")?.jumlahItem).toBe(1);
  });

  it("kedalaman dibawa supaya sub bisa ditakik di layar", () => {
    const baris = pohonRingkas(POHON);
    expect(baris.find((b) => b.code === "I")?.level).toBe(0);
    expect(baris.find((b) => b.code === "I.1")?.level).toBe(1);
  });

  it("urutannya urutan berkas, bukan abjad – RAB dibaca sebagai dokumen", () => {
    const acak = [...POHON].reverse();
    expect(pohonRingkas(acak).map((b) => b.code)).toEqual(["I", "I.1", "I.2", "II"]);
  });

  it("pohon kosong menghasilkan daftar kosong, bukan lemparan", () => {
    expect(pohonRingkas([])).toEqual([]);
  });
});

const AKTIF = [
  { lineageKey: "I.1.a", parentLineageKey: "I.1", kind: "item", code: "I.1.a", name: "Sewa direksi keet", volume: 1, unitPrice: 120, amount: 120n },
  { lineageKey: "I.1.b", parentLineageKey: "I.1", kind: "item", code: "I.1.b", name: "Papan nama", volume: 1, unitPrice: 80, amount: 80n },
  { lineageKey: "I.2.a", parentLineageKey: "I.2", kind: "item", code: "I.2.a", name: "APD", volume: 1, unitPrice: 100, amount: 100n },
  { lineageKey: "II.a", parentLineageKey: "II", kind: "item", code: "II.a", name: "Pasang batu", volume: 10, unitPrice: 50, amount: 500n },
];

describe("bandingkanPerItem – kontrak di kiri, draft adendum di kanan", () => {
  it("item yang nilainya berubah membawa KEDUA angkanya", () => {
    const baru = POHON.map((x) => (x.lineageKey === "II.a" ? { ...x, amount: 750n } : x));
    const baris = bandingkanPerItem(AKTIF, baru);
    const b = baris.find((x) => x.lineageKey === "II.a")!;
    expect(b.kontrak).toBe(500n);
    expect(b.adendum).toBe(750n);
    expect(b.selisih).toBe(250n);
    expect(b.status).toBe("berubah");
  });

  it("item BARU: sisi kontrak kosong, bukan nol", () => {
    // Nol berarti "ada, bernilai nol". Kosong berarti "tidak ada di kontrak".
    // Menyamakan keduanya membuat item baru terbaca sebagai item yang nilainya
    // dinolkan – dua keadaan yang tindak lanjutnya berbeda sama sekali.
    const baru = [...POHON, n("item", "II.b", "Pasang bronjong", 90n, "II.b", "II", 9)];
    const b = bandingkanPerItem(AKTIF, baru).find((x) => x.lineageKey === "II.b")!;
    expect(b.kontrak).toBeNull();
    expect(b.adendum).toBe(90n);
    expect(b.status).toBe("baru");
  });

  it("item HILANG tetap muncul – sisi adendum kosong", () => {
    const baru = POHON.filter((x) => x.lineageKey !== "I.1.b");
    const b = bandingkanPerItem(AKTIF, baru).find((x) => x.lineageKey === "I.1.b")!;
    expect(b.kontrak).toBe(80n);
    expect(b.adendum).toBeNull();
    expect(b.status).toBe("hilang");
  });

  it("item yang tidak berubah tetap ada di daftar – ini tabel banding, bukan daftar beda", () => {
    const b = bandingkanPerItem(AKTIF, POHON).find((x) => x.lineageKey === "I.1.a")!;
    expect(b.status).toBe("tetap");
    expect(b.selisih).toBe(0n);
  });

  it("hanya ITEM yang diadu – kategori dan sub bukan baris pemeriksaan", () => {
    const baris = bandingkanPerItem(AKTIF, POHON);
    expect(baris.map((b) => b.lineageKey).sort()).toEqual(["I.1.a", "I.1.b", "I.2.a", "II.a"]);
  });

  it("urutannya urutan berkas, dan item hilang menyusul di tempatnya", () => {
    const baru = POHON.filter((x) => x.lineageKey !== "I.1.a");
    const baris = bandingkanPerItem(AKTIF, baru);
    expect(baris.map((b) => b.lineageKey)).toEqual(["I.1.b", "I.2.a", "II.a", "I.1.a"]);
  });

  it("jalur induk dibawa supaya item bisa dikenali tanpa membuka berkasnya", () => {
    const b = bandingkanPerItem(AKTIF, POHON).find((x) => x.lineageKey === "I.1.a")!;
    expect(b.jalur).toContain("I.1");
  });
});
