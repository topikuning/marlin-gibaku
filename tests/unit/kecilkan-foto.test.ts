// MENGECILKAN FOTO: DITAWARKAN, TIDAK PERNAH DIAM-DIAM.
//
// Permintaan user 2026-09-03: *"seharusnya, kalau kamu memang bisa mengecilkan
// ukuran, ketika besar kamu menawarkan user apakah mau kompress, kalau iya,
// kamu kompres. itu kan ux yang ramah."*
//
// Dua hal dijaga di sini, dan keduanya bisa rusak tanpa satu pun uji lain
// berubah merah:
//
//  1. yang ditawari pengecilan HANYA yang memang melewati batas — menawarkan
//     pada foto 3 MB berarti mengajak merusak bukti tanpa sebab;
//  2. hasilnya benar-benar LEBIH KECIL dan cukup kecil — "mengecilkan" yang
//     membesarkan adalah kegagalan yang paling mudah lolos, sebab tombolnya
//     tetap terlihat bekerja.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAX_PHOTO_BYTES } from "@/lib/photo-limits";
import {
  SASARAN_KECIL_BYTE,
  SISI_TERPANJANG_PX,
  TANGGA_MUTU,
  hasilnyaCukup,
  mbFoto,
  namaHasil,
  perluDikecilkan,
  ukuranHasil,
} from "@/lib/photo-kecilkan";

const MB = 1024 * 1024;

describe("siapa yang ditawari pengecilan", () => {
  it("hanya yang melewati batas per-foto", () => {
    expect(perluDikecilkan(MAX_PHOTO_BYTES + 1)).toBe(true);
    expect(perluDikecilkan(MAX_PHOTO_BYTES)).toBe(false);
    expect(perluDikecilkan(3 * MB)).toBe(false);
  });
});

describe("sasaran hasil", () => {
  it("sasarannya DI BAWAH batas, bukan tepat di batasnya", () => {
    // `toBlob` tidak bisa diramalkan sampai byte terakhir; hasil yang mendarat
    // di 25,1 MB berarti seluruh usaha itu sia-sia.
    expect(SASARAN_KECIL_BYTE).toBeLessThan(MAX_PHOTO_BYTES);
  });

  it("masih jauh di atas kebutuhan bukti lapangan", () => {
    expect(SASARAN_KECIL_BYTE).toBeGreaterThanOrEqual(8 * MB);
    expect(SISI_TERPANJANG_PX).toBeGreaterThanOrEqual(2000);
  });

  it("tangga mutunya menurun, dan tidak sampai merusak", () => {
    for (let i = 1; i < TANGGA_MUTU.length; i++) {
      expect(TANGGA_MUTU[i]!).toBeLessThan(TANGGA_MUTU[i - 1]!);
    }
    expect(Math.min(...TANGGA_MUTU)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...TANGGA_MUTU)).toBeLessThanOrEqual(0.95);
  });
});

describe("ukuran hasil", () => {
  it("sisi terpanjang dibatasi, rasio dipertahankan", () => {
    const r = ukuranHasil(12000, 9000);
    expect(Math.max(r.lebar, r.tinggi)).toBe(SISI_TERPANJANG_PX);
    // 4:3 tetap 4:3 (toleransi pembulatan satu piksel).
    expect(Math.abs(r.lebar / r.tinggi - 12000 / 9000)).toBeLessThan(0.01);
  });

  it("potret ditangani sama seperti lanskap", () => {
    const r = ukuranHasil(3000, 9000);
    expect(r.tinggi).toBe(SISI_TERPANJANG_PX);
    expect(r.lebar).toBe(1000);
  });

  it("foto yang sudah kecil TIDAK diperbesar", () => {
    // Memperbesar tidak menambah satu pun detail, cuma menambah byte –
    // kebalikan dari yang diminta.
    expect(ukuranHasil(800, 600)).toEqual({ lebar: 800, tinggi: 600 });
  });

  it("tidak pernah menghasilkan sisi nol", () => {
    const r = ukuranHasil(10000, 3);
    expect(r.lebar).toBeGreaterThan(0);
    expect(r.tinggi).toBeGreaterThan(0);
  });
});

describe("kapan hasil percobaan diterima", () => {
  it("harus cukup kecil DAN lebih kecil dari aslinya", () => {
    expect(hasilnyaCukup(5 * MB, 30 * MB)).toBe(true);
    // Cukup kecil tapi MEMBESAR – ditolak. JPEG bermutu tinggi atas sumber
    // yang sudah terkompresi baik bisa membengkak.
    expect(hasilnyaCukup(5 * MB, 4 * MB)).toBe(false);
    // Lebih kecil tapi masih di atas sasaran – ditolak.
    expect(hasilnyaCukup(20 * MB, 30 * MB)).toBe(false);
  });
});

