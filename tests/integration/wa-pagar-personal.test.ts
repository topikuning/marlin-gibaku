// PAGAR KIRIMAN KE NOMOR PRIBADI BENAR-BENAR MENAHAN (DECISIONS 433).
//
// Ketetapan user 2026-08-25: matikan kiriman WhatsApp ke nomor pribadi,
// karena WhatsApp memblokir nomor yang terlalu sering mengirim chat pribadi —
// dan blokir itu ikut mematikan kiriman ke GRUP.
//
// Yang diuji di sini bukan predikatnya (itu unit test), melainkan bahwa
// pagarnya duduk di GATEWAY: satu-satunya jalan keluar semua kiriman WA. Kalau
// ia dipasang di tiap fitur, fitur yang ditambahkan besok akan lolos.
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { sendWaMessage } = await import("@/lib/waha/gateway");
const { setWahaConfig, izinKirimPersonal } = await import("@/lib/waha/config");

const suffix = `pgr${Date.now().toString(36)}`;

beforeAll(async () => {
  // Bersihkan setelan izin supaya kondisi awal = BAWAAN (pagar tertutup).
  await db.appSetting.deleteMany({ where: { key: "waha.izinkan_personal" } });
});

describe("bawaan: pagar tertutup", () => {
  it("tanpa setelan apa pun, kiriman pribadi TIDAK diizinkan", async () => {
    expect(await izinKirimPersonal()).toBe(false);
  });

  it("kiriman ke @c.us ditolak dengan sebab yang bisa dibaca admin", async () => {
    const r = await sendWaMessage({
      kind: "teks",
      destination: "6281234567890@c.us",
      payload: { teks: "uji pagar" },
      sourceType: "uji",
      idempotencyKey: `uji-personal-${suffix}`,
    });
    expect(r.status).toBe("ditolak");
    expect(r.error).toContain("nomor pribadi");
    // Sebabnya menyebut TEMPAT menyalakannya — pesan galat yang tidak
    // memberi tahu jalan keluar hanya membuat admin menebak.
    expect(r.error).toContain("Sistem");
  });

  it("penolakannya TERCATAT di outbox, bukan hilang diam-diam", async () => {
    const baris = await db.waOutbound.findFirst({
      where: { idempotencyKey: `uji-personal-${suffix}` },
      select: { status: true, lastError: true, chatId: true },
    });
    expect(baris).toBeTruthy();
    expect(baris!.status).toBe("ditolak");
    expect(baris!.lastError).toContain("nomor pribadi");
  });

  it("kiriman ke GRUP tidak tersentuh pagar ini", async () => {
    const r = await sendWaMessage({
      kind: "teks",
      destination: "120363000000000000@g.us",
      payload: { teks: "uji grup" },
      sourceType: "uji",
      idempotencyKey: `uji-grup-${suffix}`,
    });
    // WAHA memang belum terkonfigurasi di lingkungan uji, jadi ia gagal —
    // tapi HARUS gagal karena sesi/koneksi, BUKAN karena pagar personal.
    expect(r.error ?? "").not.toContain("nomor pribadi");
  });
});

describe("pagar bisa dibuka sadar oleh admin", () => {
  it("setelah diizinkan, kiriman pribadi tidak lagi ditolak oleh pagar ini", async () => {
    await setWahaConfig({ izinkanPersonal: true });
    expect(await izinKirimPersonal()).toBe(true);

    const r = await sendWaMessage({
      kind: "teks",
      destination: "6281234567890@c.us",
      payload: { teks: "uji pagar dibuka" },
      sourceType: "uji",
      idempotencyKey: `uji-personal-buka-${suffix}`,
    });
    expect(r.error ?? "").not.toContain("nomor pribadi");
  });

  it("dan bisa ditutup kembali", async () => {
    await setWahaConfig({ izinkanPersonal: false });
    expect(await izinKirimPersonal()).toBe(false);
  });
});

/* ── Pagar SATU ARAH (DECISIONS 439) ─────────────────────────────────────
 *
 * Laporan user 2026-08-26: *"aku kirim wa ke marlin, kenapa marlin tidak
 * merespon?"* — pagar DECISIONS 433 duduk di gateway, jadi ia ikut menahan
 * BALASAN atas pesan yang masuk. Yang diminta cuma satu arah: MARLIN tidak
 * menyapa duluan ke nomor pribadi; kalau disapa, ia menjawab.
 */
describe("balasan atas pesan masuk tetap lewat", () => {
  const chatPribadi = `62811${Date.now().toString().slice(-9)}@c.us`;

  it("penanda balasan TANPA pesan masuk sungguhan tetap DITOLAK", async () => {
    // Penanda yang dipercaya begitu saja akan membocorkan pagar; ia harus
    // dibuktikan ke data.
    const r = await sendWaMessage({
      kind: "teks",
      destination: chatPribadi,
      payload: { teks: "halo duluan" },
      sourceType: "uji",
      balasanMasuk: true,
      idempotencyKey: `uji-balasan-palsu-${suffix}`,
    });
    expect(r.status).toBe("ditolak");
    expect(r.error).toContain("nomor pribadi");
  });

  it("setelah ada pesan MASUK dari chat itu, balasannya diizinkan", async () => {
    await db.waMessage.create({
      data: {
        chatId: chatPribadi,
        waMessageId: `uji-masuk-${suffix}`,
        fromMe: false,
        timestamp: new Date(),
        body: "pak, progres hari ini berapa?",
      },
    });
    const r = await sendWaMessage({
      kind: "teks",
      destination: chatPribadi,
      payload: { teks: "progres hari ini 12,3%" },
      sourceType: "balasan_wa",
      balasanMasuk: true,
      idempotencyKey: `uji-balasan-sah-${suffix}`,
    });
    // Lolos pagar. Statusnya bergantung sesi WAHA (tidak ada di lingkungan
    // uji), yang penting BUKAN ditolak karena nomor pribadi.
    expect(r.error ?? "").not.toContain("nomor pribadi");
  });

  it("kiriman yang DIMULAI MARLIN ke chat yang sama tetap ditahan", async () => {
    const r = await sendWaMessage({
      kind: "teks",
      destination: chatPribadi,
      payload: { teks: "pengingat terjadwal" },
      sourceType: "penjadwal",
      idempotencyKey: `uji-inisiatif-${suffix}`,
    });
    expect(r.status).toBe("ditolak");
    expect(r.error).toContain("nomor pribadi");
  });

  it("balasan yang datang setelah jendela 24 jam bukan balasan lagi", async () => {
    const lama = `62812${Date.now().toString().slice(-9)}@c.us`;
    await db.waMessage.create({
      data: {
        chatId: lama,
        waMessageId: `uji-masuk-lama-${suffix}`,
        fromMe: false,
        timestamp: new Date(Date.now() - 30 * 3_600_000),
        body: "pesan tiga puluh jam lalu",
      },
    });
    const r = await sendWaMessage({
      kind: "teks",
      destination: lama,
      payload: { teks: "maaf baru sempat" },
      sourceType: "balasan_wa",
      balasanMasuk: true,
      idempotencyKey: `uji-balasan-basi-${suffix}`,
    });
    expect(r.status).toBe("ditolak");
  });
});
