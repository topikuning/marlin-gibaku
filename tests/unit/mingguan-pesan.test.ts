// TEKS LAPORAN PROGRES MINGGUAN — yang dibaca PPK dan konsultan di grup WA.
//
// Permintaan user 2026-08-12, dengan contoh format yang sudah dipakai mengetik
// tangan selama ini. Pesan ini bukan notifikasi internal: ia laporan resmi ke
// pemberi kerja, jadi angka yang salah di sini berbeda kelas dari bug tampilan.
import { describe, expect, it } from "vitest";
import { labelDeviasi, susunPesanMingguan } from "@/lib/mingguan/pesan";

const SATU = {
  pelaksana: "CV. ALKOMBER KARYA",
  mingguKe: 3,
  lokasi: [
    {
      nama: "Pasir",
      wilayah: "Kebumen, Jawa Tengah",
      targetPct: 6.178,
      realisasiPct: 10.048,
      deviasiPct: 3.869,
    },
  ],
};

describe("bentuk pesan mengikuti format yang dipakai user", () => {
  it("kepala + satu blok desa, urutan barisnya persis contoh", async () => {
    expect(susunPesanMingguan(SATU)).toBe(
      [
        "Laporan Progres Mingguan",
        "Nama Pelaksana : CV. ALKOMBER KARYA",
        "Minggu Ke : 3",
        "",
        "Nama Desa/KNMP : Pasir",
        "Kabupaten/Provinsi : Kebumen, Jawa Tengah",
        "Target : 6,178%",
        "Realisasi : 10,048%",
        "Deviasi : 3,869% (Mendahului)",
      ].join("\n"),
    );
  });

  it("angka memakai koma id-ID dan TIGA desimal, bukan titik", () => {
    // Contoh user menulis 6.178% — tapi seluruh MARLIN berkoma (DECISIONS 107)
    // dan user memilih koma saat ditanya. Tiga desimalnya dipertahankan.
    const teks = susunPesanMingguan(SATU)!;
    expect(teks).toContain("6,178%");
    expect(teks).not.toContain("6.178");
  });

  it("beberapa desa DITUMPUK di satu pesan, kepalanya tidak diulang", () => {
    const teks = susunPesanMingguan({
      ...SATU,
      lokasi: [
        SATU.lokasi[0],
        {
          nama: "Kedung Mutih",
          wilayah: "Demak, Jawa Tengah",
          targetPct: 12.5,
          realisasiPct: 9.1,
          deviasiPct: -3.4,
        },
      ],
    })!;
    expect(teks.match(/Laporan Progres Mingguan/g)).toHaveLength(1);
    expect(teks.match(/Nama Pelaksana/g)).toHaveLength(1);
    expect(teks.match(/Nama Desa\/KNMP/g)).toHaveLength(2);
    // Satu baris kosong memisahkan blok desa supaya terbaca di HP.
    expect(teks).toContain("(Mendahului)\n\nNama Desa/KNMP : Kedung Mutih");
  });
});

describe("arah deviasi", () => {
  it("positif mendahului, negatif terlambat, nol sesuai rencana", () => {
    expect(labelDeviasi(3.869)).toBe("Mendahului");
    expect(labelDeviasi(-3.4)).toBe("Terlambat");
    // Nol BUKAN "mendahului 0%" — kalimat itu tidak berarti apa-apa.
    expect(labelDeviasi(0)).toBe("Sesuai rencana");
  });

  it("tanda minus IKUT dicetak untuk yang terlambat", () => {
    // Labelnya sudah menyebut arah, tapi angkanya juga harus membawa tandanya:
    // teks ini sering disalin ke tempat lain, dan di sana labelnya bisa hilang
    // sementara angkanya tetap terbaca.
    const teks = susunPesanMingguan({
      ...SATU,
      lokasi: [
        {
          nama: "Kedung Mutih",
          wilayah: "Demak, Jawa Tengah",
          targetPct: 12.5,
          realisasiPct: 9.1,
          deviasiPct: -3.4,
        },
      ],
    })!;
    expect(teks).toContain("Deviasi : -3,400% (Terlambat)");
  });
});

