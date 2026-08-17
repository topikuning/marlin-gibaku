// KENDALA DITANYAKAN SAAT MENGIRIM (DECISIONS 341).
//
// Kegagalan yang dijaga berkas ini punya bentuk yang sangat khas: pelapor
// MENYATAKAN ada kendala, lalu judulnya kosong. Kalau itu diterima, kendalanya
// lenyap tanpa jejak DAN laporannya terkirim seolah-olah hari itu lancar —
// persis kebalikan dari yang barusan dinyatakan orangnya, dan tidak ada satu
// pun galat yang terbit.
//
// Sisi lainnya sama pentingnya: pengiriman dari jalur yang memang belum
// menanyakan kendala tidak boleh ikut ditolak. Pertanyaan ini soal kelengkapan
// laporan, bukan soal izin.
import { describe, expect, it } from "vitest";
import { bacaKendalaKirim } from "@/lib/daily-report/kirim-kendala";

const kosong = { pilihan: null, title: null, severity: null, description: null };

describe('pilihan "tidak ada kendala"', () => {
  it("diterima, dan tidak mencatat apa pun", () => {
    const r = bacaKendalaKirim({ ...kosong, pilihan: "tidak_ada" });
    expect(r.ok && r.kendala).toBeNull();
  });

  it("judul yang terlanjur diketik lalu dibatalkan TIDAK ikut tercatat", () => {
    // Orang mengetik kendala, berubah pikiran, menekan "Tidak ada". Jawabannya
    // yang terakhir yang berlaku — bukan sisa ketikan di kolom yang tersembunyi.
    const r = bacaKendalaKirim({
      ...kosong,
      pilihan: "tidak_ada",
      title: "hujan deras",
      severity: "tinggi",
    });
    expect(r.ok && r.kendala).toBeNull();
  });
});

describe('pilihan "ada kendala"', () => {
  it("judul terisi → tercatat lengkap", () => {
    const r = bacaKendalaKirim({
      pilihan: "ada",
      title: "  hujan deras sejak siang  ",
      severity: "tinggi",
      description: "  cor ditunda ke besok ",
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.kendala).toEqual({
      title: "hujan deras sejak siang",
      severity: "tinggi",
      description: "cor ditunda ke besok",
    });
  });

  it("judul KOSONG ditolak — bukan dikirim diam-diam tanpa kendala", () => {
    // Inti berkas ini.
    for (const t of [null, "", "   ", "ok"]) {
      const r = bacaKendalaKirim({ ...kosong, pilihan: "ada", title: t });
      expect(r.ok, JSON.stringify(t)).toBe(false);
      expect(!r.ok && r.error.toLowerCase()).toContain("judul");
    }
  });

  it("pesan penolakan menyebut JALAN KELUARNYA, bukan cuma menyalahkan", () => {
    const r = bacaKendalaKirim({ ...kosong, pilihan: "ada", title: "" });
    expect(!r.ok && r.error.toLowerCase()).toContain("tidak ada kendala");
  });

  it("uraian kosong → null, bukan string kosong", () => {
    // String kosong tersimpan di DB terbaca "ada uraiannya, isinya kosong".
    const r = bacaKendalaKirim({ pilihan: "ada", title: "material telat", severity: "sedang", description: "   " });
    expect(r.ok && r.kendala?.description).toBeNull();
  });

  it("tingkat tak dikenal jatuh ke sedang, tidak menggagalkan kiriman", () => {
    // Tingkat yang aneh datang dari peramban yang aneh, bukan dari niat buruk.
    // Menolak kiriman karenanya berarti laporan lapangan tertahan oleh dropdown.
    const r = bacaKendalaKirim({ pilihan: "ada", title: "akses jalan rusak", severity: "gawat", description: null });
    expect(r.ok && r.kendala?.severity).toBe("sedang");
  });

  it("judul & uraian yang kepanjangan ditolak dengan sebabnya", () => {
    const panjang = bacaKendalaKirim({ ...kosong, pilihan: "ada", title: "x".repeat(201) });
    expect(panjang.ok).toBe(false);
    const uraian = bacaKendalaKirim({
      pilihan: "ada",
      title: "kendala",
      severity: "sedang",
      description: "y".repeat(2001),
    });
    expect(uraian.ok).toBe(false);
  });
});

describe("jalur yang belum menanyakan kendala", () => {
  it("tanpa pilihan sama sekali: kiriman TETAP jalan", () => {
    // Kalau ini ditolak, setiap pengiriman dari jalur lain (uji e2e, klien
    // lama) mati — tanpa satu pun jaminan bertambah.
    for (const p of [null, undefined, "", "entah"]) {
      const r = bacaKendalaKirim({ ...kosong, pilihan: p });
      expect(r.ok, String(p)).toBe(true);
      expect(r.ok && r.kendala).toBeNull();
    }
  });

  it("nilai bukan-string tidak meruntuhkan apa pun", () => {
    const r = bacaKendalaKirim({ pilihan: 42, title: {}, severity: [], description: true });
    expect(r.ok && r.kendala).toBeNull();
  });
});
