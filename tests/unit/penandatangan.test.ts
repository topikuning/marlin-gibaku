/*
 * SIAPA MENEKEN APA (DECISIONS 402).
 *
 * Ketetapan user 2026-08-21: harian & mingguan diteken Pelaksana Lapangan;
 * bulanan, MC, dan CCO diteken Direktur.
 *
 * Yang dijaga di sini bukan kerapian melainkan satu hal yang tidak bisa
 * dibatalkan sesudah kertasnya diserahkan ke KKP: dokumen resmi tidak boleh
 * menyatakan orang yang tidak melakukannya.
 */
import { describe, expect, it } from "vitest";
import {
  JABATAN_PELAKSANA_BAWAAN,
  asalPelaksana,
  peringatanPelaksana,
  pihakPenyedia,
  pilihPelaksana,
  type SumberPelaksana,
} from "@/lib/laporan/penandatangan";

const PAKET: SumberPelaksana = {
  pelaksanaName: "Budi Santoso",
  pelaksanaTitle: null,
  pelaksanaTtdKey: "ttd/paket.png",
  pelaksanaStempelKey: "stempel/paket.png",
};

const LOKASI: SumberPelaksana = {
  pelaksanaName: "Sari Handayani",
  pelaksanaTitle: "Site Manager",
  pelaksanaTtdKey: "ttd/lokasi.png",
  pelaksanaStempelKey: null,
};

const KOSONG: SumberPelaksana = {
  pelaksanaName: null,
  pelaksanaTitle: null,
  pelaksanaTtdKey: null,
  pelaksanaStempelKey: null,
};

describe("dokumen mana diteken siapa", () => {
  it("harian & mingguan → Pelaksana Lapangan", () => {
    expect(pihakPenyedia("harian")).toBe("pelaksana");
    expect(pihakPenyedia("mingguan")).toBe("pelaksana");
  });

  it("bulanan, MC, dan CCO → Direktur", () => {
    expect(pihakPenyedia("bulanan")).toBe("direktur");
    expect(pihakPenyedia("mc")).toBe("direktur");
    expect(pihakPenyedia("cco")).toBe("direktur");
  });
});

describe("pelaksana lokasi menimpa pelaksana paket", () => {
  it("lokasi kosong → ikut paket", () => {
    const b = pilihPelaksana(KOSONG, PAKET);
    expect(b.nama).toBe("Budi Santoso");
    expect(b.ttdKey).toBe("ttd/paket.png");
  });

  it("lokasi terisi → milik lokasi", () => {
    const b = pilihPelaksana(LOKASI, PAKET);
    expect(b.nama).toBe("Sari Handayani");
    expect(b.jabatan).toBe("Site Manager");
  });

  it("nama berisi spasi saja dihitung KOSONG", () => {
    // Kolom yang "terlihat terisi" di layar tapi berisi spasi akan mencetak
    // baris nama kosong tanpa satu pun peringatan.
    const b = pilihPelaksana({ ...KOSONG, pelaksanaName: "   " }, PAKET);
    expect(b.nama).toBe("Budi Santoso");
  });

  it("PALING PENTING: tanda tangan tidak pernah dicampur antar orang", () => {
    /*
     * Lokasi menyebut nama sendiri tapi BELUM mengunggah tanda tangan. Kalau
     * gambarnya jatuh ke milik paket, yang tercetak adalah coretan tanda tangan
     * Budi di bawah nama Sari. Pada berkas yang diserahkan ke KKP itu bukan
     * cacat tampilan.
     *
     * Karena itu penentunya NAMA, dan bloknya diambil utuh — termasuk
     * ketiadaan tanda tangannya.
     */
    const b = pilihPelaksana({ ...LOKASI, pelaksanaTtdKey: null }, PAKET);
    expect(b.nama).toBe("Sari Handayani");
    expect(b.ttdKey).toBeNull();
    expect(b.stempelKey).toBeNull();
  });

  it("keduanya kosong → tanpa nama, jabatan tetap terbaca", () => {
    const b = pilihPelaksana(KOSONG, KOSONG);
    expect(b.nama).toBeNull();
    expect(b.jabatan).toBe(JABATAN_PELAKSANA_BAWAAN);
    expect(b.ttdKey).toBeNull();
  });

  it("jabatan kosong memakai sebutan bawaan", () => {
    expect(pilihPelaksana(KOSONG, PAKET).jabatan).toBe(JABATAN_PELAKSANA_BAWAAN);
  });

  it("TIDAK PERNAH jatuh ke Direktur", () => {
    /*
     * Ditegaskan sebagai uji tersendiri karena inilah godaan yang paling masuk
     * akal: "biar dokumennya lengkap". Dokumen yang selalu tampak lengkap sambil
     * menyebut orang yang salah lebih berbahaya daripada baris kosong yang
     * jelas-jelas menunggu tanda tangan.
     */
    const b = pilihPelaksana(KOSONG, KOSONG);
    expect(b.nama).toBeNull();
    expect(peringatanPelaksana(b)).toContain("belum diisi");
  });
});

describe("asal pelaksana disebut apa adanya", () => {
  it.each([
    [LOKASI, PAKET, "lokasi"],
    [KOSONG, PAKET, "paket"],
    [KOSONG, KOSONG, "belum diisi"],
  ] as const)("%#", (l, p, harap) => {
    expect(asalPelaksana(l, p)).toBe(harap);
  });

  it("peringatan hilang begitu namanya ada", () => {
    expect(peringatanPelaksana(pilihPelaksana(KOSONG, PAKET))).toBeNull();
  });
});
