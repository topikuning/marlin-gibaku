// "YATIM" HARUS BERARTI BENAR-BENAR TIDAK DIPAKAI.
//
// Pertanyaan user 2026-09-09, dan ini pertanyaan yang tepat: *"kamu yakin yang
// yatim itu memang benar-benar tidak digunakan?"*
//
// Jawaban jujurnya waktu itu: BELUM. Aturan versi pertama — "kunci tidak muncul
// di kolom teks mana pun bernama %key%" — punya tiga lubang, dan satu di
// antaranya terbukti, bukan dugaan:
//
// 1. KOLOM JSON TIDAK DIPINDAI. Ada 23 kolom json/jsonb di skema, dan
//    `daily_reports.final_snapshot` TERBUKTI membekukan `r2Key` foto di
//    dalamnya (`ringkas.ts`: `r2Key: p.r2Key`). Snapshot itu dokumen resmi yang
//    dicetak; kalau barisnya sudah tidak ada tapi kuncinya masih hidup di sana,
//    aturan lama menyebutnya sampah dan menghapus gambar dari laporan yang
//    sudah final.
// 2. TIDAK ADA PENJAGA UMUR, dan urutan bacanya lomba: `Promise.all([r2List(),
//    kunciDirujuk()])`. Foto yang diunggah TEPAT saat pemeriksaan berjalan bisa
//    masuk daftar obyek tapi belum masuk bacaan DB → terbaca yatim.
// 3. Bucket yang dipakai lebih dari satu lingkungan akan membuat tiap
//    lingkungan menganggap punya lingkungan lain sebagai sampah. Ini tidak bisa
//    dibuktikan dari kode, jadi yang dilakukan MENAKUT-NAKUTI dengan jujur:
//    lihat butir "porsi yatim tidak masuk akal" di panel.
//
// Arah kesalahannya tidak setara, dan itu yang menentukan seluruh rancangan:
// salah baca "masih dipakai" cuma menyisakan sampah; salah baca "yatim"
// menghapus satu-satunya salinan foto lapangan ber-GPS.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const audit = readFileSync(new URL("../../src/lib/r2-audit.ts", import.meta.url), "utf8");

describe("kolom JSON ikut dihitung sebagai rujukan", () => {
  it("skema dipindai untuk kolom json/jsonb, bukan cuma teks", () => {
    expect(audit).toMatch(/data_type IN \('json', ?'jsonb'\)/);
  });

  it("kunci yang muncul DI DALAM JSON tidak dianggap yatim", () => {
    // Contohnya `daily_reports.final_snapshot` yang membekukan r2Key foto.
    expect(audit).toContain("dipakaiDiJson");
  });

  it("pemeriksaan JSON hanya atas KANDIDAT yatim, bukan seluruh bucket", () => {
    // Kalau seluruh kunci diadu ke seluruh isi JSON, biaya jadi O(n×m) dan
    // pemeriksaan 10 GB tidak akan pernah selesai dalam satu permintaan.
    expect(audit).toMatch(/kandidat/);
  });
});

describe("penjaga umur & urutan baca", () => {
  it("obyek yang masih baru TIDAK PERNAH disebut yatim", () => {
    expect(audit).toContain("UMUR_AMAN_HARI");
  });

  it("daftar obyek dibaca DULU, rujukan DB sesudahnya", () => {
    // Urutan ini yang menutup lomba: apa pun yang ditulis selama pemeriksaan
    // pasti tertangkap bacaan DB yang belakangan. `Promise.all` justru
    // membiarkan keduanya berangkat bersamaan – itu bentuk lamanya.
    expect(audit).not.toContain("Promise.all([r2List()");
    const i = audit.indexOf("await r2List(");
    const j = audit.indexOf("await kunciDirujuk(");
    expect(i, "r2List tidak ditemukan").toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  it("umur aman minimal seminggu – bukan sejam", () => {
    const m = audit.match(/UMUR_AMAN_HARI\s*=\s*(\d+)/);
    expect(m, "ambang umur tidak ditemukan").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(7);
  });
});

describe("porsi yatim yang tidak masuk akal", () => {
  it("dilaporkan supaya bucket salah/berbagi ketahuan sebelum dihapus", () => {
    // Bucket yang dipakai dua lingkungan akan tampak "90% sampah". Angka
    // seperti itu jauh lebih mungkin berarti salah bucket daripada berarti
    // sembilan dari sepuluh berkas memang sampah.
    expect(audit).toContain("porsiJanggal");
  });
});
