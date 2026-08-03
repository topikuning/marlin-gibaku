// BARIS DOKUMEN CCO (DECISIONS 236).
//
// Permintaan user 2026-08-03: berkas contoh KKP, sheet "CCO-01 (BANGUNAN)" —
// "ini adalah draft format yang diminta kkp untuk pengajuan cco. akomodir ini".
//
// Yang diuji di sini ANGKANYA, bukan bordernya. Dokumen ini dipakai mengajukan
// perubahan nilai kontrak: satu item yang luput dari daftar berarti pekerjaan
// yang dikerjakan tanpa dasar, atau nilai yang diajukan tidak sama dengan yang
// dikerjakan.
import { describe, expect, it } from "vitest";
import { susunBarisCco, bobotPersen, type CcoNode } from "@/lib/rab/cco-rows";

let urut = 0;
const kat = (id: string, name: string, code = id): CcoNode => ({
  id,
  parentId: null,
  kind: "kategori",
  code,
  name,
  unit: null,
  volume: null,
  unitPrice: null,
  amount: 0n,
  lineageKey: `K#${id}`,
});
const item = (
  id: string,
  parentId: string,
  name: string,
  volume: number,
  harga: number,
  lineage = `I#${id}`,
): CcoNode => ({
  id: `${id}-${(urut += 1)}`,
  parentId,
  kind: "item",
  code: id,
  name,
  unit: "m2",
  volume,
  unitPrice: harga,
  amount: BigInt(Math.round(volume * harga)),
  lineageKey: lineage,
});

/** Hanya baris item, supaya asersi tidak terganggu baris judul/total. */
const items = (rows: ReturnType<typeof susunBarisCco>["rows"]) => rows.filter((r) => r.jenis === "item");
const cari = (rows: ReturnType<typeof susunBarisCco>["rows"], nama: string) =>
  rows.find((r) => r.uraian === nama)!;

describe("KASUS INTI: empat blok angka per item", () => {
  const lama = [kat("A", "PEKERJAAN TANAH"), item("1", "A", "Galian", 100, 50_000)];
  const baru = [kat("A", "PEKERJAAN TANAH"), item("1", "A", "Galian", 130, 50_000)];

  it("volume naik → masuk PEKERJAAN TAMBAH, bukan kurang", () => {
    const r = cari(susunBarisCco(lama, baru).rows, "Galian");
    expect(r.ket).toBe("TAMBAH");
    expect(r.jumlahLama).toBe(5_000_000n);
    expect(r.jumlahBaru).toBe(6_500_000n);
    expect(r.jumlahTambah).toBe(1_500_000n);
    expect(r.jumlahKurang).toBe(0n);
  });

  it("volume tambah = SELISIH, bukan volume penuh", () => {
    // Kolomnya menanyakan "berapa yang bertambah", bukan "berapa jadinya".
    const r = cari(susunBarisCco(lama, baru).rows, "Galian");
    expect(r.volumeTambah).toBeCloseTo(30, 6);
    expect(r.volumeBaru).toBeCloseTo(130, 6);
    expect(r.volumeLama).toBeCloseTo(100, 6);
  });

  it("volume turun → PEKERJAAN KURANG, besarannya POSITIF", () => {
    const turun = [kat("A", "PEKERJAAN TANAH"), item("1", "A", "Galian", 60, 50_000)];
    const r = cari(susunBarisCco(lama, turun).rows, "Galian");
    expect(r.ket).toBe("KURANG");
    expect(r.jumlahKurang).toBe(2_000_000n);
    expect(r.volumeKurang).toBeCloseTo(40, 6);
    expect(r.jumlahTambah).toBe(0n);
  });

  it("tidak berubah → TETAP, tambah & kurang nol", () => {
    const r = cari(susunBarisCco(lama, lama).rows, "Galian");
    expect(r.ket).toBe("TETAP");
    expect(r.jumlahTambah).toBe(0n);
    expect(r.jumlahKurang).toBe(0n);
  });
});

describe("item yang DICABUT tetap muncul", () => {
  // Item yang dihapus tidak ada di pohon draft. Kalau baris dibangun dari draft
  // saja, ia hilang dari dokumen — padahal justru itu isi "pekerjaan kurang".
  const lama = [
    kat("A", "PEKERJAAN TANAH"),
    item("1", "A", "Galian", 100, 50_000),
    item("2", "A", "Urugan", 20, 100_000),
  ];
  const baru = [kat("A", "PEKERJAAN TANAH"), item("1", "A", "Galian", 100, 50_000)];

  it("barisnya ada, ditandai HAPUS", () => {
    const r = cari(susunBarisCco(lama, baru).rows, "Urugan");
    expect(r.ket).toBe("HAPUS");
  });

  it("nilainya masuk pekerjaan kurang, dan CCO-01 jadi nol", () => {
    const r = cari(susunBarisCco(lama, baru).rows, "Urugan");
    expect(r.jumlahLama).toBe(2_000_000n);
    expect(r.jumlahKurang).toBe(2_000_000n);
    expect(r.jumlahBaru).toBe(0n);
  });
});

