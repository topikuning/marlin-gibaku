// BATAS 10% PERPRES 16/2018 PASAL 54 — yang dibatasi KENAIKAN NILAI KONTRAK,
// bukan jumlah kotor pekerjaan tambah.
//
// Laporan user 2026-08-03 dengan angka nyata: tambah +Rp 1.044.616.688, kurang
// −Rp 1.044.616.680 → nilai kontrak naik Rp 8. Peringatan tetap berteriak
// "melebihi 10%" karena yang diuji `totalTambah` (kotor), padahal adendumnya
// hanya MENUKAR pekerjaan.
//
// Peringatan yang menyala pada keadaan yang sah adalah cara tercepat membuat
// semua peringatan diabaikan — termasuk yang benar.
import { describe, expect, it } from "vitest";

/**
 * Cerminan aturan di `app/(app)/lokasi/[slug]/rab/adendum/page.tsx`.
 *
 * Ditulis ulang di sini sebagai fungsi murni karena halaman itu server
 * component yang menarik db; yang perlu dikunci adalah ATURANNYA, dan aturan
 * ini pernah salah selama berbulan-bulan tanpa satu pun uji yang menyentuhnya.
 */
type Sinyal = "lewat-batas" | "geser-lingkup" | "aman";

function nilaiAdendum(input: {
  nilaiAwal: bigint;
  delta: bigint;
  totalTambah: bigint;
}): Sinyal {
  const batas = input.nilaiAwal / 10n;
  if (input.delta > batas) return "lewat-batas";
  if (input.totalTambah > batas) return "geser-lingkup";
  return "aman";
}

const NILAI_AWAL = 5_891_112_777n; // revisi #1 dari kasus nyata

describe("KASUS NYATA user 2026-08-03: tukar pekerjaan, nilai praktis sama", () => {
  it("tidak dilaporkan melanggar batas 10%", () => {
    const hasil = nilaiAdendum({
      nilaiAwal: NILAI_AWAL,
      delta: 8n, // 5.891.112.785 − 5.891.112.777
      totalTambah: 1_044_616_688n,
    });
    expect(hasil).not.toBe("lewat-batas");
  });

  it("tetap disebut sebagai pergeseran LINGKUP – bukan didiamkan", () => {
    // Nilainya aman, tapi isinya berpindah ~Rp 1 miliar. Itu tetap perubahan
    // lingkup yang butuh dasar tertulis; yang salah dulu cuma NAMANYA.
    expect(
      nilaiAdendum({ nilaiAwal: NILAI_AWAL, delta: 8n, totalTambah: 1_044_616_688n }),
    ).toBe("geser-lingkup");
  });
});

describe("batas 10% diukur dari kenaikan NILAI KONTRAK", () => {
  const batas = NILAI_AWAL / 10n; // 589.111.277

  it("kenaikan nilai di atas batas → melanggar", () => {
    expect(
      nilaiAdendum({ nilaiAwal: NILAI_AWAL, delta: batas + 1n, totalTambah: batas + 1n }),
    ).toBe("lewat-batas");
  });

  it("tepat di batas belum melanggar – Perpres membatasi yang MELEBIHI", () => {
    expect(nilaiAdendum({ nilaiAwal: NILAI_AWAL, delta: batas, totalTambah: batas })).toBe("aman");
  });

  it("nilai kontrak TURUN tidak pernah melanggar batas kenaikan", () => {
    expect(
      nilaiAdendum({ nilaiAwal: NILAI_AWAL, delta: -2_000_000_000n, totalTambah: 0n }),
    ).toBe("aman");
  });

  it("pelanggaran nilai menang atas pesan pergeseran lingkup", () => {
    // Keduanya bisa benar sekaligus; yang ditampilkan harus yang paling berat.
    expect(
      nilaiAdendum({ nilaiAwal: NILAI_AWAL, delta: batas * 2n, totalTambah: batas * 3n }),
    ).toBe("lewat-batas");
  });

  it("adendum kecil tidak memicu apa pun", () => {
    expect(nilaiAdendum({ nilaiAwal: NILAI_AWAL, delta: 1_000_000n, totalTambah: 1_000_000n })).toBe(
      "aman",
    );
  });
});
