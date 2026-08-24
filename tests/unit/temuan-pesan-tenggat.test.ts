// Pesan pengingat TEMUAN lewat tenggat — modul murni (DECISIONS 426).
import { describe, expect, it } from "vitest";
import { MAKS_BARIS, pesanTemuanTenggat, sidikTenggat, type BarisTemuanTenggat } from "@/lib/findings/pesan-tenggat";

const b = (n: number, extra: Partial<BarisTemuanTenggat> = {}): BarisTemuanTenggat => ({
  judul: `Temuan ${n}`,
  lokasi: "Kedungmutih",
  severity: "sedang",
  pic: null,
  lewatHari: n,
  ...extra,
});

describe("pesanTemuanTenggat", () => {
  it("kosong → null (grup tidak dikirimi apa pun)", () => {
    expect(pesanTemuanTenggat("Paket A", [])).toBeNull();
  });

  it("menyebut jumlah, severity, PIC/belum ada PIC, dan lama keterlambatan", () => {
    const teks = pesanTemuanTenggat("Paket A", [
      b(3, { severity: "kritis", pic: "Slamet Riyadi" }),
      b(1),
    ])!;
    expect(teks).toContain("2 temuan pemeriksa sudah lewat tenggat");
    expect(teks).toContain("KRITIS");
    expect(teks).toContain("PIC Slamet Riyadi");
    expect(teks).toContain("belum ada PIC");
    expect(teks).toContain("lewat 3 hari");
    // Terlama di atas.
    expect(teks.indexOf("Temuan 3")).toBeLessThan(teks.indexOf("Temuan 1"));
    // En-dash, bukan em-dash (DECISIONS 385) — em-dash-nya ditulis —
    // supaya penjaga tanda-pisah tidak membaca asersi ini sebagai pelanggaran.
    expect(teks).not.toContain("—");
  });

  it("memotong ke MAKS_BARIS dan menyebut sisa dari TOTAL sebenarnya", () => {
    const baris = Array.from({ length: MAKS_BARIS + 2 }, (_, i) => b(i + 1));
    const teks = pesanTemuanTenggat("Paket A", baris, 40)!;
    expect(teks).toContain("40 temuan pemeriksa");
    expect(teks).toContain(`dan ${40 - MAKS_BARIS} temuan lain`);
  });

  it("sidik dipakai ulang dari kendala: stabil terhadap umur, peka terhadap total", () => {
    const a = [b(1), b(2)];
    expect(sidikTenggat(a, 2)).toBe(sidikTenggat([b(5), b(9)].map((x, i) => ({ ...x, judul: a[i].judul })), 2));
    expect(sidikTenggat(a, 2)).not.toBe(sidikTenggat(a, 3));
  });
});
