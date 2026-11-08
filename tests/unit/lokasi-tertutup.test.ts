/*
 * DAFTAR LOKASI TIDAK MENAMPILKAN YANG DICABUT / DIBATALKAN (DECISIONS 750).
 *
 * Permintaan user 2026-11-08: *"untuk lokasi-lokasi yang sudah dicabut atau
 * dibatalkan tidak perlu dimunculkan di list lokasi, kecuali memang diminta
 * untuk memunculkan"*.
 *
 * Yang dijaga: (1) tiga sebab "tertutup" – dicabut adendum, status lokasi
 * Batal, paketnya Batal; (2) yang disembunyikan DIHITUNG per sebab, supaya
 * "tidak muncul" tidak terbaca "tidak ada" (CLAUDE.md); (3) "tampilkan semua"
 * benar-benar mengembalikan semuanya.
 */
import { describe, expect, it } from "vitest";
import { alasanTertutup, saringLokasiTertutup } from "@/lib/lokasi/tertutup";

describe("alasanTertutup", () => {
  it("lokasi berjalan biasa → terbuka", () => {
    expect(alasanTertutup({ status: "berjalan", paketBatal: false, dicabut: false })).toBeNull();
    expect(alasanTertutup({ status: "selesai", paketBatal: false, dicabut: false })).toBeNull();
    expect(alasanTertutup({ status: "terhenti", paketBatal: false, dicabut: false })).toBeNull();
  });

  it("dicabut lewat adendum → 'dicabut', apa pun status lokasinya", () => {
    expect(alasanTertutup({ status: "berjalan", paketBatal: false, dicabut: true })).toBe("dicabut");
  });

  it("status lokasi Batal, atau paketnya Batal → 'batal'", () => {
    expect(alasanTertutup({ status: "batal", paketBatal: false, dicabut: false })).toBe("batal");
    expect(alasanTertutup({ status: "persiapan", paketBatal: true, dicabut: false })).toBe("batal");
  });

  it("dicabut menang atas batal – pencabutan adendum adalah keterangan yang lebih spesifik", () => {
    expect(alasanTertutup({ status: "batal", paketBatal: true, dicabut: true })).toBe("dicabut");
  });
});

describe("saringLokasiTertutup", () => {
  const baris = [
    { id: "a", tertutup: null },
    { id: "b", tertutup: "dicabut" as const },
    { id: "c", tertutup: "batal" as const },
    { id: "d", tertutup: null },
    { id: "e", tertutup: "batal" as const },
  ];

  it("bawaan: yang tertutup disembunyikan, jumlahnya disebut per sebab", () => {
    const r = saringLokasiTertutup(baris, false);
    expect(r.tampil.map((x) => x.id)).toEqual(["a", "d"]);
    expect(r.tertutup).toEqual({ dicabut: 1, batal: 2, total: 3 });
  });

  it("diminta tampil semua: tidak ada yang disembunyikan, jumlahnya tetap dilaporkan", () => {
    const r = saringLokasiTertutup(baris, true);
    expect(r.tampil.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.tertutup.total).toBe(3);
  });

  it("tanpa yang tertutup → total 0", () => {
    expect(saringLokasiTertutup([{ id: "a", tertutup: null }], false).tertutup.total).toBe(0);
  });
});
