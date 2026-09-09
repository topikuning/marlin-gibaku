// HEIC iPHONE HARUS JADI WEBP BER-CAP, BUKAN DISIMPAN MENTAH.
//
// Laporan user 2026-09-09, dengan tangkapan layar Activity Centre: *"lihat pada
// besole ada 2 foto tidak bisa diakses"* — padahal berkasnya ada, dan URL
// presign-nya jalan. Kuncinya yang membocorkan sebabnya:
//
//     photos/knmp-besole-tulungagung/2026-09-08/d38eb2d2-….heic
//
// Jalur normal SELALU menghasilkan `.webp`; `.heic` hanya lahir dari jalur
// cadangan "simpan gambar asli" di `processWithSharpOrOriginal`.
//
// Sebabnya libvips bawaan sharp: ia membaca WADAH HEIF tapi tidak punya dekoder
// HEVC-nya. Yang menipu — dan yang sempat membuat diagnosis pertama meleset —
// `sharp(buf).metadata()` BERHASIL menyebut "heif 1280x854", sebab ia cuma
// membaca header. Barulah saat pikselnya diminta:
//
//     heif: Error while loading plugin: Support for this compression format
//     has not been built in
//
// Akibatnya tiga, dan yang ketiga paling serius: petaknya kosong di peramban
// non-Safari, thumbnail tidak dibuat, dan fotonya TIDAK BER-CAP Timemark —
// jadi ia gagal sebagai bukti lapangan, bukan cuma jelek dipandang.
//
// Berkas uji di sini HEVC sungguhan (`hvc1`), bukan AVIF yang kebetulan
// berekstensi .heic — kalau dipakai AVIF, uji ini akan hijau tanpa membuktikan
// apa pun, sebab AVIF memang sudah terbaca libvips.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { bentukHeif, processWithSharpOrOriginal } = await import("@/lib/photos");
type PhotoStamp = import("@/lib/photos").PhotoStamp;

const HEIC = readFileSync(new URL("../fixtures/contoh-hevc.heic", import.meta.url));
const JPG = readFileSync(new URL("../fixtures/IMG20260801WA0035.jpg", import.meta.url));

const CAP: PhotoStamp = {
  takenAt: new Date("2026-09-08T07:55:00+07:00"),
  lat: -8.1234,
  lng: 111.9876,
  locationLabel: "BESOLE",
  companyName: "UJI",
  reporterName: "Mandor",
};

describe("pengenalan bentuk HEIF", () => {
  it("mengenali berkas HEIC dari kotak ftyp-nya, bukan dari namanya", () => {
    // Nama berkas bisa bohong (WhatsApp mengganti ekstensi); byte tidak.
    expect(bentukHeif(HEIC)).toBe(true);
  });

  it("JPEG tidak salah dikira HEIF", () => {
    expect(bentukHeif(JPG)).toBe(false);
  });

  it("berkas terpotong tidak membuatnya menebak", () => {
    expect(bentukHeif(HEIC.subarray(0, 6))).toBe(false);
    expect(bentukHeif(Buffer.alloc(0))).toBe(false);
  });
});

