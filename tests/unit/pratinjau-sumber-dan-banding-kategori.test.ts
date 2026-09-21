/*
 * PRATINJAU IMPOR RAB: SUMBER ANGKA DISEBUT, DAN KATEGORINYA DIADU KANAN-KIRI.
 *
 * **Dua laporan user 2026-09-21**, keduanya tentang blok pratinjau yang sama:
 *
 * 1. *"yang kuminta ada perbandingan itu di bagian ini, kenapa ini malah tidak
 *    ada!"* – sambil menunjuk tabel `KODE | KATEGORI & SUB-KATEGORI | ITEM |
 *    TOTAL`. Tabel banding per ITEM memang sudah ada, tetapi ia berdiri di blok
 *    lain; yang dibaca orang saat memeriksa adendum justru tabel kategori ini,
 *    dan di situ hanya ada angka berkas baru – tanpa pembanding sama sekali.
 * 2. *"lalu informasi ambil dari sheet mana dan kolom mana harga diambil juga
 *    penting disampaikan"*. Kolomnya sudah disebut; SHEET-nya tidak pernah.
 *    Padahal pemilihan sheet adalah tebakan berperingkat atas maksimal delapan
 *    kandidat ("RAB", "BQ", "MC-0", "Lampiran", …) – berkas dengan dua tab
 *    berisi bisa terbaca dari tab yang salah, dan tidak ada satu pun kalimat di
 *    layar yang memungkinkan orang menyadarinya.
 *
 * Ditambah satu cacat yang ditemukan saat memeriksa ulang layarnya di browser:
 * React mengeluh `Encountered two children with the same key` puluhan kali di
 * halaman ini, dengan kunci seperti `"1Pekerjaan Bouwplank dan Uitzet"` dan
 * `"IX.1 · 1-1-Pekerjaan Bouwplank dan Uitzet"`. Kunci disusun dari
 * `code + name`, dan kode item HANYA unik di dalam induknya – "1" berulang di
 * setiap sub-kategori. Akibatnya bukan sekadar pesan: React boleh MENGHILANGKAN
 * atau MENGGANDAKAN baris yang kuncinya kembar. Daftar perbandingan yang
 * diam-diam kehilangan baris adalah alat periksa yang berbohong, dan `lineageKey`
 * – yang memang unik – sudah dibawa sampai ke layar.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { pohonRingkas, pohonRingkasBanding } = await import("@/lib/rab/pohon-ringkas");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");

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
});

/** I ── I.1 (a, b) ── I.2 (c) · II ── (d langsung di kategori). */
const AKTIF: Flat[] = [
  n("kategori", "I", "PEKERJAAN PERSIAPAN", 300n, "I", null, 1),
  n("sub", "I.1", "Mobilisasi", 200n, "I.1", "I", 2),
  n("item", "I.1.a", "Sewa direksi keet", 120n, "I.1.a", "I.1", 3),
  n("item", "I.1.b", "Papan nama", 80n, "I.1.b", "I.1", 4),
  n("sub", "I.2", "K3", 100n, "I.2", "I", 5),
  n("item", "I.2.a", "APD", 100n, "I.2.a", "I.2", 6),
  n("kategori", "II", "PEKERJAAN REVETMENT", 500n, "II", null, 7),
  n("item", "II.a", "Pasang batu", 500n, "II.a", "II", 8),
];

describe("pohonRingkas – identitas baris ikut dibawa", () => {
  it("tiap baris membawa lineageKey, bukan cuma kode yang berulang", () => {
    // Kode kategori/sub bisa kembar antar cabang; `lineageKey` tidak. Tanpa ini
    // layar terpaksa menyusun kunci sendiri dari code+name – persis cara yang
    // membuat React menghilangkan baris.
    const baris = pohonRingkas(AKTIF);
    expect(baris.map((b) => b.lineageKey)).toEqual(["I", "I.1", "I.2", "II"]);
  });
});

describe("pohonRingkasBanding – kontrak vs berkas baru, per kategori & sub", () => {
  it("kategori yang totalnya bergeser membawa KEDUA angkanya", () => {
    const baru = AKTIF.map((x) =>
      x.lineageKey === "II" ? { ...x, amount: 750n } : x.lineageKey === "II.a" ? { ...x, amount: 750n } : x,
    );
    const b = pohonRingkasBanding(AKTIF, baru).find((x) => x.lineageKey === "II")!;
    expect(b.kontrak).toBe(500n);
    expect(b.adendum).toBe(750n);
    expect(b.selisih).toBe(250n);
    expect(b.status).toBe("berubah");
  });

  it("sub-kategori ikut diadu, bukan hanya kategori puncaknya", () => {
    const baru = AKTIF.map((x) => (x.lineageKey === "I.2" ? { ...x, amount: 160n } : x));
    const b = pohonRingkasBanding(AKTIF, baru).find((x) => x.lineageKey === "I.2")!;
    expect(b.kontrak).toBe(100n);
    expect(b.adendum).toBe(160n);
    expect(b.status).toBe("berubah");
  });

  it("kategori BARU: sisi kontrak kosong, bukan nol", () => {
    const baru = [...AKTIF, n("kategori", "III", "PEKERJAAN TAMBAH", 90n, "III", null, 9)];
    const b = pohonRingkasBanding(AKTIF, baru).find((x) => x.lineageKey === "III")!;
    expect(b.kontrak).toBeNull();
    expect(b.adendum).toBe(90n);
    expect(b.status).toBe("baru");
  });

  it("kategori HILANG tetap muncul – sisi berkas baru kosong", () => {
    const baru = AKTIF.filter((x) => !x.lineageKey.startsWith("II"));
    const b = pohonRingkasBanding(AKTIF, baru).find((x) => x.lineageKey === "II")!;
    expect(b.kontrak).toBe(500n);
    expect(b.adendum).toBeNull();
    expect(b.status).toBe("hilang");
  });

  it("yang tidak bergeser tetap ada – ini tabel banding, bukan daftar beda", () => {
    const b = pohonRingkasBanding(AKTIF, AKTIF).find((x) => x.lineageKey === "I.1")!;
    expect(b.status).toBe("tetap");
    expect(b.selisih).toBe(0n);
  });

  it("urutannya urutan BERKAS BARU, dan yang hilang menyusul di akhir", () => {
    const baru = AKTIF.filter((x) => !x.lineageKey.startsWith("I."));
    expect(pohonRingkasBanding(AKTIF, baru).map((x) => x.lineageKey)).toEqual(["I", "II", "I.1", "I.2"]);
  });

  it("tanpa satu pun simpul kontrak, hasilnya tetap daftar berkas baru", () => {
    const baris = pohonRingkasBanding([], AKTIF);
    expect(baris.map((b) => b.lineageKey)).toEqual(["I", "I.1", "I.2", "II"]);
    expect(baris.every((b) => b.status === "baru")).toBe(true);
  });
});

describe("parseHpsBuffer – sheet yang benar-benar dibaca ikut dilaporkan", () => {
  it("menyebut NAMA SHEET-nya, bukan hanya kolom harganya", async () => {
    const buf = readFileSync(join(import.meta.dirname, "..", "fixtures", "rab-aktif-situbondo.xlsx"));
    const hasil = await parseHpsBuffer(buf);
    expect(hasil.priceColumn.label).toMatch(/kolom/i);
    expect(typeof hasil.sheetName).toBe("string");
    expect(hasil.sheetName.length).toBeGreaterThan(0);
  });
});
