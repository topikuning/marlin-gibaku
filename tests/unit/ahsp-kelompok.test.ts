import { describe, expect, it } from "vitest";
import {
  hitungTahap,
  kelompokkanPerUraian,
  type BarisUntukKelompok,
} from "@/lib/ahsp/kelompok";

/**
 * Pengelompokan pemetaan untuk dilihat orang (DECISIONS 326).
 *
 * Keluhan user: layar RAPL tidak ramah. Cacat terbesarnya bukan selera —
 * daftarnya menyodorkan 1.616 baris RAB untuk 480 keputusan, dengan uraian yang
 * sama berulang-ulang.
 */

function baris(over: Partial<BarisUntukKelompok> = {}): BarisUntukKelompok {
  return {
    code: over.code ?? "1",
    uraian: over.uraian ?? "Pekerjaan Beton",
    unit: over.unit ?? "m3",
    volume: over.volume === undefined ? 10 : over.volume,
    amount: over.amount ?? 1_000_000n,
    tanda: over.tanda ?? "pekerjaan beton|m3",
    keadaan: over.keadaan ?? "usulan",
    skor: over.skor ?? 0.6,
    meyakinkan: over.meyakinkan ?? false,
    catatan: over.catatan ?? null,
    petunjuk: over.petunjuk ?? null,
    ahsp: over.ahsp === undefined ? null : over.ahsp,
  };
}

describe("kelompokkanPerUraian", () => {
  it("satu uraian = satu baris, dengan berapa baris RAB yang bergantung padanya", () => {
    const hasil = kelompokkanPerUraian([
      baris({ code: "1", amount: 1_000_000n, volume: 10 }),
      baris({ code: "7", amount: 2_000_000n, volume: 5 }),
      baris({ code: "9", amount: 3_000_000n, volume: 2 }),
    ]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].jumlahBaris).toBe(3);
    expect(hasil[0].nilai).toBe(6_000_000n);
    expect(hasil[0].volume).toBe(17);
    // Kode RAB pertama tetap dibawa supaya bisa ditelusuri balik ke dokumennya.
    expect(hasil[0].kodeContoh).toBe("1");
  });

  it("diurut dari NILAI TERBESAR — bukan urutan dokumen", () => {
    // Daftar pekerjaan yang berguna dimulai dari yang paling menentukan uang.
    const hasil = kelompokkanPerUraian([
      baris({ tanda: "kecil", uraian: "Kecil", amount: 1_000n }),
      baris({ tanda: "besar", uraian: "Besar", amount: 900_000_000n }),
      baris({ tanda: "sedang", uraian: "Sedang", amount: 5_000_000n }),
    ]);
    expect(hasil.map((h) => h.uraian)).toEqual(["Besar", "Sedang", "Kecil"]);
  });

  it("satu baris tanpa volume membuat jumlah volumenya KOSONG, bukan salah", () => {
    // Menjumlahkan 10 + (tidak diketahui) jadi 10 menghasilkan angka yang
    // terlihat benar dan tidak berarti apa-apa.
    const hasil = kelompokkanPerUraian([
      baris({ volume: 10 }),
      baris({ volume: null }),
      baris({ volume: 5 }),
    ]);
    expect(hasil[0].volume).toBeNull();
    // Nilai rupiah tetap dijumlahkan — itu memang selalu ada.
    expect(hasil[0].nilai).toBe(3_000_000n);
  });

  it("uraian yang berbeda tidak digabung", () => {
    const hasil = kelompokkanPerUraian([
      baris({ tanda: "a", uraian: "A" }),
      baris({ tanda: "b", uraian: "B" }),
    ]);
    expect(hasil).toHaveLength(2);
  });
});

describe("hitungTahap", () => {
  const u = (keadaan: BarisUntukKelompok["keadaan"], tanda: string, amount = 1_000_000n) =>
    baris({ keadaan, tanda, amount });

  it("tahap AKTIF = yang paling awal dan masih bersisa", () => {
    // Orang yang membuka halaman harus langsung melihat SATU pekerjaan yang
    // jelas, bukan empat tabel lalu menebak mulai dari mana.
    const belum = hitungTahap(kelompokkanPerUraian([u("belum", "a"), u("usulan", "b")]));
    expect(belum.find((t) => t.aktif)?.tahap).toBe("petakan");

    const menunggu = hitungTahap(kelompokkanPerUraian([u("usulan", "a"), u("disetujui", "b")]));
    expect(menunggu.find((t) => t.aktif)?.tahap).toBe("setujui");

    const beres = hitungTahap(kelompokkanPerUraian([u("disetujui", "a"), u("koreksi", "b")]));
    expect(beres.find((t) => t.aktif)?.tahap).toBe("kebutuhan");
  });

  it("baris PUTUS masuk tahap petakan, bukan dianggap selesai", () => {
    // Tautan yang putus karena basis AHSP diganti (DECISIONS 323) adalah
    // kerusakan yang harus dikerjakan ulang, bukan keputusan yang sudah jadi.
    const t = hitungTahap(kelompokkanPerUraian([u("putus", "a"), u("disetujui", "b")]));
    expect(t.find((x) => x.tahap === "petakan")?.sisa).toBe(1);
    expect(t.find((x) => x.aktif)?.tahap).toBe("petakan");
  });

  it('"dinyatakan tidak ada" dihitung SELESAI di tahap setujui, tapi tidak dipakai kebutuhan', () => {
    const t = hitungTahap(kelompokkanPerUraian([u("tidak_ada", "a"), u("disetujui", "b")]));
    expect(t.find((x) => x.tahap === "setujui")?.selesai).toBe(2);
    // Kebutuhan hanya dari yang benar-benar berpadanan.
    expect(t.find((x) => x.tahap === "kebutuhan")?.selesai).toBe(1);
  });

  it("nilai rupiah yang tertahan dilaporkan per tahap", () => {
    // "12 uraian menunggu" tidak memberi tahu seberapa penting; rupiahnya iya.
    const t = hitungTahap(
      kelompokkanPerUraian([
        u("belum", "a", 900_000_000n),
        u("usulan", "b", 5_000_000n),
        u("disetujui", "c", 1_000_000n),
      ]),
    );
    expect(t.find((x) => x.tahap === "petakan")?.nilaiSisa).toBe(900_000_000n);
    expect(t.find((x) => x.tahap === "setujui")?.nilaiSisa).toBe(5_000_000n);
  });

  it("daftar kosong tidak meledak dan tidak mengaku sudah selesai", () => {
    const t = hitungTahap([]);
    expect(t).toHaveLength(4);
    expect(t.find((x) => x.aktif)?.tahap).toBe("kebutuhan");
    expect(t.every((x) => x.sisa === 0)).toBe(true);
  });
});
