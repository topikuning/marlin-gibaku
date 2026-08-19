// SINKRONISASI chat_id WHATSAPP — diuji terhadap DATABASE ASLI (DECISIONS 348).
//
// Jalur terima→simpan tidak pernah punya uji integrasi sama sekali. Itu masalah,
// karena SATU-SATUNYA hal yang menentukan pesan tersimpan atau hilang adalah
// pencocokan teks `Package.waGroupId` lawan chatId dari webhook — dan
// perbedaannya tidak pernah memunculkan galat. Gejalanya cuma "pesan tidak
// masuk", yang tak bisa dibedakan dari WAHA yang belum mengirim apa pun.
//
// Yang dibuktikan di sini adalah hal yang MUSTAHIL dibuktikan di uji murni:
// bahwa bentuk tulisan apa pun dari engine mana pun benar-benar bertemu dengan
// baris paket yang sudah tersimpan.
//
// Sejak DECISIONS 370 sisi TERSIMPAN selalu kanonik (migration + indeks unik),
// jadi yang berbeda-beda tinggal sisi MASUK — dan itulah yang divariasikan di
// bawah.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { ingestWaEvent } = await import("@/lib/waha/ingest");

const suffix = Math.random().toString(36).slice(2, 8);

/*
 * SEMUA baris tersimpan kanonik — dan itu sekarang invarian, bukan kebetulan
 * (DECISIONS 370).
 *
 * Versi pertama berkas ini menyimpan bentuk MENTAH ("…002" tanpa sufiks,
 * "…@s.whatsapp.net") untuk meniru baris lama, karena waktu itu pembacaan
 * memang mencocokkan seluruh varian. Sejak migration `20260819120000` seluruh
 * `wa_group_id` dikanonikkan dan diberi indeks unik, jadi baris seperti itu
 * tidak bisa ada lagi — menyimpannya di fixture berarti menguji keadaan yang
 * tidak mungkin terjadi, dan menuntut pencocokan longgar yang justru dibuang
 * karena membuat pemilihan paket bergantung pada urutan baris.
 *
 * Yang diuji tetap sama dan tetap penting: bentuk MASUK apa pun dari engine
 * mana pun harus bertemu baris kanoniknya.
 */
const GRUP_KANONIK = "12036300000000001@g.us";
/** Grup kedua — masuknya nanti diuji dalam bentuk telanjang tanpa sufiks. */
const GRUP_TELANJANG = "12036300000000002@g.us";
/** Kontak — masuknya nanti diuji lewat domain NOWEB maupun WEBJS. */
const KONTAK_NOWEB = "6285799999999@c.us";

let idKanonik = "";
let idTelanjang = "";
let idNoweb = "";

