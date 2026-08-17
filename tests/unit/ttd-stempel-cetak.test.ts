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

const { PERSEN_STEMPEL, ukuranTtd: ukuran } = await import("@/lib/export/ttd-ukuran");

/**
 * Ketujuh penyaji: LEBAR KOLOM tanda tangan dan RUANG dari tepi atas blok
 * sampai garis nama, apa adanya dari kodenya (HTML px, PDF poin). `huruf` =
 * ukuran huruf blok itu — dipakai membandingkan dengan foto dokumen asli.
 */
const DOKUMEN = [
  { nama: "html: lembar kurva-S", lebar: 200, ruang: 72, huruf: 8.5 },
  { nama: "html: laporan harian", lebar: 350, ruang: 84, huruf: 10 },
  { nama: "html: laporan periodik", lebar: 280, ruang: 84, huruf: 10 },
  { nama: "html: rencana mingguan", lebar: 280, ruang: 88, huruf: 10 },
  { nama: "pdf: laporan periodik", lebar: 256, ruang: 68, huruf: 7.5 },
  { nama: "pdf: laporan harian", lebar: 265, ruang: 70, huruf: 7 },
  { nama: "pdf: rencana mingguan", lebar: 176, ruang: 72, huruf: 7.5 },
];

describe("stempel TIDAK PERNAH melebihi blok tanda tangannya (DECISIONS 333)", () => {
  it("tinggi stempel ≤ ruang dari tepi atas blok sampai garis nama", () => {
    // Keberatan user, dengan tangkapan layar: *"stempelmu jangan melebihi
    // areanya tandatangannya, itu memakan tabel juga."* Versi 330 memakai
    // 2,3 × ruang, sehingga stempel melimpah ke ATAS menembus tabel di
    // atasnya. Ini invarian yang paling penting di berkas ini.
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.stempel.tinggi, d.nama).toBeLessThanOrEqual(d.ruang);
    }
  });

  it("berlaku juga untuk kolom yang sangat lebar", () => {
    // Kolom lebar tidak boleh membuat stempel melar melewati bloknya —
    // aturan lebar dan aturan ruang keduanya mengikat.
    const u = ukuran(4000, 70);
    expect(u.stempel.tinggi).toBeLessThanOrEqual(70);
  });

  it("coretan tanda tangan juga tetap di dalam bloknya", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.ttd.tinggi, d.nama).toBeLessThanOrEqual(d.ruang);
    }
  });

  it("stempel + turunnya masih di dalam blok", () => {
    // Sisi bawah boleh menimpa baris nama sedikit (dokumen aslinya begitu),
    // tapi sisi ATAS tidak boleh keluar: tinggi + turun ≤ ruang + turun.
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.stempel.tinggi - u.turun, d.nama).toBeLessThanOrEqual(d.ruang);
    }
  });
});

describe("ukuran stempel tetap sepadan dokumen asli", () => {
  it("garis tengah stempel ±8–12× tinggi huruf", () => {
    // Foto dokumen asli: stempel ≈ 280 px dengan huruf ≈ 26 px → ±10,8×.
    // Rentang ini yang membuat "mengikuti contoh" jadi angka, bukan selera.
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      const kali = u.stempel.tinggi / d.huruf;
      expect(kali, `${d.nama} (${kali.toFixed(1)}× huruf)`).toBeGreaterThan(8);
      expect(kali, `${d.nama} (${kali.toFixed(1)}× huruf)`).toBeLessThan(12);
    }
  });

  it("stempel + geserannya tidak pernah keluar dari kolomnya", () => {
    const kasus = [
      ...DOKUMEN.map((d) => ({ nama: d.nama, lebar: d.lebar, ruang: d.ruang })),
      { nama: "kolom sangat sempit", lebar: 90, ruang: 84 },
      { nama: "kolom sempit, ruang tinggi", lebar: 120, ruang: 200 },
    ];
    for (const d of kasus) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.stempel.lebar / 2 + u.geser, d.nama).toBeLessThanOrEqual(d.lebar / 2);
    }
  });

  it("kolom sempit dilayani persen lebar, bukan ruang", () => {
    const lebar = 100;
    const ruang = 200; // ruang mengizinkan jauh lebih besar dari kolomnya
    const u = ukuran(lebar, ruang);
    expect(u.stempel.lebar).toBe(Math.round((lebar * PERSEN_STEMPEL) / 100));
  });
});

describe("bentuk & letak", () => {
  it("stempel BUNDAR — lebar sama dengan tingginya", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.stempel.lebar, d.nama).toBe(u.stempel.tinggi);
    }
  });

  it("coretan lebih LEBAR tapi lebih RENDAH daripada stempel", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.ttd.lebar, d.nama).toBeGreaterThan(u.stempel.lebar);
      expect(u.ttd.tinggi, d.nama).toBeLessThan(u.stempel.tinggi);
    }
  });

  it("coretan memanjang, bukan bujur sangkar", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.ttd.lebar / u.ttd.tinggi, d.nama).toBeGreaterThan(1.5);
    }
  });

  it("stempel TURUN sedikit menimpa baris nama, tapi tidak menelannya", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.turun, d.nama).toBeGreaterThan(0);
      expect(u.turun, d.nama).toBeLessThan(u.stempel.tinggi / 8);
    }
  });

  it("stempel digeser ke kiri supaya MENIMPA coretan, bukan berdiri terpisah", () => {
    for (const d of DOKUMEN) {
      const u = ukuran(d.lebar, d.ruang);
      expect(u.geser, d.nama).toBeGreaterThan(0);
      expect(u.geser, d.nama).toBeLessThan(u.stempel.lebar / 2 + u.ttd.lebar / 2);
    }
  });
});
