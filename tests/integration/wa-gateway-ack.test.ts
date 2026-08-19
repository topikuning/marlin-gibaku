// GATEWAY PENGIRIMAN + REKONSILIASI ACK (DECISIONS 374).
//
// Temuan audit user 2026-08-19: tiga fungsi kirim, tiga perilaku. `sendText`
// mengembalikan id-atau-null, `sendImage`/`sendFile` mengembalikan void, dan
// pemeriksaan sesi WORKING hanya ada di sebagian jalur. Tiap pemanggil
// menafsirkan keberhasilan sendiri, dan sebagian UI menulis "Terkirim" begitu
// HTTP 2xx — padahal WAHA menjawab 2xx juga saat sesinya belum login.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

/** Disetel per uji — inilah yang menggantikan jaringan WAHA. */
let statusSesi = "WORKING";
let lemparkan: { pesan: string; kode?: number } | null = null;
const dikirim: { jalur: string; chatId: string }[] = [];

class WahaErrorPalsu extends Error {
  readonly status?: number;
  constructor(m: string, s?: number) {
    super(m);
    this.status = s;
  }
}

vi.mock("@/lib/waha/client", () => ({
  WahaError: WahaErrorPalsu,
  getSessionStatus: async () => ({ name: "default", status: statusSesi }),
  kirimMentahTeks: async (chatId: string) => {
    if (lemparkan) throw new WahaErrorPalsu(lemparkan.pesan, lemparkan.kode);
    dikirim.push({ jalur: "teks", chatId });
    return `WA_${dikirim.length}`;
  },
  kirimMentahGambar: async (chatId: string) => {
    if (lemparkan) throw new WahaErrorPalsu(lemparkan.pesan, lemparkan.kode);
    dikirim.push({ jalur: "gambar", chatId });
    return `WA_${dikirim.length}`;
  },
  kirimMentahFile: async (chatId: string) => {
    if (lemparkan) throw new WahaErrorPalsu(lemparkan.pesan, lemparkan.kode);
    dikirim.push({ jalur: "berkas", chatId });
    return `WA_${dikirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { sendWaMessage, terapkanAck, ringkasPengiriman } = await import("@/lib/waha/gateway");

const GRUP = "120363000000005555@g.us";
const BERKAS = { mimetype: "application/pdf", filename: "laporan.pdf", data: "eA==" };

afterAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE TABLE wa_outbound RESTART IDENTITY CASCADE`);
  await db.$disconnect();
});

beforeEach(async () => {
  statusSesi = "WORKING";
  lemparkan = null;
  dikirim.length = 0;
  await db.waOutbound.deleteMany({});
});

let n = 0;
const kunci = () => `uji-${Date.now()}-${++n}`;

describe("gateway: bukti, bukan asumsi", () => {
  it("TEKS, GAMBAR, dan BERKAS sama-sama menyimpan message ID", async () => {
    /*
     * Yang dulu bolong justru dua terakhir: `sendImage`/`sendFile`
     * mengembalikan `void`, sehingga kiriman laporan resmi — yang paling
     * penting dilacak — tidak pernah punya bukti apa pun bahwa WAHA
     * menerimanya.
     */
    const teks = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "halo" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    const gambar = await sendWaMessage({
      kind: "gambar", destination: GRUP, payload: { file: BERKAS },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    const berkas = await sendWaMessage({
      kind: "berkas", destination: GRUP, payload: { file: BERKAS },
      idempotencyKey: kunci(), sourceType: "uji",
    });

    for (const r of [teks, gambar, berkas]) {
      expect(r.waMessageId, r.status).not.toBeNull();
      expect(r.status).toBe("diterima_waha");
    }
    expect(await db.waOutbound.count({ where: { waMessageId: { not: null } } })).toBe(3);
  });

  it('status awal "diterima_waha", BUKAN "terkirim" atau "sampai"', async () => {
    /*
     * Nama status inilah yang menahan UI dari mengaku lebih dari yang
     * diketahui. Sesudah WAHA menjawab 2xx, yang benar-benar dibuktikan hanya
     * "WAHA menerima permintaannya" — bukan bahwa WhatsApp mengirimkannya.
     */
    const r = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "halo" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(r.status).toBe("diterima_waha");
    const baris = await db.waOutbound.findFirstOrThrow({ select: { status: true, sentAt: true } });
    expect(baris.status).toBe("diterima_waha");
    // `sentAt` = kapan diserahkan ke WAHA; `ackAt` masih kosong karena belum
    // ada satu pun bukti dari WhatsApp.
    expect(baris.sentAt).not.toBeNull();
    const utuh = await db.waOutbound.findFirstOrThrow({ select: { ackAt: true } });
    expect(utuh.ackAt).toBeNull();
  });

  it("sesi selain WORKING DITOLAK sebelum endpoint kirim dipanggil", async () => {
    /*
     * Pemeriksaan ini dulu hanya ada di sebagian jalur — dan justru jalur yang
     * TIDAK memeriksanya (gambar & berkas) yang dipakai mengirim laporan resmi.
     */
    statusSesi = "SCAN_QR_CODE";
    const r = await sendWaMessage({
      kind: "berkas", destination: GRUP, payload: { file: BERKAS },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(r.status).toBe("gagal");
    expect(r.diterimaWaha).toBe(false);
    expect(r.error).toContain("belum siap");
    // Bukti bahwa penolakannya terjadi SEBELUM jaringan disentuh.
    expect(dikirim).toHaveLength(0);
  });

  it("status sesi yang tidak terbaca diperlakukan TIDAK siap", async () => {
    // Lebih baik menahan dengan sebab yang jelas daripada melemparkannya ke
    // sesi yang mungkin mati lalu melaporkannya terkirim.
    statusSesi = "FAILED";
    const r = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "x" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(r.diterimaWaha).toBe(false);
    expect(dikirim).toHaveLength(0);
  });

  it("kunci idempotensi yang sama TIDAK mengirim dua kali", async () => {
    const k = kunci();
    const a = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "sekali saja" },
      idempotencyKey: k, sourceType: "uji",
    });
    const b = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "sekali saja" },
      idempotencyKey: k, sourceType: "uji",
    });

    expect(dikirim).toHaveLength(1);
    expect(b.waMessageId).toBe(a.waMessageId);
    expect(await db.waOutbound.count()).toBe(1);
  });

  it("galat 4xx = DITOLAK (tidak layak diulang), bukan gagal", async () => {
    /*
     * WhatsApp menolak nomor tak terdaftar dengan 4xx (mis. 463). Menandainya
     * "gagal" mengundang percobaan ulang yang pasti sia-sia — dan
     * menyembunyikan bahwa tujuannya yang salah.
     */
    lemparkan = { pesan: "WAHA error 463: not registered", kode: 463 };
    const r = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "x" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(r.status).toBe("ditolak");
    expect(r.diterimaWaha).toBe(false);

    const baris = await db.waOutbound.findFirstOrThrow();
    expect(baris.errorCode).toBe("463");
    expect(baris.lastError).toContain("463");
  });

  it("galat jaringan (tanpa kode HTTP) = GAGAL, bukan ditolak", async () => {
    lemparkan = { pesan: "Tidak bisa menghubungi server WAHA" };
    const r = await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "x" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(r.status).toBe("gagal");
  });

  it("tujuan yang tidak terbaca ditolak tanpa menyentuh jaringan", async () => {
    const r = await sendWaMessage({
      kind: "teks", destination: "   ", payload: { teks: "x" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(r.status).toBe("ditolak");
    expect(dikirim).toHaveLength(0);
  });

  it("tujuan dikanonikkan sebelum dikirim", async () => {
    // Satu grup, satu bentuk — sama seperti sisi masuk (DECISIONS 370).
    await sendWaMessage({
      kind: "teks", destination: "120363000000005555:9@G.US", payload: { teks: "x" },
      idempotencyKey: kunci(), sourceType: "uji",
    });
    expect(dikirim[0].chatId).toBe(GRUP);
  });
});

describe("rekonsiliasi message.ack", () => {
  const kirim = async () =>
    sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "halo" },
      idempotencyKey: kunci(), sourceType: "uji",
    });

  it("ack menaikkan status: diterima → terkirim → sampai → dibaca", async () => {
    const r = await kirim();
    const id = r.waMessageId!;

    expect(await terapkanAck(id, 1)).toMatchObject({ berubah: true, ke: "terkirim" });
    expect(await terapkanAck(id, 2)).toMatchObject({ berubah: true, ke: "sampai" });
    expect(await terapkanAck(id, 3)).toMatchObject({ berubah: true, ke: "dibaca" });

    const baris = await db.waOutbound.findUniqueOrThrow({ where: { waMessageId: id } });
    expect(baris.status).toBe("dibaca");
    expect(baris.ackAt).not.toBeNull();
  });

  it("ack DUPLIKAT idempoten", async () => {
    const id = (await kirim()).waMessageId!;
    await terapkanAck(id, 2);
    const kedua = await terapkanAck(id, 2);
    expect(kedua).toMatchObject({ cocok: true, berubah: false });
  });

  it("ack OUT-OF-ORDER tidak menurunkan status", async () => {
    const id = (await kirim()).waMessageId!;
    await terapkanAck(id, 3); // dibaca duluan
    const telat = await terapkanAck(id, 2); // delivered menyusul
    expect(telat).toMatchObject({ berubah: false });
    const baris = await db.waOutbound.findUniqueOrThrow({ where: { waMessageId: id } });
    expect(baris.status).toBe("dibaca");
  });

  it("ack ERROR menandai gagal walau sudah sempat terkirim", async () => {
    const id = (await kirim()).waMessageId!;
    await terapkanAck(id, 1);
    expect(await terapkanAck(id, -1)).toMatchObject({ berubah: true, ke: "gagal" });
  });

  it("ack untuk pesan yang BUKAN kiriman MARLIN diabaikan dengan tenang", async () => {
    /*
     * WAHA mengirim ack untuk SETIAP pesan keluar dari nomor itu, termasuk yang
     * diketik manusia dari HP-nya. Itu wajar, bukan galat.
     */
    const r = await terapkanAck("WA_ENTAH_SIAPA", 2);
    expect(r).toMatchObject({ cocok: false });
  });
});

describe("diagnosa pengiriman", () => {
  it("ringkasan memuat hitungan per status dan kegagalan terbaru", async () => {
    await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "ok" },
      idempotencyKey: kunci(), sourceType: "laporan_harian",
    });
    lemparkan = { pesan: "WAHA error 463: not registered", kode: 463 };
    await sendWaMessage({
      kind: "teks", destination: GRUP, payload: { teks: "gagal" },
      idempotencyKey: kunci(), sourceType: "laporan_mingguan",
    });

    const r = await ringkasPengiriman();
    expect(r.per.find((p) => p.status === "diterima_waha")?.jumlah).toBe(1);
    expect(r.per.find((p) => p.status === "ditolak")?.jumlah).toBe(1);
    // Asal kiriman ikut tercatat — tanpa itu, kegagalan tidak bisa ditelusuri
    // balik ke fitur yang menerbitkannya.
    expect(r.gagalTerbaru[0].sourceType).toBe("laporan_mingguan");
    expect(r.gagalTerbaru[0].errorCode).toBe("463");
  });
});
