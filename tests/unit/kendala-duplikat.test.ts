import { describe, expect, it } from "vitest";
import { cariDuplikat, kemiripan, normalJudul } from "@/lib/kendala/duplikat";

/**
 * PENJAGA DUPLIKAT KENDALA (DECISIONS 392).
 *
 * Tangkapan layar user memuat "Lahan belum bisa clear" TIGA kali — tanggal
 * sama, tingkat sama, ketiganya terbuka. Tiga baris untuk satu masalah membuat
 * hitungan "berapa kendala terbuka" kehilangan arti.
 */

const tgl = new Date("2026-08-18T00:00:00.000Z");
const k = (id: string, title: string) => ({ id, title, createdAt: tgl });

describe("normalJudul", () => {
  it("mengabaikan huruf besar dan tanda baca", () => {
    expect(normalJudul("Lahan BELUM bisa clear!!")).toBe("lahan belum bisa clear");
  });
});

describe("kemiripan", () => {
  it("judul identik = 1", () => {
    expect(kemiripan("Lahan belum bisa clear", "lahan belum bisa clear")).toBe(1);
  });

  it("beda satu kata tetap tinggi", () => {
    /*
     * Versi pertama memakai bigram KATA dan hanya menghasilkan 0,40 di sini —
     * satu kata yang hilang sudah cukup meloloskan duplikat, padahal justru
     * bentuk itu yang paling sering diketik orang yang mengulang laporan.
     * Ketahuan dari uji yang merah, bukan perkiraan. Bigram KARAKTER: 0,865.
     */
    expect(kemiripan("Lahan belum bisa clear", "Lahan belum clear")).toBeGreaterThan(0.8);
  });

  it("masalah BERBEDA pada objek yang sama tidak dianggap duplikat", () => {
    /*
     * "Akses jalan rusak" vs "Akses jalan longsor" = 0,647. Di bawah ambang
     * 0,7, dan memang harus: dua kerusakan berbeda pada jalan yang sama.
     * Menawarkannya sebagai duplikat melatih orang mengabaikan tawaran ini,
     * dan tawaran yang selalu diabaikan sama saja dengan tidak ada.
     */
    expect(kemiripan("Akses jalan rusak", "Akses jalan longsor")).toBeLessThan(0.7);
  });

  it("kalimat berbeda yang kebetulan berbagi kata umum tetap RENDAH", () => {
    /*
     * Dua-duanya memuat "belum". Kalau pembandingnya per-kata, keduanya akan
     * dianggap mirip dan penjaga ini berubah jadi gangguan yang diabaikan.
     */
    expect(kemiripan("Lahan belum bisa clear", "Material besi belum datang")).toBeLessThan(0.4);
  });

  it("judul kosong tidak pernah mirip apa pun", () => {
    expect(kemiripan("", "apa saja")).toBe(0);
  });
});

describe("cariDuplikat", () => {
  it("REGRESI: 'Lahan belum bisa clear' ketiga menemukan dua sebelumnya", () => {
    const hasil = cariDuplikat("Lahan belum bisa clear", [
      k("1", "Lahan belum bisa clear"),
      k("2", "Lahan belum bisa clear"),
      k("3", "Relokasi pedagang belum bisa dikendalikan"),
    ]);
    expect(hasil.map((h) => h.id)).toEqual(["1", "2"]);
  });

  it("kendala yang benar-benar lain TIDAK dianggap duplikat", () => {
    expect(
      cariDuplikat("Material besi belum datang", [k("1", "Lahan belum bisa clear")]),
    ).toEqual([]);
  });

  it("paling mirip di urutan pertama, maksimal tiga", () => {
    const hasil = cariDuplikat("Lahan belum bisa clear", [
      k("a", "Lahan belum clear"),
      k("b", "Lahan belum bisa clear"),
      k("c", "Lahan belum bisa clear juga"),
      k("d", "Lahan belum bisa clear sekali"),
    ]);
    expect(hasil).toHaveLength(3);
    expect(hasil[0].id).toBe("b");
  });

  it("daftar kosong → tidak ada tawaran", () => {
    expect(cariDuplikat("apa pun", [])).toEqual([]);
  });
});
