// ARSIP DINGIN BERKAS ASLI: HAPUS HANYA SETELAH TERBUKTI, DAN SETELAH MENUNGGU.
//
// Rancangan yang diberikan user 2026-09-09 (susunan ChatGPT) menaruh Railway
// Volume sebagai persinggahan: unggahan menulis ke disk, pekerja latar
// memindahkannya ke mesin sendiri, dan kalau disknya penuh ada jalur darurat
// balik ke R2. Lima keadaan, dua di antaranya khusus "pembersihan", berkas
// kunci di disk, satu image Docker dan satu service Railway tambahan, dan 14
// variabel lingkungan.
//
// Rancangan yang dipakai membuang Volume-nya. Persinggahannya sudah ada — R2,
// tempat berkas asli memang sudah ditulis sejak dulu. Yang tersisa cuma
// pemindahan di belakang layar, dan bersamanya lenyap: disk penuh, izin berkas,
// urutan resolusi path yang harus sama antara aplikasi dan skrip shell, jalur
// darurat, dan tiga dari lima keadaan.
//
// Yang dijaga berkas ini adalah bagian yang KALAU SALAH TIDAK BISA DIPERBAIKI:
// kapan sebuah berkas boleh dihapus dari tempat asalnya.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { jalurDingin } = await import("@/lib/arsip-asli/dingin");
const { ARSIP_AKTIF_DEFAULT, ARSIP_TENGGANG_DEFAULT } = await import("@/lib/arsip-asli/setelan");

const antrean = readFileSync(new URL("../../src/lib/arsip-asli/antrean.ts", import.meta.url), "utf8");
const dingin = readFileSync(new URL("../../src/lib/arsip-asli/dingin.ts", import.meta.url), "utf8");
const audit = readFileSync(new URL("../../src/lib/r2-audit.ts", import.meta.url), "utf8");
const rute = readFileSync(
  new URL("../../src/app/api/cron/arsip-asli/route.ts", import.meta.url),
  "utf8",
);

describe("kunci arsip tidak bisa dipakai menembus direktori", () => {
  it("kunci yang wajar diterima apa adanya", () => {
    expect(jalurDingin("photos/knmp-besole/2026-09-08/abc-123.asli.jpg")).toBe(
      "photos/knmp-besole/2026-09-08/abc-123.asli.jpg",
    );
  });

  it("jalan ke atas DITOLAK, bukan dibersihkan", () => {
    // Dibersihkan berarti menebak maksud, dan tebakan tidak boleh menentukan
    // berkas mana yang ditimpa di mesin seberang.
    expect(() => jalurDingin("photos/x/2026-01-01/../../../etc/passwd")).toThrow(/tidak berbentuk sah/);
    expect(() => jalurDingin("../rahasia")).toThrow(/tidak berbentuk sah/);
    expect(() => jalurDingin("/etc/passwd")).toThrow(/tidak berbentuk sah/);
  });

  it("kunci di luar ruang foto ditolak", () => {
    expect(() => jalurDingin("documents/2026/rahasia.pdf")).toThrow(/tidak berbentuk sah/);
  });
});

describe("urutan yang tidak boleh terbalik", () => {
  it("berkas dikirim, DIBACA ULANG, baru dicatat", () => {
    const badan = antrean.slice(antrean.indexOf("async function pindahkanSatu"));
    const kirim = badan.indexOf("await kirimDingin(");
    const periksa = badan.indexOf("const cek = await periksaDingin(");
    const catat = badan.indexOf("await tandaiTerarsip(foto.id);\n}");
    expect(kirim).toBeGreaterThan(-1);
    // Percaya balasan PUT saja tidak cukup: yang menentukan aman-tidaknya
    // adalah apa yang bisa dibaca KEMBALI.
    expect(periksa).toBeGreaterThan(kirim);
    expect(catat).toBeGreaterThan(periksa);
  });

  it("sidik jari dicocokkan SEBELUM dikirim", () => {
    const badan = antrean.slice(antrean.indexOf("async function pindahkanSatu"));
    const cocok = badan.indexOf("tidak cocok dengan sidik jari yang tercatat");
    expect(cocok).toBeGreaterThan(-1);
    expect(cocok).toBeLessThan(badan.indexOf("await kirimDingin("));
  });

  it("pengiriman TIDAK menghapus apa pun", () => {
    // Menambah salinan dan mengurangi salinan tidak boleh terjadi dalam satu
    // tarikan napas – satu kesalahan di tengah bisa menghilangkan keduanya.
    const badan = antrean.slice(
      antrean.indexOf("async function pindahkanSatu"),
      antrean.indexOf("async function tandaiTerarsip"),
    );
    expect(badan).not.toContain("r2Delete");
    expect(badan).not.toContain("hapusDingin");
  });

  it("isi berbeda di arsip = BERHENTI, bukan ditimpa", () => {
    expect(antrean).toContain("JANGAN ditimpa");
  });
});

