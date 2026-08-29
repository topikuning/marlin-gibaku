// PENGINGAT LAPORAN HARIAN KE GRUP WHATSAPP — ketetapan user 2026-08-29,
// menindaklanjuti pengumuman KKP ("dokumentasi dilaporkan setiap hari melalui
// grup WhatsApp", berkas mingguan paling lambat Minggu 23.59).
//
// Yang berbahaya di fitur ini bukan teksnya (sudah diuji unit), melainkan
// KAPAN dan BERAPA KALI ia berbunyi. Tiga kegagalan yang harus mustahil:
//
//   1. mengirim beruntun tanpa jeda — 19 pesan sekaligus ke 19 grup adalah pola
//      yang membuat nomornya ditandai spam;
//   2. mengirim dua kali ke grup yang sama di hari yang sama;
//   3. menagih grup yang justru sudah lengkap saat gilirannya tiba.
//
// Ketiganya hanya bisa dibuktikan lewat DB sungguhan: pengamannya UNIQUE
// (paket, tanggal) di Postgres dan kolom `send_after`, bukan sebuah `if`.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terkirim: { chatId: string; text: string }[] = [];
let wahaHidup = true;

vi.mock("@/lib/waha/client", () => ({
  isWahaConfigured: async () => wahaHidup,
  getSessionStatus: async () => ({ name: "default", status: "WORKING" }),
}));

