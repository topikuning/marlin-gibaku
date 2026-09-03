/*
 * BATAS SATU KALI UNGGAH FOTO (DECISIONS 425).
 *
 * Keberatan user 2026-08-23: *"sekali upload pilih foto dari galeri kenapa cuma
 * dibatasi 6? sementara bisa menambahkan lagi"*. Batas JUMLAH yang bisa dilewati
 * dengan mengunggah lagi memang tidak melindungi apa pun; yang mengikat sungguhan
 * adalah ukuran permintaan (`bodySizeLimit` 30 MB).
 *
 * Yang dijaga di sini bukan cuma angkanya, melainkan KEJUJURANNYA: berapa yang
 * tidak muat selalu diketahui, dan pesannya menyebut pagar mana yang kena.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_MB,
  MAX_PHOTOS_PER_UPLOAD,
  MAX_UPLOAD_BYTES_TOTAL,
  MAX_UPLOAD_MB_TOTAL,
  muatSekaliUnggah,
} from "@/lib/photo-limits";

const MB = 1024 * 1024;

describe("muatSekaliUnggah", () => {
  it("pilihan wajar (12 foto @2 MB) MUAT seluruhnya – tidak ada yang tertinggal", () => {
    const r = muatSekaliUnggah(Array(12).fill(2 * MB));
    expect(r.muat).toBe(12);
    expect(r.sisa).toBe(0);
    expect(r.pesan).toBeNull();
  });

  it("lewat batas JUMLAH: pesannya menyebut jumlah, bukan ukuran", () => {
    const r = muatSekaliUnggah(Array(MAX_PHOTOS_PER_UPLOAD + 3).fill(64 * 1024));
    expect(r.muat).toBe(MAX_PHOTOS_PER_UPLOAD);
    expect(r.sisa).toBe(3);
    expect(r.pesan).toContain(`${MAX_PHOTOS_PER_UPLOAD} foto`);
    expect(r.pesan).not.toContain("MB");
  });

  it("lewat batas UKURAN: pesannya menyebut MB, bukan jumlah", () => {
    // 8 foto @5 MB = 40 MB, jauh di atas anggaran satu permintaan.
    const r = muatSekaliUnggah(Array(8).fill(5 * MB));
    expect(r.muat).toBeLessThan(8);
    expect(r.sisa).toBeGreaterThan(0);
    expect(r.pesan).toContain("MB");
    expect(r.pesan).not.toContain(`${MAX_PHOTOS_PER_UPLOAD} foto`);
  });

  it("yang dinyatakan muat SELALU di bawah anggaran byte", () => {
    for (const ukuran of [[24 * MB, 24 * MB], Array(30).fill(1 * MB), [27 * MB, 1 * MB, 1 * MB]]) {
      const r = muatSekaliUnggah(ukuran);
      const total = ukuran.slice(0, r.muat).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(MAX_UPLOAD_BYTES_TOTAL);
      expect(r.muat + r.sisa).toBe(ukuran.length);
    }
  });

  it("pilihan kosong tidak menghasilkan peringatan palsu", () => {
    expect(muatSekaliUnggah([])).toEqual({
      terima: [],
      kebesaran: [],
      muat: 0,
      sisa: 0,
      pesan: null,
      pesanSisa: null,
    });
  });

  it("SATU foto yang sendirian sudah melebihi anggaran tidak bikin muat=0 senyap", () => {
    // 29 MB > batas per-berkas, jadi ia ditolak sendirian; 1 MB sesudahnya
    // TETAP ikut — foto kebesaran tidak menyandera yang wajar.
    const r = muatSekaliUnggah([29 * MB, 1 * MB]);
    expect(r.terima).toEqual([1]);
    expect(r.sisa).toBe(1);
    expect(r.pesan).toBeTruthy();
  });
});

/*
 * PAGAR PER-BERKAS DIPERIKSA SEBELUM DIKIRIM (keluhan user 2026-09-03:
 * *"kalau ukuran lebih dari batasmu, kamu sudah ngasih warning gak, atau silent
 * aja"*).
 *
 * Dua celah yang ditutup di sini, keduanya kegagalan-DIAM:
 *
 *  1. foto 26 MB lolos anggaran 28 MB → dulu tidak ada peringatan sama sekali,
 *     berkasnya terunggah utuh di sinyal lapangan, baru ditolak server;
 *  2. foto 29 MB → dulu `muat = 0` dengan pesan "Kirim yang ini dulu" padahal
 *     tidak ada yang bisa dikirim, dan sebab sebenarnya tidak pernah disebut.
 */
