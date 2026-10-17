import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Server action-nya menyentuh DB; yang diuji di sini hanya apa yang tampil.
vi.mock("@/app/(app)/lokasi/[slug]/actions", () => ({
  beriAksesLokasiAction: async () => undefined,
  cabutAksesLokasiAction: async () => undefined,
}));

import { AksesPanel, type BarisAksesUi } from "@/app/(app)/lokasi/[slug]/akses-panel";

/**
 * KARTU "AKSES PENGGUNA" DI RINGKASAN LOKASI TIDAK BOLEH MEMANJANG.
 *
 * Keluhan user 2026-10-17 (tangkapan layar Ringkasan lokasi): *"informasi
 * pengguna saat ini terlalu panjang, harus dibatasi secara default, lalu ada
 * load more"*. Kartunya duduk di kolom samping Kurva-S; tiap orang yang
 * ditugaskan menambah satu baris, dan lokasi dengan belasan akun mendorong
 * "Laporan terakhir" jauh ke bawah.
 *
 * Yang dijaga:
 *   1. Kartu menampilkan paling banyak 5 orang – yang DITUGASKAN lebih dulu,
 *      urutan dari server dipertahankan.
 *   2. Yang dipotong DISEBUT: jumlah totalnya ada di kartu dan di tombol
 *      "Lihat semua". Daftar yang terpotong diam-diam terbaca lengkap – bahaya
 *      yang sudah disebut `lib/users/akses-lokasi.ts`.
 *   3. Daftar yang tidak terpotong tidak diberi tombol "Lihat semua".
 *   4. Formulir tambah pindah ke panel; di kartu tinggal tombolnya.
 */

function orang(i: number, jalan: BarisAksesUi["jalan"]): BarisAksesUi {
  return {
    userId: `u${i}`,
    nama: `Orang ${String(i).padStart(2, "0")}`,
    peran: jalan === "penugasan" ? "Site Manager" : "Program Director",
    jalan,
    aktif: true,
    waNumber: `62812000000${String(i).padStart(2, "0")}@c.us`,
    waTerverifikasi: false,
  };
}

/** 7 ditugaskan + 5 karena peran, sudah berurutan seperti dari `aksesLokasi`. */
const DUA_BELAS: BarisAksesUi[] = [
  ...Array.from({ length: 7 }, (_, i) => orang(i + 1, "penugasan")),
  ...Array.from({ length: 5 }, (_, i) => orang(i + 8, "peran")),
];

function render(baris: BarisAksesUi[], opsi: { bolehKelola?: boolean; eksekutifDisembunyikan?: boolean } = {}) {
  return renderToStaticMarkup(
    <AksesPanel
      locationId="00000000-0000-4000-8000-000000000001"
      slug="kranji"
      baris={baris}
      calon={[{ id: "c1", nama: "Calon Satu", peran: "Pelaksana" }]}
      bolehKelola={opsi.bolehKelola ?? false}
      eksekutifDisembunyikan={opsi.eksekutifDisembunyikan ?? false}
    />,
  );
}

describe("kartu akses pengguna: dibatasi, sisanya di panel", () => {
  it("menampilkan paling banyak 5 orang, yang ditugaskan lebih dulu", () => {
    const html = render(DUA_BELAS);
    for (let i = 1; i <= 5; i++) expect(html, `Orang 0${i}`).toContain(`Orang 0${i}`);
    for (let i = 6; i <= 12; i++) {
      const nama = `Orang ${String(i).padStart(2, "0")}`;
      expect(html, `${nama} tidak boleh ikut tampil di kartu`).not.toContain(nama);
    }
  });

  it("yang terpotong disebut: jumlah total dan tombol Lihat semua", () => {
    const html = render(DUA_BELAS);
    expect(html).toContain("12 orang");
    expect(html).toContain("7 ditugaskan");
    expect(html).toContain("5 karena peran");
    expect(html).toContain("Lihat semua 12 orang");
  });

  it("daftar yang muat seluruhnya tidak diberi tombol Lihat semua", () => {
    const html = render(DUA_BELAS.slice(0, 5));
    for (let i = 1; i <= 5; i++) expect(html).toContain(`Orang 0${i}`);
    expect(html).not.toContain("Lihat semua");
  });

  it("nomor WA tidak memanjangkan baris kartu – ia ada di panel", () => {
    const html = render(DUA_BELAS);
    expect(html).not.toContain("@c.us");
    expect(html).not.toContain("belum diverifikasi");
  });

  it("pengelola: formulir tambah pindah ke panel, di kartu tinggal tombolnya", () => {
    const html = render(DUA_BELAS.slice(0, 3), { bolehKelola: true });
    expect(html).toContain("Tambah pengguna");
    expect(html).not.toContain("Tambah pengguna ke lokasi ini");
    expect(html).not.toContain('id="tambah-akses"');
  });

  it("bukan pengelola: tidak ada tombol tambah", () => {
    const html = render(DUA_BELAS.slice(0, 3));
    expect(html).not.toContain("Tambah pengguna");
  });

  it("catatan akun Executive View tetap ditulis di kartu", () => {
    const html = render(DUA_BELAS, { eksekutifDisembunyikan: true });
    expect(html).toContain("Akun Executive View tidak ditampilkan di daftar ini.");
  });

  it("daftar kosong tetap berkata begitu", () => {
    const html = render([]);
    expect(html).toContain("Belum ada yang bisa membuka lokasi ini.");
    expect(html).not.toContain("Lihat semua");
  });
});