describe("nama & angka yang dilihat orang", () => {
  it("nama hasil menyebut bahwa ia sudah dikecilkan, tidak menyamar", () => {
    expect(namaHasil("IMG_2031.HEIC")).toBe("IMG_2031-kecil.jpg");
    expect(namaHasil("tanpa-ekstensi")).toBe("tanpa-ekstensi-kecil.jpg");
  });

  it("MB ditulis dengan koma, kebiasaan Indonesia", () => {
    expect(mbFoto(26 * MB)).toBe("26,0");
    expect(mbFoto(1.5 * MB)).toBe("1,5");
  });
});

describe("pengecilan tidak pernah berjalan tanpa diminta", () => {
  it("hanya dipanggil dari penangan ketukan, bukan dari efek atau saat memilih", () => {
    // Foto adalah BUKTI. Mengubahnya – sekalipun cuma ukurannya – keputusan
    // yang bukan milik program. Kalau `kecilkanFoto` suatu saat dipanggil di
    // dalam `tumpuk` atau sebuah `useEffect`, ia berubah jadi otomatis tanpa
    // satu pun uji lain berubah merah.
    const src = readFileSync("src/components/knmp/photo-source-input.tsx", "utf8");
    const i = src.indexOf("const kecilkanSemua");
    expect(i).toBeGreaterThan(-1);

    // Satu-satunya pemanggil `kecilkanFoto` adalah `kecilkanSemua`.
    const pemanggil = [...src.matchAll(/kecilkanFoto\(/g)].map((m) => m.index!);
    const akhirFungsi = src.indexOf("const tolakTawaran");
    expect(akhirFungsi).toBeGreaterThan(i);
    for (const p of pemanggil) {
      if (src.slice(0, p).includes("import")) {
        // lewati baris impor
        if (p < src.indexOf("export function PhotoSourceInput")) continue;
      }
      expect(p).toBeGreaterThan(i);
      expect(p).toBeLessThan(akhirFungsi);
    }

    // Dan `kecilkanSemua` dipasang pada onClick, bukan useEffect.
    expect(src).toContain("onClick={kecilkanSemua}");
    expect(src).not.toMatch(/useEffect\([^)]*kecilkanSemua/);
  });

  it("tidak merakit DataTransfer sendiri – itu bisa MELEMPAR di ponsel", () => {
    // Ditemukan CI 2026-09-03 lewat penjaga `galat-klien`: rancangan pertama
    // `kecilkanSemua` merakit `DataTransfer` untuk menyerahkan hasilnya, dan
    // perakitan itu bisa melempar di peramban ponsel (lihat `rakitGagal`).
    // Lemparan di dalam penangan async = penolakan yang tidak tertangani =
    // tombol yang seolah tidak bekerja, tanpa jejak apa pun.
    //
    // Jalan keluarnya bukan menambah try/catch kedua, melainkan menghapus
    // sebabnya: `tumpuk` menerima `File[]`, jadi tidak ada yang perlu dirakit.
    const src = readFileSync("src/components/knmp/photo-source-input.tsx", "utf8");
    const i = src.indexOf("const kecilkanSemua");
    const akhir = src.indexOf("const tolakTawaran");
    expect(src.slice(i, akhir)).not.toContain("new DataTransfer");
    expect(src).toContain("const tumpuk = (baru: ArrayLike<File>)");
  });

  it("TIDAK ditawarkan di perangkat yang tak bisa menerima berkas ganti", () => {
    // Di jalur `rakitGagal` yang terkirim adalah isi pemilih terakhir apa
    // adanya, jadi berkas HASIL pengecilan tidak akan pernah ikut. Tombol yang
    // tidak bisa menepati janjinya lebih buruk daripada penolakan terus terang.
    const src = readFileSync("src/components/knmp/photo-source-input.tsx", "utf8");
    expect(src).toContain("const bolehTawar = !rakitGagal;");
    expect(src).toContain("setTawaran(bolehTawar ?");
    // Di situ pesan PENUH yang dipakai – yang menyebut ukurannya.
    expect(src).toContain("setPesanBatas(bolehTawar ? batas.pesanSisa : batas.pesan);");
  });
});
