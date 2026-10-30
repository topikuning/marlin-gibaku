import { describe, expect, it } from "vitest";
import {
  bulanRomawi,
  kekuranganData,
  lampiranBawaan,
  persenSurat,
  polaNomorSah,
  rupiahSurat,
  susunNomor,
  susunSurat,
  terbilang,
  terbilangRupiah,
  urutanTermin,
  type Blok,
  type DataSurat,
} from "@/lib/surat-penyedia/aturan";

/** Surat berkop penyedia – DECISIONS 716. Angka acuan: TERMIN 1 CV. Putera Fahlevi. */

describe("terbilang", () => {
  it("angka TERMIN 1 contoh – yang di surat aslinya kehilangan \"delapan ratus\"", () => {
    expect(terbilangRupiah(2_695_798_800n)).toBe(
      "Dua Miliar Enam Ratus Sembilan Puluh Lima Juta Tujuh Ratus Sembilan Puluh Delapan Ribu Delapan Ratus Rupiah",
    );
    expect(terbilang(13_478_994_000n)).toBe(
      "Tiga Belas Miliar Empat Ratus Tujuh Puluh Delapan Juta Sembilan Ratus Sembilan Puluh Empat Ribu",
    );
  });

  it("bentuk khusus: se-, belas, puluh, nol", () => {
    expect(terbilang(0n)).toBe("Nol");
    expect(terbilang(1n)).toBe("Satu");
    expect(terbilang(10n)).toBe("Sepuluh");
    expect(terbilang(11n)).toBe("Sebelas");
    expect(terbilang(19n)).toBe("Sembilan Belas");
    expect(terbilang(100n)).toBe("Seratus");
    expect(terbilang(1_000n)).toBe("Seribu");
    expect(terbilang(1_100n)).toBe("Seribu Seratus");
    expect(terbilang(2_001n)).toBe("Dua Ribu Satu");
    expect(terbilang(1_000_000n)).toBe("Satu Juta");
    expect(terbilang(101_000_011n)).toBe("Seratus Satu Juta Sebelas");
    expect(terbilang(1_000_000_000_000n)).toBe("Satu Triliun");
  });
});

describe("rupiah, persen, romawi, urutan", () => {
  it("rupiah satu kali \"Rp\" – bukan \"Rp. Rp.\" seperti contoh", () => {
    expect(rupiahSurat(2_695_798_800n)).toBe("Rp 2.695.798.800,-");
    expect(rupiahSurat(0n)).toBe("Rp 0,-");
  });
  it("persen bergaya Indonesia", () => {
    expect(persenSurat(20)).toBe("20%");
    expect(persenSurat(26.6)).toBe("26,6%");
  });
  it("bulan Romawi dan urutan termin", () => {
    expect(bulanRomawi(9)).toBe("IX");
    expect(bulanRomawi(12)).toBe("XII");
    expect(() => bulanRomawi(13)).toThrow();
    expect(urutanTermin(1)).toBe("Pertama");
    expect(urutanTermin(4)).toBe("Keempat");
  });
});

describe("nomor surat", () => {
  const POLA = "324.{urut}/SP/PF-KNMP-ATMP/{bulan}/{tahun}";
  it("pola contoh menghasilkan nomor persis surat aslinya", () => {
    expect(susunNomor(POLA, 18, new Date("2026-09-17T03:00:00Z"))).toBe("324.18/SP/PF-KNMP-ATMP/IX/2026");
  });
  it("bulan & tahun menurut WIB, bukan UTC", () => {
    // 30 Sep 2026 20:00 UTC = 1 Okt 2026 03:00 WIB.
    expect(susunNomor(POLA, 1, new Date("2026-09-30T20:00:00Z"))).toBe("324.1/SP/PF-KNMP-ATMP/X/2026");
  });
  it("pola wajib memuat {urut}; penanda asing ditolak dengan sebutannya", () => {
    expect(polaNomorSah(POLA)).toBeNull();
    expect(polaNomorSah("")).toMatch(/kosong/);
    expect(polaNomorSah("SP/{bulan}/{tahun}")).toMatch(/\{urut\}/);
    expect(polaNomorSah("{urut}/{bln}/{tahun}")).toMatch(/\{bln\}/);
  });
});

