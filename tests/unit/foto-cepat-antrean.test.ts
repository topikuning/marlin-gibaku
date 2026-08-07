// ANTREAN UNGGAH SAAT JARINGAN JELEK / OFFLINE (DECISIONS 257).
//
// Permintaan user: "lalu perlu solusi juga jika jaringan jelek, atau offline".
//
// Yang dijaga berkas ini adalah dua keputusan yang menentukan apakah bukti
// lapangan selamat atau hilang:
//
//  1. Kegagalan JARINGAN tidak pernah menyerah. Sinyal jelek adalah keadaan
//     NORMAL di lokasi KNMP, bukan kasus tepi; antrean yang menyerah sesudah
//     N percobaan akan membuang foto persis di tempat yang paling butuh.
//  2. Penolakan SERVER berhenti. Foto duplikat akan ditolak seribu kali dengan
//     hasil yang sama — mencobanya terus menghabiskan baterai sambil
//     menyembunyikan sebabnya dari pelapor.
//
// Keduanya cacat senyap kalau terbalik: tidak ada galat, tidak ada layar yang
// berubah, hanya foto yang tidak pernah sampai.
import { describe, expect, it } from "vitest";
import {
  BATAS_KIRIM_MACET_MS,
  BATAS_PUTARAN_MS,
  BATAS_SATU_KIRIM_MS,
  MAKS_ANTREAN,
  bolehCoba,
  kirimMacet,
  putaranDitinggalkan,
  jedaBerikutnya,
  ringkasAntrean,
  statusDariKegagalan,
  type ItemAntrean,
} from "@/lib/foto-cepat/antrean-kebijakan";

const T = 1_700_000_000_000;
const item = (p: Partial<ItemAntrean> = {}): ItemAntrean => ({
  id: "x",
  percobaan: 0,
  terakhirCoba: 0,
  status: "menunggu",
  ...p,
});

describe("jadwal percobaan ulang", () => {
  it("percobaan pertama langsung, tanpa jeda", () => {
    expect(jedaBerikutnya(0)).toBe(0);
  });

  it("naik bertahap", () => {
    expect(jedaBerikutnya(1)).toBeLessThan(jedaBerikutnya(2));
    expect(jedaBerikutnya(2)).toBeLessThan(jedaBerikutnya(3));
  });

  it("MENDATAR, tidak naik tanpa batas", () => {
    // Jeda yang terus berlipat akhirnya jadi berjam-jam — secara praktis sama
    // dengan menyerah, hanya tanpa mengakuinya.
    const jauh = jedaBerikutnya(50);
    expect(jauh).toBe(jedaBerikutnya(5));
    expect(jauh).toBeLessThanOrEqual(300_000);
  });
});

describe("kapan boleh dicoba", () => {
  it("belum pernah dicoba + online → langsung", () => {
    expect(bolehCoba(item(), T, true)).toBe(true);
  });

  it("offline → tunggu, jangan bakar baterai", () => {
    expect(bolehCoba(item(), T, false)).toBe(false);
  });

  it("belum sampai jadwalnya → tunggu", () => {
    const i = item({ percobaan: 2, terakhirCoba: T - 1_000, status: "gagal_jaringan" });
    expect(bolehCoba(i, T, true)).toBe(false);
  });

  it("sudah lewat jadwalnya → coba lagi", () => {
    const i = item({ percobaan: 2, terakhirCoba: T - 999_999, status: "gagal_jaringan" });
    expect(bolehCoba(i, T, true)).toBe(true);
  });

  it("sedang dikirim → jangan dikirim dua kali", () => {
    expect(bolehCoba(item({ status: "kirim" }), T, true)).toBe(false);
  });

  it("gagal jaringan berkali-kali → TETAP dicoba, tidak pernah menyerah", () => {
    // Inti janjinya. Kalau suatu saat ada batas percobaan, uji ini yang
    // menangkapnya — bukan mandor yang kehilangan foto sehari kerja.
    const i = item({ percobaan: 500, terakhirCoba: T - 999_999, status: "gagal_jaringan" });
    expect(bolehCoba(i, T, true)).toBe(true);
  });

  it("DITOLAK server → berhenti, walau sudah lama dan online", () => {
    const i = item({ percobaan: 1, terakhirCoba: T - 999_999, status: "ditolak" });
    expect(bolehCoba(i, T, true)).toBe(false);
  });
});

