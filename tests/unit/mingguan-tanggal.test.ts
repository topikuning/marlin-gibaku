// BERKAS MINGGUAN: tujuh tanggal yang membentuk minggu ke-n (DECISIONS 332).
//
// Cacat yang dijaga berkas ini SENYAP dan mahal: berkasnya tetap terbit, tetap
// rapi, tetap bertanda tangan — hanya tanggalnya yang bukan minggu itu. Sampul
// menulis "MINGGU KE-3", isinya hari-hari minggu ke-4. Tidak ada yang tahu
// sampai seseorang mencocokkannya dengan kalender, dan saat itu dokumennya
// sudah ditandatangani PPK.
//
// Sumber cacatnya: DUA rumus di dua berkas yang harus saling membalik.
//
//   queries.getKkpDailyData : weekNo   = floor((tanggal − mulai) / 7 hari) + 1
//   mingguan-kkp.tanggalMinggu : tanggal = mulai + (n − 1) × 7 hari + i
//
// Karena itu uji utamanya bukan "apakah tanggalnya benar" melainkan **apakah
// keduanya saling membalik** — sifat yang tetap berlaku walau salah satu
// rumusnya diubah orang lain nanti.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

const { tanggalMinggu } = await import("@/lib/pdf/mingguan-kkp");

const HARI = 86_400_000;
const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Salinan rumus `queries.getKkpDailyData` — sengaja ditulis ulang di sini. */
function weekNoDariTanggal(mulai: Date, kunci: string): number {
  return Math.max(1, Math.floor((tgl(kunci).getTime() - mulai.getTime()) / (7 * HARI)) + 1);
}

describe("tujuh tanggal minggu ke-n", () => {
  const MULAI = tgl("2026-08-03"); // Senin

  it("minggu ke-1 mulai tepat di tanggal SPMK", () => {
    expect(tanggalMinggu(MULAI, 1)[0]).toBe("2026-08-03");
  });

  it("selalu tujuh tanggal, berurutan, tanpa lompat", () => {
    for (const n of [1, 2, 5, 40]) {
      const t = tanggalMinggu(MULAI, n);
      expect(t, `minggu ${n}`).toHaveLength(7);
      for (let i = 1; i < t.length; i++) {
        expect(tgl(t[i]).getTime() - tgl(t[i - 1]).getTime(), `minggu ${n} hari ${i}`).toBe(HARI);
      }
    }
  });

  it("minggu berikutnya mulai tepat sehari sesudah minggu sebelumnya berakhir", () => {
    // Tidak boleh ada hari yang jatuh di antara dua minggu, dan tidak boleh ada
    // hari yang masuk dua minggu sekaligus.
    for (const n of [1, 2, 3, 12]) {
      const ini = tanggalMinggu(MULAI, n);
      const depan = tanggalMinggu(MULAI, n + 1);
      expect(tgl(depan[0]).getTime() - tgl(ini[6]).getTime(), `minggu ${n}→${n + 1}`).toBe(HARI);
    }
  });

  it("SETIAP tanggal yang dihasilkan mengaku milik minggu itu juga", () => {
    // Inti berkas ini: kedua rumus saling membalik.
    for (const n of [1, 2, 3, 7, 25, 52]) {
      for (const t of tanggalMinggu(MULAI, n)) {
        expect(weekNoDariTanggal(MULAI, t), `${t} pada minggu ${n}`).toBe(n);
      }
    }
  });

  it("tetap saling membalik walau SPMK jatuh di tengah pekan", () => {
    // Minggu kontrak TIDAK sama dengan minggu kalender: ia dihitung dari SPMK.
    // Kalau suatu saat ada yang "membetulkannya" jadi Senin–Minggu, uji ini
    // yang merah lebih dulu.
    for (const awal of ["2026-08-05", "2026-08-08", "2026-12-30"]) {
      const mulai = tgl(awal);
      for (const n of [1, 4, 9]) {
        for (const t of tanggalMinggu(mulai, n)) {
          expect(weekNoDariTanggal(mulai, t), `${awal} · ${t} · minggu ${n}`).toBe(n);
        }
      }
    }
  });

  it("melintasi pergantian tahun tanpa tergelincir", () => {
    const mulai = tgl("2026-12-28");
    const t = tanggalMinggu(mulai, 2);
    expect(t[0]).toBe("2027-01-04");
    expect(t[6]).toBe("2027-01-10");
  });
});

const { statusBerkasMingguan } = await import("@/lib/pdf/mingguan-kkp");

/**
 * Baris status di kaki tiap halaman. Diuji terpisah karena PDF-nya memakai font
 * subset — teksnya TIDAK bisa dicari di berkas hasilnya, sehingga uji
 * integrasi tidak mungkin membuktikan kalimatnya. Yang bisa dijamin: kalimatnya
 * disusun benar, dan `renderMingguanKkpPdf` memang memanggil fungsi ini.
 */
describe("status kaki berkas mingguan", () => {
  const dasar = { minggu: 3, adaFinal: true, hariKosong: 0, fotoDipotong: 0 };

  it("minggu selalu disebut", () => {
    expect(statusBerkasMingguan(dasar)).toContain("Minggu ke-3");
  });

  it("berkas utuh & final tidak diberi peringatan apa pun", () => {
    expect(statusBerkasMingguan(dasar)).toBe("Minggu ke-3");
  });

  it("tanpa satu pun laporan final → PRATINJAU", () => {
    // Berkas yang isinya masih draf tidak boleh terbaca resmi hanya karena
    // sampulnya rapi dan bertanda tangan.
    expect(statusBerkasMingguan({ ...dasar, adaFinal: false })).toContain("PRATINJAU");
  });

  it("hari kosong DISEBUT jumlahnya", () => {
    // "Tidak muncul" tidak boleh terbaca "tidak ada".
    expect(statusBerkasMingguan({ ...dasar, hariKosong: 4 })).toContain(
      "4 hari belum ada laporan",
    );
  });

  it("foto yang tidak muat DISEBUT jumlahnya", () => {
    // Memotong dokumentasi diam-diam membuat berkasnya terbaca lengkap.
    expect(statusBerkasMingguan({ ...dasar, fotoDipotong: 31 })).toContain(
      "31 foto tidak dimuat",
    );
  });

  it("beberapa kekurangan sekaligus, semuanya disebut", () => {
    const s = statusBerkasMingguan({ minggu: 5, adaFinal: false, hariKosong: 2, fotoDipotong: 9 });
    expect(s).toContain("Minggu ke-5");
    expect(s).toContain("PRATINJAU");
    expect(s).toContain("2 hari belum ada laporan");
    expect(s).toContain("9 foto tidak dimuat");
  });
});
