// BAWAAN PENANDA PETA — berkelompok atau satu per satu, diatur di layar Sistem.
//
// Permintaan user 2026-09-06: *"bagaimana supaya aku bisa atur default kelompok
// atau per titik langsung"*. Tombol di peta (DECISIONS 537) cuma berlaku selama
// layar itu terbuka; ini yang menentukan apa yang dilihat SEMUA orang saat peta
// dibuka — termasuk mandor yang tidak akan pernah menyentuh tombol itu.
//
// Diuji lewat DB sungguhan karena yang menyimpan bukan sebuah variabel,
// melainkan `AppSetting` ber-tanggal-berlaku: nilai TERBARU yang menang, dan
// menyimpan dua kali di hari yang sama harus menimpa, bukan menumpuk baris yang
// urutannya lalu jadi undian.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { PETA_KELOMPOK_DEFAULT, PETA_KELOMPOK_KEY, getKelompokBawaan, setKelompokBawaan } =
  await import("@/lib/peta/setelan");

beforeEach(async () => {
  await db.appSetting.deleteMany({ where: { key: PETA_KELOMPOK_KEY } });
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: PETA_KELOMPOK_KEY } });
});

describe("bawaan pengelompokan penanda peta", () => {
  it("belum pernah disetel = BERKELOMPOK", async () => {
    // Bukan selera: sistem ini menuju 200+ lokasi di 7 provinsi, dan pada
    // tampilan nasional ratusan pin yang menimpa bukan informasi.
    expect(PETA_KELOMPOK_DEFAULT).toBe(true);
    expect(await getKelompokBawaan()).toBe(true);
  });

  it("dimatikan lalu dibaca lagi = satu per satu", async () => {
    await setKelompokBawaan(false);
    expect(await getKelompokBawaan()).toBe(false);
  });

  it("dinyalakan lagi di hari yang sama MENIMPA, tidak menumpuk", async () => {
    await setKelompokBawaan(false);
    await setKelompokBawaan(true);
    expect(await getKelompokBawaan()).toBe(true);
    const baris = await db.appSetting.count({ where: { key: PETA_KELOMPOK_KEY } });
    expect(baris, "satu baris per tanggal berlaku").toBe(1);
  });

  it("nilai kosong diperlakukan sebagai belum disetel, bukan sebagai 'mati'", async () => {
    // Baris kosong bisa lahir dari impor/penyuntingan manual. Membacanya
    // sebagai `false` berarti peta diam-diam berubah tanpa ada yang memutuskan.
    await db.appSetting.create({
      data: { key: PETA_KELOMPOK_KEY, value: "", effectiveFrom: new Date(Date.UTC(2026, 8, 6)) },
    });
    expect(await getKelompokBawaan()).toBe(PETA_KELOMPOK_DEFAULT);
  });
});