describe("HEIC HEVC lewat pipeline foto", () => {
  it("keluar sebagai webp, bukan disimpan mentah sebagai .heic", async () => {
    // SEBELUM perbaikan: ext "heic", contentType "image/heic", thumb null,
    // width/height null — persis foto Besole yang petaknya kosong.
    const hasil = await processWithSharpOrOriginal(HEIC, CAP, {
      name: "IMG_1234.heic",
      type: "image/heic",
    });
    expect(hasil.ext).toBe("webp");
    expect(hasil.contentType).toBe("image/webp");
    expect(hasil.main.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(hasil.main.subarray(8, 12).toString("latin1")).toBe("WEBP");
  }, 60_000);

  it("ukurannya terbaca dan gambarnya menyusut, bukan disalin apa adanya", async () => {
    const hasil = await processWithSharpOrOriginal(HEIC, CAP, {
      name: "IMG_1234.heic",
      type: "image/heic",
    });
    expect(hasil.width).toBe(1280);
    expect(hasil.height).toBe(854);
    // Bukan byte aslinya yang diteruskan.
    expect(hasil.main.length).toBeLessThan(HEIC.length);
  }, 60_000);

  it("thumbnail ikut dibuat – grid tidak lagi memuat gambar penuh", async () => {
    const hasil = await processWithSharpOrOriginal(HEIC, CAP, {
      name: "IMG_1234.heic",
      type: "image/heic",
    });
    expect(hasil.thumb, "thumbnail tidak dibuat").not.toBeNull();
    expect(hasil.thumb!.length).toBeLessThan(hasil.main.length);
  }, 60_000);
});

describe("jalur lama tidak ikut berubah", () => {
  it("JPEG tetap diproses seperti biasa", async () => {
    // Dekoder HEIC hanya boleh menyentuh berkas HEIF, dan hanya SESUDAH sharp
    // gagal. Kalau ia ikut campur di jalur biasa, seluruh unggahan melambat.
    const hasil = await processWithSharpOrOriginal(JPG, CAP, {
      name: "IMG20260801WA0035.jpg",
      type: "image/jpeg",
    });
    expect(hasil.ext).toBe("webp");
    expect(hasil.width).toBeGreaterThan(0);
  }, 60_000);

  it("berkas yang bukan gambar tetap jatuh ke simpan-asli", async () => {
    const sampah = Buffer.from("ini bukan gambar sama sekali", "utf8");
    const hasil = await processWithSharpOrOriginal(sampah, CAP, { name: "catatan.txt", type: "text/plain" });
    expect(hasil.main).toBe(sampah);
    expect(hasil.thumb).toBeNull();
  }, 30_000);
});

// ── Perbaikan foto yang TERLANJUR masuk sebagai HEIC ──────────────────────
//
// Dekoder baru hanya menolong unggahan BERIKUTNYA. Foto Besole yang sudah
// tersimpan tidak berubah sendiri — tetap tak terbaca peramban, tetap tanpa cap.
// Yang dijaga di bawah bentuk kodenya: perilakunya menuntut R2 + DB sungguhan,
// sementara justru bentuk inilah yang gampang salah saat seseorang merapikannya.
describe("perbaikan foto HEIC yang sudah tersimpan", () => {
  const aksi = readFileSync(new URL("../../src/lib/photo-restamp/actions.ts", import.meta.url), "utf8");
  const badan = aksi.slice(aksi.indexOf("perbaikiFotoHeicAction"));

  it("memilih foto dari KUNCI R2-nya, bukan dari mimeType", () => {
    // `mimeType` merekam apa yang dikirim peramban; yang menentukan sebuah foto
    // bisa ditampilkan atau tidak adalah apa yang benar-benar ada di bucket.
    expect(badan).toContain('r2Key: { endsWith: ".heic" }');
    expect(badan).toContain('r2Key: { endsWith: ".heif" }');
  });

  it("dijaga capability + dicatat audit", () => {
    expect(badan).toContain('requireCapability("photo.restamp")');
    expect(badan).toContain('audit(actor.id, "photo.heic_repair"');
  });

  it("tidak mengarang nilai cap – dipakai apa adanya dari yang tersimpan", () => {
    // Ini perbaikan TEKNIS, bukan koreksi manusia: kalau nilainya ikut berubah,
    // riwayat cap berbohong tentang siapa yang mengubah apa.
    expect(badan).toContain("stampDariNilai(k.saatIni)");
    expect(badan).toContain("manualFields: []");
  });

  it("menolak menukar kunci bila hasilnya masih bukan webp", () => {
    // Tanpa ini, foto yang tetap tak terbaca akan ditandai "sudah diperbaiki".
    expect(badan).toContain('processed.ext !== "webp"');
  });

  it("arsip berkas asli TIDAK ikut dihapus", () => {
    // DECISIONS 197: arsip asli satu-satunya rujukan keaslian foto.
    expect(badan).toContain("kunciLama !== k.originalKey");
  });
});
