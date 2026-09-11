// PERINGATAN HANYA UNTUK YANG TIDAK BISA DIBERESKAN SENDIRI.
//
// Permintaan user 2026-09-11: peringatan WhatsApp ber-sakelar, *"dan yang lebih
// penting kamu harus handle jika ada masalah secara otomatis"*. Urutan itu yang
// dipakai — sebagian besar kerusakan sudah ditangani `antrean.ts` dan tidak
// pernah sampai ke lapis ini.
//
// Yang dijaga berkas ini: kapan MARLIN boleh berbunyi, dan kapan ia HARUS DIAM.
// Diam yang salah membuat orang tidak tahu; bunyi yang salah membuat orang
// berhenti membaca — dan pesan yang diabaikan sama saja dengan tidak ada.
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { kenaliMasalah, AMBANG_DISK_BYTE, AMBANG_MACET_JAM } = await import(
  "@/lib/arsip-asli/peringatan"
);
type Fakta = Parameters<typeof kenaliMasalah>[0];

const SEHAT: Fakta = {
  aktif: true,
  terkonfigurasi: true,
  menunggu: 0,
  gagalTerus: 0,
  terakhirBerhasil: new Date("2026-09-11T00:00:00Z"),
  galatTerakhir: null,
  sisaBytes: 500 * 1024 ** 3,
};
const KINI = new Date("2026-09-11T01:00:00Z");
const kode = (f: Partial<Fakta>) => kenaliMasalah({ ...SEHAT, ...f }, KINI).map((m) => m.kode);

describe("diam adalah jawaban yang benar", () => {
  it("semuanya sehat: tidak ada peringatan", () => {
    expect(kode({})).toEqual([]);
  });

  it("arsip sengaja DIMATIKAN orang: diam, itu bukan kerusakan", () => {
    expect(kode({ aktif: false, menunggu: 900, gagalTerus: 7 })).toEqual([]);
  });

  it("alamat arsip memang belum diisi: diam juga", () => {
    expect(kode({ terkonfigurasi: false, menunggu: 900 })).toEqual([]);
  });

  it("ada antrean tapi baru saja ada yang berhasil: belum macet", () => {
    expect(kode({ menunggu: 400 })).toEqual([]);
  });

  it("tidak ada yang berhasil lama, TAPI antreannya kosong: tidak apa-apa", () => {
    // Tidak ada yang dikerjakan bukan kemacetan — itu keadaan normal setelah
    // seluruh tunggakan habis.
    expect(kode({ menunggu: 0, terakhirBerhasil: null })).toEqual([]);
  });
});

describe("yang memang harus dibunyikan", () => {
  it("berkas hilang dari arsip = paling gawat, disebut PERTAMA", () => {
    const m = kenaliMasalah(
      { ...SEHAT, galatTerakhir: "buang-r2 a1b2: berkas TIDAK ADA di arsip – tidak dibuang" },
      KINI,
    );
    expect(m[0].kode).toBe("hilang-dari-arsip");
    // Pesannya wajib menenangkan soal yang sudah ditangani sendiri, supaya
    // orang tidak panik menyelamatkan berkas yang sudah aman.
    expect(m[0].teks).toMatch(/ditahan|dikirim ulang/i);
  });

  it("ada antrean & tidak ada yang berhasil melewati ambang: macet", () => {
    const lewat = new Date(KINI.getTime() - (AMBANG_MACET_JAM + 1) * 3_600_000);
    expect(kode({ menunggu: 120, terakhirBerhasil: lewat })).toContain("macet");
  });

  it("belum pernah berhasil sama sekali padahal ada antrean: macet", () => {
    expect(kode({ menunggu: 5, terakhirBerhasil: null })).toContain("macet");
  });

  it("ada yang berhenti dicoba: disebut, beserta bahwa berkasnya masih aman", () => {
    const m = kenaliMasalah({ ...SEHAT, gagalTerus: 3 }, KINI);
    expect(m.map((x) => x.kode)).toContain("berhenti-dicoba");
    expect(m.find((x) => x.kode === "berhenti-dicoba")!.teks).toMatch(/tetap aman di R2/i);
  });

  it("sisa disk di bawah ambang: disebut sebelum arsipnya berhenti menerima", () => {
    expect(kode({ sisaBytes: AMBANG_DISK_BYTE - 1 })).toContain("disk-menipis");
    expect(kode({ sisaBytes: AMBANG_DISK_BYTE + 1 })).not.toContain("disk-menipis");
  });

  it("sisa disk tidak diketahui tidak dianggap penuh", () => {
    // null berarti gateway tidak melaporkannya – menebaknya sebagai 0 akan
    // membunyikan alarm palsu tiap jam.
    expect(kode({ sisaBytes: null })).not.toContain("disk-menipis");
  });
});