vi.mock("@/lib/waha/kirim", () => ({
  sendText: async (chatId: string, text: string) => {
    terkirim.push({ chatId, text });
    return `wamid.${terkirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { antrekanPengingatGrup, kurasPengingatGrup, JEDA_ANTAR_GRUP_MS } = await import(
  "@/lib/harian/penjadwal-grup"
);
const { setPengingatGrupAktif } = await import("@/lib/harian/setelan-grup");

const suffix = `pg${Date.now().toString(36)}`;
/** 18.00 WIB pada 2026-08-29 = 11:00 UTC — jam putaran harian sungguhan. */
const SORE = new Date("2026-08-29T11:00:00.000Z");
const SPMK = new Date("2026-08-01T00:00:00.000Z");
const GRUP_A = `62800a-${suffix}@g.us`;
const GRUP_B = `62800b-${suffix}@g.us`;

let orgId = "";
let paketA = "";
let paketB = "";
let lokasiA = "";
let userId = "";

async function buatPaket(nama: string, grup: string, vendorId: string) {
  const pkg = await db.package.create({
    data: { orgId, name: nama, stage: "pelaksanaan", waGroupId: grup },
    select: { id: true },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId,
      contractNumber: `SPK-${nama}-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-07-25"),
      durationDays: 120,
      startDate: SPMK,
      endDate: new Date("2026-11-29"),
    },
  });
  const lok = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${nama}`,
      slug: `lok-${nama.toLowerCase()}-${suffix}`,
      village: "Desa",
      regency: "Kebumen",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  return { packageId: pkg.id, locationId: lok.id };
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org PG ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const vendor = await db.vendor.create({
    data: { orgId, name: "CV. UJI GRUP" },
    select: { id: true },
  });
  const u = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      fullName: "Mandor Uji",
      role: "site_manager",
      passwordHash: "x",
    },
    select: { id: true },
  });
  userId = u.id;
  const a = await buatPaket(`A${suffix}`, GRUP_A, vendor.id);
  const b = await buatPaket(`B${suffix}`, GRUP_B, vendor.id);
  paketA = a.packageId;
  paketB = b.packageId;
  lokasiA = a.locationId;
});

beforeEach(async () => {
  terkirim.length = 0;
  wahaHidup = true;
  await db.groupReminderJob.deleteMany({ where: { packageId: { in: [paketA, paketB] } } });
  await db.dailyReport.deleteMany({ where: { location: { packageId: { in: [paketA, paketB] } } } });
  await setPengingatGrupAktif(true);
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => {});
  await db.$disconnect();
});

/**
 * Siapkan giliran HANYA untuk dua paket uji.
 *
 * DB uji dipakai bersama berkas lain, jadi `antrekanPengingatGrup` juga
 * menjaring paket milik uji lain dan giliran kita terselip di tengah. Yang
 * diuji blok `kurasPengingatGrup` adalah perilaku penguras — bukan siapa saja
 * yang kebetulan ada di DB — maka giliran asing dibuang dan giliran kita
 * dirapatkan ke SORE dan SORE+1 menit.
 */
async function siapkanGiliran(now = SORE) {
  await antrekanPengingatGrup(now);
  await db.groupReminderJob.deleteMany({ where: { packageId: { notIn: [paketA, paketB] } } });
  const milik = await db.groupReminderJob.findMany({
    where: { packageId: { in: [paketA, paketB] } },
    orderBy: { sendAfter: "asc" },
    select: { id: true },
  });
  for (const [i, r] of milik.entries()) {
    await db.groupReminderJob.update({
      where: { id: r.id },
      data: { sendAfter: new Date(now.getTime() + i * JEDA_ANTAR_GRUP_MS) },
    });
  }
}

/** Giliran milik paket-paket uji saja — DB uji dipakai bersama berkas lain. */
async function giliran() {
  return db.groupReminderJob.findMany({
    where: { packageId: { in: [paketA, paketB] } },
    orderBy: { sendAfter: "asc" },
    select: { packageId: true, sendAfter: true, status: true, locations: true, waMessageId: true },
  });
}

describe("antrekanPengingatGrup", () => {
  it("sakelar MATI = tidak satu giliran pun dibuat", async () => {
    await setPengingatGrupAktif(false);
    const hasil = await antrekanPengingatGrup(SORE);
    expect(hasil.aktif).toBe(false);
    expect(await giliran()).toHaveLength(0);
  });

  it("satu giliran per paket, berjarak minimal satu menit", async () => {
    const hasil = await antrekanPengingatGrup(SORE);
    expect(hasil.dibuat).toBeGreaterThanOrEqual(2);

    const baris = (await giliran()).filter((g) => [paketA, paketB].includes(g.packageId));
    expect(baris).toHaveLength(2);
    const jarak = baris[1].sendAfter.getTime() - baris[0].sendAfter.getTime();
    expect(jarak).toBeGreaterThanOrEqual(JEDA_ANTAR_GRUP_MS);
  });

  it("dipicu dua kali sehari tidak menggandakan giliran", async () => {
    await antrekanPengingatGrup(SORE);
    const kedua = await antrekanPengingatGrup(new Date(SORE.getTime() + 60 * 60_000));
    expect(kedua.dibuat).toBe(0);
    expect(await giliran()).toHaveLength(2);
  });
});

describe("kurasPengingatGrup", () => {
  it("hanya mengirim yang SUDAH tiba gilirannya", async () => {
    await siapkanGiliran();
    // Tepat pada jam antre: baru giliran pertama yang jatuh tempo.
    const hasil = await kurasPengingatGrup({ now: SORE, tidur: async () => {} });
    expect(hasil.terkirim).toBe(1);
    expect(terkirim).toHaveLength(1);

    const baris = await giliran();
    expect(baris[0].status).toBe("terkirim");
    expect(baris[1].status).toBe("menunggu");
  });

  it("menunggu satu menit di antara dua pesan", async () => {
    await siapkanGiliran();
    const jeda: number[] = [];
    const hasil = await kurasPengingatGrup({
      now: new Date(SORE.getTime() + 5 * 60_000), // dua-duanya sudah jatuh tempo
      tidur: async (ms) => {
        jeda.push(ms);
      },
    });
    expect(hasil.terkirim).toBe(2);
    expect(jeda).toEqual([JEDA_ANTAR_GRUP_MS]);
  });

  it("grup yang keburu lengkap DILEWATI, tanpa pesan", async () => {
    await siapkanGiliran();
    // Laporan lokasi paket A masuk setelah gilirannya diantre.
    await db.dailyReport.create({
      data: {
        locationId: lokasiA,
        reportDate: new Date("2026-08-29T00:00:00.000Z"),
        status: "dikirim",
        createdById: userId,
      },
    });

    const hasil = await kurasPengingatGrup({ now: SORE, tidur: async () => {} });
    expect(hasil.dilewati).toBe(1);
    expect(hasil.terkirim).toBe(0);
    expect(terkirim).toHaveLength(0);
    expect((await giliran())[0].status).toBe("dilewati");
  });

  it("tidak pernah mengirim dua kali ke grup yang sama di hari yang sama", async () => {
    await siapkanGiliran();
    await kurasPengingatGrup({ now: SORE, tidur: async () => {} });
    await kurasPengingatGrup({ now: SORE, tidur: async () => {} });
    expect(terkirim.filter((t) => t.chatId === GRUP_A)).toHaveLength(1);
  });

  it("WAHA belum dikonfigurasi: giliran TIDAK dibakar jadi gagal", async () => {
    await siapkanGiliran();
    wahaHidup = false;
    const hasil = await kurasPengingatGrup({ now: SORE, tidur: async () => {} });
    expect(hasil.terkirim).toBe(0);
    // Masih menunggu — bukan `gagal`. Kalau dibakar, pengingat hari itu hilang
    // bukan karena grupnya sudah lengkap.
    expect((await giliran()).every((g) => g.status === "menunggu")).toBe(true);
  });
});