describe("yang belum diketahui tidak boleh dicetak sebagai nol", () => {
  it("lokasi tanpa kurva-S mengaku belum punya target, bukan menulis 0,000%", () => {
    // Nol berarti "rencananya memang nol minggu ini". Kalau baseline-nya belum
    // ada, itu pernyataan yang berbeda — dan di grup pemberi kerja, deviasi
    // terhadap target yang tidak ada akan terbaca sebagai prestasi.
    const teks = susunPesanMingguan({
      ...SATU,
      lokasi: [
        {
          nama: "Tengket",
          wilayah: "Bangkalan, Jawa Timur",
          targetPct: null,
          realisasiPct: 4.2,
          deviasiPct: 4.2,
        },
      ],
    })!;
    expect(teks).toContain("Target : belum ada kurva-S");
    expect(teks).toContain("Deviasi : belum bisa dihitung");
    expect(teks).not.toContain("0,000%");
    // Realisasinya TETAP dilaporkan — itu fakta lapangan yang memang diketahui.
    expect(teks).toContain("Realisasi : 4,200%");
  });
});

describe("pesan kosong", () => {
  it("paket tanpa lokasi tidak menghasilkan pesan sama sekali", () => {
    // Kepala surat tanpa isi cuma membuat grup berisik dan menurunkan
    // kepercayaan pada pesan berikutnya.
    expect(susunPesanMingguan({ ...SATU, lokasi: [] })).toBeNull();
  });
});

describe("TOTAL PAKET — angka gabungan seluruh lokasi", () => {
  const DUA = {
    ...SATU,
    lokasi: [
      SATU.lokasi[0],
      {
        nama: "Kedung Mutih",
        wilayah: "Demak, Jawa Tengah",
        targetPct: 12.5,
        realisasiPct: 9.1,
        deviasiPct: -3.4,
      },
    ],
  };

  it("dicetak di BAWAH rincian, bukan di atasnya", () => {
    // Rangkuman yang mendahului hal yang dirangkumnya membuat pembaca menakar
    // angka gabungan sebelum tahu isinya.
    const teks = susunPesanMingguan({
      ...DUA,
      rekap: {
        targetPct: 9.339,
        realisasiPct: 9.574,
        deviasiPct: 0.235,
        lokasiDihitung: 2,
        lokasiTanpaKurva: 0,
      },
    })!;
    expect(teks.indexOf("TOTAL PAKET")).toBeGreaterThan(teks.indexOf("Kedung Mutih"));
    expect(teks).toContain("TOTAL PAKET (2 lokasi)");
    expect(teks).toContain("Target : 9,339%");
    expect(teks).toContain("Realisasi : 9,574%");
    expect(teks).toContain("Deviasi : 0,235% (Mendahului)");
  });

  it("lokasi yang DIKELUARKAN disebut jumlahnya, bukan disembunyikan", () => {
    // "2 lokasi" dan "2 dari 3 lokasi" adalah dua pernyataan yang berbeda jauh.
    // Tanpa keterangan ini, angka gabungan terbaca seolah mencakup semuanya.
    const teks = susunPesanMingguan({
      ...DUA,
      rekap: {
        targetPct: 9.339,
        realisasiPct: 9.574,
        deviasiPct: 0.235,
        lokasiDihitung: 2,
        lokasiTanpaKurva: 1,
      },
    })!;
    expect(teks).toContain("TOTAL PAKET (2 dari 3 lokasi — 1 lokasi belum ada kurva-S)");
  });

  it("paket SATU lokasi tidak dapat rekap — angkanya akan sama persis", () => {
    const teks = susunPesanMingguan({
      ...SATU,
      rekap: {
        targetPct: 6.178,
        realisasiPct: 10.048,
        deviasiPct: 3.869,
        lokasiDihitung: 1,
        lokasiTanpaKurva: 0,
      },
    })!;
    expect(teks).not.toContain("TOTAL PAKET");
  });

  it("tanpa rekap, pesannya tetap sah — cuma tidak ada bagian totalnya", () => {
    const teks = susunPesanMingguan({ ...DUA, rekap: null })!;
    expect(teks).toContain("Nama Desa/KNMP : Kedung Mutih");
    expect(teks).not.toContain("TOTAL PAKET");
  });
});
