// NASIB SEBENARNYA pengingat harian, bukan "sukses" yang ditulis sebelum
// pesannya berangkat (DECISIONS 380 · menutup sisa `WA-01`).
//
// `DailyReminderLog.status` diisi "sukses" SEBELUM `sendText` dipanggil, dan
// hanya berubah kalau pemanggilan melempar. Padahal kegagalan yang paling
// berbahaya justru terjadi SESUDAH itu: WAHA menerbitkan id pesan, lalu
// WhatsApp menolak sendiri (error 463 — nomor pengirim dibatasi menghubungi
// nomor baru). Penolakan itu tidak terlihat dari respons API.
//
// Sejak DECISIONS 374 nasibnya tercatat di `wa_outbound` dan diperbarui
// `message.ack`. Berkas ini menjaga sambungannya ke layar: tanpa itu pengingat
// yang DITOLAK tetap tampil "ada ID pesan" — yang terbaca seperti baik-baik saja.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/waha/client", () => ({
  isWahaConfigured: async () => true,
  getSessionStatus: async () => ({ status: "WORKING" }),
}));

const { db } = await import("@/lib/db");
const { pratinjauPengingat } = await import("@/lib/harian/pratinjau");
const { jakartaDateKey } = await import("@/lib/format");

const suffix = `png${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
// Hari ini menurut Asia/Jakarta — `pratinjauPengingat` memakai jam berjalan,
// jadi tanggal yang dipatok akan membuat uji ini hijau/merah tergantung hari.
const dateKey = jakartaDateKey(new Date());
const ID_PESAN = `msg-${suffix}`;

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org PNG ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const u = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      email: `sm-${suffix}@contoh.id`,
      fullName: "SM PNG",
      role: "site_manager",
      passwordHash: "x",
      waNumber: "628123456789@c.us",
    },
    select: { id: true },
  });
  userId = u.id;
});

beforeEach(async () => {
  await db.dailyReminderLog.deleteMany({ where: { userId } });
  await db.waOutbound.deleteMany({ where: { waMessageId: ID_PESAN } });
});

afterAll(async () => {
  /*
   * TRUNCATE, bukan DELETE — pola yang sama dengan berkas integrasi lain.
   *
   * `audit_logs` append-only di tingkat basis data (trigger menolak
   * UPDATE/DELETE), tapi trigger itu TIDAK berlaku untuk TRUNCATE. Jadi jejak
   * audit tetap tak bisa dihapus dalam pemakaian normal, sementara uji tetap
   * bisa mengembalikan basis data ke keadaan bersih.
   *
   * Wajib: sebagian uji lain menegaskan hitungan GLOBAL, jadi baris yang
   * tertinggal dari berkas ini membuat uji yang sama sekali tidak berhubungan
   * gagal — dan gagalnya di tempat yang tidak menunjuk ke sini.
   */
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_reminder_logs, wa_outbound, audit_logs, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

/** Pengingat yang menurut catatannya sendiri "sukses" dan punya ID pesan. */
async function catatPengingatSukses() {
  await db.dailyReminderLog.create({
    data: {
      userId,
      dateKey,
      locations: 1,
      status: "sukses",
      chatId: "628123456789@c.us",
      waMessageId: ID_PESAN,
      attempts: 1,
      lastSentAt: new Date(),
    },
  });
}

async function catatOutbox(status: "diterima_waha" | "dibaca" | "ditolak") {
  await db.waOutbound.create({
    data: {
      kind: "teks",
      chatId: "628123456789@c.us",
      idempotencyKey: `uji-${suffix}-${status}`,
      sourceType: "uji",
      status,
      waMessageId: ID_PESAN,
      ringkas: "pengingat uji",
    },
  });
}

async function jejak() {
  const p = await pratinjauPengingat(orgId);
  return p.sudahDikirim.find((s) => s.nama === "SM PNG") ?? null;
}

describe("nasib kiriman dibaca dari outbox, bukan dari catatan pra-kirim", () => {
  it("DITOLAK WhatsApp tidak lagi tampil seolah baik-baik saja", async () => {
    /*
     * Inti `WA-01`. Barisnya sendiri berkata "sukses" dan punya ID pesan —
     * dua-duanya benar, dan dua-duanya menyesatkan. Yang benar ada di outbox.
     */
    await catatPengingatSukses();
    await catatOutbox("ditolak");
    const s = await jejak();
    expect(s?.status).toBe("sukses"); // catatan lamanya memang begitu
    expect(s?.adaBukti).toBe(true);
    // …tapi nasib sebenarnya yang dipakai layar:
    expect(s?.statusKirim).toBe("ditolak");
  });

  it("DIBACA ikut terbaca – kabar baik pun tidak boleh hilang", async () => {
    // Pagar ini tidak boleh cuma memburukkan; ack yang maju juga harus tampil,
    // kalau tidak, "ada ID pesan" tetap jadi satu-satunya yang bisa dikatakan.
    await catatPengingatSukses();
    await catatOutbox("dibaca");
    expect((await jejak())?.statusKirim).toBe("dibaca");
  });

  it("tanpa baris outbox → null, BUKAN ditebak", async () => {
    /*
     * Kiriman lama dari sebelum outbox ada. Menebaknya "terkirim" akan
     * mengarang bukti; layar jatuh kembali ke kalimat lama yang jujur
     * ("ada ID pesan").
     */
    await catatPengingatSukses();
    expect((await jejak())?.statusKirim).toBeNull();
  });

  it("pencocokannya lewat ID PESAN, bukan nomor tujuan", async () => {
    /*
     * Dua orang bisa memakai nomor WhatsApp yang sama (mis. satu HP dipakai
     * berdua di lapangan). Kalau nasib kiriman dicocokkan lewat nomor tujuan,
     * status kiriman orang PERTAMA menempel juga ke orang kedua — dan yang
     * kedua tampil "dibaca" padahal pesannya tidak pernah punya bukti apa pun.
     *
     * Skenarionya sengaja memuat SATU baris ber-ID (supaya query outbox
     * benar-benar berjalan) dan satu baris tanpa ID. Versi pertama uji ini
     * hanya memuat baris tanpa ID, jadi query-nya dilewati sama sekali dan
     * pencocokan lewat nomor pun ikut lolos — hijau yang tidak membuktikan apa
     * pun.
     */
    await catatPengingatSukses(); // SM PNG — punya ID pesan
    await catatOutbox("dibaca");

    const nomorSama = "628123456789@c.us";
    const u2 = await db.user.create({
      data: {
        orgId,
        username: `sm2-${suffix}`,
        email: `sm2-${suffix}@contoh.id`,
        fullName: "SM PNG Dua",
        role: "site_manager",
        passwordHash: "x",
        waNumber: nomorSama,
      },
      select: { id: true },
    });
    await db.dailyReminderLog.create({
      data: {
        userId: u2.id,
        dateKey,
        locations: 1,
        status: "sukses",
        chatId: nomorSama,
        attempts: 1,
        lastSentAt: new Date(),
      },
    });

    const p = await pratinjauPengingat(orgId);
    const kedua = p.sudahDikirim.find((x) => x.nama === "SM PNG Dua");
    expect(kedua?.adaBukti).toBe(false);
    expect(kedua?.statusKirim).toBeNull();
    // Yang PUNYA id tetap terbaca benar.
    expect(p.sudahDikirim.find((x) => x.nama === "SM PNG")?.statusKirim).toBe("dibaca");

    await db.dailyReminderLog.deleteMany({ where: { userId: u2.id } });
  });
});
