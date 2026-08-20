// Pengingat WA laporan harian + minggu-0 sebelum SPMK (DECISIONS 202).
//
// Permintaan user 2026-08-01: "pengguna seharusnya ada nomor wa yang diisi,
// lalu aku ingin tiap hari ada auto wa ke tiap penanggung jawab, bahwa laporan
// hari ini sudah diinput atau belum" + temuan SPMK 3 Agustus tapi sistem sudah
// memposisikan Pelaksanaan pada 1 Agustus.
import { describe, expect, it, vi } from "vitest";
import { pesanPengingat } from "@/lib/harian/pesan";

// `lib/progress` menarik db (server-only) hanya karena query di modul yang
// sama; DUA FUNGSI yang diuji di sini murni. Env diisi & modulnya diimpor
// dinamis supaya tes ini tidak butuh database.
process.env.APP_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
const { currentWeekNumber, planPctAtWeek } = await import("@/lib/progress");

describe("pesan pengingat: hanya menagih yang perlu", () => {
  it("tanpa lokasi tertagih → TIDAK ada pesan sama sekali", () => {
    // Pengingat yang tetap datang saat semua sudah lapor akan berhenti dibaca
    // dalam seminggu, dan pengingat yang tidak dibaca sama saja dengan tidak ada.
    expect(pesanPengingat("Prio", "1 Agt 2026", [])).toBeNull();
  });

  it("satu lokasi belum lapor: menyebut nama orang, tanggal, dan lokasinya", () => {
    const t = pesanPengingat("Prio Yulianto", "1 Agt 2026", [
      { nama: "Pengaradan", adaDraft: false },
    ])!;
    expect(t).toContain("Prio Yulianto");
    expect(t).toContain("1 Agt 2026");
    expect(t).toContain("Pengaradan – belum ada laporan");
    expect(t).toContain("1 lokasi");
  });

  it("membedakan BELUM ADA dari MASIH DRAF – dua masalah yang berbeda", () => {
    const t = pesanPengingat("Budi", "1 Agt 2026", [
      { nama: "Alfa", adaDraft: true },
      { nama: "Beta", adaDraft: false },
    ])!;
    expect(t).toContain("Alfa – masih DRAF, belum dikirim");
    expect(t).toContain("Beta – belum ada laporan");
    expect(t).toContain("2 lokasi");
  });

  it("satu orang tiga lokasi = SATU pesan, bukan tiga", () => {
    const t = pesanPengingat("Citra", "1 Agt 2026", [
      { nama: "A", adaDraft: false },
      { nama: "B", adaDraft: false },
      { nama: "C", adaDraft: false },
    ])!;
    expect(t.match(/^• /gm)).toHaveLength(3);
    expect(t.startsWith("*MARLIN")).toBe(true);
  });

  it("menyebut dirinya pesan otomatis + kemungkinan sudah dikirim", () => {
    // Orang lapangan yang baru saja mengirim laporan lalu menerima tagihan akan
    // mengira sistemnya rusak. Pesannya harus mendahului kebingungan itu.
    const t = pesanPengingat("D", "1 Agt 2026", [{ nama: "X", adaDraft: false }])!;
    expect(t).toMatch(/otomatis/i);
    expect(t).toMatch(/abaikan/i);
  });
});

/* ── Minggu 0: sebelum SPMK, proyek BELUM berjalan ───────────────────────── */

describe("kurva-S sebelum tanggal SPMK", () => {
  const spmk = new Date("2026-08-03T00:00:00.000Z");
  const kurva = [10, 25, 45, 70, 90, 100];

  it("BUKTI BUG LAMA: 1 Agustus (SPMK 3 Agustus) dulu terbaca Minggu 1", () => {
    // Sekarang 0 = belum mulai. Dulu di-clamp ke 1, sehingga rencana minggu 1
    // dianggap target yang seharusnya sudah tercapai.
    expect(currentWeekNumber(spmk, 6, new Date("2026-08-01T10:00:00+07:00"))).toBe(0);
  });

  it("minggu 0 → rencana 0%, bukan rencana minggu 1", () => {
    expect(planPctAtWeek(kurva, 0)).toBe(0);
    // Tanpa perbaikan ini, hasilnya 10% → deviasi −10 pp palsu.
    expect(planPctAtWeek(kurva, 1)).toBe(10);
  });

  it("pada hari SPMK-nya sendiri sudah Minggu 1", () => {
    expect(currentWeekNumber(spmk, 6, new Date("2026-08-03T08:00:00+07:00"))).toBe(1);
  });

  it("berjalan normal setelahnya, dan tetap ter-clamp di minggu terakhir", () => {
    expect(currentWeekNumber(spmk, 6, new Date("2026-08-12T08:00:00+07:00"))).toBe(2);
    expect(currentWeekNumber(spmk, 6, new Date("2027-01-01T08:00:00+07:00"))).toBe(6);
  });
});
