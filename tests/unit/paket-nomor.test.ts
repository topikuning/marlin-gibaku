// KOLOM "NOMOR" DI DAFTAR PAKET — cadangan ke nomor kontrak (DECISIONS 248).
//
// Permintaan user 2026-08-04: "untuk nomor di halaman paket, tampilkan saja
// nomor kontraknya jika nomornya kosong."
//
// Yang dikunci di sini bukan sekadar "ada fallback", melainkan APA ARTINYA
// KOSONG. Versi sebelumnya memakai `?? "—"` yang hanya menangkap null; string
// kosong dan string berisi spasi lolos, tampil kosong di layar, DAN sekaligus
// menutup jalan ke nomor kontraknya. Cacat seperti itu tidak menimbulkan galat
// apa pun — kolomnya cuma terlihat kosong, persis seperti sebelum diperbaiki.
import { describe, expect, it } from "vitest";
import { nomorPaket } from "@/app/(app)/paket/nomor";

describe("nomorPaket", () => {
  it("memakai nomor paket bila ada", () => {
    expect(nomorPaket("PKT-001", "KTR-999")).toBe("PKT-001");
  });

  it("jatuh ke nomor kontrak bila nomor paket null", () => {
    expect(nomorPaket(null, "KTR-999")).toBe("KTR-999");
  });

  it("string KOSONG dihitung kosong, bukan nilai sah", () => {
    expect(nomorPaket("", "KTR-999")).toBe("KTR-999");
  });

  it("string berisi SPASI saja juga dihitung kosong", () => {
    // Kolom teks yang "dikosongkan" lewat form kerap menyisakan spasi.
    expect(nomorPaket("   ", "KTR-999")).toBe("KTR-999");
  });

  it("undefined (paket tanpa kontrak sama sekali) tetap aman", () => {
    expect(nomorPaket(null, undefined)).toBe("–");
    expect(nomorPaket(undefined, undefined)).toBe("–");
  });

  it("keduanya kosong → strip, bukan string kosong yang tak terlihat", () => {
    // "—" menyatakan "memang tidak ada"; sel kosong terbaca "belum dimuat".
    expect(nomorPaket("  ", "  ")).toBe("–");
    expect(nomorPaket(null, null)).toBe("–");
  });

  it("nomor yang dipakai sudah dirapikan dari spasi tepi", () => {
    expect(nomorPaket("  PKT-001  ")).toBe("PKT-001");
    expect(nomorPaket(null, "  KTR-999  ")).toBe("KTR-999");
  });
});
