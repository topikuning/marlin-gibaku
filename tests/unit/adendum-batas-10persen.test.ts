// BATAS 10% PERPRES 16/2018 PASAL 54.
//
// Dua hal yang pernah salah di sini:
//
// 1. Yang diuji `totalTambah` (KOTOR), padahal Pasal 54 membatasi kenaikan
//    NILAI kontrak (bersih). Laporan user 2026-08-03 dengan angka nyata: tambah
//    +Rp 1.044.616.688, kurang -Rp 1.044.616.680, nilai naik Rp 8 - dan
//    peringatannya tetap berteriak "melebihi 10%" (DECISIONS 233).
// 2. Plafonnya dihitung PER LOKASI dari RAB revisi pertama yang bisa berupa
//    HPS. Penegasan user 2026-09-01: "satu kontrak bisa naik turun 10% dari
//    batas nilai kontrak. misal 2 lokasi, lokasi a kontrak 100jt, lokasi b
//    100jt. batas kenaikan adalah 20jt. maka ketika lokasi a sudah 15jt
//    penambahan, lokasi b maksimal tinggal 5jt."
//
// Peringatan yang menyala pada keadaan yang sah adalah cara tercepat membuat
// semua peringatan diabaikan - termasuk yang benar.
//
// Uji ini dulu MENYALIN ULANG rumusnya sebagai fungsi lokal, karena aturannya
// hidup di dalam server component yang menarik db. Akibatnya ia menguji
// salinannya sendiri: menghapus seluruh blok peringatan di halaman tidak
// membuat satu uji pun merah. Aturannya kini di `lib/rab/batas-adendum.ts`.
import { describe, expect, it } from "vitest";
import { nilaiAdendum, type MasukanBatas, type SinyalBatas } from "@/lib/rab/batas-adendum";

const A = "lokasi-a";
const B = "lokasi-b";

/** Kontrak dua lokasi @100 jt, PPN 0 supaya angkanya terbaca apa adanya. */
function duaLokasi(o: {
  aktifA: bigint;
  aktifB: bigint;
  draftDi: string;
  draft: bigint;
  totalTambah?: bigint;
}): MasukanBatas {
  return {
    nilaiKontrak: 200_000_000n,
    rabAktifPaket: [
      { locationId: A, totalPraPpn: o.aktifA },
      { locationId: B, totalPraPpn: o.aktifB },
    ],
    locationIdDraft: o.draftDi,
    totalDraftPraPpn: o.draft,
    totalTambahPraPpn: o.totalTambah ?? 0n,
    nilaiRabAwalPraPpn: null,
    ppnPercent: 0,
  };
}

