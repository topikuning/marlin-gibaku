import { describe, expect, it } from "vitest";
import {
  JADWAL_TERMIN_BAWAAN,
  bulanRomawi,
  hariTanggalTerbilang,
  jadwalBerlaku,
  kekuranganData,
  kekuranganTertaut,
  tautanLengkapi,
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
import { AMBANG_TERMIN_PCT } from "@/lib/kesiapan/rules";

/** Surat berkop penyedia – DECISIONS 716/717. Angka acuan: TERMIN 1 CV. Putera Fahlevi. */

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
  termin: { ke: 1, ambangPct: 25, bayarPct: 20, retensiPct: 0, bruto: 2_695_798_800n, retensi: 0n, nilai: 2_695_798_800n },
  // Angka per lokasi persis surat Permohonan Pemeriksaan TERMIN 1 (15 Sep 2026).
  progres: {
    pct: 26.6,
    mingguKe: 7,
    lokasi: [
      { nama: "Asemdoyong", nomor: "", tanggal: new Date("2026-09-13T00:00:00Z"), mingguKe: 7, persen: 35.9 },
      { nama: "Muarareja", nomor: "LKP-02", tanggal: new Date("2026-09-13T00:00:00Z"), mingguKe: 7, persen: 3.7 },
      { nama: "Purwahamba", nomor: "", tanggal: new Date("2026-09-13T00:00:00Z"), mingguKe: 7, persen: 30.1 },
      { nama: "Tegalsari", nomor: "", tanggal: new Date("2026-09-13T00:00:00Z"), mingguKe: 7, persen: 30.4 },
    ],
  },
  konsultan: { firma: "PT. Agrinas Jaladri Nusantara", nama: "Ir. Sujoko", jabatan: "Co-Team Leader" },
  surat: {
    nomor: "324.18/SP/PF-KNMP-ATMP/IX/2026",
    tanggal: new Date("2026-09-17T03:00:00Z"),
    kota: "Bogor",
    kepada: ["Pejabat Pembuat Komitmen Kegiatan Kampung Nelayan Merah Putih", "Satker Sekretariat DJPT", "KKP"],
    lampiran: lampiranBawaan("permohonan_pembayaran", 1),
    rapat: { pimpinan: "", peserta: [], cara: "" },
  },
};

/** Termin 4 jadwal bawaan: 25% × 13.478.994.000 dengan retensi 5%. */
const TERMIN4: DataSurat["termin"] = {
  ke: 4,
  ambangPct: 100,
  bayarPct: 25,
  retensiPct: 5,
  bruto: 3_369_748_500n,
  retensi: 673_949_700n,
  nilai: 2_695_798_800n,
};

