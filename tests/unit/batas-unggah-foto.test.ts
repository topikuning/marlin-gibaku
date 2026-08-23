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
  MAX_PHOTOS_PER_UPLOAD,
  MAX_UPLOAD_BYTES_TOTAL,
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
    expect(muatSekaliUnggah([])).toEqual({ muat: 0, sisa: 0, pesan: null });
  });

  it("SATU foto yang sendirian sudah melebihi anggaran tidak bikin muat=0 senyap", () => {
    // Batas per-berkas (25 MB) ditegakkan di tempat lain; di sini yang penting
    // sisanya tetap dihitung dan disebut, bukan menghilang.
    const r = muatSekaliUnggah([29 * MB, 1 * MB]);
    expect(r.muat).toBe(0);
    expect(r.sisa).toBe(2);
    expect(r.pesan).toBeTruthy();
  });
});
