// KONTEKS PROYEK YANG SENGAJA DIKOSONGKAN HARUS TETAP KOSONG (DECISIONS 228).
//
// Laporan user 2026-08-02: baris "Pengendalian Proyek Kampung Nelayan Merah
// Putih (KNMP)" di sidebar berasal dari kolom "Konteks proyek" di menu Sistem —
// tapi "jika … kuhapus tanpa kuisi apa pun lalu simpan selalu kembali terisi
// dengan nilai yang sama".
//
// Sebabnya `getBranding` memperlakukan nilai kosong sebagai "belum diatur" dan
// menambalnya dengan default. Akibatnya perintah admin yang jelas ditolak
// diam-diam: layar bilang "tersimpan", nilainya kembali seperti semula, dan
// tidak ada satu pun pesan yang menjelaskan.
//
// Sekarang: baris yang ADA di DB adalah keputusan admin dan dihormati apa
// adanya — default hanya untuk key yang BELUM PERNAH disimpan. Isian yang wajib
// (nama aplikasi, tagline, nama pemilik) tetap menolak kosong, karena aplikasi
// tanpa nama bukan pilihan desain melainkan layar rusak.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { getBranding, setBranding, BRAND_DEFAULTS, BRAND_KEYS } = await import("@/lib/branding");

async function bersih() {
  await db.appSetting.deleteMany({ where: { key: { in: Object.values(BRAND_KEYS) } } });
}

beforeEach(bersih);
afterAll(async () => {
  await bersih();
  await db.$disconnect();
});

describe("KASUS INTI: kosong yang disengaja tidak boleh diisi ulang sendiri", () => {
  it("konteks proyek dikosongkan → tetap kosong setelah dibaca ulang", async () => {
    await setBranding({ projectContext: "Proyek Uji" });
    expect((await getBranding()).projectContext).toBe("Proyek Uji");

    await setBranding({ projectContext: "" });
    expect((await getBranding()).projectContext).toBe("");
  });

  it("keterangan pemilik pekerjaan juga bisa benar-benar dikosongkan", async () => {
    await setBranding({ ownerSubtitle: "" });
    expect((await getBranding()).ownerSubtitle).toBe("");
  });

  it("spasi saja dihitung kosong – bukan teks yang tak terlihat", async () => {
    await setBranding({ projectContext: "   " });
    expect((await getBranding()).projectContext).toBe("");
  });

  it("mengetik ulang mengembalikan teksnya (tidak ada jalan buntu)", async () => {
    await setBranding({ projectContext: "" });
    await setBranding({ projectContext: BRAND_DEFAULTS.projectContext });
    expect((await getBranding()).projectContext).toBe(BRAND_DEFAULTS.projectContext);
  });
});

describe("default hanya untuk yang BELUM PERNAH diatur", () => {
  it("tanpa baris sama sekali, semua memakai bawaan", async () => {
    const b = await getBranding();
    expect(b.appName).toBe(BRAND_DEFAULTS.appName);
    expect(b.tagline).toBe(BRAND_DEFAULTS.tagline);
    expect(b.projectContext).toBe(BRAND_DEFAULTS.projectContext);
    expect(b.ownerName).toBe(BRAND_DEFAULTS.ownerName);
    expect(b.ownerSubtitle).toBe(BRAND_DEFAULTS.ownerSubtitle);
  });

  it("isian WAJIB tetap ditambal bawaan kalau tersimpan kosong", async () => {
    // Aplikasi tanpa nama = layar rusak, bukan keputusan desain. Nilai kosong
    // untuk key ini juga sudah ditolak di boundary aksi (lihat brandingSchema).
    await setBranding({ appName: "", tagline: "", ownerName: "" });
    const b = await getBranding();
    expect(b.appName).toBe(BRAND_DEFAULTS.appName);
    expect(b.tagline).toBe(BRAND_DEFAULTS.tagline);
    expect(b.ownerName).toBe(BRAND_DEFAULTS.ownerName);
  });
});