function teks(bloks: Blok[]): string {
  return bloks
    .map((b) => {
      if (b.jenis === "paragraf") return b.isi.map((r) => r.teks).join("");
      if (b.jenis === "judul") return `${b.teks} ${b.sub ?? ""}`;
      if (b.jenis === "pasangan") return b.baris.map((x) => `${x.label}: ${x.isi.map((r) => r.teks).join("")}`).join("\n");
      if (b.jenis === "daftar") return b.butir.join("\n");
      if (b.jenis === "ttd2") return [b.kiri, b.kanan].map((p) => `${p.peran} ${p.perusahaan} ${p.nama} ${p.jabatan}`).join("\n");
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
    for (const jenis of ["permohonan_pemeriksaan", "ba_pembahasan_kemajuan", "permohonan_pembayaran", "invoice", "kwitansi"] as const) {
      expect(teks(susunSurat({ ...DATA, jenis }).blok)).not.toMatch(/\u2014/);
    }
  });

  it("termin dengan retensi: ketiga surat uang menyebut potongannya dan memakai nilai DIBAYAR", () => {
    const d = { ...DATA, termin: TERMIN4 };
    const pp = teks(susunSurat(d).blok);
    expect(pp).toContain("25% × Rp 13.478.994.000,- = Rp 3.369.748.500,-");
    expect(pp).toContain("dikurangi retensi sebesar 5% × Rp 13.478.994.000,- = Rp 673.949.700,-");
    expect(pp).toMatch(/Termin Keempat menjadi sebesar Rp 2\.695\.798\.800,-/);
    const inv = teks(susunSurat({ ...d, jenis: "invoice" }).blok);
    expect(inv).toContain("Retensi: 5% × Rp 13.478.994.000,- = Rp 673.949.700,- (ditahan)");
    expect(inv).toContain("Total Tagihan: Rp 2.695.798.800,-");
    const kw = teks(susunSurat({ ...d, jenis: "kwitansi" }).blok);
    expect(kw).toContain("Sebesar: Rp 2.695.798.800,-");
    expect(kw).toContain("Termin Keempat (25% dikurangi retensi 5%)");
    // Tanpa retensi tidak ada kata retensi sama sekali.
    expect(teks(susunSurat(DATA).blok)).not.toMatch(/retensi/i);
  });

  it("permohonan pemeriksaan: persis contoh TERMIN 1 – rata-rata, tiap lokasi, syarat termin", () => {
    const s = teks(susunSurat({ ...DATA, jenis: "permohonan_pemeriksaan" }).blok);
    expect(s).toContain("Permohonan Pemeriksaan Progres Pekerjaan");
    expect(s).toContain("Konsultan Pengawas PT. Agrinas Jaladri Nusantara dengan nilai rata-rata progres sebesar 26,6%, yaitu:");
    expect(s).toContain("Lokasi KNMP Desa Asemdoyong tanggal 13 September 2026 pada Minggu ke-7 sebesar 35,9%;");
    // Nomor laporan hanya ditulis bila diisi; butir terakhir diakhiri titik.
    expect(s).toContain("Lokasi KNMP Desa Muarareja Nomor: LKP-02 tanggal 13 September 2026 pada Minggu ke-7 sebesar 3,7%;");
    expect(s).toContain("Lokasi KNMP Desa Tegalsari tanggal 13 September 2026 pada Minggu ke-7 sebesar 30,4%.");
    expect(s).toContain("sebagai syarat pengajuan Pembayaran Termin Pertama.");
    const daftar = susunSurat({ ...DATA, jenis: "permohonan_pemeriksaan" }).blok.find((b) => b.jenis === "daftar");
    expect(daftar && daftar.jenis === "daftar" && daftar.penanda).toBe("kurung");
  });

  it("BA pembahasan kemajuan: judul berambang, hari-tanggal terbilang, dua pihak meneken", () => {
    const blok = susunSurat({ ...DATA, jenis: "ba_pembahasan_kemajuan", surat: { ...DATA.surat, tanggal: new Date("2026-09-16T00:00:00Z") } }).blok;
    const s = teks(blok);
    expect(s).toContain("PEMBAHASAN KEMAJUAN HASIL PEKERJAAN (25%)");
    expect(s).toContain("Pada hari ini Rabu, tanggal Enam Belas, bulan September, tahun Dua Ribu Dua Puluh Enam");
    expect(s).toContain("secara hybrid melalui zoom meeting");
    expect(s).toContain("progres fisik pekerjaan di 4 lokasi pada minggu ke-7 telah mencapai sebesar 26,6%");
    expect(s).toContain("Direktur CV. Putera Fahlevi");
    // Judul kontrak sudah diawali "Pekerjaan" – tidak digandakan.
    expect(s).toContain("Pembahasan Kemajuan Pekerjaan Konstruksi Pembangunan");
    expect(s).not.toContain("Pekerjaan Pekerjaan");
    const ttd = blok.find((b) => b.jenis === "ttd2");
    expect(ttd && ttd.jenis === "ttd2" && ttd.kanan).toEqual({
      peran: "Konsultan Pengawas",
      perusahaan: "PT. Agrinas Jaladri Nusantara",
      nama: "Ir. Sujoko",
      jabatan: "Co-Team Leader",
    });
    // Isian rapat yang diketik menggantikan bawaan.
    const s2 = teks(
      susunSurat({
        ...DATA,
        jenis: "ba_pembahasan_kemajuan",
        surat: { ...DATA.surat, rapat: { pimpinan: "Wakil Sah PPK Wilayah II", peserta: ["Peserta A"], cara: "di kantor PPK" } },
      }).blok,
    );
    expect(s2).toContain("dipimpin langsung oleh Wakil Sah PPK Wilayah II");
    expect(s2).toContain("Peserta A");
    expect(s2).not.toContain("Tenaga Ahli Teknis KNMP");
    expect(s2).toContain("di kantor PPK dengan hasil");
  });

  it("satu lokasi: kalimat menyebut lokasinya, bukan \"di 1 lokasi\"", () => {
    const s = teks(
      susunSurat({ ...DATA, jenis: "ba_pembahasan_kemajuan", progres: { ...DATA.progres!, lokasi: DATA.progres!.lokasi.slice(0, 1) } }).blok,
    );
    expect(s).toContain("progres fisik pekerjaan di Lokasi KNMP Desa Asemdoyong pada minggu ke-7");
    expect(s).not.toContain("di 1 lokasi");
  });
});

