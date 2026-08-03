// BATAS FOTO — angka yang dipakai penegakan HARUS sama dengan angka yang
// ditampilkan (DECISIONS 229).
//
// Pesan "Foto terlalu besar (maks 8 MB)" pernah ditulis sebagai teks mati
// sementara batasnya konstanta terpisah. Teks seperti itu bertahan setelah
// batasnya berubah, dan pesan yang bohong soal batas membuat orang mengecilkan
// foto sampai ukuran yang sebenarnya tidak perlu.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAX_PHOTO_BYTES, MAX_PHOTO_MB, MAX_PHOTOS_PER_UPLOAD } from "@/lib/photo-limits";

describe("batas ukuran foto", () => {
  it("label MB diturunkan dari byte, bukan ditulis terpisah", () => {
    expect(MAX_PHOTO_MB).toBe(MAX_PHOTO_BYTES / (1024 * 1024));
  });

  it("cukup besar untuk foto HP masa kini (kamera 48+ MP ≈ 10–20 MB)", () => {
    // Batas yang menolak foto yang baru saja dijepret bukan pagar, itu jalan
    // buntu: mandor tidak akan mengecilkan berkas di lapangan, ia akan berhenti
    // melampirkan bukti.
    expect(MAX_PHOTO_BYTES).toBeGreaterThanOrEqual(20 * 1024 * 1024);
  });

  it("pesan penolakan memakai konstanta, tidak menulis angka sendiri", () => {
    const src = readFileSync("src/lib/photos.ts", "utf8");
    expect(src).toContain("maks ${MAX_PHOTO_MB} MB");
    expect(src).not.toMatch(/maks \d+ MB\)/); // tidak ada angka mati tersisa
  });
});

describe("batas jumlah per unggah", () => {
  it("dipakai bersama oleh label klien dan penegakan server", () => {
    const klien = readFileSync("src/components/knmp/photo-source-input.tsx", "utf8");
    expect(klien).toContain("MAX_PHOTOS_PER_UPLOAD");
    // Tidak ada angka mati "maks 6" yang bisa basi diam-diam.
    expect(klien).not.toMatch(/maks(imal)? 6\b/);
    expect(MAX_PHOTOS_PER_UPLOAD).toBeGreaterThan(1);
  });
});
