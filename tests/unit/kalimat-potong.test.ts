// "Maksimal 3 kalimat" harus DITEGAKKAN KODE, bukan cuma diminta lewat prompt.
//
// Permintaan user 2026-08-31: kesimpulan satu lokasi "dalam 2-3 kalimat".
// Sampai sekarang batas semacam itu hanya tertulis di instruksi
// (`executiveSummary maksimal 3 kalimat`, `waSummary maksimal 3 kalimat`) dan
// tidak ada satu baris kode pun yang memeriksanya — model tetap sering
// mengirim lebih, dan yang membaca di WhatsApp menerima paragraf.
//
// Yang paling mudah salah di sini bukan pemotongannya, melainkan APA yang
// dianggap akhir kalimat. Angka Indonesia memakai titik sebagai pemisah ribuan
// ("Rp 1.500.000"), jadi pemotong yang memecah di setiap titik akan memenggal
// kalimat di tengah nominal — persis di tempat yang paling merugikan.
import { describe, expect, it } from "vitest";
import { potongKalimat } from "@/lib/kalimat";

describe("potongKalimat", () => {
  it("mengambil sebanyak yang diminta, tidak lebih", () => {
    const t = "Satu. Dua. Tiga. Empat.";
    expect(potongKalimat(t, 3)).toBe("Satu. Dua. Tiga.");
    expect(potongKalimat(t, 2)).toBe("Satu. Dua.");
  });

  it("tidak memotong di dalam angka berpemisah ribuan", () => {
    const t = "Biaya tertahan Rp 1.500.000 di lokasi itu. Pekerjaannya berhenti.";
    expect(potongKalimat(t, 1)).toBe("Biaya tertahan Rp 1.500.000 di lokasi itu.");
  });

  it("membiarkan teks yang sudah cukup pendek apa adanya", () => {
    expect(potongKalimat("Satu kalimat saja.", 3)).toBe("Satu kalimat saja.");
    expect(potongKalimat("Tanpa titik sama sekali", 3)).toBe("Tanpa titik sama sekali");
  });

  it("menghormati tanda tanya dan seru sebagai akhir kalimat", () => {
    expect(potongKalimat("Kenapa berhenti? Lahannya belum bebas. Sudah 91 hari.", 2)).toBe(
      "Kenapa berhenti? Lahannya belum bebas.",
    );
  });

  it("merapikan spasi berlebih dan baris kosong", () => {
    expect(potongKalimat("  Satu.\n\n  Dua.  ", 2)).toBe("Satu. Dua.");
  });

  it("mengembalikan teks kosong apa adanya", () => {
    expect(potongKalimat("", 3)).toBe("");
    expect(potongKalimat("   ", 3)).toBe("");
  });
});
