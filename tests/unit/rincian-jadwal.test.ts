import { describe, expect, it } from "vitest";
import {
  labelJadwal,
  susunRincian,
  totalBobotKategori,
  totalNilaiKategori,
  type SimpulRab,
} from "@/lib/export/rincian-jadwal";

/**
 * Rincian Time Schedule sampai level item (DECISIONS 316).
 *
 * Yang paling berharga diuji di sini: BOBOT adalah fakta dari RAB, sedangkan
 * WAKTU adalah warisan kategori induk. Kalau pembedaan itu kabur, berkas ini
 * berubah jadi dokumen yang menyatakan jadwal per item yang tidak pernah
 * disusun siapa pun — lalu disetorkan ke pemberi kerja.
 */

/** Pohon contoh: 1 kategori → 1 sub → 2 item, + kategori kedua tanpa anak. */
function pohon(): SimpulRab[] {
  return [
    { id: "k1", parentId: null, kind: "kategori", code: "A", name: "PEKERJAAN PERSIAPAN", volume: null, unit: null, unitPrice: null, amount: 400, lineageKey: "A" },
    { id: "s1", parentId: "k1", kind: "sub", code: "A.1", name: "Mobilisasi", volume: null, unit: null, unitPrice: null, amount: 400, lineageKey: "A.1" },
    { id: "i1", parentId: "s1", kind: "item", code: "A.1.1", name: "Direksi keet", volume: 2, unit: "unit", unitPrice: 100, amount: 200, lineageKey: "A.1.1" },
    { id: "i2", parentId: "s1", kind: "item", code: "A.1.2", name: "Papan nama", volume: 1, unit: "bh", unitPrice: 200, amount: 200, lineageKey: "A.1.2" },
    { id: "k2", parentId: null, kind: "kategori", code: "B", name: "PEKERJAAN STRUKTUR", volume: null, unit: null, unitPrice: null, amount: 600, lineageKey: "B" },
  ];
}

const JADWAL = [
  { lineageKey: "A", segments: [{ startWeek: 1, endWeek: 4 }] },
  { lineageKey: "B", segments: [{ startWeek: 3, endWeek: 8 }, { startWeek: 11, endWeek: 12 }] },
];

describe("labelJadwal", () => {
  it("rentang biasa", () => {
    expect(labelJadwal([{ startWeek: 5, endWeek: 12 }])).toBe("M5–M12");
  });

  it("satu minggu tidak ditulis sebagai rentang", () => {
    expect(labelJadwal([{ startWeek: 7, endWeek: 7 }])).toBe("M7");
  });

  it("JEDA ditulis terpisah – menggabungkannya akan berbohong", () => {
    // "M5–M14" akan membuat pembaca mengira minggu 9–10 dikerjakan.
    expect(labelJadwal([{ startWeek: 5, endWeek: 8 }, { startWeek: 11, endWeek: 14 }])).toBe(
      "M5–M8, M11–M14",
    );
  });

  it("kategori tanpa jadwal ditandai, bukan dikosongkan diam-diam", () => {
    expect(labelJadwal([])).toBe("–");
  });
});

describe("susunRincian", () => {
  const rows = susunRincian(pohon(), 1000, JADWAL);

  it("mempertahankan urutan pohon RAB apa adanya", () => {
    expect(rows.map((r) => r.code)).toEqual(["A", "A.1", "A.1.1", "A.1.2", "B"]);
  });

  it("bobot tiap baris dihitung dari nilainya sendiri terhadap grand total", () => {
    expect(rows.find((r) => r.code === "A")!.bobotPct).toBeCloseTo(40);
    expect(rows.find((r) => r.code === "A.1.1")!.bobotPct).toBeCloseTo(20);
    expect(rows.find((r) => r.code === "A.1.2")!.bobotPct).toBeCloseTo(20);
    expect(rows.find((r) => r.code === "B")!.bobotPct).toBeCloseTo(60);
  });

  it("ITEM mewarisi jadwal kategori induknya, lewat sub di antaranya", () => {
    // Item menempel ke sub, bukan langsung ke kategori — penelusurannya harus
    // naik lebih dari satu tingkat.
    const item = rows.find((r) => r.code === "A.1.1")!;
    expect(item.kategori).toBe("PEKERJAAN PERSIAPAN");
    expect(item.jadwal).toBe("M1–M4");
  });

  it("jeda kategori ikut terwarisi utuh ke itemnya", () => {
    const kat = rows.find((r) => r.code === "B")!;
    expect(kat.jadwal).toBe("M3–M8, M11–M12");
  });

  it("level dipakai untuk indentasi: kategori 0, sub 1, item 3", () => {
    expect(rows.map((r) => r.level)).toEqual([0, 1, 3, 3, 0]);
  });

  it("kategori yang belum dijadwalkan tidak mengarang waktu", () => {
    const tanpa = susunRincian(pohon(), 1000, [{ lineageKey: "A", segments: [{ startWeek: 1, endWeek: 4 }] }]);
    expect(tanpa.find((r) => r.code === "B")!.jadwal).toBe("–");
  });

  it("grand total DITERIMA, bukan dijumlah dari simpul – mencegah hitung ganda", () => {
    // Σ semua amount = 1600 (kategori + anaknya). Kalau itu yang jadi pembagi,
    // bobot kategori jadi 25% + 37,5% dan totalnya bukan 100%.
    expect(totalBobotKategori(rows)).toBeCloseTo(100);
  });

  it("total hanya menjumlah KATEGORI – sub/item adalah anaknya", () => {
    expect(totalNilaiKategori(rows)).toBe(1000);
  });

  it("data kosong / grand total nol tidak melempar", () => {
    expect(susunRincian([], 1000, JADWAL)).toEqual([]);
    expect(susunRincian(pohon(), 0, JADWAL)).toEqual([]);
  });

  it("pohon rusak (parent melingkar) tidak menggantungkan unduhan", () => {
    const rusak: SimpulRab[] = [
      { id: "x", parentId: "y", kind: "item", code: "X", name: "X", volume: null, unit: null, unitPrice: null, amount: 10, lineageKey: "X" },
      { id: "y", parentId: "x", kind: "grup", code: "Y", name: "Y", volume: null, unit: null, unitPrice: null, amount: 10, lineageKey: "Y" },
    ];
    const hasil = susunRincian(rusak, 100, []);
    expect(hasil).toHaveLength(2);
    expect(hasil[0].kategori).toBe("–");
    expect(hasil[0].jadwal).toBe("–");
  });
});
