// TANYA-JAWAB WHATSAPP BEBAS — perangkai, diuji terhadap DATABASE ASLI
// (DECISIONS 339).
//
// `waha-tanya-izin.test.ts` sudah membuktikan aturan izinnya secara MURNI. Yang
// TIDAK bisa dibuktikan di sana: apakah perangkainya benar-benar MEMANGGIL
// aturan itu, dengan urutan yang benar, dan dengan lokasi yang benar-benar dari
// basis data. Aturan yang benar tapi tidak terpanggil terlihat persis sama
// seperti aturan yang salah — dari sisi orang yang menerima balasannya.
//
// Karena itu berkas ini memakai `accessibleLocationIds`, `locationScopeWhere`,
// dan query lokasi yang ASLI. Yang dipalsukan hanya dua hal yang memang bukan
// milik kita: jaringan WhatsApp (`sendText`) dan penyedia AI (`aiStructured`).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Pesan yang "terkirim" ke WhatsApp — inti seluruh pembuktian di berkas ini. */
const terkirim: { chatId: string; teks: string }[] = [];

vi.mock("@/lib/waha/client", () => ({
  sendText: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  getNomorMarlin: async () => NOMOR_MARLIN,
}));

/** Niat yang "dibaca AI" — disetel per uji. */
let niatPalsu: unknown = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
let aiSehat = true;

vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async () =>
    aiSehat
      ? {
          ok: true,
          data: niatPalsu,
          meta: {
            ok: true,
            provider: "anthropic",
            model: "uji",
            text: "",
            usage: { inputTokens: 10, outputTokens: 5 },
            latencyMs: 1,
            finishReason: null,
          },
          attempts: 1,
        }
      : { ok: false, errorCode: "provider_down", error: "uji", meta: null, attempts: 1 },
}));

const NOMOR_MARLIN = "6281200000000";

const { db } = await import("@/lib/db");
const { jawabPertanyaanWa } = await import("@/lib/waha/tanya");

const suffix = `wt${Date.now().toString(36)}`;
const GRUP_A = `12036300000000001@g.us`;
const GRUP_LAIN_ORG = `12036300000000002@g.us`;

let orgId = "";
let orgLainId = "";
let lokA1 = "";
let lokA2 = "";
let lokB1 = "";
let nomorSM = "6285700000001";
let nomorAdmin = "6285700000002";

async function buatPaket(oid: string, nama: string, waGroupId: string | null) {
  return db.package.create({ data: { orgId: oid, name: `${nama} ${suffix}`, waGroupId } });
}