let no = 0;
/** Event webhook; setiap pesan butuh id unik supaya dedup tidak menutupi hasil. */
function event(payload: Record<string, unknown>) {
  no += 1;
  return {
    event: "message",
    session: "default",
    payload: { id: `m-${suffix}-${no}`, timestamp: 1_690_000_000, body: "halo", ...payload },
  };
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ${suffix}`, slug: `oi-${suffix}` },
  });
  const buat = async (nama: string, waGroupId: string) =>
    (
      await db.package.create({
        data: { orgId: org.id, name: `${nama} ${suffix}`, waGroupId },
        select: { id: true },
      })
    ).id;
  idKanonik = await buat("Kanonik", GRUP_KANONIK);
  idTelanjang = await buat("Telanjang", GRUP_TELANJANG);
  idNoweb = await buat("Noweb", KONTAK_NOWEB);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE wa_messages, packages, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("satu grup, berapa pun bentuk tulisannya", () => {
  it("bentuk kanonik: tersimpan", async () => {
    const r = await ingestWaEvent(event({ from: GRUP_KANONIK, author: "6281234757999@c.us" }));
    expect(r.stored, r.reason).toBe(true);
    expect(r.packageId).toBe(idKanonik);
  });

  it("bentuk MENTAH NOWEB (key.remoteJid): tersimpan ke paket yang sama", async () => {
    /*
     * Sebelum DECISIONS 348 bentuk ini dikembalikan `null` oleh parser — pesan
     * dibuang sebelum pencocokan paket sempat terjadi, dan alasannya tercatat
     * "payload tidak dikenali" yang tidak menyebut apa pun yang bisa ditindak.
     */
    const r = await ingestWaEvent(
      event({
        key: { remoteJid: GRUP_KANONIK, fromMe: false, participant: "6281234757999@s.whatsapp.net" },
      }),
    );
    expect(r.stored, r.reason).toBe(true);
    expect(r.packageId).toBe(idKanonik);
  });

  it("chatId yang tersimpan SELALU kanonik, apa pun bentuk masuknya", async () => {
    // Kalau bentuk masuk ikut tersimpan apa adanya, tabel pesan jadi berisi dua
    // tulisan untuk satu grup dan indeks [chatId, timestamp] terbelah.
    const rows = await db.waMessage.findMany({
      where: { packageId: idKanonik },
      select: { chatId: true },
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(rows.map((r) => r.chatId))]).toEqual([GRUP_KANONIK]);
  });

  it("chatId masuk TANPA sufiks domain tetap cocok", async () => {
    // Bentuk telanjang masih datang dari sebagian payload; ia harus menemukan
    // baris kanoniknya, bukan dianggap grup lain.
    const r = await ingestWaEvent(event({ from: "12036300000000002" }));
    expect(r.stored, r.reason).toBe(true);
    expect(r.packageId).toBe(idTelanjang);
  });

  it("domain NOWEB dan WEBJS adalah chat yang sama", async () => {
    const r = await ingestWaEvent(event({ from: "6285799999999@s.whatsapp.net" }));
    expect(r.stored, r.reason).toBe(true);
    expect(r.packageId).toBe(idNoweb);
  });

  it("sufiks PERANGKAT tidak memecah chat jadi dua", async () => {
    const r = await ingestWaEvent(event({ from: "6285799999999:12@s.whatsapp.net" }));
    expect(r.stored, r.reason).toBe(true);
    expect(r.packageId).toBe(idNoweb);
  });
});

describe("yang memang TIDAK disimpan tetap tidak disimpan", () => {
  it("chat pribadi tak tertaut: bukan 'grup tidak tertaut', dan itu penting", async () => {
    // Kalimatnya menentukan ke mana admin pergi mencari. "Grup tidak tertaut"
    // mengirimnya memburu tautan grup yang tidak pernah ada.
    const r = await ingestWaEvent(event({ from: "6289999999999@c.us" }));
    expect(r.stored).toBe(false);
    expect(r.reason).toContain("chat pribadi");
    expect(r.chatId).toBe("6289999999999@c.us");
  });

  it("grup yang belum ditautkan: ditolak dengan chatId yang bisa disalin", async () => {
    const r = await ingestWaEvent(event({ from: "12036399999999999@g.us" }));
    expect(r.stored).toBe(false);
    expect(r.reason).toContain("grup tidak tertaut");
    // Nilai yang dilaporkan harus persis nilai yang perlu ditempel admin.
    expect(r.chatId).toBe("12036399999999999@g.us");
  });

  it("pesan sama dua kali (message + message.any): satu baris, bukan dua", async () => {
    const ev = event({ from: GRUP_KANONIK });
    expect((await ingestWaEvent(ev)).stored).toBe(true);
    expect((await ingestWaEvent({ ...ev, event: "message.any" })).stored).toBe(true);
    const n = await db.waMessage.count({
      where: { waMessageId: (ev.payload as { id: string }).id },
    });
    expect(n).toBe(1);
  });

  it("payload tak dikenali: alasannya menyebut KERANGKA, tanpa isi pesan", async () => {
    /*
     * User meminta "log full raw payload". Payload utuh memang dicatat — tapi ke
     * log server. Log hit di Sistem dibaca admin lain, jadi yang masuk ke sana
     * adalah kerangkanya: nama medan + nilai yang bukan isi chat.
     */
    const r = await ingestWaEvent({
      event: "message",
      payload: { tanpaChat: true, body: "gaji saya belum dibayar" },
    });
    expect(r.stored).toBe(false);
    expect(r.reason).toContain("tanpaChat=true");
    expect(r.reason).not.toContain("gaji");
  });
});

describe("pesan KELUAR dari MARLIN", () => {
  it("disimpan (ringkasan grup butuh utuh), dan ditandai fromMe", async () => {
    // Sengaja disimpan — beda dengan tanya-jawab, yang justru harus mengabaikan
    // pesan sendiri supaya tidak membalas dirinya sendiri.
    const ev = event({ to: GRUP_KANONIK, from: "6281200000000@c.us", fromMe: true });
    const r = await ingestWaEvent(ev);
    expect(r.stored, r.reason).toBe(true);
    const row = await db.waMessage.findUniqueOrThrow({
      where: { waMessageId: (ev.payload as { id: string }).id },
      select: { fromMe: true, chatId: true },
    });
    expect(row.fromMe).toBe(true);
    expect(row.chatId).toBe(GRUP_KANONIK);
  });

  it("keluar lewat bentuk mentah key.fromMe juga dikenali sebagai milik kita", async () => {
    const ev = event({ key: { remoteJid: GRUP_KANONIK, fromMe: true }, to: GRUP_KANONIK });
    const r = await ingestWaEvent(ev);
    expect(r.stored, r.reason).toBe(true);
    const row = await db.waMessage.findUniqueOrThrow({
      where: { waMessageId: (ev.payload as { id: string }).id },
      select: { fromMe: true },
    });
    expect(row.fromMe).toBe(true);
  });
});
