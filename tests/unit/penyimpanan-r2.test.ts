// PEMBERSIHAN PENYIMPANAN: DAFTARNYA DIHITUNG DI SERVER, TIDAK DITERIMA DARI LAYAR.
//
// Teguran user 2026-09-09 atas jawaban pertama yang berupa perintah terminal:
// *"sejak kapan harus buka console lalu harus jalankan perintah itu! kalau kamu
// ngasih solusi yang praktis!"*. Jadi audit + pembersihan pindah ke layar
// Sistem — dan begitu ia jadi tombol, dua cacat muncul yang tidak ada pada
// skrip:
//
// 1. Layar hanya memegang 50 yatim TERBESAR. Kalau daftar itu yang dikirim,
//    tombol "hapus 5.000 obyek" diam-diam cuma menghapus 50 — dan orang akan
//    menekannya berulang kali sambil bertanya kenapa angkanya tidak turun.
// 2. Daftar dari peramban bisa BASI. Foto yang diunggah sesudah pemeriksaan
//    belum diketahui layar; menghapusnya berarti menghapus foto lapangan yang
//    baru saja masuk — dan R2 satu-satunya salinannya.
//
// Keduanya hilang dengan satu aturan: `bersihkanPenyimpananAction()` TIDAK
// menerima parameter. Yatimnya dihitung ulang pada detik penghapusan.
//
// Yang dijaga di sini BENTUK kodenya. Menguji perilakunya menuntut R2 sungguhan
// (uji integrasi tidak punya bucket), sementara bentuk inilah yang dulu salah
// dan yang paling gampang salah lagi saat seseorang "menambah opsi hapus
// terpilih".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const aksi = readFileSync(new URL("../../src/lib/system/actions.ts", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../../src/app/(app)/sistem/penyimpanan-panel.tsx", import.meta.url),
  "utf8",
);
const halaman = readFileSync(new URL("../../src/app/(app)/sistem/page.tsx", import.meta.url), "utf8");
const audit = readFileSync(new URL("../../src/lib/r2-audit.ts", import.meta.url), "utf8");

describe("pembersihan penyimpanan R2", () => {
  it("aksinya tidak menerima daftar kunci dari klien", () => {
    expect(aksi).toContain("export async function bersihkanPenyimpananAction(): Promise<BersihkanR2State>");
  });

  it("yatimnya dihitung ulang di server sebelum menghapus", () => {
    const badan = aksi.slice(aksi.indexOf("bersihkanPenyimpananAction"));
    expect(badan).toContain("kunciYatim");
    // Urutannya penting: hitung dulu, baru hapus. Yang dibandingkan PEMANGGILAN
    // `r2Delete(k)`, bukan barisnya di-import (import selalu lebih dulu).
    expect(badan.indexOf("await kunciYatim()")).toBeLessThan(badan.indexOf("await r2Delete(k)"));
  });

  it("penghapusan dijaga capability + dicatat audit", () => {
    const badan = aksi.slice(
      aksi.indexOf("bersihkanPenyimpananAction"),
      aksi.indexOf("bersihkanPenyimpananAction") + 2000,
    );
    expect(badan).toContain('requireCapability("system.manage")');
    expect(badan).toContain('audit(actor.id, "system.r2_cleanup"');
  });

  it("pemeriksaan pun dijaga capability + dicatat audit", () => {
    const badan = aksi.slice(aksi.indexOf("auditPenyimpananAction"));
    expect(badan).toContain('requireCapability("system.manage")');
    expect(badan).toContain('audit(actor.id, "system.r2_audit"');
  });
});

describe("panel di layar Sistem", () => {
  it("memanggil aksi hapus TANPA argumen", () => {
    expect(panel).toContain("bersihkanPenyimpananAction()");
    // Bentuk lama yang salah: mengirim 50 kunci teratas dari layar.
    expect(panel).not.toMatch(/bersihkanPenyimpananAction\(\s*hasil/);
  });

  it("meminta konfirmasi sebelum menghapus", () => {
    expect(panel).toContain("mintaKonfirmasi");
    expect(panel).toContain("Ya, hapus sekarang");
  });

  it("terpasang di halaman /sistem, bukan cuma ada berkasnya", () => {
    // Komponen yang tidak dirender sama saja dengan tidak ada – dan itu persis
    // keluhan yang memulai perubahan ini.
    expect(halaman).toContain('from "./penyimpanan-panel"');
    // Dicocokkan per-bagian, bukan sebagai satu baris utuh: menambah prop baru
    // (mis. `fotoHeic`) bukan kerusakan, dan uji yang merah karenanya cuma
    // menyuruh orang menyalin ulang string tanpa memeriksa apa pun.
    expect(halaman).toMatch(/<PenyimpananPanel[^>]*configured=\{r2On\}/);
  });
});

describe("penentuan yatim", () => {
  it("daftar kolom rujukan DIPUNGUT dari skema, tidak ditulis tangan", () => {
    // Kalau ditulis tangan, satu kolom baru yang lupa didaftarkan membuat
    // ribuan berkas HIDUP terbaca "sampah".
    expect(audit).toContain("information_schema.columns");
    expect(audit).toContain("column_name ILIKE '%key%'");
  });

  it("nilai app_settings ikut dihitung sebagai rujukan", () => {
    // Logo pemilik disimpan sebagai setelan, bukan kolom ber-"key".
    expect(audit).toContain("FROM app_settings");
  });

  it("melaporkan juga rujukan yang MENGGANTUNG (berkas hilang)", () => {
    expect(audit).toContain("rujukanMenggantung");
    expect(audit).toContain("rujukanHilang");
  });
});