describe("jadwal termin bawaan KKP (DECISIONS 717)", () => {
  it("4 termin pada ambang kesiapan; nilai termin 100%, dibayar 95% + retensi 5% di termin 4", () => {
    expect(JADWAL_TERMIN_BAWAAN.map((t) => t.ambangPct)).toEqual([...AMBANG_TERMIN_PCT]);
    expect(JADWAL_TERMIN_BAWAAN.map((t) => t.bayarPct - t.retensiPct)).toEqual([20, 25, 30, 20]);
    expect(JADWAL_TERMIN_BAWAAN.reduce((s, t) => s + t.bayarPct, 0)).toBe(100);
    expect(JADWAL_TERMIN_BAWAAN.reduce((s, t) => s + t.retensiPct, 0)).toBe(5);
  });
  it("jadwal milik kontrak menggantikan bawaan sepenuhnya", () => {
    expect(jadwalBerlaku([]).bawaan).toBe(true);
    const sendiri = [{ terminKe: 1, ambangPct: 50, bayarPct: 50, retensiPct: 0 }];
    expect(jadwalBerlaku(sendiri)).toEqual({ bawaan: false, baris: sendiri });
  });
  it("hari & tanggal terbilang menurut WIB", () => {
    // 15 Sep 2026 20:00 UTC = Rabu 16 Sep 2026 03:00 WIB.
    expect(hariTanggalTerbilang(new Date("2026-09-15T20:00:00Z"))).toBe(
      "Rabu, tanggal Enam Belas, bulan September, tahun Dua Ribu Dua Puluh Enam",
    );
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
  it("surat progres: tanpa progres konsultan, di bawah ambang, tanpa konsultan → disebut", () => {
    expect(kekuranganData({ ...DATA, jenis: "permohonan_pemeriksaan", progres: null }).join(" ")).toMatch(/laporan konsultan untuk termin 1/);
    expect(
      kekuranganData({ ...DATA, jenis: "permohonan_pemeriksaan", progres: { ...DATA.progres!, pct: 24.9 } }).join(" "),
    ).toMatch(/tercatat 24,9%, ambangnya 25%/);
    const ba = kekuranganData({ ...DATA, jenis: "ba_pembahasan_kemajuan", konsultan: { firma: null, nama: null, jabatan: "Team Leader" } });
    expect(ba.join(" ")).toMatch(/firma konsultan/);
    expect(ba.join(" ")).toMatch(/Koordinator Team Leader atau Team Leader/);
    // Permohonan pemeriksaan tidak butuh penanda tangan konsultan; surat uang tidak butuh progres.
    expect(kekuranganData({ ...DATA, jenis: "permohonan_pemeriksaan", konsultan: { ...DATA.konsultan, nama: null } })).toEqual([]);
    expect(kekuranganData({ ...DATA, progres: null })).toEqual([]);
  });
  it("tiap kekurangan menyebut tempat mengisinya, dengan nama menu yang sebenarnya", () => {
    const k = kekuranganTertaut({
      ...DATA,
      jenis: "kwitansi",
      bank: null,
      penyedia: { ...DATA.penyedia, npwp: null },
      penandaTangan: { nama: "", jabatan: "Direktur" },
    });
    expect(k.map((x) => x.tujuan)).toEqual(["penanda_tangan", "rekening", "npwp"]);
    expect(kekuranganData({ ...DATA, penandaTangan: { nama: "", jabatan: "Direktur" } })[0]).toBe(
      "nama penanda tangan penyedia (Kontrak & Adendum › Penanda tangan dokumen KKP)",
    );
    const ba = kekuranganTertaut({ ...DATA, jenis: "ba_pembahasan_kemajuan", progres: null, konsultan: { firma: "F", nama: null, jabatan: "Team Leader" } });
    expect(ba.map((x) => x.tujuan)).toEqual(["progres", "penanda_tangan"]);
  });
});

describe("tautanLengkapi", () => {
  const ke = { packageId: "pkg-1", vendorId: "ven-1" };
  it("membawa langsung ke isiannya: panel penanda tangan terbuka, perusahaan terbuka, termin terpilih", () => {
    expect(tautanLengkapi("penanda_tangan", ke)).toBe("/paket/pkg-1/kontrak#penanda-tangan");
    expect(tautanLengkapi("npwp", ke)).toBe("/master/perusahaan?buka=ven-1");
    expect(tautanLengkapi("rekening", ke)).toBe("/paket/pkg-1/termin#data-surat");
    expect(tautanLengkapi("jadwal", ke)).toBe("/paket/pkg-1/termin#jadwal-termin");
    expect(tautanLengkapi("progres", { ...ke, terminKe: 3 })).toBe("/paket/pkg-1/termin?termin=3#progres-konsultan");
    expect(tautanLengkapi("progres", ke)).toBe("/paket/pkg-1/termin#progres-konsultan");
  });
});
