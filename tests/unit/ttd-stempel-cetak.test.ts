// TANDA TANGAN & STEMPEL PADA LAPORAN CETAK (DECISIONS 328).
//
// Permintaan user 2026-08-16: *"untuk laporan harian dan mingguan, aku butuh
// tanda tangan dan stempel perusahaan, untuk ditempel… orang lapangan kuno dan
// konservatif, tetap minta untuk laporan di tanda tangan manual dan dicetak"*,
// disusul *"pastikan semua dokumen itu stempel dan ttdnya proporsional di
// posisinya"*.
//
// Dua cacat yang mungkin dan keduanya SENYAP — dokumennya tetap terbentuk,
// tetap rapi, tetap bisa dicetak:
//
//  1. **Stempel salah pihak.** Blok tanda tangan disusun sebagai LARIK tiga
//     elemen; kalau penyaji mencocokkan gambar berdasarkan URUTAN larik, mengubah
//     urutan blok (mis. PPK dipindah ke kanan) akan menempelkan stempel PPK di
//     kolom penyedia. Baru ketahuan setelah dokumennya beredar dan
//     ditandatangani.
//  2. **Ukuran tidak proporsional.** Empat dokumen memakai tinggi ruang tanda
//     tangan yang berbeda (40–56px). Ukuran piksel tetap yang pas di laporan
//     harian akan melimpah keluar kolom di lembar kurva-S yang berhuruf 8,5px.
//
// Berkas ini mengunci: identitas pihak dibawa DATANYA (bukan urutan), cadangan
// stempel vendor hanya untuk stempel (bukan tanda tangan), dan seluruh ukuran
// gambar turunan dari satu angka tinggi.
import { describe, expect, it, vi } from "vitest";
import { pihakTandaTanganRencana, type SumberTtdRencana } from "@/lib/plan/rencana-ttd";

vi.hoisted(() => {
  // `ttd-laporan` menarik `lib/db` yang memvalidasi env saat DIMUAT, dan
  // `import` di-hoist ke atas berkas — jadi env harus disetel lebih dulu lagi.
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});
const { pilihKunciTtd } = await import("@/lib/export/ttd-laporan");
type SumberKunciTtd = import("@/lib/export/ttd-laporan").SumberKunciTtd;

const KOP: SumberTtdRencana["header"] = {
  vendorName: "PT Kurnia Alam Sentosa",
  contractorSignerName: "Andi Prasetyo",
  contractorSignerTitle: "Direktur",
  supervisorName: "Rina Wijaya",
  supervisorFirm: "PT Konsultan Pengawas Nusantara",
  ppkName: "Budi Santoso",
  ppkNip: "19800101 200501 1 001",
};

const KOSONG: SumberKunciTtd = {
  ppkTtdKey: null,
  ppkStempelKey: null,
  supervisorTtdKey: null,
  supervisorStempelKey: null,
  contractorTtdKey: null,
  contractorStempelKey: null,
  vendorStempelKey: null,
};

describe("identitas pihak dibawa datanya, bukan urutan larik", () => {
  it("tiap blok tanda tangan rencana menyebut pihaknya sendiri", () => {
    const blok = pihakTandaTanganRencana({ header: KOP });

    // Ini inti pengujiannya: pasangan (nama, pihak) harus cocok TANPA melihat
    // posisi elemen dalam larik.
    const perPihak = new Map(blok.map((b) => [b.pihak, b]));
    expect(perPihak.get("penyedia")?.name).toBe("Andi Prasetyo");
    expect(perPihak.get("pengawas")?.name).toBe("Rina Wijaya");
    expect(perPihak.get("ppk")?.name).toBe("Budi Santoso");
  });

  it("ketiga pihak berbeda — tidak ada dua blok yang mengaku pihak yang sama", () => {
    const blok = pihakTandaTanganRencana({ header: KOP });
    expect(new Set(blok.map((b) => b.pihak)).size).toBe(3);
  });

  it("urutan blok boleh berubah tanpa membuat gambar tertukar", () => {
    // Penyaji yang benar mencari lewat `pihak`; membalik larik tidak boleh
    // mengubah pasangan nama↔pihak.
    const dibalik = [...pihakTandaTanganRencana({ header: KOP })].reverse();
    expect(dibalik.find((b) => b.pihak === "ppk")?.name).toBe("Budi Santoso");
    expect(dibalik.find((b) => b.pihak === "penyedia")?.name).toBe("Andi Prasetyo");
  });
});

