// PENILAIAN RENCANA MINGGUAN (DECISIONS 258).
//
// Keberatan user 2026-08-05: "aku sudah buat rencana, lalu apa? … berapa persen
// pencapaiannya jika rencanamu diikuti … apa maksud tulisan merah itu?"
//
// Yang dikunci berkas ini tiga hal yang semuanya cacat SENYAP — tidak satu pun
// menimbulkan galat, layarnya tetap rapi, dan salahnya baru ketahuan saat
// rencana dipertanggungjawabkan ke PPK:
//
//  1. label kejaran yang terbaca sebagai penambahan padahal himpunan bagian;
//  2. proyeksi yang tidak pernah dihitung, sehingga rencana tak bisa dinilai
//     sebelum dijalankan;
//  3. PPC yang kalau dihitung tertimbang-volume akan memberi nilai bagus untuk
//     minggu yang sebenarnya memacetkan seluruh rantai pekerjaan.
import { describe, expect, it } from "vitest";
import {
  LABEL_STATUS,
  hitungPpc,
  hitungProyeksi,
  labelKejar,
  statusDeviasi,
} from "@/lib/plan/rencana-format";

const fmt = (n: number) => n.toFixed(2);

describe("label kejaran", () => {
  it("tanpa kejaran → tidak ada label sama sekali", () => {
    expect(labelKejar(100, 0, fmt)).toBeNull();
  });

  it("SELURUH target adalah kejaran → dikatakan, bukan diulang angkanya", () => {
    // Kasus di layar user: target 1.698,24 dengan kejaran 1.698,24. Notasi lama
    // "(+1.698,24 kejar)" terbaca 3.396,48 — dua kali lipat kenyataannya.
    expect(labelKejar(1698.24, 1698.24, fmt)).toBe("seluruhnya kejaran");
  });

  it("sebagian kejaran → disebut BAGIAN, bukan tambahan", () => {
    // Kata "termasuk" yang menentukan. "+142,51" mengajak menjumlahkan;
    // "termasuk 142,51" mengajak membaginya.
    expect(labelKejar(275.32, 142.51, fmt)).toBe("termasuk 142.51 kejaran");
  });

  it("kejaran melebihi target (pembulatan) tetap dibaca seluruhnya", () => {
    // Bisa terjadi karena `min(sisa, …)` memotong target tapi tidak kejarannya.
    // Yang dilarang: menampilkan angka yang lebih besar daripada targetnya.
    expect(labelKejar(100, 100.0000001, fmt)).toBe("seluruhnya kejaran");
  });
});

describe("proyeksi kalau rencana diikuti", () => {
  const dasar = { actualPct: 12.4, targetPct: 23.1, grandTotal: 2_000_000_000 };

  it("menjawab 'sampai di mana', bukan mengulang riwayat", () => {
    const p = hitungProyeksi({ ...dasar, nilaiRencana: 148_000_000 });
    expect(p.tambahanPct).toBeCloseTo(7.4, 5);
    expect(p.proyeksiPct).toBeCloseTo(19.8, 5);
  });

  it("menandai bahwa rencana ini SAJA belum cukup mengejar kurva-S", () => {
    // Ini yang paling berguna: rencananya masuk akal, tapi tetap tertinggal.
    // Tanpa angka ini, orang menyetujui rencana yang sudah pasti tidak mengejar.
    const p = hitungProyeksi({ ...dasar, nilaiRencana: 148_000_000 });
    expect(p.masihTertinggal).toBe(true);
    expect(p.selisihPct).toBeCloseTo(-3.3, 5);
  });

  it("rencana yang cukup → tidak ditandai tertinggal", () => {
    const p = hitungProyeksi({ ...dasar, nilaiRencana: 220_000_000 });
    expect(p.proyeksiPct).toBeCloseTo(23.4, 5);
    expect(p.masihTertinggal).toBe(false);
  });

  it("selisih setipis pembulatan TIDAK ditandai tertinggal", () => {
    // Menandai merah untuk 0,005 poin hanya melatih orang mengabaikan warna.
    const p = hitungProyeksi({ actualPct: 20, targetPct: 20.005, nilaiRencana: 0, grandTotal: 100 });
    expect(p.masihTertinggal).toBe(false);
  });

  it("rencana kosong → proyeksi = realisasi sekarang, apa adanya", () => {
    const p = hitungProyeksi({ ...dasar, nilaiRencana: 0 });
    expect(p.tambahanPct).toBe(0);
    expect(p.proyeksiPct).toBeCloseTo(12.4, 5);
  });
});

describe("PPC — Percent Plan Complete", () => {
  it("dihitung PER KOMITMEN dan BINER, bukan tertimbang volume", () => {
    // Inti Last Planner System: pekerjaan 80% selesai TIDAK melepaskan
    // penerusnya. Empat komitmen, satu tuntas → 25%, walau volumenya hampir
    // penuh. Kalau suatu saat ini dihitung tertimbang, angkanya jadi ~94% untuk
    // minggu yang sebenarnya memacetkan seluruh rantai.
    const p = hitungPpc([
      { targetVolume: 100, realisasiVolume: 100 },
      { targetVolume: 100, realisasiVolume: 95 },
      { targetVolume: 100, realisasiVolume: 92 },
      { targetVolume: 100, realisasiVolume: 90 },
    ]);
    expect(p.pct).toBe(25);
    expect(p.volumePct).toBeGreaterThan(90); // pelengkap, bukan pengganti
  });

  it("kelebihan di satu item TIDAK menutupi kekurangan di item lain", () => {
    // Tanpa pembatasan per item, volumePct bisa 100% padahal ada yang nol —
    // dan yang nol itulah yang menghentikan pekerjaan berikutnya.
    const p = hitungPpc([
      { targetVolume: 100, realisasiVolume: 200 },
      { targetVolume: 100, realisasiVolume: 0 },
    ]);
    expect(p.pct).toBe(50);
    expect(p.volumePct).toBe(50);
  });

  it("tuntas persis di target dihitung tuntas", () => {
    expect(hitungPpc([{ targetVolume: 50, realisasiVolume: 50 }]).pct).toBe(100);
  });

  it("tidak ada rencana minggu lalu → null, BUKAN 0", () => {
    // 0% berarti "berjanji lalu gagal total"; null berarti "tidak berjanji".
    // Menyamakannya menghukum lokasi yang baru mulai.
    const p = hitungPpc([]);
    expect(p.pct).toBeNull();
    expect(p.volumePct).toBeNull();
  });
});

describe("status deviasi", () => {
  it("tiga tingkat, dengan ambang yang bisa dipertanggungjawabkan", () => {
    expect(statusDeviasi(0)).toBe("aman");
    expect(statusDeviasi(-4.9)).toBe("aman");
    expect(statusDeviasi(-5.1)).toBe("perhatian");
    expect(statusDeviasi(-10.1)).toBe("kritis");
  });

  it("tiap status punya label teks — bukan warna saja", () => {
    // Berkas ini dicetak hitam-putih dan dibaca orang yang mungkin buta warna.
    for (const s of ["aman", "perhatian", "kritis"] as const) {
      expect(LABEL_STATUS[s]).toBeTruthy();
    }
  });
});
