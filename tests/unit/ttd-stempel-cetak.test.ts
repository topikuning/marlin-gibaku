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

const { BATAS_STEMPEL, PERSEN_STEMPEL, ukuranTtd: ukuran } = await import(
  "@/lib/export/ttd-ukuran"
);

/**
 * Ketujuh penyaji dengan LEBAR KOLOM dan TINGGI CELAH-nya masing-masing, apa
 * adanya dari kodenya (HTML px, PDF poin). `huruf` = ukuran huruf blok tanda
 * tangan di penyaji itu — dipakai membandingkan dengan foto dokumen asli.
 */
const DOKUMEN = [
  { nama: "html: lembar kurva-S", lebar: 200, celah: 40, huruf: 8.5 },
  { nama: "html: laporan harian", lebar: 350, celah: 48, huruf: 10 },
  { nama: "html: laporan periodik", lebar: 280, celah: 48, huruf: 10 },
  { nama: "html: rencana mingguan", lebar: 280, celah: 56, huruf: 10 },
  { nama: "pdf: laporan periodik", lebar: 256, celah: 32, huruf: 7.5 },
  { nama: "pdf: laporan harian", lebar: 265, celah: 34, huruf: 7 },
  { nama: "pdf: rencana mingguan", lebar: 176, celah: 40, huruf: 7.5 },
];

describe("ukuran stempel — acuannya LEBAR KOLOM, bukan tinggi celah (DECISIONS 330)", () => {
  it("stempel jauh lebih besar daripada celah tanda tangannya", () => {
    // Inti koreksi user: *"kenapa makin kecil, bukan makin mengikuti contoh!"*
    // Versi 328/329 menskalakan dari tinggi celah, sehingga stempel SELALU
    // lebih kecil daripada celah itu. Di dokumen asli justru sebaliknya:
    // stempel membentang jauh melewati celahnya.
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.stempel.tinggi, d.nama).toBeGreaterThan(d.celah * 1.5);
    }
  });

  it("garis tengah stempel ±9–14× tinggi huruf, seperti foto dokumen asli", () => {
    // Diukur dari foto yang dikirim user: stempel ≈ 280 px dengan huruf ≈ 26 px
    // → ±10,8×. Rentang ini yang membuat "mengikuti contoh" jadi angka, bukan
    // selera.
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      const kali = u.stempel.tinggi / d.huruf;
      expect(kali, `${d.nama} (${kali.toFixed(1)}× huruf)`).toBeGreaterThan(9);
      expect(kali, `${d.nama} (${kali.toFixed(1)}× huruf)`).toBeLessThan(14);
    }
  });

  it("stempel + geserannya tidak pernah keluar dari kolomnya", () => {
    // Batas keras: keluar kolom berarti menabrak blok tanda tangan sebelah.
    //
    // Sengaja diuji juga pada kolom SANGAT SEMPIT. Pada ketujuh dokumen nyata,
    // rem tinggi-celah selalu memotong lebih dulu sehingga aturan lebar tidak
    // pernah teruji di sana — versi pertama uji ini lolos bahkan ketika stempel
    // disetel selebar penuh kolom.
    const kasus = [
      ...DOKUMEN.map((d) => ({ nama: d.nama, lebar: d.lebar, celah: d.celah })),
      { nama: "kolom sangat sempit", lebar: 90, celah: 48 },
      { nama: "kolom sempit, celah tinggi", lebar: 120, celah: 90 },
    ];
    for (const d of kasus) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.stempel.lebar / 2 + u.geser, d.nama).toBeLessThanOrEqual(d.lebar / 2);
    }
  });

  it("kolom yang makin lebar TIDAK membuat stempel melar tanpa batas", () => {
    // Rem `BATAS_STEMPEL` harus benar-benar menggigit; tanpa itu kolom lebar di
    // layar menghasilkan stempel sebesar setengah halaman.
    const sempit = ukuran(200, 48);
    const lebar = ukuran(2000, 48);
    expect(lebar.stempel.tinggi).toBe(Math.round(48 * BATAS_STEMPEL));
    expect(lebar.stempel.tinggi).toBeGreaterThanOrEqual(sempit.stempel.tinggi);
  });

  it("kolom sempit dilayani persen lebar, bukan rem", () => {
    // Sisi lain dari aturan yang sama: pada kolom sempit yang menentukan adalah
    // LEBAR KOLOMNYA, supaya stempel tidak menabrak tetangganya — walau remnya
    // sebenarnya mengizinkan lebih besar.
    const lebar = 100;
    const celah = 90; // rem mengizinkan 207 — jauh lebih besar dari kolomnya
    const u = ukuran(lebar, celah);
    expect(u.stempel.lebar).toBeLessThan(Math.round(celah * BATAS_STEMPEL));
    expect(u.stempel.lebar).toBe(Math.round((lebar * PERSEN_STEMPEL) / 100));
  });
});

describe("bentuk & letak", () => {
  it("stempel BUNDAR — lebar sama dengan tingginya", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.stempel.lebar, d.nama).toBe(u.stempel.tinggi);
    }
  });

  it("coretan tanda tangan lebih LEBAR tapi lebih RENDAH daripada stempel", () => {
    // Benda aslinya: stempel bundar ±4 cm; coretan ±5–6 cm × ±3 cm.
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.ttd.lebar, d.nama).toBeGreaterThan(u.stempel.lebar);
      expect(u.ttd.tinggi, d.nama).toBeLessThan(u.stempel.tinggi);
    }
  });

  it("coretan memanjang, bukan bujur sangkar", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.ttd.lebar / u.ttd.tinggi, d.nama).toBeGreaterThan(1.5);
    }
  });

  it("stempel TURUN sedikit melewati garis pijak — menimpa baris nama", () => {
    // Di foto asli sisi bawah stempel menutupi nama penanda tangan. Nol berarti
    // ia berhenti rapi di garis, dan itu yang terbaca sebagai gambar tempelan.
    for (const d of DOKUMEN) {
      expect(ukuran(d.lebar, d.celah).turun, d.nama).toBeGreaterThan(0);
    }
  });

  it("turunnya kecil — tidak menelan baris nama", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.turun, d.nama).toBeLessThan(u.stempel.tinggi / 8);
    }
  });

  it("stempel digeser ke kiri supaya MENIMPA coretan, bukan berdiri terpisah", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.celah);
      expect(u.geser, d.nama).toBeGreaterThan(0);
      // Kalau geseran melebihi setengah lebar gabungan, keduanya berpisah.
      expect(u.geser, d.nama).toBeLessThan(u.stempel.lebar / 2 + u.ttd.lebar / 2);
    }
  });
});