describe("membedakan sebab kegagalan", () => {
  it("jaringan → dicoba lagi; server → berhenti", () => {
    expect(statusDariKegagalan("jaringan")).toBe("gagal_jaringan");
    expect(statusDariKegagalan("server")).toBe("ditolak");
    expect(bolehCoba(item({ status: statusDariKegagalan("jaringan"), percobaan: 1, terakhirCoba: 0 }), T, true)).toBe(true);
    expect(bolehCoba(item({ status: statusDariKegagalan("server") }), T, true)).toBe(false);
  });
});

describe("ringkasan untuk pelapor", () => {
  it("memisahkan yang masih diperjuangkan dari yang butuh keputusan", () => {
    const r = ringkasAntrean([
      item({ id: "a", status: "menunggu" }),
      item({ id: "b", status: "gagal_jaringan" }),
      item({ id: "c", status: "ditolak" }),
    ]);
    expect(r.menunggu).toBe(2);
    expect(r.ditolak).toBe(1);
    expect(r.perluPerhatian).toBe(true);
  });

  it("antrean kosong tidak memunculkan peringatan apa pun", () => {
    expect(ringkasAntrean([]).perluPerhatian).toBe(false);
  });
});

describe("batas antrean", () => {
  it("ada batasnya, dan tidak absurd", () => {
    // Penyimpanan peramban terbatas. Tanpa batas, jepretan berikutnya hilang
    // diam-diam saat kuota penuh — kegagalan paling buruk yang mungkin di sini.
    expect(MAKS_ANTREAN).toBeGreaterThanOrEqual(50);
    expect(MAKS_ANTREAN).toBeLessThanOrEqual(500);
  });
});

describe("kirimMacet — baris yang kehilangan halamannya", () => {
  // Laporan user 2026-08-07: *"ada yg stuck. sudah coba logout, ganti user,
  // tetap muncul di hp awal. coba ambil foto berhasil terupload langsung, tapi
  // foto yang gantung ini stuck"*.
  //
  // "kirim" adalah SATU-SATUNYA status yang hanya bisa diturunkan oleh halaman
  // yang menyetelnya. Halaman mati di tengah unggahan (tab ditutup, HP
  // terkunci, peramban membunuh halaman latar) → barisnya tinggal bertuliskan
  // "kirim…" selamanya, dan `bolehCoba` menolak menyentuhnya. Logout tidak
  // menolong karena antreannya milik PERANGKAT, bukan sesi.

  const kirimSejak = (lalu: number): ItemAntrean => ({
    id: "x",
    percobaan: 0,
    terakhirCoba: 1_000_000 - lalu,
    status: "kirim",
  });

  it("baris 'kirim' yang masih baru BUKAN macet", () => {
    // Unggahan satu foto di sinyal jelek boleh lama. Membebaskannya terlalu
    // cepat berarti mengirim foto yang sama dua kali.
    expect(kirimMacet(kirimSejak(5_000), 1_000_000)).toBe(false);
    expect(kirimMacet(kirimSejak(BATAS_KIRIM_MACET_MS - 1), 1_000_000)).toBe(false);
  });

  it("baris 'kirim' yang lewat ambang DINYATAKAN macet", () => {
    expect(kirimMacet(kirimSejak(BATAS_KIRIM_MACET_MS), 1_000_000)).toBe(true);
    expect(kirimMacet(kirimSejak(3_600_000), 1_000_000)).toBe(true);
  });

  it("status selain 'kirim' tidak pernah dianggap macet", () => {
    // "ditolak" berhenti karena keputusan server dan butuh orang; membebaskannya
    // otomatis akan mengulang penolakan yang sama tanpa henti.
    for (const status of ["menunggu", "gagal_jaringan", "ditolak"] as const) {
      expect(kirimMacet({ ...kirimSejak(3_600_000), status }, 1_000_000)).toBe(false);
    }
  });

  it("baris macet tetap DITOLAK `bolehCoba` — pembebasannya harus disengaja", () => {
    // Kedua aturan ini sengaja terpisah. `bolehCoba` menjaga satu foto tidak
    // dikirim dua kali bersamaan; membebaskan yang macet adalah tindakan lain
    // yang menurunkan statusnya lebih dulu. Kalau `bolehCoba` sendiri yang
    // dilonggarkan, foto yang SUNGGUH sedang diunggah ikut dikirim ulang.
    expect(bolehCoba(kirimSejak(3_600_000), 1_000_000, true)).toBe(false);
  });
});

