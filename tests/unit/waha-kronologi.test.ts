// Jalur WhatsApp untuk kronologi lokasi — permintaan user 2026-08-31.
//
// Yang dikunci di sini bukan susunan kalimatnya, melainkan tiga keputusan:
//
// 1. "kronologi X" terbaca TANPA memanggil AI. Jalur cepat WA memang dibuat
//    supaya pertanyaan lazim tetap terjawab saat provider mati dan tidak
//    memakan kuota.
// 2. "kronologi kendala X" tetap SATU niat. Pola kronologi menelan kata
//    "kendala" di belakangnya; kalau tidak, dua temuan di dua rentang teks
//    membuat pertanyaan yang gamblang berubah jadi ambigu.
// 3. Balasannya membuka dengan KONDISI TERKINI, bukan dengan kejadian tertua.
//    Yang membaca di HP sering berhenti di layar pertama.
import { describe, expect, it } from "vitest";
import { parseNiatDeterministik } from "@/lib/waha/parser-niat";
import {
  balasKronologi,
  balasKronologiRapi,
  balasKronologiTanpaLokasi,
} from "@/lib/waha/tanya-format";
import { susunKronologi } from "@/lib/kronologi/susun";

const niatDari = (t: string) => {
  const h = parseNiatDeterministik(t);
  return h.jenis === "yakin" ? h.kandidat.niat : `(${h.jenis})`;
};

describe("niat kronologi dibaca aturan", () => {
  it("terbaca tanpa AI", () => {
    expect(niatDari("kronologi danasari")).toBe("kronologi");
    expect(niatDari("kondisi terkini danasari")).toBe("kronologi");
  });

  it("tetap satu niat walau menyebut kendala atau kegiatan", () => {
    expect(niatDari("kronologi kendala danasari")).toBe("kronologi");
    expect(niatDari("kronologi kegiatan danasari")).toBe("kronologi");
  });

  it("tidak merebut pertanyaan kendala biasa", () => {
    expect(niatDari("kendala danasari")).toBe("kendala");
  });
});

const k = susunKronologi({
  sampai: "2026-08-31",
  kendala: [
    {
      id: "a",
      judul: "Lahan blok B belum bebas",
      rincian: null,
      tingkat: "kritis",
      status: "terbuka",
      dibuka: "2026-06-01",
      ditutup: null,
      catatanPenutup: null,
      sumber: "manual",
      pic: "Dinas PU",
      tenggat: "2026-08-01",
    },
  ],
  kegiatan: [
    {
      id: "g",
      tanggal: "2026-08-24",
      jenis: "Rapat koordinasi",
      judul: "Koordinasi pembebasan lahan",
      catatan: "Disepakati pengukuran ulang",
      kendala: null,
      solusi: null,
      peserta: null,
      status: "final",
      jumlahFoto: 3,
    },
  ],
});


describe("balasKronologi", () => {
  const teks = balasKronologi({
    lokasi: "Danasari",
    wilayah: "Pemalang, Jawa Tengah",
    sampai: k.sampai,
    hari: 90,
    peristiwa: k.peristiwa,
    kondisi: k.kondisi,
    dipotong: k.dipotong,
  });

  it("membuka dengan kondisi terkini, bukan dengan kejadian tertua", () => {
    const iKondisi = teks.indexOf("Kondisi terkini");
    const iUrutan = teks.indexOf("Urutan kejadian");
    expect(iKondisi).toBeGreaterThan(-1);
    expect(iUrutan).toBeGreaterThan(iKondisi);
  });

  it("menyebut kendala terbuka beserta umur dan tenggatnya yang terlewat", () => {
    expect(teks).toContain("1 kendala masih terbuka");
    expect(teks).toContain("1 kritis");
    expect(teks).toContain("lewat tenggat");
    expect(teks).toContain("91 hari");
  });

  it("memuat kegiatan lapangan beserta catatannya", () => {
    expect(teks).toContain("Koordinasi pembebasan lahan");
    expect(teks).toContain("Disepakati pengukuran ulang");
  });
});

describe("balasKronologiTanpaLokasi", () => {
  it("menyebutkan pilihannya, bukan menolak", () => {
    const t = balasKronologiTanpaLokasi(["Danasari", "Kedung Mutih"], 5);
    expect(t).toContain("Danasari");
    expect(t).toContain("3 lokasi lain");
    expect(t).toContain("kronologi Danasari");
  });
});

describe("balasKronologiRapi", () => {
  // Keluhan user 2026-08-31 atas bentuk pertama: "jangan apa adanya semua
  // dikirim". Yang dikunci di sini adalah bahwa bentuk rapi memang BERHENTI
  // mengirim daftar mentahnya, bukan sekadar menambahkan paragraf di atasnya.
  const teks = balasKronologiRapi(
    {
      lokasi: "Danasari",
      wilayah: "Pemalang, Jawa Tengah",
      sampai: k.sampai,
      hari: 90,
      peristiwa: k.peristiwa,
      kondisi: k.kondisi,
      dipotong: k.dipotong,
    },
    {
      kesimpulan:
        "Danasari saat ini tertahan pembebasan lahan blok B yang sudah terbuka 91 hari. Karena itu pekerjaan di blok tersebut belum bisa dimulai.",
      babak: [
        {
          judul: "Menunggu pembebasan lahan",
          periode: "1 Jun - 24 Agu 2026",
          reason: "Kendala dibuka awal Juni dan belum tertutup sampai sekarang.",
        },
      ],
    },
  );

  it("membuka dengan kesimpulan, bukan dengan daftar", () => {
    const kalimatPertama = teks.split("\n").filter(Boolean)[2];
    expect(kalimatPertama).toContain("Danasari saat ini tertahan");
  });

  it("TIDAK mengirim daftar kejadian mentahnya", () => {
    // Judul kegiatan mentah hanya muncul di bentuk cadangan.
    expect(teks).not.toContain("Koordinasi pembebasan lahan");
    expect(teks).toContain("Menunggu pembebasan lahan");
  });

  it("tetap membawa angka kondisi dari sistem, bukan dari kalimat model", () => {
    expect(teks).toContain("1 kendala terbuka");
    expect(teks).toContain("tertua 91 hari");
  });

  it("menunjukkan di mana daftar lengkapnya bisa dilihat", () => {
    expect(teks).toContain("MARLIN");
    expect(teks).toContain("2 kejadian");
  });
});