describe("CONTOH USER: plafon 10% milik KONTRAK, dibagi rebutan antar lokasi", () => {
  it("batasnya 20 jt untuk dua lokasi @100 jt - bukan 10 jt per lokasi", () => {
    const h = nilaiAdendum(duaLokasi({ aktifA: 100_000_000n, aktifB: 100_000_000n, draftDi: A, draft: 100_000_000n }))!;
    expect(h.nilaiAwal).toBe(200_000_000n);
    expect(h.batas).toBe(20_000_000n);
    expect(h.sisaPlafon).toBe(20_000_000n);
    expect(h.sinyal).toBe("aman");
  });

  it("lokasi A menambah 15 jt sendirian: masih aman, sisa plafon 5 jt", () => {
    const h = nilaiAdendum(duaLokasi({ aktifA: 100_000_000n, aktifB: 100_000_000n, draftDi: A, draft: 115_000_000n }))!;
    expect(h.kenaikanDraft).toBe(15_000_000n);
    expect(h.kenaikanKumulatif).toBe(15_000_000n);
    expect(h.sisaPlafon).toBe(5_000_000n);
    expect(h.sinyal).toBe("aman");
  });

  it("A sudah 15 jt: B menambah 5 jt masih aman - plafonnya pas habis", () => {
    // A sudah AKTIF di 115 jt. B mengajukan 105 jt.
    const h = nilaiAdendum(duaLokasi({ aktifA: 115_000_000n, aktifB: 100_000_000n, draftDi: B, draft: 105_000_000n }))!;
    expect(h.kenaikanDraft).toBe(5_000_000n);
    expect(h.kenaikanLokasiLain).toBe(15_000_000n);
    expect(h.kenaikanKumulatif).toBe(20_000_000n);
    expect(h.sisaPlafon).toBe(0n);
    expect(h.sinyal).toBe("aman"); // Perpres membatasi yang MELEBIHI.
  });

  it("A sudah 15 jt: B menambah 6 jt MELANGGAR, walau 6 jt itu cuma 6% RAB-nya sendiri", () => {
    // Inilah yang tidak pernah tertangkap oleh batas per-lokasi: 6 jt dari
    // 100 jt adalah 6%, "aman" menurut lokasi B, tapi kontraknya sudah 21 jt.
    const h = nilaiAdendum(duaLokasi({ aktifA: 115_000_000n, aktifB: 100_000_000n, draftDi: B, draft: 106_000_000n }))!;
    expect(h.kenaikanKumulatif).toBe(21_000_000n);
    expect(h.sisaPlafon).toBe(-1_000_000n);
    expect(h.sinyal).toBe("lewat-batas");
  });

  it("lokasi lain yang TURUN mengembalikan plafon", () => {
    // A dikurangi 10 jt, B menambah 25 jt: kontrak naik 15 jt, masih di bawah 20.
    const h = nilaiAdendum(duaLokasi({ aktifA: 90_000_000n, aktifB: 100_000_000n, draftDi: B, draft: 125_000_000n }))!;
    expect(h.kenaikanLokasiLain).toBe(-10_000_000n);
    expect(h.kenaikanKumulatif).toBe(15_000_000n);
    expect(h.sinyal).toBe("aman");
  });

  it("lokasi paket yang belum punya RAB aktif DISEBUT jumlahnya", () => {
    // Tanpa ini, lokasi yang belum diisi membuat nilai akhir jauh di bawah
    // kenyataan dan setiap adendum terlihat "aman".
    const h = nilaiAdendum({
      ...duaLokasi({ aktifA: 100_000_000n, aktifB: 100_000_000n, draftDi: A, draft: 100_000_000n }),
      rabAktifPaket: [
        { locationId: A, totalPraPpn: 100_000_000n },
        { locationId: B, totalPraPpn: null },
      ],
    })!;
    expect(h.lokasiTanpaRabAktif).toBe(1);
  });
});

/** Pembungkus satu lokasi, untuk kasus-kasus DECISIONS 233. */
function satuLokasi(o: { nilaiAwal: bigint; delta: bigint; totalTambah: bigint }): SinyalBatas {
  const aktif = o.nilaiAwal;
  const h = nilaiAdendum({
    nilaiKontrak: o.nilaiAwal,
    rabAktifPaket: [{ locationId: A, totalPraPpn: aktif }],
    locationIdDraft: A,
    totalDraftPraPpn: aktif + o.delta,
    totalTambahPraPpn: o.totalTambah,
    nilaiRabAwalPraPpn: null,
    ppnPercent: 0,
  });
  if (!h) throw new Error("tidak ada dasar batas");
  return h.sinyal;
}

const NILAI_AWAL = 5_891_112_777n; // kasus nyata 2026-08-03
const BATAS = NILAI_AWAL / 10n;

describe("KASUS NYATA user 2026-08-03: tukar pekerjaan, nilai praktis sama", () => {
  it("tidak dilaporkan melanggar batas 10%", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: 8n, totalTambah: 1_044_616_688n })).not.toBe(
      "lewat-batas",
    );
  });

  it("tetap disebut sebagai pergeseran LINGKUP - bukan didiamkan", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: 8n, totalTambah: 1_044_616_688n })).toBe(
      "geser-lingkup",
    );
  });
});

