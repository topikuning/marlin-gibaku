// ATURAN VERIFIKASI NOMOR WHATSAPP (DECISIONS 570).
//
// Permintaan user 2026-09-13: *"untuk verifikasi WA (hanya satu kali). login,
// paksa kirim wa dari nomor mereka, lalu ada kode balasan, setelah itu kode
// masukkan, bisa diskip, tapi sebelum dilakukan setiap kali login akan
// dimintai"* — *"itu sekaligus jadi informasi nomor wa jika nomor masih
// kosong/atau update nomor wa sebelumnya"*.
//
// Yang diuji di sini ATURANNYA, terpisah dari database: pembacaan frasa dari
// pesan orang, tahap yang sedang berjalan, dan pencocokan kode berikut
// pagarnya. Aturan keamanan yang tidak diuji sama saja dengan tidak ada.
import { describe, expect, it } from "vitest";

const {
  AWALAN_FRASA,
  MAKS_PERCOBAAN,
  buatFrasa,
  buatKode,
  cocokkanKode,
  frasaDariPesan,
  keadaanVerifikasi,
  tautanKirimWa,
} = await import("@/lib/waha/verifikasi-aturan");

const baris = (p: Partial<Parameters<typeof cocokkanKode>[0] & object> = {}) => ({
  phrase: "MARLIN-ACDEFG",
  code: "123456",
  waNumber: "628123456789",
  attempts: 0,
  expiresAt: new Date("2026-09-13T10:00:00Z"),
  ...p,
});
const SEBELUM = new Date("2026-09-13T09:50:00Z");
const SESUDAH = new Date("2026-09-13T10:05:00Z");

describe("frasa yang harus dikirim pengguna", () => {
  it("selalu berawalan MARLIN- dan 6 huruf", () => {
    const f = buatFrasa(() => 0.5);
    expect(f.startsWith(AWALAN_FRASA)).toBe(true);
    expect(f.slice(AWALAN_FRASA.length)).toHaveLength(6);
  });

  it("tidak memakai huruf yang mudah tertukar", () => {
    // 0/O, 1/I/L, 5/S, 8/B — frasa ini dibaca dari layar lalu diketik ulang di
    // WhatsApp, dan satu huruf tertukar berakhir sebagai "tidak terjadi apa-apa".
    let semua = "";
    for (let i = 0; i < 200; i++) semua += buatFrasa().slice(AWALAN_FRASA.length);
    expect(semua).not.toMatch(/[01OIL5S8B]/);
  });

  it("kode balasan selalu 6 angka, termasuk yang berawal nol", () => {
    expect(buatKode(() => 0)).toBe("000000");
    expect(buatKode(() => 0.0000005)).toHaveLength(6);
  });
});

describe("membaca frasa dari pesan orang", () => {
  it("dikenali apa adanya", () => {
    expect(frasaDariPesan("MARLIN-ACDEFG")).toBe("MARLIN-ACDEFG");
  });

  it("huruf kecil dan kalimat pengiring tetap dikenali", () => {
    // Orang menulis "halo pak, marlin-acdefg ya" — menolaknya berarti mereka
    // akan mengulang dengan cara yang sama persis lalu menyimpulkan ini rusak.
    expect(frasaDariPesan("halo pak, marlin-acdefg ya")).toBe("MARLIN-ACDEFG");
    expect(frasaDariPesan("  MARLIN-acdefg  ")).toBe("MARLIN-ACDEFG");
  });

  it("pesan biasa tidak pernah terbaca sebagai frasa", () => {
    expect(frasaDariPesan("progres hari ini berapa?")).toBeNull();
    expect(frasaDariPesan("MARLIN")).toBeNull();
    expect(frasaDariPesan("MARLIN-123")).toBeNull(); // kurang panjang
    expect(frasaDariPesan(null)).toBeNull();
    expect(frasaDariPesan("")).toBeNull();
  });
});

describe("tahap yang sedang berjalan", () => {
  it("belum pernah mencoba", () => {
    expect(keadaanVerifikasi(null, null, null, SEBELUM)).toEqual({ tahap: "belum" });
  });

  it("sudah minta frasa, pesannya belum datang", () => {
    const k = keadaanVerifikasi(baris({ code: null, waNumber: null }), null, null, SEBELUM);
    expect(k.tahap).toBe("menunggu-pesan");
    expect(k).toMatchObject({ frasa: "MARLIN-ACDEFG" });
  });

  it("pesannya sudah masuk, tinggal mengetik kode", () => {
    const k = keadaanVerifikasi(baris(), null, null, SEBELUM);
    expect(k).toMatchObject({ tahap: "menunggu-kode", nomor: "628123456789", sisaPercobaan: MAKS_PERCOBAAN });
  });

  it("yang KEDALUWARSA dibaca sebagai belum, bukan tahap yang menggantung", () => {
    // Layar yang menunggu sesuatu yang tidak akan pernah datang lebih buruk
    // daripada layar yang menyuruh mulai lagi.
    expect(keadaanVerifikasi(baris(), null, null, SESUDAH)).toEqual({ tahap: "belum" });
  });

  it("sudah terverifikasi menang atas percobaan apa pun yang tersisa", () => {
    const kapan = new Date("2026-09-01T00:00:00Z");
    expect(keadaanVerifikasi(baris(), kapan, "628999", SEBELUM)).toEqual({
      tahap: "selesai",
      nomor: "628999",
      kapan,
    });
  });
});

