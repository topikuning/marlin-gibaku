import { describe, expect, it } from "vitest";
import { PRINT_BACK_PARAM, safeBackPath, withBackTo } from "@/lib/print-back";

/**
 * Tombol "Kembali" di halaman cetak dulu dipaku ke daftar laporan lokasi, jadi
 * pengguna yang mencetak laporan harian tanggal tertentu dilempar ke halaman
 * yang memuat laporan mingguan. Sekarang asalnya dibawa lewat query — dan
 * karena query bisa diisi siapa saja, isinya harus disaring.
 */

const FALLBACK = "/lokasi/kedungrejo/harian/2026-05-12";

describe("safeBackPath", () => {
  it("path internal dipakai apa adanya", () => {
    expect(safeBackPath("/lokasi/kedungrejo/harian/2026-05-12", FALLBACK)).toBe(
      "/lokasi/kedungrejo/harian/2026-05-12",
    );
    expect(safeBackPath("/laporan", FALLBACK)).toBe("/laporan");
  });

  it("kosong / tidak ada → cadangan", () => {
    expect(safeBackPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath("", FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath("   ", FALLBACK)).toBe(FALLBACK);
  });

  it("MENOLAK tujuan luar (open redirect)", () => {
    expect(safeBackPath("https://jahat.example", FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath("//jahat.example", FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath("/\\jahat.example", FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath("/lokasi\\..\\x", FALLBACK)).toBe(FALLBACK);
    expect(safeBackPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
  });

  it("menolak path yang memuat '..'", () => {
    expect(safeBackPath("/lokasi/../../etc", FALLBACK)).toBe(FALLBACK);
  });
});

describe("withBackTo", () => {
  it("menyisipkan asal halaman & meng-encode-nya", () => {
    const href = withBackTo("/cetak/harian/kedungrejo/2026-05-12", "/lokasi/kedungrejo/harian/2026-05-12");
    expect(href).toContain(`${PRINT_BACK_PARAM}=`);
    const url = new URL(href, "https://x.test");
    expect(url.searchParams.get(PRINT_BACK_PARAM)).toBe("/lokasi/kedungrejo/harian/2026-05-12");
  });

  it("pulang-pergi: hasil withBackTo lolos safeBackPath", () => {
    const asal = "/laporan?periode=mingguan";
    const href = withBackTo("/cetak/harian/a/2026-05-12", asal);
    const url = new URL(href, "https://x.test");
    expect(safeBackPath(url.searchParams.get(PRINT_BACK_PARAM), FALLBACK)).toBe(asal);
  });
});
