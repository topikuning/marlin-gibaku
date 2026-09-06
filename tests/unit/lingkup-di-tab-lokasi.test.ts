// PELETAKAN MENU LINGKUP LOKASI — di tab Lokasi, bukan di Ringkasan.
//
// Ketetapan user 2026-09-06: *"peletakan menunya juga tidak perlu ada di
// ringkasan, di tab lokasi saja. supaya ringkasan tidak banyak pilihan aksi!"*
//
// Uji ini membaca BERKASNYA, bukan tampilannya, dan itu disengaja: yang
// dilarang bukan "tombol terlihat di layar tertentu" melainkan panel aksinya
// dipasang kembali di halaman ringkasan — dan itulah yang mudah terjadi tanpa
// sengaja saat halaman ringkasan disusun ulang nanti. Satu baris impor sudah
// cukup jadi tanda.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baca = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const RINGKASAN = "src/app/(app)/paket/[id]/page.tsx";
const TAB_LOKASI = "src/app/(app)/paket/[id]/lokasi/page.tsx";

describe("panel lingkup lokasi", () => {
  it("TIDAK dipasang di halaman ringkasan paket", () => {
    const isi = baca(RINGKASAN);
    expect(isi).not.toContain("lingkup-panel");
    expect(isi).not.toContain("<LingkupPanel");
  });

  it("dipasang di tab Lokasi", () => {
    const isi = baca(TAB_LOKASI);
    expect(isi).toContain("<LingkupPanel");
  });

  it("ringkasan tetap MEMBACA akibatnya – yang pindah menunya, bukan informasinya", () => {
    // Kartu KPI "Jumlah lokasi" tetap menyebut berapa yang dicabut adendum.
    // Menghapus ini bersama panelnya akan membuat angka paket berubah tanpa
    // penjelasan apa pun di layar yang dipakai orang mengambil keputusan.
    expect(baca(RINGKASAN)).toContain("dicabut adendum");
  });
});