describe("pemilihan kunci gambar", () => {
  it("memakai gambar kontrak bila ada", () => {
    const k = pilihKunciTtd({
      ...KOSONG,
      ppkTtdKey: "kontrak/1/ppkTtdKey.webp",
      ppkStempelKey: "kontrak/1/ppkStempelKey.webp",
      supervisorTtdKey: "kontrak/1/supervisorTtdKey.webp",
      contractorTtdKey: "kontrak/1/contractorTtdKey.webp",
      contractorStempelKey: "kontrak/1/contractorStempelKey.webp",
      vendorStempelKey: "vendors/v1/stempel.webp",
    });
    expect(k.ppk.ttd).toBe("kontrak/1/ppkTtdKey.webp");
    expect(k.pengawas.ttd).toBe("kontrak/1/supervisorTtdKey.webp");
    // Stempel khusus kontrak MENANG atas stempel master vendor.
    expect(k.penyedia.stempel).toBe("kontrak/1/contractorStempelKey.webp");
  });

  it("stempel penyedia jatuh ke master vendor bila kontrak tidak punya", () => {
    const k = pilihKunciTtd({ ...KOSONG, vendorStempelKey: "vendors/v1/stempel.webp" });
    expect(k.penyedia.stempel).toBe("vendors/v1/stempel.webp");
  });

  it("cadangan vendor TIDAK berlaku untuk tanda tangan", () => {
    // Stempel = benda perusahaan, boleh dipakai bersama. Tanda tangan = coretan
    // ORANG; memakai cadangan di sini berarti membubuhkan tanda tangan seseorang
    // pada dokumen yang bukan urusannya.
    const k = pilihKunciTtd({ ...KOSONG, vendorStempelKey: "vendors/v1/stempel.webp" });
    expect(k.penyedia.ttd).toBeNull();
    expect(k.ppk.ttd).toBeNull();
    expect(k.pengawas.ttd).toBeNull();
  });

  it("cadangan vendor TIDAK bocor ke stempel PPK atau pengawas", () => {
    // Stempel penyedia adalah milik penyedia. Membubuhkannya di kolom PPK
    // memalsukan pengesahan pemberi kerja.
    const k = pilihKunciTtd({ ...KOSONG, vendorStempelKey: "vendors/v1/stempel.webp" });
    expect(k.ppk.stempel).toBeNull();
    expect(k.pengawas.stempel).toBeNull();
  });

  it("semuanya kosong bila belum ada yang diunggah", () => {
    const k = pilihKunciTtd(KOSONG);
    expect(Object.values(k).flatMap((p) => [p.ttd, p.stempel]).every((v) => v === null)).toBe(true);
  });
});

const { NISBAH_TTD, ukuranTtd: ukuran } = await import("@/lib/export/ttd-ukuran");

describe("ukuran gambar proporsional di semua dokumen", () => {
  // Tinggi ruang tanda tangan SETIAP dokumen, apa adanya dari penyajinya.
  // HTML dalam piksel, PDF dalam poin — perbandingannya harus tetap sama di
  // keduanya, karena itu keduanya diuji dengan aturan yang sama.
  const DOKUMEN = [
    { nama: "html: lembar kurva-S", tinggi: 40 },
    { nama: "html: laporan harian", tinggi: 48 },
    { nama: "html: laporan periodik", tinggi: 48 },
    { nama: "html: rencana mingguan", tinggi: 56 },
    { nama: "pdf: laporan periodik", tinggi: 32 },
    { nama: "pdf: laporan harian", tinggi: 34 },
    { nama: "pdf: rencana mingguan", tinggi: 40 },
  ];

  it("stempel selalu lebih tinggi daripada tanda tangan, di dokumen mana pun", () => {
    // Meniru benda aslinya: stempel bundar ±4 cm, coretan tanda tangan ±3 cm.
    for (const d of DOKUMEN) {
      const u = ukuran(d.tinggi);
      expect(u.ttd.tinggi, d.nama).toBeLessThan(u.stempel.tinggi);
    }
  });

  it("stempel tidak pernah melebihi tinggi ruangnya", () => {
    // Kalau melebihi, ia akan menabrak baris jabatan di atasnya — dan pada
    // lembar kurva-S yang paling sempit itulah yang pertama terjadi.
    for (const d of DOKUMEN) {
      expect(ukuran(d.tinggi).stempel.tinggi, d.nama).toBeLessThanOrEqual(d.tinggi);
    }
  });

  it("perbandingan tanda tangan : stempel sama persis di keempat dokumen", () => {
    const nisbah = DOKUMEN.map((d) => {
      const u = ukuran(d.tinggi);
      return u.ttd.tinggi / u.stempel.tinggi;
    });
    // Pembulatan ke piksel bulat menyisakan selisih < 0,01 — itu yang ditoleransi,
    // bukan perbedaan ukuran yang sengaja.
    for (const n of nisbah) expect(Math.abs(n - NISBAH_TTD)).toBeLessThan(0.01);
  });

  it("tanda tangan lebih lebar daripada tinggi — coretan, bukan bujur sangkar", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.tinggi);
      expect(u.ttd.lebarMaks, d.nama).toBeGreaterThan(u.ttd.tinggi);
    }
  });

  it("geseran stempel tetap di dalam kolomnya sendiri", () => {
    // Kolom tersempit yang dipakai: lembar kurva-S, ±3 kolom pada A4 landscape
    // dengan padding — sekitar 200px. Setengah lebar stempel + geserannya harus
    // muat di separuh kolom itu.
    const SETENGAH_KOLOM_TERSEMPIT = 100;
    for (const d of DOKUMEN) {
      const u = ukuran(d.tinggi);
      expect(u.stempel.lebar / 2 + u.geser, d.nama).toBeLessThan(SETENGAH_KOLOM_TERSEMPIT);
    }
  });

  it("stempel benar-benar MENIMPA tanda tangan, tidak berdiri terpisah", () => {
    // Geserannya harus lebih kecil daripada setengah lebar keduanya digabung —
    // kalau lebih, stempel melayang di sebelah kiri seperti gambar nyasar.
    for (const d of DOKUMEN) {
      const u = ukuran(d.tinggi);
      expect(u.geser, d.nama).toBeLessThan(u.stempel.lebar / 2 + u.ttd.lebarMaks / 2);
      // …dan harus lebih besar dari nol, kalau tidak keduanya bertumpuk persis
      // di tengah dan tanda tangannya tertutup.
      expect(u.geser, d.nama).toBeGreaterThan(0);
    }
  });
});