describe("batas 10% diukur dari kenaikan NILAI KONTRAK", () => {
  it("kenaikan nilai di atas batas → melanggar", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: BATAS + 1n, totalTambah: BATAS + 1n })).toBe(
      "lewat-batas",
    );
  });

  it("tepat di batas belum melanggar - Perpres membatasi yang MELEBIHI", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: BATAS, totalTambah: BATAS })).toBe("aman");
  });

  it("nilai kontrak TURUN tidak pernah melanggar batas kenaikan", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: -2_000_000_000n, totalTambah: 0n })).toBe("aman");
  });

  it("pelanggaran nilai menang atas pesan pergeseran lingkup", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: BATAS * 2n, totalTambah: BATAS * 3n })).toBe(
      "lewat-batas",
    );
  });

  it("adendum kecil tidak memicu apa pun", () => {
    expect(satuLokasi({ nilaiAwal: NILAI_AWAL, delta: 1_000_000n, totalTambah: 1_000_000n })).toBe("aman");
  });
});

describe("dasarnya NILAI KONTRAK, bukan RAB revisi pertama", () => {
  it("memakai nilai kontrak bila ada, dan menyebut dasarnya", () => {
    const h = nilaiAdendum({
      nilaiKontrak: 5_000_000_000n,
      rabAktifPaket: [{ locationId: A, totalPraPpn: 5_000_000_000n }],
      locationIdDraft: A,
      totalDraftPraPpn: 5_600_000_000n,
      totalTambahPraPpn: 600_000_000n,
      nilaiRabAwalPraPpn: 9_000_000_000n, // HPS jauh lebih tinggi - tidak boleh dipakai
      ppnPercent: 0,
    })!;
    expect(h.dasar).toBe("kontrak");
    expect(h.nilaiAwal).toBe(5_000_000_000n);
    // Dengan dasar HPS 9 M, 600 jt akan terbaca "aman" - persis kelonggaran
    // yang muncul saat tender dimenangkan di bawah HPS.
    expect(h.sinyal).toBe("lewat-batas");
  });

  it("tanpa kontrak, RAB revisi pertama dipakai TAPI dasarnya ditandai", () => {
    const h = nilaiAdendum({
      nilaiKontrak: null,
      rabAktifPaket: [{ locationId: A, totalPraPpn: 1_000_000_000n }],
      locationIdDraft: A,
      totalDraftPraPpn: 1_050_000_000n,
      totalTambahPraPpn: 50_000_000n,
      nilaiRabAwalPraPpn: 1_000_000_000n,
      ppnPercent: 11,
    })!;
    expect(h.dasar).toBe("rab-revisi-pertama");
    expect(h.nilaiAwal).toBe(1_110_000_000n);
  });

  it("tanpa kontrak DAN tanpa RAB awal: null, bukan nol yang membuat semua melanggar", () => {
    expect(
      nilaiAdendum({
        nilaiKontrak: null,
        rabAktifPaket: [],
        locationIdDraft: A,
        totalDraftPraPpn: 1n,
        totalTambahPraPpn: 1n,
        nilaiRabAwalPraPpn: null,
        ppnPercent: 11,
      }),
    ).toBeNull();
  });
});

describe("PPN dibawa ke konvensi yang sama", () => {
  it("RAB pra-PPN dinaikkan sebelum diadu dengan nilai kontrak", () => {
    // Kontrak 1 M (incl-PPN), batas 100 jt. RAB aktif 900 jt pra-PPN = 999 jt
    // incl-PPN 11%. Draft 995 jt pra-PPN = 1.104.450.000 incl-PPN.
    const h = nilaiAdendum({
      nilaiKontrak: 1_000_000_000n,
      rabAktifPaket: [{ locationId: A, totalPraPpn: 900_000_000n }],
      locationIdDraft: A,
      totalDraftPraPpn: 995_000_000n,
      totalTambahPraPpn: 95_000_000n,
      nilaiRabAwalPraPpn: null,
      ppnPercent: 11,
    })!;
    expect(h.nilaiAkhir).toBe(1_104_450_000n);
    expect(h.kenaikanKumulatif).toBe(104_450_000n);
    expect(h.sinyal).toBe("lewat-batas");
  });
});