describe("masa tenggang", () => {
  it("bawaannya menunggu, bukan menghapus seketika", () => {
    expect(ARSIP_TENGGANG_DEFAULT).toBeGreaterThanOrEqual(7);
  });

  it("fiturnya MATI sampai dinyalakan orang", () => {
    // Fitur yang memindahkan lalu menghapus berkas tidak boleh menyala sendiri
    // begitu kodenya ter-deploy.
    expect(ARSIP_AKTIF_DEFAULT).toBe(false);
  });

  it("salinan R2 hanya dibuang untuk yang sudah terbukti terarsip", () => {
    const badan = antrean.slice(antrean.indexOf("async function buangSalinanR2Lewat"));
    expect(badan).toContain("originalArchivedAt: { not: null, lte: batas }");
    expect(badan).toContain("originalR2PurgedAt: null");
  });
});

describe("membaca berkas asli dari mana pun ia berada", () => {
  it("selama salinan R2 masih ada, kegagalan arsip TIDAK menggagalkan pekerjaan", () => {
    const badan = antrean.slice(antrean.indexOf("export async function bacaBerkasAsli"));
    expect(badan).toContain("masihDiR2");
    expect(badan).toContain("jangan menggagalkan pekerjaan orang");
  });

  it("kalau salinan R2 sudah dibuang, galatnya menyebut sebabnya", () => {
    const badan = antrean.slice(antrean.indexOf("export async function bacaBerkasAsli"));
    expect(badan).toMatch(/sedang tidak bisa dihubungi/);
  });
});

describe("tidak membangun yang kedua", () => {
  it("pakai CRON_SECRET yang sudah ada, bukan rahasia baru", () => {
    expect(rute).toContain("process.env.CRON_SECRET");
    // Yang dilarang MEMBACA rahasia kedua, bukan menyebutnya: komentar di rute
    // itu justru menjelaskan kenapa rahasia kedua tidak dipakai.
    expect(rute).not.toMatch(/process\.env\.ORIGINAL_ARCHIVE_TRIGGER_SECRET/);
  });

  it("tanpa secret dibalas 404, sama seperti jalur cron lain", () => {
    expect(rute).toContain("status: 404");
    expect(rute).toContain("timingSafeEqual");
  });

  it("otentikasi dipasang di SATU pintu keluar, bukan di tiap pemanggil", () => {
    // Versi pertama menyerahkannya ke pemanggil dan `HEAD` langsung lupa
    // membawanya – pemeriksaan "sudah ada belum" akan dijawab halaman login.
    expect(dingin).toContain("headers: kepala(s, tambahanKepala)");
    // Tepat satu PEMANGGILAN (yang satunya lagi definisi fungsinya sendiri):
    // begitu ada pemanggil kedua, otentikasi punya dua tempat untuk lupa.
    expect(dingin.match(/[^n] kepala\(s/g) ?? []).toHaveLength(1);
  });
});

describe("audit penyimpanan tidak berteriak untuk yang sudah pindah", () => {
  it("berkas asli hanya dituntut ada di R2 selama salinannya belum dibuang", () => {
    // Tanpa ini, tiap berkas yang BERHASIL diarsipkan dilaporkan "hilang".
    expect(audit).toContain('syarat: "original_r2_purged_at IS NULL"');
  });
});

describe("uji sambungan menjawab pertanyaan yang benar", () => {
  const aksi = readFileSync(new URL("../../src/lib/system/actions.ts", import.meta.url), "utf8");
  const badan = aksi.slice(
    aksi.indexOf("export async function ujiArsipAsliAction"),
    aksi.indexOf("function dugaan("),
  );

  it("bolak-balik penuh, bukan sekadar ping", () => {
    // Halaman login Cloudflare Access menjawab 200, dan tunnel ke port kosong
    // menjawab 502 – keduanya tidak terjawab oleh satu GET /sehat.
    for (const langkah of ["kirimDingin(", "periksaDingin(", "ambilDingin(", "hapusDingin("]) {
      expect(badan, `uji sambungan tidak memanggil ${langkah}`).toContain(langkah);
    }
    expect(badan, "byte yang kembali tidak dicocokkan").toContain("kembali.equals(isi)");
  });

  it("berkas uji dibersihkan walau ujinya gagal di tengah", () => {
    expect(badan).toContain("hapusDingin(setelan, kunci).catch(() => {})");
  });

  it("tidak menyentuh foto sungguhan", () => {
    expect(badan).toContain("photos/uji-sambungan/");
    expect(badan).not.toContain("db.photo");
  });

  it("gagalnya menyebut langkah mana yang gagal", () => {
    expect(badan).toContain("GAGAL di langkah ${langkah}");
  });
});
