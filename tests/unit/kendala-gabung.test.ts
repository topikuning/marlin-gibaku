import { describe, expect, it } from "vitest";
import { alasanTidakBisaDigabung, catatanGabung } from "@/lib/kendala/gabung";
import type { KendalaGabung } from "@/lib/kendala/gabung";

/**
 * DECISIONS 393 — menggabungkan kendala kembar.
 *
 * Penjaga duplikat menahan kembar BARU di pintu masuk; ini merapikan yang
 * terlanjur ada. Tangkapan layar user memuat "Lahan belum bisa clear" tiga
 * kali.
 *
 * Yang dijaga di sini bukan "boleh atau tidak", melainkan cara penggabungan
 * bisa MENGHILANGKAN masalah yang masih berjalan – akibat yang jauh lebih buruk
 * daripada duplikat yang dibiarkan.
 */

const k = (o: Partial<KendalaGabung> = {}): KendalaGabung => ({
  id: "a",
  locationId: "lok-1",
  status: "terbuka",
  mergedIntoId: null,
  ...o,
});

describe("alasanTidakBisaDigabung", () => {
  it("dua kendala terbuka di lokasi sama boleh digabungkan", () => {
    expect(alasanTidakBisaDigabung(k({ id: "a" }), k({ id: "b" }))).toBeNull();
  });

  it("kendala yang sudah ditangani tetap boleh jadi induk", () => {
    // "ditangani" berarti ada yang sedang mengerjakannya – justru induk yang
    // baik untuk kembarnya yang belum disentuh.
    expect(
      alasanTidakBisaDigabung(k({ id: "a" }), k({ id: "b", status: "ditangani" })),
    ).toBeNull();
  });

  it("tidak bisa digabungkan ke dirinya sendiri", () => {
    expect(alasanTidakBisaDigabung(k({ id: "a" }), k({ id: "a" }))).toMatch(/dirinya sendiri/i);
  });

  it("REGRESI: lintas lokasi DITOLAK", () => {
    /*
     * "Lahan belum bisa clear" di dua desa berbeda adalah dua masalah berbeda,
     * sedekat apa pun kalimatnya. Menggabungkannya akan menghapus satu masalah
     * nyata dari hitungan lokasi yang lain – dan lokasi itu tidak akan pernah
     * tahu kendalanya hilang.
     */
    const hasil = alasanTidakBisaDigabung(
      k({ id: "a", locationId: "lok-1" }),
      k({ id: "b", locationId: "lok-2" }),
    );
    expect(hasil).toMatch(/lokasi yang sama/i);
  });

  it("REGRESI: induk yang SUDAH digabungkan ditolak – tidak boleh berantai", () => {
    /*
     * Kalau A → B diizinkan padahal B → C, terbentuk rantai yang harus
     * ditelusuri setiap pembaca untuk tahu mana yang berlaku, dan rantai yang
     * melingkar akan menggantung selamanya.
     */
    const hasil = alasanTidakBisaDigabung(
      k({ id: "a" }),
      k({ id: "b", mergedIntoId: "c" }),
    );
    expect(hasil).toMatch(/sudah digabungkan/i);
  });

  it("kendala yang sudah pernah digabungkan tidak bisa digabungkan lagi", () => {
    const hasil = alasanTidakBisaDigabung(
      k({ id: "a", mergedIntoId: "z" }),
      k({ id: "b" }),
    );
    expect(hasil).toMatch(/sudah pernah digabungkan/i);
  });

  it("REGRESI: induk yang sudah SELESAI ditolak", () => {
    /*
     * Menggabungkan kendala yang masih terbuka ke kendala yang sudah ditutup
     * akan menghilangkan masalah yang masih berjalan dari SEMUA hitungan –
     * papan, dashboard, laporan KKP, pengingat WA sekaligus. Yang benar:
     * buka kembali induknya dulu.
     */
    const hasil = alasanTidakBisaDigabung(
      k({ id: "a" }),
      k({ id: "b", status: "selesai" }),
    );
    expect(hasil).toMatch(/sudah selesai/i);
  });

  it("urutan pemeriksaan: diri sendiri diperiksa sebelum lokasi", () => {
    // Kendala yang dibandingkan dengan dirinya sendiri selalu selokasi, jadi
    // kalau lokasi diperiksa lebih dulu, pesannya akan menyesatkan.
    expect(alasanTidakBisaDigabung(k({ id: "a" }), k({ id: "a" }))).toMatch(/dirinya sendiri/i);
  });
});

describe("catatanGabung", () => {
  it("selalu menyebut JUDUL induknya", () => {
    /*
     * Orang yang membuka riwayat ini enam bulan lagi tidak punya cara lain
     * mengetahui ke mana masalah ini pindah. "Digabungkan" saja adalah jejak
     * buntu.
     */
    const c = catatanGabung("Lahan belum bisa clear");
    expect(c).toContain("Lahan belum bisa clear");
  });

  it("catatan tambahan ikut, tanpa menghapus keterangan bakunya", () => {
    const c = catatanGabung("Lahan belum bisa clear", "Dilaporkan dua mandor berbeda.");
    expect(c).toContain("Lahan belum bisa clear");
    expect(c).toContain("Dilaporkan dua mandor berbeda.");
  });

  it("catatan kosong / spasi tidak menghasilkan ekor menggantung", () => {
    expect(catatanGabung("X", "   ")).toBe(catatanGabung("X"));
    expect(catatanGabung("X").endsWith(" ")).toBe(false);
  });
});