describe("batas UKURAN SATU foto diperiksa di muka", () => {
  it("foto di antara batas per-berkas dan anggaran permintaan TIDAK lolos diam-diam", () => {
    // 26 MB: di bawah anggaran 28 MB, di atas batas 25 MB per foto. Inilah
    // celah yang dulu sama sekali tidak berbunyi.
    expect(26 * MB).toBeLessThan(MAX_UPLOAD_BYTES_TOTAL);
    expect(26 * MB).toBeGreaterThan(MAX_PHOTO_BYTES);

    const r = muatSekaliUnggah([26 * MB]);
    expect(r.muat).toBe(0);
    expect(r.sisa).toBe(1);
    expect(r.pesan).toBeTruthy();
    // Menyebut batasnya DAN ukuran fotonya – supaya orang tahu sejauh apa
    // lewatnya, bukan cuma bahwa ia lewat.
    expect(r.pesan).toContain(`${MAX_PHOTO_MB} MB`);
    expect(r.pesan).toContain("26,0 MB");
  });

  it("pilihan yang seluruhnya ditolak tidak menyuruh 'kirim yang ini dulu'", () => {
    // Petunjuk buntu: tidak ada satu pun yang bisa dikirim. Yang benar adalah
    // menunjuk jalan keluarnya – sejak 2026-09-03 jalan itu ADA (pengecilan
    // ditawarkan di layar), jadi pesannya menyebut itu.
    const r = muatSekaliUnggah([40 * MB]);
    expect(r.muat).toBe(0);
    expect(r.pesan).not.toContain("Kirim yang ini dulu");
    expect(r.pesan).toMatch(/[Kk]ecilkan/);
  });

  it("foto kebesaran dipisahkan, supaya layar bisa MENAWARKAN pengecilan", () => {
    // Nasibnya beda dari sisa yang lain: yang tidak muat karena anggaran cukup
    // dikirim di gelombang berikutnya; yang kebesaran tidak akan pernah muat.
    const r = muatSekaliUnggah([2 * MB, 30 * MB, 26 * MB]);
    expect(r.kebesaran).toEqual([1, 2]);
    expect(r.terima).toEqual([0]);
  });

  it("`pesanSisa` tidak menyebut foto kebesaran – layar sudah menawarkannya", () => {
    // Menyebut masalah yang sama dua kali dengan nada berbeda (sekali sebagai
    // penolakan, sekali sebagai tawaran) membuat orang mengira ada dua masalah.
    const r = muatSekaliUnggah([30 * MB]);
    expect(r.pesanSisa).toBeNull();
    expect(r.pesan).toBeTruthy();
  });

  it("foto kebesaran di TENGAH tidak menyandera foto wajar sesudahnya", () => {
    const r = muatSekaliUnggah([2 * MB, 30 * MB, 3 * MB]);
    expect(r.terima).toEqual([0, 2]);
    expect(r.sisa).toBe(1);
  });

  it("dua pagar kena sekaligus: keduanya disebut, bukan salah satu", () => {
    // Satu kebesaran + sisanya menghabiskan anggaran permintaan.
    const r = muatSekaliUnggah([30 * MB, ...Array(4).fill(10 * MB)]);
    expect(r.pesan).toContain(`${MAX_PHOTO_MB} MB`);
    expect(r.pesan).toContain(`${MAX_UPLOAD_MB_TOTAL} MB`);
    expect(r.muat + r.sisa).toBe(5);
  });

  it("yang diterima SELALU di bawah kedua pagar", () => {
    const kasus = [
      [26 * MB, 1 * MB],
      [30 * MB, 30 * MB],
      Array(30).fill(1 * MB),
      [24 * MB, 24 * MB, 26 * MB],
    ];
    for (const ukuran of kasus) {
      const r = muatSekaliUnggah(ukuran);
      let total = 0;
      for (const i of r.terima) {
        expect(ukuran[i]!).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
        total += ukuran[i]!;
      }
      expect(total).toBeLessThanOrEqual(MAX_UPLOAD_BYTES_TOTAL);
      expect(r.muat).toBe(r.terima.length);
      expect(r.muat + r.sisa).toBe(ukuran.length);
    }
  });

  it("teks peringatannya memakai en-dash, bukan em-dash", () => {
    const r = muatSekaliUnggah([26 * MB]);
    expect(r.pesan ?? "").not.toContain(String.fromCharCode(0x2014));
  });
});