const DATA: DataSurat = {
  jenis: "permohonan_pembayaran",
  penyedia: { nama: "CV. Putera Fahlevi", npwp: "0502 5643 0540 4000" },
  penandaTangan: { nama: "Rheza Fajar Adi P.", jabatan: "Direktur" },
  kontrak: {
    nomor: "B.19714/DJPT.6/PI.420/PPK/VII/2026",
    tanggal: new Date("2026-07-15T00:00:00Z"),
    judul:
      "Pekerjaan Konstruksi Pembangunan Kampung Nelayan Merah Putih di Kabupaten Pemalang, Kota Tegal dan Kabupaten Tegal Provinsi Jawa Tengah",
    nilai: 13_478_994_000n,
  },
  bank: { nama: "Bank BJB KC Bogor", rekening: "0138941035001", atasNama: "PUTERA FAHLEVI CV" },
  termin: { ke: 1, bayarPct: 20, nilai: 2_695_798_800n },
  surat: {
    nomor: "324.18/SP/PF-KNMP-ATMP/IX/2026",
    tanggal: new Date("2026-09-17T03:00:00Z"),
    kota: "Bogor",
    kepada: ["Pejabat Pembuat Komitmen Kegiatan Kampung Nelayan Merah Putih", "Satker Sekretariat DJPT", "KKP"],
    lampiran: lampiranBawaan("permohonan_pembayaran", 1),
  },
};

function teks(bloks: Blok[]): string {
  return bloks
    .map((b) => {
      if (b.jenis === "paragraf") return b.isi.map((r) => r.teks).join("");
      if (b.jenis === "judul") return `${b.teks} ${b.sub ?? ""}`;
      if (b.jenis === "pasangan") return b.baris.map((x) => `${x.label}: ${x.isi.map((r) => r.teks).join("")}`).join("\n");
      if (b.jenis === "daftar") return b.butir.join("\n");
      return `${b.salam} ${b.perusahaan} ${b.nama} ${b.jabatan} ${b.kotakNominal ?? ""}`;
    })
    .join("\n");
}

describe("susunSurat", () => {
  it("permohonan pembayaran: nilai kontrak, hitungan termin, terbilang lengkap, lampiran", () => {
    const s = teks(susunSurat(DATA).blok);
    expect(s).toContain("Bogor, 17 September 2026");
    expect(s).toContain("Permohonan Pembayaran Termin Pertama");
    expect(s).toContain("20% × Rp 13.478.994.000,- = Rp 2.695.798.800,-");
    expect(s).toContain("Delapan Ribu Delapan Ratus Rupiah");
    expect(s).toContain("Kwitansi Pembayaran Termin Pertama");
    expect(s).not.toMatch(/Rp\.? Rp/);
    expect(s).toContain("Rheza Fajar Adi P.");
  });

  it("invoice & kwitansi memakai angka YANG SAMA dengan permohonannya", () => {
    const nilai = /Rp 2\.695\.798\.800,-/;
    for (const jenis of ["invoice", "kwitansi"] as const) {
      const s = teks(susunSurat({ ...DATA, jenis }).blok);
      expect(s, jenis).toMatch(nilai);
      expect(s, jenis).toContain("0138941035001");
      expect(s, jenis).toContain("0502 5643 0540 4000");
    }
    const kw = susunSurat({ ...DATA, jenis: "kwitansi" }).blok.find((b) => b.jenis === "ttd");
    expect(kw && kw.jenis === "ttd" && kw.meterai).toBe(true);
  });

  it("tanpa em-dash di teks surat (DECISIONS 385)", () => {
    for (const jenis of ["permohonan_pembayaran", "invoice", "kwitansi"] as const) {
      expect(teks(susunSurat({ ...DATA, jenis }).blok)).not.toMatch(/\u2014/);
    }
  });

  it("jenis yang belum tersedia ditolak dengan namanya", () => {
    expect(() => susunSurat({ ...DATA, jenis: "ba_pembahasan_kemajuan" })).toThrow(/belum bisa disusun/);
  });
});

describe("kekuranganData", () => {
  it("lengkap → kosong", () => {
    expect(kekuranganData(DATA)).toEqual([]);
  });
  it("invoice tanpa rekening & NPWP, termin tanpa persen → disebut semua", () => {
    const k = kekuranganData({
      ...DATA,
      jenis: "invoice",
      bank: null,
      penyedia: { ...DATA.penyedia, npwp: null },
      termin: { ...DATA.termin, nilai: 0n },
      penandaTangan: { nama: " ", jabatan: "Direktur" },
    });
    expect(k).toHaveLength(4);
    expect(k.join(" ")).toMatch(/rekening/);
    expect(k.join(" ")).toMatch(/NPWP/);
    expect(k.join(" ")).toMatch(/persen pembayaran/);
    expect(k.join(" ")).toMatch(/penanda tangan/);
  });
});
