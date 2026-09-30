/*
 * BANDINGKAN RAB AKTIF DENGAN RAB SEBELUMNYA (DECISIONS 637).
 *
 * Permintaan user yang "dari awal sampai sekarang belum ada": perbandingan RAB
 * aktif dengan RAB sebelumnya. Pengaduannya memakai `diffRevisions` yang sama
 * dengan halaman draft adendum; yang diuji di sini pemilihan pasangannya.
 */
import { describe, expect, it } from "vitest";
import { pilihPasanganBawaan } from "@/lib/rab/pasangan-banding";

describe("pilihPasanganBawaan", () => {
  const revisi = [
    { id: "r4", revisionNo: 4, status: "draft" as const },
    { id: "r3", revisionNo: 3, status: "aktif" as const },
    { id: "r2", revisionNo: 2, status: "digantikan" as const },
    { id: "r1", revisionNo: 1, status: "digantikan" as const },
  ];
  it("bawaan: RAB aktif dibandingkan dengan revisi TEPAT sebelumnya (draft tidak ikut)", () => {
    expect(pilihPasanganBawaan(revisi, {})).toEqual({ dari: "r2", ke: "r3", pilihanDitolak: false });
  });
  it("pilihan tangan dihormati bila sah", () => {
    expect(pilihPasanganBawaan(revisi, { dari: "r1", ke: "r3" })).toEqual({ dari: "r1", ke: "r3", pilihanDitolak: false });
  });
  it("revisi yang sama di kedua sisi TIDAK diganti diam-diam: penolakannya dikatakan", () => {
    // Produksi 2026-09-30: user memilih #1 vs #1, halaman diam-diam menampilkan
    // #1 → #4 sementara kedua pilihan tetap bertuliskan #1.
    expect(pilihPasanganBawaan(revisi, { dari: "r1", ke: "r1" })).toEqual({ dari: "r2", ke: "r3", pilihanDitolak: true });
  });
  it("hanya satu revisi → tidak ada yang dibandingkan", () => {
    expect(pilihPasanganBawaan([{ id: "r1", revisionNo: 1, status: "aktif" }], {})).toBeNull();
  });
});