describe("mencocokkan kode", () => {
  it("kode benar diterima", () => {
    expect(cocokkanKode(baris(), "123456", SEBELUM)).toEqual({ ok: true });
  });

  it("spasi dan tanda baca dari salin-tempel WhatsApp tidak menggagalkan", () => {
    expect(cocokkanKode(baris(), " 123 456 ", SEBELUM)).toEqual({ ok: true });
    expect(cocokkanKode(baris(), "Kode: 123456", SEBELUM)).toEqual({ ok: true });
  });

  it("kode salah ditolak", () => {
    expect(cocokkanKode(baris(), "999999", SEBELUM)).toEqual({ ok: false, sebab: "kode-salah" });
  });

  it("percobaan habis ditolak SEBELUM kodenya dibandingkan", () => {
    // Kalau batasnya diperiksa sesudah perbandingan, kode 6 angka bisa ditebak
    // habis-habisan asal penebaknya sabar.
    const r = cocokkanKode(baris({ attempts: MAKS_PERCOBAAN }), "123456", SEBELUM);
    expect(r).toEqual({ ok: false, sebab: "habis-percobaan" });
  });

  it("kedaluwarsa ditolak walau kodenya benar", () => {
    expect(cocokkanKode(baris(), "123456", SESUDAH)).toEqual({ ok: false, sebab: "kedaluwarsa" });
  });

  it("belum ada pesan masuk = belum ada kode untuk dicocokkan", () => {
    expect(cocokkanKode(baris({ code: null }), "123456", SEBELUM)).toEqual({
      ok: false,
      sebab: "belum-ada-pesan",
    });
  });

  it("tanpa percobaan sama sekali ditolak, bukan diloloskan", () => {
    expect(cocokkanKode(null, "123456", SEBELUM)).toEqual({ ok: false, sebab: "kedaluwarsa" });
  });
});

const TAUTAN =
  "https://api.whatsapp.com/send/?phone=628123456789&text=MARLIN-ACDEFG&type=phone_number&app_absent=0";

describe("tautan kirim WhatsApp sekali klik", () => {
  it("membuka WhatsApp ke nomor MARLIN dengan frasanya sudah terketik", () => {
    // Teguran user 2026-09-13: *"seharusnya kirim kode ini kamu sediakan klik,
    // dia langsung buka whatsapp pesannya siap kirim ke nomor marlin."* Menyuruh
    // orang lapangan menyalin frasa, membuka WhatsApp, mencari nomor MARLIN,
    // lalu mengetik ulang — itu empat kesempatan gagal untuk satu langkah yang
    // bisa jadi satu ketukan.
    expect(tautanKirimWa("628123456789", "MARLIN-ACDEFG")).toBe(TAUTAN);
  });

  it("memakai bentuk api.whatsapp.com/send, bukan wa.me", () => {
    // wa.me berhenti di halaman antara "Continue to Chat" di peramban desktop —
    // satu ketukan tambahan tepat di langkah yang seharusnya jadi satu ketukan.
    const t = tautanKirimWa("628123456789", "MARLIN-ACDEFG")!;
    expect(t).toContain("type=phone_number");
    expect(t).toContain("app_absent=0");
    expect(t).not.toContain("wa.me");
  });

  it("nomor dirapikan dulu – 0812…, +62…, spasi, dan JID @c.us sama-sama sah", () => {
    // Nomor datang dari sesi WAHA apa adanya, kadang sebagai JID "628…@c.us";
    // tautannya hanya menerima angka.
    expect(tautanKirimWa("+62 812-3456-789", "MARLIN-ACDEFG")).toBe(TAUTAN);
    expect(tautanKirimWa("08123456789", "MARLIN-ACDEFG")).toBe(TAUTAN);
    expect(tautanKirimWa("628123456789@c.us", "MARLIN-ACDEFG")).toBe(TAUTAN);
  });

  it("tanpa nomor tujuan → null, bukan tautan yang menuju entah ke mana", () => {
    // Sesi WhatsApp MARLIN bisa sedang putus. Tombol yang membuka WhatsApp ke
    // nomor kosong lebih buruk daripada tidak ada tombol: orang mengira sudah
    // mengirim.
    expect(tautanKirimWa(null, "MARLIN-ACDEFG")).toBeNull();
    expect(tautanKirimWa("", "MARLIN-ACDEFG")).toBeNull();
    expect(tautanKirimWa("62", "MARLIN-ACDEFG")).toBeNull();
  });
});
