// SIAPA YANG MEMINTA KIRIMAN WHATSAPP (DECISIONS baru 2026-10-07).
//
// Keluhan user: *"marlin mengirim data dari sistem ke wa … siapa yg request?
// perlu diketahui siapa peminta data agar jelas"*. Yang dijaga:
//   1. kiriman dari tombol di aplikasi mencatat akun + label peminta di outbox;
//   2. balasan atas pertanyaan di grup MENGUTIP pesan penanya (reply_to) dan
//      mencatat penanyanya – lewat konteks balasan, tanpa disebut di tiap
//      pemanggil;
//   3. kutipan yang ditolak WAHA (4xx) tidak menggagalkan jawaban: dikirim
//      ulang sekali TANPA kutipan; galat jaringan (5xx) tidak diulang;
//   4. kalimat keterangan di pesan: "atas permintaan Nama (Peran)" dan
//      "Pesan otomatis MARLIN – … Tidak ada yang memintanya".
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

let tolakKutipan: number | null = null;
const dikirim: { chatId: string; teks?: string; caption?: string; replyTo: string | null }[] = [];

class WahaErrorPalsu extends Error {
  readonly status?: number;
  constructor(m: string, s?: number) {
    super(m);
    this.status = s;
  }
}

vi.mock("@/lib/waha/client", () => ({
  WahaError: WahaErrorPalsu,
  getSessionStatus: async () => ({ name: "default", status: "WORKING" }),
  kirimMentahTeks: async (chatId: string, teks: string, replyTo?: string | null) => {
    if (replyTo && tolakKutipan) throw new WahaErrorPalsu("kutipan tidak ditemukan", tolakKutipan);
    dikirim.push({ chatId, teks, replyTo: replyTo ?? null });
    return `WA_${dikirim.length}`;
  },
  kirimMentahGambar: async () => "WA_G",
  kirimMentahFile: async (chatId: string, _f: unknown, caption?: string, replyTo?: string | null) => {
    dikirim.push({ chatId, caption, replyTo: replyTo ?? null });
    return `WA_${dikirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { sendText, sendFile, balasWa } = await import("@/lib/waha/kirim");
const { jalankanDenganKonteksBalasan } = await import("@/lib/waha/konteks-balasan");
const { catatanOtomatis, catatanPeminta, denganCatatan, pemintaPengguna } = await import("@/lib/waha/asal-pesan");
const { pesanKendalaTenggat } = await import("@/lib/kendala/pesan-tenggat");

const GRUP = "120363000000007777@g.us";
const suffix = `wp${Date.now().toString(36)}`;
let userId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  userId = (
    await db.user.create({
      data: { orgId: org.id, username: `budi-${suffix}`, fullName: "Budi Santoso", passwordHash: "x", role: "site_manager" },
    })
  ).id;
});

beforeEach(async () => {
  tolakKutipan = null;
  dikirim.length = 0;
  await db.waOutbound.deleteMany({ where: { chatId: GRUP } });
});

afterAll(async () => {
  await db.waOutbound.deleteMany({ where: { chatId: GRUP } });
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("kalimat keterangan asal pesan", () => {
  it("tombol aplikasi menyebut nama dan peran peminta", () => {
    const p = pemintaPengguna({ id: "u1", fullName: "Budi Santoso", role: "site_manager" });
    expect(p.label).toBe("Budi Santoso (Site Manager)");
    expect(denganCatatan("*Laporan Harian*\n📍 Kranji", catatanPeminta(p))).toBe(
      "*Laporan Harian*\n📍 Kranji\n\n_Dikirim lewat MARLIN atas permintaan Budi Santoso (Site Manager)._",
    );
  });

  it("pengingat terjadwal menyebut dirinya otomatis dan tidak diminta siapa pun", () => {
    expect(catatanOtomatis("uji")).toBe("_Pesan otomatis MARLIN – uji._");
    const teks = pesanKendalaTenggat("Paket A", [
      { judul: "Material terlambat", lokasi: "Kranji", pic: null, lewatHari: 3 },
    ] as Parameters<typeof pesanKendalaTenggat>[1])!;
    expect(teks).toContain("_Pesan otomatis MARLIN – pengingat harian kendala lewat tenggat. Tidak ada yang memintanya");
  });
});

describe("outbox mencatat peminta", () => {
  it("kiriman dari tombol aplikasi: akun + label tersimpan untuk setiap pesan kiriman itu", async () => {
    const peminta = pemintaPengguna({ id: userId, fullName: "Budi Santoso", role: "site_manager" });
    await sendText(GRUP, denganCatatan("Laporan", catatanPeminta(peminta)), { peminta });
    await sendFile(GRUP, { mimetype: "application/pdf", filename: "a.pdf", data: "eA==" }, "a.pdf", { peminta });
    const rows = await db.waOutbound.findMany({ where: { chatId: GRUP }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.dimintaOlehId).toBe(userId);
      expect(r.peminta).toBe("Budi Santoso (Site Manager)");
    }
    expect(dikirim[0]!.teks).toContain("atas permintaan Budi Santoso (Site Manager)");
  });

  it("kiriman terjadwal (tanpa peminta) tercatat kosong", async () => {
    await sendText(GRUP, "pengingat");
    const r = await db.waOutbound.findFirstOrThrow({ where: { chatId: GRUP } });
    expect(r.dimintaOlehId).toBeNull();
    expect(r.peminta).toBeNull();
  });
});

describe("balasan di grup mengutip penanya", () => {
  const konteks = () => ({ balasKe: "false_120363@g.us_PESANPENANYA", dimintaOlehId: userId, peminta: "Budi Santoso" });

  it("balasan membawa reply_to dan mencatat penanyanya", async () => {
    await jalankanDenganKonteksBalasan(konteks(), () => balasWa(GRUP, "Progres Kranji 42%"));
    expect(dikirim).toEqual([{ chatId: GRUP, teks: "Progres Kranji 42%", replyTo: "false_120363@g.us_PESANPENANYA" }]);
    const r = await db.waOutbound.findFirstOrThrow({ where: { chatId: GRUP } });
    expect(r).toMatchObject({ dimintaOlehId: userId, peminta: "Budi Santoso", status: "diterima_waha" });
  });

  it("kutipan ditolak WAHA (4xx): jawaban tetap terkirim, sekali, tanpa kutipan", async () => {
    tolakKutipan = 400;
    await jalankanDenganKonteksBalasan(konteks(), () => balasWa(GRUP, "Progres Kranji 42%"));
    expect(dikirim).toEqual([{ chatId: GRUP, teks: "Progres Kranji 42%", replyTo: null }]);
    const rows = await db.waOutbound.findMany({ where: { chatId: GRUP } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("diterima_waha");
  });

  it("galat server (5xx) tidak diulang tanpa kutipan – itu bukan soal kutipannya", async () => {
    tolakKutipan = 502;
    await expect(
      jalankanDenganKonteksBalasan(konteks(), () => balasWa(GRUP, "Progres Kranji 42%")),
    ).rejects.toThrow();
    expect(dikirim).toEqual([]);
  });

  it("di luar penjawab pesan, balasan tidak membawa kutipan", async () => {
    await balasWa(GRUP, "halo");
    expect(dikirim[0]!.replyTo).toBeNull();
  });
});
