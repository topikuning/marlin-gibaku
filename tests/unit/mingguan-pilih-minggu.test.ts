// LAPORAN MINGGUAN → GRUP WA: minggu mana yang dilaporkan (DECISIONS 357).
//
// Permintaan user 2026-08-17: *"itu saat ini kirim minggu berjalan, padahal
// kadang kita butuh kirim minggu terakhir. butuh flexibelitas di situ."*
//
// Cacat yang dijaga berkas ini SENYAP: pesannya tetap terkirim, tetap rapi,
// tetap berjudul "Minggu Ke : 6" — hanya angkanya yang bukan angka minggu itu.
// Penerimanya PPK dan konsultan, di grup yang pesannya tidak bisa ditarik
// kembali, dan tidak ada yang bisa membedakannya tanpa menghitung ulang sendiri.
//
// Karena itu yang diuji BUKAN "apakah nomor minggunya benar" saja, melainkan
// apakah `mingguKontrak` dan `rentangMingguKontrak` benar-benar SALING
// MEMBALIK — sifat yang tetap berlaku walau salah satu rumusnya diubah nanti.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

const { mingguKontrak, rentangMingguKontrak, mingguSelesaiTerakhir, asOfMinggu } = await import(
  "@/lib/mingguan/kirim"
);

const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SPMK = tgl("2026-07-06"); // Senin

describe("rentang minggu kontrak", () => {
  it("minggu ke-1 dimulai TEPAT di tanggal SPMK", () => {
    const r = rentangMingguKontrak(SPMK, 1);
    expect(r.mulai.toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(r.akhir.toISOString().slice(0, 10)).toBe("2026-07-12");
  });

  it("tiap minggu tepat 7 hari, tanpa celah & tanpa tumpang tindih", () => {
    for (let n = 1; n <= 30; n++) {
      const a = rentangMingguKontrak(SPMK, n);
      const b = rentangMingguKontrak(SPMK, n + 1);
      expect(b.mulai.getTime() - a.akhir.getTime(), `minggu ${n}→${n + 1}`).toBe(86_400_000);
    }
  });

  it("SALING MEMBALIK dengan mingguKontrak – tiap hari di rentang memberi nomor yang sama", () => {
    /*
     * Inti berkas ini. Kalau salah satu rumus digeser satu hari, judul pesan
     * dan angka di dalamnya akan berasal dari minggu yang berbeda — dan
     * gejalanya tidak terlihat di layar mana pun.
     */
    for (let n = 1; n <= 30; n++) {
      const r = rentangMingguKontrak(SPMK, n);
      for (let i = 0; i < 7; i++) {
        const hari = new Date(r.mulai.getTime() + i * 86_400_000);
        expect(mingguKontrak(SPMK, hari), `minggu ${n} hari ke-${i + 1}`).toBe(n);
      }
    }
  });

  it("nomor minggu di bawah 1 dijepit, bukan menghasilkan tanggal sebelum SPMK", () => {
    for (const n of [0, -1, -99]) {
      expect(rentangMingguKontrak(SPMK, n).mulai.toISOString().slice(0, 10), String(n)).toBe(
        "2026-07-06",
      );
    }
  });
});

describe("minggu selesai terakhir", () => {
  it("nol selama kontrak belum melewati satu minggu penuh", () => {
    // Bukan "minggu ke-0": menawarkan kirim minggu terakhir pada kontrak yang
    // baru berjalan tiga hari menjanjikan laporan yang isinya belum ada.
    expect(mingguSelesaiTerakhir(SPMK, tgl("2026-07-06"))).toBe(0);
    expect(mingguSelesaiTerakhir(SPMK, tgl("2026-07-12"))).toBe(0);
  });

  it("naik satu tepat saat minggu berikutnya dimulai", () => {
    expect(mingguSelesaiTerakhir(SPMK, tgl("2026-07-13"))).toBe(1);
    expect(mingguSelesaiTerakhir(SPMK, tgl("2026-07-19"))).toBe(1);
    expect(mingguSelesaiTerakhir(SPMK, tgl("2026-07-20"))).toBe(2);
  });

  it("selalu tepat satu di bawah minggu berjalan", () => {
    for (const hari of ["2026-07-06", "2026-08-01", "2026-09-15", "2026-12-31"]) {
      const n = tgl(hari);
      expect(mingguSelesaiTerakhir(SPMK, n), hari).toBe(mingguKontrak(SPMK, n) - 1);
    }
  });
});

describe("asOf: tanggal yang dipakai menghitung angka", () => {
  const KINI = tgl("2026-08-19"); // minggu berjalan ke-7

  it("minggu berjalan memakai HARI INI, bukan akhir minggunya", () => {
    /*
     * Memakai akhir minggu berjalan berarti memakai tanggal DEPAN, dan
     * `report_date <= asOf` akan diam-diam memasukkan laporan yang belum ada.
     */
    const berjalan = mingguKontrak(SPMK, KINI);
    expect(asOfMinggu(SPMK, berjalan, KINI).getTime()).toBe(KINI.getTime());
  });

  it("minggu LAMPAU memakai hari terakhir minggu itu", () => {
    // Tanpa ini, judul "Minggu ke-5" memuat realisasi hari ini — jawaban benar
    // untuk minggu yang salah.
    const asOf = asOfMinggu(SPMK, 5, KINI);
    expect(asOf.toISOString().slice(0, 10)).toBe(
      rentangMingguKontrak(SPMK, 5).akhir.toISOString().slice(0, 10),
    );
    expect(asOf.getTime()).toBeLessThan(KINI.getTime());
  });

  it("minggu DEPAN tidak pernah menghasilkan asOf di masa depan", () => {
    // Pemanggil menolak minggu > berjalan, tapi pagar keduanya murah dan
    // mencegah tanggal depan bocor ke query kalau pagar pertama kelak digeser.
    const berjalan = mingguKontrak(SPMK, KINI);
    expect(asOfMinggu(SPMK, berjalan + 3, KINI).getTime()).toBe(KINI.getTime());
  });

  it("asOf minggu lampau selalu naik seiring nomor minggunya", () => {
    let sebelumnya = 0;
    for (let n = 1; n < mingguKontrak(SPMK, KINI); n++) {
      const t = asOfMinggu(SPMK, n, KINI).getTime();
      expect(t, `minggu ${n}`).toBeGreaterThan(sebelumnya);
      sebelumnya = t;
    }
  });
});