async function buatLokasi(packageId: string, nama: string) {
  const l = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama.toLowerCase().replace(/\s+/g, "")}-${suffix}`,
      village: nama,
      regency: "Kab",
      province: "Prov",
      // `isActive` default-nya FALSE di skema; lokasi non-aktif tidak menagih
      // laporan dan sengaja tidak masuk katalog jawaban.
      isActive: true,
    },
  });
  return l.id;
}

async function buatUser(oid: string, nama: string, role: string, waNumber: string | null) {
  const u = await db.user.create({
    data: {
      orgId: oid,
      username: `${nama}-${suffix}`,
      fullName: nama,
      role: role as never,
      passwordHash: "x",
      waNumber,
    },
  });
  return u.id;
}

/** Event webhook WAHA seperti yang benar-benar tiba. */
function event(p: {
  chatId: string;
  dari: string;
  teks: string;
  mention?: string[];
  fromMe?: boolean;
}) {
  const grup = p.chatId.endsWith("@g.us");
  return {
    event: "message",
    payload: {
      id: `msg-${Math.random().toString(36).slice(2)}`,
      from: grup ? p.chatId : `${p.dari}@c.us`,
      author: grup ? `${p.dari}@c.us` : undefined,
      fromMe: p.fromMe ?? false,
      body: p.teks,
      timestamp: Math.floor(Date.now() / 1000),
      mentionedIds: p.mention ?? [],
    },
  };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const orgLain = await db.organization.create({
    data: { name: `OrgLain ${suffix}`, slug: `ol-${suffix}` },
  });
  orgId = org.id;
  orgLainId = orgLain.id;

  const pkgA = await buatPaket(orgId, "Paket A", GRUP_A);
  const pkgB = await buatPaket(orgId, "Paket B", null);
  const pkgLain = await buatPaket(orgLainId, "Paket Tetangga", GRUP_LAIN_ORG);

  lokA1 = await buatLokasi(pkgA.id, "Kedung Mutih");
  lokA2 = await buatLokasi(pkgA.id, "Kedungmalang");
  lokB1 = await buatLokasi(pkgB.id, "Tengket");
  await buatLokasi(pkgLain.id, "Batah Timur");

  // Site Manager: ditugaskan ke SELURUH lokasi org (A1, A2, B1).
  const sm = await buatUser(orgId, "SiteManager", "site_manager", nomorSM);
  for (const locationId of [lokA1, lokA2, lokB1]) {
    await db.locationAssignment.create({ data: { userId: sm, locationId } });
  }
  // Super admin: lintas lokasi, TANPA penugasan.
  await buatUser(orgId, "SuperAdmin", "super_admin", nomorAdmin);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ai_runs, audit_logs, location_assignments, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(() => {
  terkirim.length = 0;
  aiSehat = true;
  niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
});

describe("kapan MARLIN benar-benar membalas", () => {
  it("pesan grup TANPA mention: tidak ada apa pun yang dikirim", async () => {
    const r = await jawabPertanyaanWa(
      event({ chatId: GRUP_A, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
  });

  it("pesan dari MARLIN SENDIRI tidak pernah dijawab", async () => {
    // Tanpa pagar ini, balasan MARLIN masuk lagi lewat `message.any` dan MARLIN
    // membalas dirinya sendiri — tanpa henti, di grup pelanggan.
    const r = await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: NOMOR_MARLIN,
        teks: "mana yang deviasinya negatif",
        mention: [`${NOMOR_MARLIN}@c.us`],
        fromMe: true,
      }),
    );
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
  });

  it("chat pribadi dari nomor TIDAK DIKENAL: DIAM, bukan 'Anda belum terdaftar'", async () => {
    // Balasan apa pun mengkonfirmasi bahwa nomor ini milik sistem proyek.
    const r = await jawabPertanyaanWa(
      event({ chatId: "6289999999999@c.us", dari: "6289999999999", teks: "progress hari ini" }),
    );
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
  });

  it("chat pribadi dari pengguna terdaftar: dijawab", async () => {
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(r.dijawab).toBe(true);
    expect(terkirim).toHaveLength(1);
  });

  it("grup dengan mention ke MARLIN: dijawab", async () => {
    const r = await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSM,
        teks: "@6281200000000 mana yang deviasinya negatif",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    expect(r.dijawab).toBe(true);
    expect(terkirim).toHaveLength(1);
  });
});

describe("apa yang boleh bocor ke grup", () => {
  it("jawaban di grup TIDAK menyebut lokasi paket lain", async () => {
    // Inti seluruh fitur. Pertanyaan lintas lokasi yang dijawab jujur akan
    // menyebut Paket B ke seluruh anggota grup Paket A — termasuk vendornya.
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSM,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Kedung Mutih");
    expect(teks).not.toContain("Tengket");
    // Dan pemotongannya DIAKUI — jawaban sebagian yang diam akan dibaca lengkap.
    expect(teks).toContain("Paket A");
    expect(teks.toLowerCase()).toContain("chat pribadi");
  });

  it("chat pribadi orang yang sama: Tengket ikut — jadi pemotongan tadi nyata", async () => {
    // Tanpa uji pasangan ini, "tidak menyebut Tengket" bisa saja karena
    // Tengket memang tidak pernah muncul di jawaban mana pun.
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "siapa yang belum lapor" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Tengket");
    expect(teks).toContain("Kedung Mutih");
  });

  it("SUPER ADMIN pun dipotong di grup", async () => {
    // Izin penanya tidak menaikkan apa yang pantas dibaca ANGGOTA GRUP.
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorAdmin,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Kedung Mutih");
    expect(teks).not.toContain("Tengket");
  });

  it("grup milik ORGANISASI LAIN: ditolak, bukan dijawab dengan data mereka", async () => {
    // Grup ini tertaut paket — tapi paket tenant lain. Super admin kita tidak
    // boleh menjadi pintu masuk ke sana hanya karena izinnya "tanpa batas".
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_LAIN_ORG,
        dari: nomorAdmin,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).not.toContain("Batah Timur");
    expect(teks.toLowerCase()).toContain("belum tertaut paket");
  });
});

describe("nama lokasi di pertanyaan", () => {
  it("nama ambigu: BALIK BERTANYA menyebut kandidat, tidak memilih", async () => {
    niatPalsu = { niat: "progress", lokasiDisebut: ["kedung"], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "progress di kedung" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Kedung Mutih");
    expect(teks).toContain("Kedungmalang");
    expect(teks.toLowerCase()).toContain("nama lengkapnya");
  });

  it("lokasi di LUAR lingkup grup: 'tidak ditemukan', bukan diam-diam jadi semua", async () => {
    // Kegagalan yang dijaga: nama tak dikenal diabaikan, `lokasiDisebut` jadi
    // kosong, lalu jawabannya melebar ke SELURUH lingkup — menjawab pertanyaan
    // yang tidak ditanyakan, dengan data yang tidak diminta.
    niatPalsu = { niat: "progress", lokasiDisebut: ["Tengket"], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSM,
        teks: "progress di Tengket",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).toContain("tidak menemukan lokasi");
    expect(teks).not.toContain("Kedung Mutih");
  });

  it("satu lokasi disebut: hanya lokasi itu yang dijawab", async () => {
    niatPalsu = { niat: "progress", lokasiDisebut: ["Tengket"], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "progress di Tengket" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Tengket");
    expect(teks).not.toContain("Kedung Mutih");
  });
});

describe("mengaku saat tidak bisa", () => {
  it("niat null: mengaku belum mengerti + menyebut yang bisa dijawab", async () => {
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "besok hujan tidak" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).toContain("belum mengerti");
    expect(teks.toLowerCase()).toContain("deviasi");
  });

  it("AI mati: mengaku, TIDAK mengarang jawaban", async () => {
    aiSehat = false;
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).toContain("tidak bisa membaca");
    // Tidak ada satu pun nama lokasi di balasan gagal.
    expect(teks).not.toContain("Kedung");
  });

  it("pemakaian AI tercatat di ai_runs — kuota guard menghitung dari sana", async () => {
    const sebelum = await db.aiRun.count({ where: { runKind: "tanya" } });
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(await db.aiRun.count({ where: { runKind: "tanya" } })).toBe(sebelum + 1);
  });

  it("jawaban yang berhasil ditulis ke audit", async () => {
    const sebelum = await db.auditLog.count({ where: { action: "waha.tanya" } });
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(await db.auditLog.count({ where: { action: "waha.tanya" } })).toBe(sebelum + 1);
  });
});