describe("putaranDitinggalkan — kunci yang pemegangnya sudah tidak ada", () => {
  // Laporan lanjutan user 2026-08-07: foto TETAP stuck sesudah perbaikan
  // pembebasan baris macet naik ke server. Sebabnya satu lapis lebih dalam:
  // tidak ada satu pun batas waktu di jalur itu. Kalau yang ditunggu tidak
  // pernah menjawab, `finally` yang melepas kunci antrean tidak pernah jalan —
  // antreannya mati diam-diam, layarnya membeku pada label terakhir, dan "Coba
  // kirim sekarang" pun tidak berbuat apa-apa karena kuncinya masih dipegang.

  it("menganggur (null) tidak pernah dianggap ditinggalkan", () => {
    expect(putaranDitinggalkan(null, 1_000_000)).toBe(false);
  });

  it("putaran yang masih wajar tidak diambil alih", () => {
    // Putaran sehat boleh lama — ia mengirim beberapa foto berturut-turut.
    // Mengambil alih terlalu cepat berarti dua putaran berjalan bersamaan dan
    // foto yang sama dikirim dua kali.
    expect(putaranDitinggalkan(1_000_000 - 1_000, 1_000_000)).toBe(false);
    expect(putaranDitinggalkan(1_000_000 - (BATAS_PUTARAN_MS - 1), 1_000_000)).toBe(false);
  });

  it("putaran yang lewat batas DIAMBIL ALIH", () => {
    expect(putaranDitinggalkan(1_000_000 - BATAS_PUTARAN_MS, 1_000_000)).toBe(true);
    expect(putaranDitinggalkan(1_000_000 - 3_600_000, 1_000_000)).toBe(true);
  });

  it("batas satu kirim lebih pendek daripada batas putaran", () => {
    // Urutan ini yang membuat kegagalan tertangkap di tempat yang benar: satu
    // pengiriman menyerah lebih dulu (dan barisnya dapat pesan yang menjelaskan),
    // baru sesudahnya kunci putaran dianggap ditinggalkan. Kalau terbalik,
    // pengambilalihan kunci terjadi SELAGI pengiriman masih sah berjalan.
    expect(BATAS_SATU_KIRIM_MS).toBeLessThan(BATAS_PUTARAN_MS);
  });
});

describe("status 'rusak' — isi fotonya hilang dari simpanan", () => {
  // Bukti dari perangkat user 2026-08-07, dua peramban sekaligus:
  //   UnknownError: Error preparing Blob/File data to be stored in object store
  // dan di peramban kedua, pratinjaunya muncul sebagai ikon gambar rusak.
  // Artinya bytenya memang tidak ada lagi — bukan jaringan, bukan server.

  const rusak = (): ItemAntrean => ({
    id: "x",
    percobaan: 0,
    terakhirCoba: 0,
    status: "rusak",
  });

  it("TIDAK pernah dicoba lagi", () => {
    // Mencoba mengirim sesuatu yang bytenya tidak ada hanya membakar baterai
    // sambil menyembunyikan kenyataan dari pemiliknya.
    expect(bolehCoba(rusak(), 1_000_000, true)).toBe(false);
  });

  it("TIDAK dihitung sebagai 'menunggu terkirim'", () => {
    // "3 foto menunggu terkirim" untuk foto yang tak akan pernah terkirim
    // adalah kebohongan yang membuat orang menunggu sia-sia.
    const r = ringkasAntrean([{ status: "rusak" }, { status: "menunggu" }, { status: "ditolak" }]);
    expect(r.menunggu).toBe(1);
    expect(r.rusak).toBe(1);
    expect(r.ditolak).toBe(1);
  });

  it("tetap menuntut perhatian — bukan disembunyikan", () => {
    // Foto yang hilang harus terlihat supaya bisa dibuang lalu dipotret ulang;
    // menyembunyikannya berarti pemiliknya mengira buktinya masih ada.
    expect(ringkasAntrean([{ status: "rusak" }]).perluPerhatian).toBe(true);
  });
});
