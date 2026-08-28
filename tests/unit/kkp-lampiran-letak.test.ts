// TATA LETAK KARTU DOKUMENTASI — bagian yang bisa dihitung tanpa menggambar.
//
// Keluhan user atas berkas 26 Agustus 2026: *"foto juga susunannya
// berantakan."* Halamannya memuat dua kartu berdampingan — kiri satu foto,
// kanan dua — lalu berhenti dengan setengah lembar kosong di bawahnya, dan
// empat kartu memakan dua lembar yang keduanya setengah terisi.
//
// Dua sebab, dan keduanya diuji di sini: pasangan kartu yang kaku (lubang di
// bawah kartu yang lebih pendek) dan tinggi foto yang dipatok 150 pt (dua kartu
// dua-foto meleset SEPULUH POIN dari tinggi kolomnya).
import { describe, expect, it } from "vitest";
import {
  JARAK_KARTU,
  TINGGI_FOTO_MAKS,
  TINGGI_FOTO_MIN,
  taruhDuaKolom,
  tinggiFotoDokumentasi,
  tinggiKartu,
} from "@/lib/daily-report/kkp-lampiran-susun";

/** Tinggi kolom cetak A4 tegak dengan FORM_MARGIN 24 – sama dengan produksi. */
const KOLOM = 842 - 24 - 12 - 24;

describe("tinggi foto dipilih supaya kartunya muat, bukan dipatok", () => {
  it("REGRESI: dua kartu berisi dua foto muat dalam SATU kolom", () => {
    /*
     * Inilah berkas yang dikeluhkan: kartu 1–2 foto, empat kartu, dua lembar.
     * Pada tinggi foto 150 pt satu kartu dua-foto = 396 pt, dua kartu = 802 pt,
     * sementara kolomnya 782 pt. Meleset 20 pt, dan 20 pt itu yang membuang
     * satu lembar.
     */
    const banyak = [1, 2, 2, 1];
    const h = tinggiFotoDokumentasi(banyak, KOLOM);
    expect(h).toBeLessThan(TINGGI_FOTO_MAKS);
    expect(h).toBeGreaterThanOrEqual(TINGGI_FOTO_MIN);

    const dua = tinggiKartu(2, h);
    expect(dua * 2 + JARAK_KARTU).toBeLessThanOrEqual(KOLOM);
  });

  it("tidak mengecilkan foto kalau memang sudah muat", () => {
    // Dua kartu satu-foto: keduanya masuk sekolom pada ukuran terbesar. Tidak
    // ada alasan mengecilkan – itu cuma membuang kejelasan tanpa menghemat apa
    // pun.
    expect(tinggiFotoDokumentasi([1, 1], KOLOM)).toBe(TINGGI_FOTO_MAKS);
  });

  it("berhenti mengecilkan sebelum fotonya tidak bisa dinilai", () => {
    /*
     * Menghemat lembar dengan mengecilkan foto sampai sekecil apa pun akan
     * membuat dokumentasi lapangan tidak berguna. Batasnya tegas, dan tanpa
     * batas ini 20 kartu akan menyusut sampai beberapa puluh poin saja.
     */
    const h = tinggiFotoDokumentasi(Array.from({ length: 20 }, () => 1), KOLOM);
    expect(h).toBeGreaterThanOrEqual(TINGGI_FOTO_MIN);
  });

  it("kartu tertinggi TIDAK PERNAH melebihi kolomnya", () => {
    // Kartu yang melimpah digambar menembus tepi kertas — cacat yang sama
    // dengan blanko yang meluber, hanya di blok yang berbeda.
    for (const n of [1, 2, 3, 5, 9]) {
      const h = tinggiFotoDokumentasi([n], KOLOM);
      expect(tinggiKartu(n, h)).toBeLessThanOrEqual(KOLOM);
    }
  });

  it("kartu pelengkap tanpa baris judul dihitung tanpa baris judul", () => {
    // Material/alat tidak punya judul di atas tiap foto. Menghitungnya seolah
    // punya membuat taksirannya kebesaran, dan taksiran kebesaran = lembar
    // setengah kosong.
    expect(tinggiKartu(2, 100, 0)).toBeLessThan(tinggiKartu(2, 100));
  });
});

describe("kartu jatuh ke kolom terpendek, bukan ke pasangan tetap", () => {
  it("REGRESI: kartu pendek tidak meninggalkan lubang di sebelah kartu tinggi", () => {
    /*
     * Susunan lama: (1,2) sebaris, (2,1) sebaris. Tinggi barisnya ditentukan
     * kartu dua-foto, jadi di bawah kartu satu-foto menganga ruang setinggi
     * satu foto penuh — dua kali, di dua lembar berbeda.
     *
     * Dengan kolom mengalir, kartu keempat mengisi ruang itu.
     */
    const h = tinggiFotoDokumentasi([1, 2, 2, 1], KOLOM);
    const letak = taruhDuaKolom([1, 2, 2, 1].map((n) => tinggiKartu(n, h)), KOLOM);
    expect(letak.every((l) => l.halaman === 0)).toBe(true);
    // Kedua kolom terpakai, dan masing-masing memuat dua kartu.
    expect(letak.filter((l) => l.kolom === 0)).toHaveLength(2);
    expect(letak.filter((l) => l.kolom === 1)).toHaveLength(2);
  });

  it("tidak ada kartu yang tergambar melewati tepi bawah kolom", () => {
    const tinggi = [3, 1, 2, 1, 1, 3, 2, 1, 1, 2].map((n) => tinggiKartu(n, 130));
    for (const [i, l] of taruhDuaKolom(tinggi, KOLOM).entries()) {
      expect(l.y + tinggi[i]).toBeLessThanOrEqual(KOLOM);
    }
  });

  it("kartu tidak pernah bertindihan dalam satu kolom", () => {
    const tinggi = [2, 1, 3, 1, 2, 2, 1].map((n) => tinggiKartu(n, 130));
    const letak = taruhDuaKolom(tinggi, KOLOM);
    const terpakai = new Map<string, number>();
    for (const [i, l] of letak.entries()) {
      const kunci = `${l.halaman}:${l.kolom}`;
      const bawahSebelumnya = terpakai.get(kunci) ?? 0;
      expect(l.y).toBeGreaterThanOrEqual(bawahSebelumnya);
      terpakai.set(kunci, l.y + tinggi[i]);
    }
  });

  it("halaman pertama tetap halaman BARU – blok ini tidak menempel di ekor blanko", () => {
    // Nomor halaman mulai 0 untuk kartu pertama; penyaji memanggil
    // `mulaiHalamanBaru()` tiap kali nomor itu berubah, termasuk yang pertama.
    expect(taruhDuaKolom([100], KOLOM)[0].halaman).toBe(0);
  });

  it("daftar kosong tidak menerbitkan halaman apa pun", () => {
    expect(taruhDuaKolom([], KOLOM)).toEqual([]);
  });
});
