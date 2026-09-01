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
import { nilaiAdendum, type SinyalBatas } from "@/lib/rab/batas-adendum";

/**
 * Uji ini dulu MENYALIN ULANG rumusnya sebagai fungsi lokal, karena aturannya
 * hidup di dalam server component yang menarik db. Akibatnya ia menguji
 * salinannya sendiri: menghapus seluruh blok peringatan di halaman tidak
 * membuat satu uji pun merah. Aturannya kini di `lib/rab/batas-adendum.ts` dan
 * diimpor apa adanya.
 *
 * Pembungkus di bawah hanya memasang nilai bawaan supaya kasus-kasus lama tetap
 * terbaca; ia tidak memuat satu pun keputusan.
 */
function sinyal(input: {
  nilaiAwal: bigint;
  delta: bigint;
  totalTambah: bigint;
  deltaBerlaku?: bigint;
}): SinyalBatas {
  const h = nilaiAdendum({
    nilaiKontrak: input.nilaiAwal,
    nilaiRabAwalPraPpn: null,
    deltaBerlaku: input.deltaBerlaku ?? 0n,
    deltaDraftPraPpn: input.delta,
    totalTambahPraPpn: input.totalTambah,
    // 0% supaya kasus lama membandingkan angka yang sama persis seperti dulu;
    // pengaruh PPN diuji terpisah di bawah.
    ppnPercent: 0,
  });
  if (!h) throw new Error("tidak ada dasar batas");
  return h.sinyal;
}

const NILAI_AWAL = 5_891_112_777n; // revisi #1 dari kasus nyata

describe("KASUS NYATA user 2026-08-03: tukar pekerjaan, nilai praktis sama", () => {
  it("tidak dilaporkan melanggar batas 10%", () => {
    const hasil = sinyal({
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
      sinyal({ nilaiAwal: NILAI_AWAL, delta: 8n, totalTambah: 1_044_616_688n }),
    ).toBe("geser-lingkup");
  });
});

describe("batas 10% diukur dari kenaikan NILAI KONTRAK", () => {
  const batas = NILAI_AWAL / 10n; // 589.111.277

  it("kenaikan nilai di atas batas → melanggar", () => {
    expect(
      sinyal({ nilaiAwal: NILAI_AWAL, delta: batas + 1n, totalTambah: batas + 1n }),
    ).toBe("lewat-batas");
  });

  it("tepat di batas belum melanggar – Perpres membatasi yang MELEBIHI", () => {
    expect(sinyal({ nilaiAwal: NILAI_AWAL, delta: batas, totalTambah: batas })).toBe("aman");
  });

  it("nilai kontrak TURUN tidak pernah melanggar batas kenaikan", () => {
    expect(
      sinyal({ nilaiAwal: NILAI_AWAL, delta: -2_000_000_000n, totalTambah: 0n }),
    ).toBe("aman");
  });

  it("pelanggaran nilai menang atas pesan pergeseran lingkup", () => {
    // Keduanya bisa benar sekaligus; yang ditampilkan harus yang paling berat.
    expect(
      sinyal({ nilaiAwal: NILAI_AWAL, delta: batas * 2n, totalTambah: batas * 3n }),
    ).toBe("lewat-batas");
  });

  it("adendum kecil tidak memicu apa pun", () => {
    expect(sinyal({ nilaiAwal: NILAI_AWAL, delta: 1_000_000n, totalTambah: 1_000_000n })).toBe(
      "aman",
    );
  });
});

describe("dasarnya NILAI KONTRAK, bukan RAB revisi pertama", () => {
  it("memakai nilai kontrak bila ada, dan menyebut dasarnya", () => {
    const h = nilaiAdendum({
      nilaiKontrak: 5_000_000_000n,
      nilaiRabAwalPraPpn: 9_000_000_000n, // HPS jauh lebih tinggi – tidak boleh dipakai
      deltaBerlaku: 0n,
      deltaDraftPraPpn: 600_000_000n,
      totalTambahPraPpn: 600_000_000n,
      ppnPercent: 0,
    })!;
    expect(h.dasar).toBe("kontrak");
    expect(h.nilaiAwal).toBe(5_000_000_000n);
    // 600 juta > 10% dari 5 M. Dengan dasar HPS 9 M ia akan terbaca "aman" –
    // persis kelonggaran yang dikeluhkan: kontrak dimenangkan di bawah HPS,
    // plafonnya ikut menggelembung.
    expect(h.sinyal).toBe("lewat-batas");
  });

  it("tanpa kontrak, RAB revisi pertama dipakai TAPI dasarnya ditandai", () => {
    const h = nilaiAdendum({
      nilaiKontrak: null,
      nilaiRabAwalPraPpn: 1_000_000_000n,
      deltaBerlaku: 0n,
      deltaDraftPraPpn: 50_000_000n,
      totalTambahPraPpn: 50_000_000n,
      ppnPercent: 11,
    })!;
    expect(h.dasar).toBe("rab-revisi-pertama");
    // RAB pra-PPN dinaikkan ke konvensi kontrak supaya kedua sisi sebanding.
    expect(h.nilaiAwal).toBe(1_110_000_000n);
  });

  it("tanpa kontrak DAN tanpa RAB awal: null, bukan nol yang membuat semua melanggar", () => {
    expect(
      nilaiAdendum({
        nilaiKontrak: null,
        nilaiRabAwalPraPpn: null,
        deltaBerlaku: 0n,
        deltaDraftPraPpn: 1n,
        totalTambahPraPpn: 1n,
        ppnPercent: 11,
      }),
    ).toBeNull();
  });
});

describe("batasnya KUMULATIF, bukan per adendum", () => {
  const KONTRAK = 5_000_000_000n; // batas 500 juta

  it("dua adendum 4% yang sudah berlaku + 4% lagi = melanggar", () => {
    expect(
      sinyal({
        nilaiAwal: KONTRAK,
        deltaBerlaku: 400_000_000n,
        delta: 200_000_000n,
        totalTambah: 200_000_000n,
      }),
    ).toBe("lewat-batas");
  });

  it("adendum yang sama sendirian belum melanggar", () => {
    expect(
      sinyal({ nilaiAwal: KONTRAK, deltaBerlaku: 0n, delta: 200_000_000n, totalTambah: 200_000_000n }),
    ).toBe("aman");
  });
});

describe("PPN dibawa ke konvensi yang sama", () => {
  it("Δ RAB pra-PPN dinaikkan sebelum diadu dengan nilai kontrak", () => {
    // Kontrak 1 M (incl-PPN), batas 100 juta. Δ RAB 95 juta pra-PPN = 105,45
    // juta incl-PPN 11% – melewati batas justru karena PPN-nya.
    const h = nilaiAdendum({
      nilaiKontrak: 1_000_000_000n,
      nilaiRabAwalPraPpn: null,
      deltaBerlaku: 0n,
      deltaDraftPraPpn: 95_000_000n,
      totalTambahPraPpn: 95_000_000n,
      ppnPercent: 11,
    })!;
    expect(h.kenaikanDraft).toBe(105_450_000n);
    expect(h.sinyal).toBe("lewat-batas");
  });
});
