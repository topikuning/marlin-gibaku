import { describe, expect, it } from "vitest";
import { catatanGabung, ringkasKendalaPerLokasi } from "@/lib/waha/kendala-ringkas";
import type { BarisKendala } from "@/lib/waha/tanya-format";

/**
 * Register kendala: satu baris per lokasi, tanpa kembar (DECISIONS 450).
 *
 * Kasus di sini diambil dari dokumen yang BENAR-BENAR terkirim ke user
 * 2026-08-27 – Betahwalang dua kali dengan kalimat identik, Junganyar tiga
 * baris untuk dua persoalan, dan "Pekerjaan tertahan menunggu lahan / izin"
 * berdiri sendiri di sebelah kalimat yang memuatnya utuh.
 *
 * Yang dijaga bukan cuma penggabungannya, melainkan BATASNYA: kalimat yang
 * sekadar mirip tidak boleh ikut hilang, karena yang hilang dari daftar
 * tagihan adalah pekerjaan yang tidak ditagih.
 */

const k = (
  lokasi: string,
  judul: string,
  tingkat = "sedang",
  status = "terbuka",
  umurHari = 5,
): BarisKendala => ({ lokasi, judul, tingkat, status, umurHari });

describe("kembar dibuang", () => {
  it("kalimat yang PERSIS sama di satu lokasi jadi satu", () => {
    const r = ringkasKendalaPerLokasi([
      k("Betahwalang", "Lokasi depan proyek masih proses pembersihan dari tempat rongsokan"),
      k("Betahwalang", "Lokasi depan proyek masih proses pembersihan dari tempat rongsokan"),
    ]);
    expect(r.baris).toHaveLength(1);
    expect(r.baris[0].kendala).toHaveLength(1);
    expect(r.digabung).toBe(1);
  });

  it("beda huruf besar/kecil & tanda baca tetap terbaca sama", () => {
    const r = ringkasKendalaPerLokasi([
      k("Tengket", "Menunggu lahan / izin"),
      k("Tengket", "MENUNGGU LAHAN/IZIN."),
    ]);
    expect(r.baris[0].kendala).toHaveLength(1);
  });

  it("kalimat yang sudah TERMUAT UTUH di kalimat lain dibuang, yang lengkap dipakai", () => {
    const panjang =
      "Pekerjaan tertahan menunggu lahan / izin – Menunggu Akses Jalan Menuju Lokasi Belum Clean and Clear";
    const r = ringkasKendalaPerLokasi([
      k("Batah Timur", "Pekerjaan tertahan menunggu lahan / izin", "kritis"),
      k("Batah Timur", panjang),
    ]);
    expect(r.baris[0].kendala).toEqual([panjang]);
  });

  it("lokasi BERBEDA dengan kalimat sama TIDAK digabung", () => {
    // Dua lokasi yang macet karena sebab yang sama tetap dua tagihan.
    const teks = "Belum mendapatkan berita acara serah terima lapangan";
    const r = ringkasKendalaPerLokasi([k("Banjarejo", teks), k("Kanigoro", teks)]);
    expect(r.baris).toHaveLength(2);
    expect(r.digabung).toBe(0);
  });

  it("kalimat pendek yang umum TIDAK ikut tertelan kalimat panjang", () => {
    // "Lainnya" kebetulan muncul di tengah kalimat lain – menggabungkannya
    // berarti menghapus satu kendala yang memang berdiri sendiri.
    const r = ringkasKendalaPerLokasi([
      k("Klampis Timur", "Sosialisasi warga dan hal lainnya yang perlu diselesaikan"),
      k("Klampis Timur", "Lainnya"),
    ]);
    expect(r.baris[0].kendala).toHaveLength(2);
  });

  it("kalimat yang sekadar mirip tetap dua – yang hilang dari daftar tidak ditagih", () => {
    const r = ringkasKendalaPerLokasi([
      k("Junganyar", "Menunggu lahan / izin"),
      k("Junganyar", "Lokasi Pekerjaan masuk di kawasan Hutan Lindung"),
    ]);
    expect(r.baris[0].kendala).toHaveLength(2);
  });
});

describe("satu baris per lokasi", () => {
  it("beberapa kendala di satu lokasi jadi SATU baris berisi semuanya", () => {
    const r = ringkasKendalaPerLokasi([
      k("Junganyar", "Menunggu lahan / izin", "kritis", "terbuka", 5),
      k("Junganyar", "Menunggu lahan / izin", "sedang", "terbuka", 5),
      k("Junganyar", "Lokasi Pekerjaan masuk di kawasan Hutan Lindung", "sedang", "terbuka", 5),
    ]);
    expect(r.baris).toHaveLength(1);
    expect(r.baris[0].kendala).toEqual([
      "Menunggu lahan / izin",
      "Lokasi Pekerjaan masuk di kawasan Hutan Lindung",
    ]);
  });

  it("tingkat = yang TERTINGGI di lokasi itu", () => {
    const r = ringkasKendalaPerLokasi([
      k("Mertak", "Perihal lokasi area", "sedang"),
      k("Mertak", "Akses jalan terputus", "kritis"),
      k("Mertak", "Menunggu material tiba", "rendah"),
    ]);
    expect(r.baris[0].tingkat).toBe("kritis");
  });

  it("umur = yang TERLAMA, bukan rata-rata", () => {
    const r = ringkasKendalaPerLokasi([
      k("Mertak", "Satu", "sedang", "terbuka", 2),
      k("Mertak", "Dua", "sedang", "terbuka", 9),
    ]);
    expect(r.baris[0].umurHari).toBe(9);
  });

  it("status = yang paling BELUM tertangani", () => {
    const r = ringkasKendalaPerLokasi([
      k("Mertak", "Satu", "sedang", "ditangani"),
      k("Mertak", "Dua", "sedang", "terbuka"),
    ]);
    expect(r.baris[0].status).toBe("terbuka");
  });

  it("urutan lokasi mengikuti urutan datangnya, bukan diacak Map", () => {
    const r = ringkasKendalaPerLokasi([k("Zeta", "a"), k("Alfa", "b"), k("Zeta", "c")]);
    expect(r.baris.map((b) => b.lokasi)).toEqual(["Zeta", "Alfa"]);
  });
});

describe("penggabungan tidak pernah diam-diam", () => {
  it("jumlah yang digabung disebutkan", () => {
    expect(catatanGabung(3)).toContain("3 baris");
  });

  it("tanpa kembar, tidak ada catatan sama sekali", () => {
    // Catatan yang selalu muncul akan berhenti dibaca justru saat ia berarti.
    expect(catatanGabung(0)).toBeNull();
  });
});