describe("item BARU muncul di kategori yang benar", () => {
  const lama = [
    kat("A", "PEKERJAAN TANAH"),
    item("1", "A", "Galian", 100, 50_000),
    kat("B", "PEKERJAAN BETON"),
    item("1", "B", "Sloof", 10, 200_000, "I#B1"),
  ];
  const baru = [
    kat("A", "PEKERJAAN TANAH"),
    item("1", "A", "Galian", 100, 50_000),
    kat("B", "PEKERJAAN BETON"),
    item("1", "B", "Sloof", 10, 200_000, "I#B1"),
    item("2", "B", "Kolom praktis", 5, 300_000, "I#B2"),
  ];

  it("ditandai BARU dengan MC-0 nol", () => {
    const r = cari(susunBarisCco(lama, baru).rows, "Kolom praktis");
    expect(r.ket).toBe("BARU");
    expect(r.jumlahLama).toBe(0n);
    expect(r.jumlahTambah).toBe(1_500_000n);
    expect(r.jumlahBaru).toBe(1_500_000n);
  });

  it("disisipkan di dalam kategorinya, bukan ditumpuk di ujung dokumen", () => {
    const rows = susunBarisCco(lama, baru).rows;
    const iBeton = rows.findIndex((r) => r.uraian === "PEKERJAAN BETON");
    const iBaru = rows.findIndex((r) => r.uraian === "Kolom praktis");
    const iJumlah = rows.findIndex((r) => r.uraian === "JUMLAH");
    expect(iBaru).toBeGreaterThan(iBeton);
    expect(iBaru).toBeLessThan(iJumlah);
  });
});

describe("KATEGORI yang seluruhnya baru", () => {
  // Perubahan terbesar justru yang paling mudah luput: satu blok pekerjaan
  // baru yang induknya sama sekali tidak ada di RAB aktif.
  const lama = [kat("A", "PEKERJAAN TANAH"), item("1", "A", "Galian", 100, 50_000)];
  const baru = [
    kat("A", "PEKERJAAN TANAH"),
    item("1", "A", "Galian", 100, 50_000),
    kat("C", "PEKERJAAN LANSKAP"),
    item("1", "C", "Paving", 200, 120_000, "I#C1"),
  ];

  it("kategori dan isinya ikut tercetak", () => {
    const rows = susunBarisCco(lama, baru).rows;
    expect(rows.some((r) => r.uraian === "PEKERJAAN LANSKAP")).toBe(true);
    const p = cari(rows, "Paving");
    expect(p.ket).toBe("BARU");
    expect(p.jumlahTambah).toBe(24_000_000n);
  });

  it("nilainya ikut total, bukan hilang diam-diam", () => {
    const { totalBaru, totalTambah, totalLama } = susunBarisCco(lama, baru);
    expect(totalLama).toBe(5_000_000n);
    expect(totalTambah).toBe(24_000_000n);
    expect(totalBaru).toBe(29_000_000n);
  });
});

describe("INVARIAN: MC-0 + tambah − kurang = CCO-01", () => {
  // Kalau invarian ini pecah, dokumennya membantah dirinya sendiri dan tidak
  // ada pemeriksa yang bisa merekonsiliasinya.
  const lama = [
    kat("A", "TANAH"),
    item("1", "A", "Galian", 100, 50_000),
    item("2", "A", "Urugan", 20, 100_000),
    kat("B", "BETON"),
    item("1", "B", "Sloof", 10, 200_000, "I#B1"),
  ];
  const baru = [
    kat("A", "TANAH"),
    item("1", "A", "Galian", 130, 50_000), // naik
    kat("B", "BETON"),
    item("1", "B", "Sloof", 4, 200_000, "I#B1"), // turun
    item("2", "B", "Kolom", 5, 300_000, "I#B2"), // baru
    // "Urugan" dicabut
  ];

  it("total menutup persis", () => {
    const { totalLama, totalTambah, totalKurang, totalBaru } = susunBarisCco(lama, baru);
    expect(totalLama + totalTambah - totalKurang).toBe(totalBaru);
  });

  it("baris JUMLAH memuat angka total yang sama", () => {
    const { rows, totalLama, totalTambah, totalKurang, totalBaru } = susunBarisCco(lama, baru);
    const j = rows.find((r) => r.jenis === "total")!;
    expect(j.jumlahLama).toBe(totalLama);
    expect(j.jumlahTambah).toBe(totalTambah);
    expect(j.jumlahKurang).toBe(totalKurang);
    expect(j.jumlahBaru).toBe(totalBaru);
  });

  it("setiap item terhitung tepat sekali", () => {
    const rows = items(susunBarisCco(lama, baru).rows);
    // 2 item lama + 1 item baru = 3 baris, tidak ada yang ganda.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.uraian).sort()).toEqual(["Galian", "Kolom", "Sloof", "Urugan"]);
  });
});

describe("bobot persen", () => {
  it("nilai ÷ penyebut × 100", () => {
    expect(bobotPersen(2_500_000n, 10_000_000n)).toBeCloseTo(25, 6);
  });

  it("penyebut nol → 0, bukan NaN/Infinity", () => {
    // Kontrak kosong itu mungkin (HPS belum diimpor). NaN di sel Excel
    // menghasilkan #NUM! di dokumen resmi.
    expect(bobotPersen(1_000n, 0n)).toBe(0);
  });
});
