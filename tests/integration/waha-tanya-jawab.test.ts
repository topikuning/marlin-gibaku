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
/** Berkas yang "terkirim" — jalur PDF untuk daftar panjang (DECISIONS 448). */
const berkasTerkirim: { chatId: string; nama: string; mime: string; caption: string; bytes: number }[] =
  [];

vi.mock("@/lib/waha/client", () => ({
  // Identitas sesi = nomor DAN LID (DECISIONS 349). Dipalsukan seperti WAHA
  // yang sudah bermigrasi ke identitas privasi: mention di grup berisi @lid.
  getIdentitasMarlin: async () => ({ nomor: NOMOR_MARLIN, lid: LID_MARLIN }),
}));

/*
 * Jalur kirim dipalsukan di `@/lib/waha/kirim`, BUKAN di `client` (DECISIONS 374).
 *
 * Sejak gateway kanonik ada, pemanggil fitur tidak lagi menyentuh `client`
 * langsung: `client` tinggal transport mentah, dan `kirim` yang menumpang
 * gateway (periksa sesi → catat outbox → simpan message id). Memalsukan
 * `client` saja membuat uji menembus gateway sungguhan — yang benar, tapi
 * bukan yang sedang diuji berkas ini.
 */
vi.mock("@/lib/waha/kirim", () => ({
  // `balasWa` = jalur balasan atas pesan MASUK (DECISIONS 439). `sendText`
  // ikut ditiru karena berkas lain memakainya; keduanya dicatat sama.
  balasWa: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  sendText: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  balasFileWa: async (
    chatId: string,
    file: { mimetype: string; filename: string; data: string },
    caption?: string,
  ) => {
    berkasTerkirim.push({
      chatId,
      nama: file.filename,
      mime: file.mimetype,
      caption: caption ?? "",
      bytes: Buffer.from(file.data, "base64").length,
    });
    return "mock-id";
  },
}));

/** Niat yang "dibaca AI" — disetel per uji. */
let niatPalsu: unknown = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
let aiSehat = true;

/**
 * Keluaran ask-shaped untuk jalur TANYA BEBAS (`tanya-bebas.ts`).
 *
 * `aiStructured` melayani DUA kontrak di berkas ini: pembaca niat dan penjawab
 * bebas. Dulu stub-nya mengembalikan niat untuk keduanya, jadi penjawab bebas
 * membaca `answerParts` dari objek niat dan meledak dengan
 * "parts is not iterable" — kegagalan stub yang menyamar sebagai bug produksi.
 *
 * Tanpa bagian jawaban, penjawab bebas jatuh ke kalimat "sumber tidak cukup".
 * Itu memang keluaran yang benar untuk uji-uji di sini: yang diperiksa adalah
 * lapisan di sekitarnya (pengenalan lokasi, kutipan catatan, penanda), bukan
 * karangan model.
 */
const jawabanBebasPalsu: unknown = {
  answer: "Belum ada bagian jawaban yang bersumber untuk data uji ini.",
  answerParts: [],
  citations: [],
  confidence: 0,
  limitations: [],
};

/**
 * Bila menyala, penjawab bebas MENYALIN satu fakta dari prompt-nya sendiri.
 *
 * Butir terbuka yang ditinggalkan sesi sebelumnya: jalur tanya bebas tidak
 * pernah diuji dengan jawaban yang benar-benar bersumber, karena stub-nya
 * selalu mengembalikan `answerParts: []` sehingga selalu jatuh ke "sumber
 * tidak cukup". Yang lolos validator dengan begitu tidak pernah tersentuh uji.
 *
 * Faktanya TIDAK dikarang di sini: ia dibaca dari baris "FAKTA YANG BOLEH
 * DIKLAIM" di dalam prompt — persis seperti model sungguhan yang hanya boleh
 * mengklaim angka yang disodorkan MARLIN. Menuliskan id/angka tetap di uji
 * akan membuatnya lulus untuk alasan yang salah (dan pecah tiap kali data seed
 * berubah).
 */
let jawabanBersumber = false;
/** Bila diisi, jawaban bebas menyalin metrik ini – bukan fakta pertama. */
let metrikJawabanBersumber: string | null = null;

/** Baris fakta pertama di prompt → satu klaim yang sah. `null` bila tak ada. */
function klaimDariPrompt(prompt: string, metric?: string | null): Record<string, unknown> | null {
  const semua = [
    ...prompt.matchAll(
      /- locationId=(\S+) metric=(\S+) value=(\S+) periodKey=(\S+) sourceRefId=(\S+)/g,
    ),
  ];
  const m = metric ? semua.find((x) => x[2] === metric) : semua[0];
  if (!m) return null;
  return {
    locationId: m[1],
    metric: m[2],
    value: Number(m[3]),
    periodKey: m[4],
    sourceRefId: m[5],
  };
}

vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async (_skema: unknown, req?: { schemaHint?: string; prompt?: string }) =>
    aiSehat
      ? {
          ok: true,
          // Hanya SCHEMA_HINTS.ask yang memuat "answerParts" — pembeda yang
          // tegas antara kedua kontrak, tanpa mengimpor apa pun ke dalam
          // factory vi.mock yang ter-hoisting.
          data: req?.schemaHint?.includes("answerParts")
            ? bebas(req?.prompt ?? "")
            : niatPalsu,
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

/**
 * Pertanyaan yang MEMANG harus dibaca AI.
 *
 * Tidak memuat satu pun kata kunci niat dan tidak menyebut waktu, jadi parser
 * deterministik menyerahkannya — persis jalur yang diuji oleh uji-uji AI di
 * berkas ini.
 */
function bebas(prompt: string): unknown {
  if (!jawabanBersumber) return jawabanBebasPalsu;
  const klaim = klaimDariPrompt(prompt, metrikJawabanBersumber);
  if (!klaim) return jawabanBebasPalsu;
  const teks = metrikJawabanBersumber
    ? `Sudah diperiksa sampai akhir periode: ${klaim.value} laporan.`
    : "Pekerjaan tanggul masih berjalan di lokasi yang saya periksa.";
  return {
    // Angka hanya dipakai bila disalin dari klaim yang sama; jalur bawaan
    // sengaja tetap tanpa angka untuk menjaga uji jawaban kualitatif lama.
    answer: teks,
    answerParts: [
      {
        text: teks,
        claims: [klaim],
        kutipan: [],
        sourceRefIds: [],
      },
    ],
    citations: [{ sourceRefId: klaim.sourceRefId, note: null }],
    confidence: 80,
    limitations: [],
  };
}

const TANYA_BUTUH_AI = "bagaimana keadaan pekerjaan tanggul";

const NOMOR_MARLIN = "6281200000000";
const LID_MARLIN = "77712345678901";

const { db } = await import("@/lib/db");
const { jawabPertanyaanWa } = await import("@/lib/waha/tanya");
const { normalizeWaTarget } = await import("@/lib/contacts/model");

const suffix = `wt${Date.now().toString(36)}`;
const GRUP_A = `12036300000000001@g.us`;
const GRUP_LAIN_ORG = `12036300000000002@g.us`;
/** Grup yang TIDAK tertaut paket mana pun — jalur baru brief 5A. */
const GRUP_LEPAS = `12036300000000003@g.us`;

let orgId = "";
let orgLainId = "";
let lokA1 = "";
let lokA2 = "";
let lokB1 = "";
let nomorSM = "6285700000001";
const nomorSmB = "6285700000009";
let nomorAdmin = "6285700000002";
/** Program Director org kita — peran istimewa kedua (brief 5A). */
const nomorPD = "6285700000003";
/** Super admin ORGANISASI LAIN — dipakai membuktikan batas tenancy. */
const nomorAdminLain = "6285700000004";

async function buatPaket(oid: string, nama: string, waGroupId: string | null) {
  return db.package.create({ data: { orgId: oid, name: `${nama} ${suffix}`, waGroupId } });
}

async function buatLokasi(packageId: string, nama: string, regency = "Kab") {
  const l = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama.toLowerCase().replace(/\s+/g, "")}-${suffix}`,
      village: nama,
      // Kabupaten SUNGGUHAN, bukan "Kab" untuk semua: penanya lapangan menyebut
      // daerah, dan kabupaten yang seragam membuat perilaku itu tak teruji
      // (DECISIONS 367).
      regency,
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
      /*
       * Ditulis PERSIS seperti aplikasi menulisnya — lewat `normalizeWaTarget`,
       * yang menghasilkan "628…@c.us" (DECISIONS 345). Versi pertama uji ini
       * menaruh nomor polos, jadi ia hijau sementara produksi diam total: yang
       * diuji bukan data yang benar-benar ada di basis data.
       */
      waNumber: waNumber ? normalizeWaTarget(waNumber) : null,
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
  /** Dipakai uji idempotensi: webhook yang sama dikirim ulang membawa id sama. */
  id?: string;
  /** ID pesan yang DIKUTIP — pengikat jawaban pilihan (DECISIONS 376). */
  mengutip?: string;
}) {
  const grup = p.chatId.endsWith("@g.us");
  return {
    event: "message",
    payload: {
      id: p.id ?? `msg-${Math.random().toString(36).slice(2)}`,
      from: grup ? p.chatId : `${p.dari}@c.us`,
      author: grup ? `${p.dari}@c.us` : undefined,
      fromMe: p.fromMe ?? false,
      body: p.teks,
      timestamp: Math.floor(Date.now() / 1000),
      mentionedIds: p.mention ?? [],
      ...(p.mengutip ? { contextInfo: { stanzaId: p.mengutip } } : {}),
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

  lokA1 = await buatLokasi(pkgA.id, "Kedung Mutih", "Demak");
  lokA2 = await buatLokasi(pkgA.id, "Kedungmalang", "Demak");
  lokB1 = await buatLokasi(pkgB.id, "Tengket", "Bangkalan");
  await buatLokasi(pkgLain.id, "Batah Timur", "Bangkalan");

  // Site Manager: ditugaskan ke SELURUH lokasi org (A1, A2, B1).
  const sm = await buatUser(orgId, "SiteManager", "site_manager", nomorSM);
  for (const locationId of [lokA1, lokA2, lokB1]) {
    await db.locationAssignment.create({ data: { userId: sm, locationId } });
  }
  // Super admin: lintas lokasi, TANPA penugasan.
  await buatUser(orgId, "SuperAdmin", "super_admin", nomorAdmin);
  // Peran istimewa kedua + super admin organisasi lain (brief 5A).
  await buatUser(orgId, "ProgramDirector", "program_director", nomorPD);
  await buatUser(orgLainId, "AdminOrgLain", "super_admin", nomorAdminLain);
  // Orang organisasi LAIN — dipakai menguji pemetaan @lid lintas organisasi.
  await buatUser(orgLainId, "OrangOrgLain", "site_manager", null);
  // Pengguna TERDAFTAR yang ditugaskan HANYA ke paket B — dipakai membuktikan
  // pembalikan DECISIONS 351: dulu ia ditolak di grup paket A, sementara orang
  // tak terdaftar justru dilayani di grup yang sama.
  const smB = await buatUser(orgId, "SmPaketB", "site_manager", nomorSmB);
  await db.locationAssignment.create({ data: { userId: smB, locationId: lokB1 } });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ai_runs, audit_logs, location_assignments, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  terkirim.length = 0;
  berkasTerkirim.length = 0;
  aiSehat = true;
  jawabanBersumber = false;
  metrikJawabanBersumber = null;
  niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
  /*
   * Kuota AI (20 analisis/jam/pengguna) dinolkan tiap uji.
   *
   * Tanpa ini, JUMLAH uji di berkas ini ikut menentukan hasilnya: uji-uji awal
   * menghabiskan jatah SiteManager, lalu uji yang jauh di bawah menerima
   * "Batas 20 analisis AI per jam tercapai" alih-alih jawaban yang sedang
   * diperiksa. Persis itu yang terjadi saat dua uji kabupaten ditambahkan —
   * uji yang merah bukan uji yang berubah. Satu uji sudah membersihkannya
   * sendiri sejak dulu; pembersihan itu memang milik seluruh berkas.
   *
   * Tidak ada uji di sini yang menguji BATASnya sendiri — yang ada menghitung
   * SELISIH baris ai_runs, dan selisih tidak terganggu penolan.
   */
  await db.aiRun.deleteMany({});
  // Tawaran klarifikasi juga durable (DECISIONS 376): tawaran yang tersisa dari
  // uji sebelumnya akan membuat "1" di uji berikutnya menjawab pertanyaan lain.
  await db.waPendingClarification.deleteMany({});
  // Konteks susulan juga durable (DECISIONS 377): konteks sisa uji sebelumnya
  // akan membuat "kalau kemarin?" menyambung ke pertanyaan yang salah.
  await db.waChatContext.deleteMany({});
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

describe("perintah membuat laporan benar-benar mengirim berkasnya", () => {
  /*
   * Keluhan user 2026-08-29, dengan tangkapan layar: *"buat laporan kemarin
   * untuk kranji"* dijawab kutipan catatan lapangan berikut keluhan *"Tidak
   * saya kenali: buat"* — sementara yang ia harapkan adalah berkas laporan
   * lengkap berikut kendalanya.
   *
   * DUA cacat bertumpuk, dan yang pertama membuat yang kedua tak pernah
   * kelihatan:
   *
   * 1. Niat `produksi` memang dikenali `parseNiatDeterministik`, tetapi
   *    `rencanaDeterministik` menuntut tidak ada kata yang tak terjelaskan dan
   *    "buat" tidak pernah dihapus dari sisa frasa — jadi kalimatnya
   *    diserahkan ke AI, yang menjawabnya sebagai pencarian catatan.
   * 2. Sekalipun sampai, balasannya hanya menolak: "buka Report Studio".
   *
   * Diuji lewat `jawabPertanyaanWa` dengan parser SUNGGUHAN (bukan niat palsu),
   * karena cacat pertama justru ada di penyambungan — persis pelajaran dari
   * kadens bulanan.
   */
  it("REGRESI: 'buat laporan …' tidak lagi jatuh ke pencarian catatan", async () => {
    niatPalsu = null; // paksa jalur deterministik + AI sungguhan
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "buat laporan kemarin untuk kedung mutih" }),
    );
    const teks = terkirim.map((t) => t.teks).join("\n");
    expect(teks, "tidak ada balasan").not.toBe("");
    expect(teks).not.toContain("Tidak saya kenali: buat");
    expect(teks).toContain("Blanko harian");
    expect(berkasTerkirim, "teks menjanjikan berkas, tetapi tidak ada PDF yang dikirim").toHaveLength(1);
    expect(berkasTerkirim[0]).toMatchObject({
      chatId: `${nomorSM}@c.us`,
      mime: "application/pdf",
    });
    expect(berkasTerkirim[0].nama).toMatch(/^laporan-harian-.*\.pdf$/);
    expect(berkasTerkirim[0].bytes).toBeGreaterThan(0);
  });
});

describe("kejujuran waktu sampai ke jawaban WhatsApp", () => {
  it("REGRESI: verifikasi yang dibuat SESUDAH akhir periode belum dihitung pada periode itu", async () => {
    const pemeriksa = await db.user.findFirstOrThrow({
      where: { orgId, role: "super_admin" },
      select: { id: true },
    });
    const laporanSebelumBatas = await db.dailyReport.create({
      data: {
        locationId: lokA1,
        reportDate: new Date("2026-06-29T00:00:00.000Z"),
        status: "dikirim",
        createdById: pemeriksa.id,
      },
      select: { id: true },
    });
    const laporanSetelahBatas = await db.dailyReport.create({
      data: {
        locationId: lokA1,
        reportDate: new Date("2026-06-30T00:00:00.000Z"),
        status: "dikirim",
        createdById: pemeriksa.id,
      },
      select: { id: true },
    });
    await db.reportVerification.createMany({
      data: [
        {
          reportId: laporanSebelumBatas.id,
          status: "diverifikasi",
          verifiedById: pemeriksa.id,
          // 30 Juni 23.59.59 WIB — masih harus dihitung.
          createdAt: new Date("2026-06-30T16:59:59.000Z"),
        },
        {
          reportId: laporanSetelahBatas.id,
          status: "diverifikasi",
          verifiedById: pemeriksa.id,
          // 1 Juli 00.00 WIB — pada akhir 30 Juni belum terjadi.
          createdAt: new Date("2026-06-30T17:00:00.000Z"),
        },
      ],
    });

    niatPalsu = {
      niat: null,
      lokasiDisebut: ["Kedung Mutih"],
      periode: { jenis: "tanggal", hari: 30, bulan: 6, tahun: 2026 },
    };
    jawabanBersumber = true;
    metrikJawabanBersumber = "laporan_sudah_diverifikasi";

    const hasil = await jawabPertanyaanWa(
      event({
        // Verifikasi eksternal dipagari kapabilitas. Pakai Super Admin supaya
        // yang diuji benar-benar integritas waktunya, bukan penolakan izin SM.
        chatId: `${nomorAdmin}@c.us`,
        dari: nomorAdmin,
        teks: "berapa laporan yang sudah diperiksa wakil PPK per 30 Juni 2026?",
      }),
    );
    expect(hasil.dijawab, hasil.alasan).toBe(true);
    expect(hasil.alasan).toBe("dijawab fleksibel dari sumber MARLIN");
    expect(terkirim.map((x) => x.teks).join("\n")).toContain(
      "Sudah diperiksa sampai akhir periode: 1 laporan.",
    );
    // ReportVerification append-only. Jejak uji tidak dihapus satu per satu;
    // teardown berkas melakukan TRUNCATE ... CASCADE seperti fixture lain.
  });
});

describe("kadens rekap disebut sesuai yang diminta", () => {
  /*
   * Rekap BULANAN memakai pengambil data dan perakit balasan yang SAMA dengan
   * mingguan (DECISIONS 462) — rumusnya memang sama, dan itu disengaja. Yang
   * tidak disengaja: versi pertama membiarkan judul dan sebutan periodenya
   * terpatok "mingguan", sehingga chat berbunyi "Laporan mingguan · sepanjang
   * pekan" sementara PDF lampirannya berjudul "Laporan bulanan".
   *
   * Diuji lewat `jawabPertanyaanWa`, BUKAN lewat perakitnya langsung: cacatnya
   * ada di penyambungan, dan uji yang memanggil perakit dengan judul yang benar
   * akan hijau justru ketika penyambungnya salah.
   */
  it("REGRESI: laporan_bulanan menyebut BULAN, bukan pekan", async () => {
    niatPalsu = { niat: "laporan_bulanan", lokasiDisebut: [], periode: "bulan_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "rekap bulanan" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks, "tidak ada balasan yang terkirim").not.toBe("");
    expect(teks).toContain("Laporan bulanan");
    expect(teks).not.toContain("Laporan mingguan");
    expect(teks).not.toContain("sepanjang pekan");
  });

  it("laporan_mingguan tetap menyebut PEKAN – kadens lama tidak ikut berubah", async () => {
    // Uji pasangan: tanpa ini, "tidak menyebut mingguan" bisa saja karena
    // kata itu memang tak pernah muncul di jalur mana pun.
    niatPalsu = { niat: "laporan_mingguan", lokasiDisebut: [], periode: "minggu_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "rekap mingguan" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Laporan mingguan");
    expect(teks).not.toContain("Laporan bulanan");
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

  it("chat pribadi orang yang sama: Tengket ikut – jadi pemotongan tadi nyata", async () => {
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

  it("grup ORGANISASI LAIN: dijawab dengan data GRUPNYA, tak pernah data kita", async () => {
    /*
     * DIBALIK OLEH DECISIONS 351 — dan justru mengencang.
     *
     * Versi lama menolak seluruhnya, karena `paketGrup` disaring dengan orgId
     * penanya: lingkup grup di-irisan dengan izin penanya, dan izin super admin
     * "tanpa batas" akan melahap lokasi grup asing.
     *
     * Sejak lingkup grup ditentukan PAKET GRUPNYA, syarat itu tidak diperlukan
     * — dan tidak mungkin lagi, karena penanya boleh tidak terdaftar. Yang
     * menggantikannya lebih kuat dan diuji di sini: apa pun organisasi
     * penanyanya, jawaban di grup ini berisi data paket GRUP INI, dan lokasi
     * organisasi KITA tidak pernah ikut.
     */
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({
        chatId: GRUP_LAIN_ORG,
        dari: nomorAdmin,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    const teks = terkirim[0]?.teks ?? "";
    // Arah yang benar-benar berbahaya: data KITA muncul di grup tenant lain.
    expect(teks).not.toContain("Kedung Mutih");
    expect(teks).not.toContain("Kedungmalang");
    expect(teks).not.toContain("Tengket");
    // Dan jawabannya memang dipotong ke paket grup itu, bukan melebar.
    expect(teks).toContain("Paket Tetangga");
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

  it("nama KABUPATEN dijawab, bukan 'tidak menemukan lokasi'", async () => {
    /*
     * Keluhan user 2026-08-19 dari WhatsApp sungguhan: *"apa jember kemarin
     * laporan?"* → *"Saya tidak menemukan lokasi: jember. Mungkin salah ketik,
     * atau di luar penugasan Anda."* Padahal Jember kabupaten, dan lokasinya
     * ada. Katalog nama saja tidak cukup — orang lapangan menyebut daerah.
     */
    niatPalsu = { niat: "progress", lokasiDisebut: ["Demak"], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "progress di Demak" }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).not.toContain("tidak menemukan lokasi");
    // Kedua lokasi di Kabupaten Demak ikut …
    expect(teks).toContain("Kedung Mutih");
    expect(teks).toContain("Kedungmalang");
    // … yang di kabupaten lain TIDAK.
    expect(teks).not.toContain("Tengket");
    // Dan balasannya MENGAKU bahwa yang dibaca itu kabupaten — tanpa ini,
    // penanya mengira sedang membaca angka satu lokasi.
    expect(teks).toContain("Kabupaten Demak");
    expect(teks).toContain("2 lokasi");
  });

  it("kabupaten di luar lingkup penanya tetap 'tidak ditemukan'", async () => {
    // Menyebut kabupaten tidak boleh jadi jalan pintas melewati pemotongan
    // izin: Batah Timur (Bangkalan) milik organisasi LAIN.
    niatPalsu = { niat: "progress", lokasiDisebut: ["Bangkalan"], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSM,
        teks: "progress di Bangkalan",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).toContain("tidak menemukan lokasi");
    expect(teks).not.toContain("Batah Timur");
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

describe("periode lampau: jujur soal WAKTU yang dijawab (DECISIONS 369)", () => {
  const tanya = async (teks: string) => {
    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks }));
    return terkirim[0]?.teks ?? "";
  };

  it("deviasi lampau TIDAK lagi mengaku 'posisi HARI INI'", async () => {
    /*
     * Kalimat itu dulu benar dan sekarang salah. `dataDeviasi` menerima
     * `dateKey` dan meneruskannya sebagai `asOf`, jadi angkanya memang posisi
     * tanggal yang ditanya — keterangan lama berubah dari pengakuan jujur
     * menjadi keterangan keliru, dan keterangan keliru yang terdengar
     * berhati-hati lebih merusak daripada tidak ada keterangan sama sekali.
     */
    niatPalsu = {
      niat: "deviasi",
      lokasiDisebut: [],
      periode: { jenis: "mundur_hari", hari: 7 },
    };
    const teks = await tanya("deviasi seminggu lalu");
    expect(teks.toLowerCase()).not.toContain("posisi hari ini");
    expect(teks.toLowerCase()).not.toContain("belum bisa menghitung deviasi");
  });

  it("laporan harian untuk RENTANG tetap menyebut tanggal mana yang diambil", async () => {
    // Laporan harian selalu satu tanggal. Meminjam label rentang ("minggu
    // lalu") untuk isi satu hari adalah judul yang tidak dijawab isinya.
    niatPalsu = {
      niat: "laporan",
      lokasiDisebut: [],
      periode: { jenis: "rentang", satuan: "minggu", mundur: 1 },
    };
    const teks = await tanya("minta laporan minggu lalu");
    expect(teks).toContain("Laporan harian selalu satu tanggal");
    expect(teks.toLowerCase()).toContain("hari terakhirnya");
  });

  it("kendala 'terbuka sekarang' untuk periode lampau TETAP mengaku begitu", async () => {
    /*
     * Cabang `terbuka_sekarang` masih ada dan masih harus jujur: daftarnya
     * keadaan SEKARANG, bukan keadaan pada periode yang ditanya.
     *
     * Pertanyaannya sengaja yang MEMANG lewat AI. Sejak DECISIONS 381, teks
     * yang menyebut "kendala" + periode lampau dicegat parser dan DITAWARI dua
     * cara baca — jadi memakai teks itu di sini akan menguji jalur yang tidak
     * pernah sampai ke cabang ini.
     */
    niatPalsu = {
      niat: "kendala",
      lokasiDisebut: [],
      periode: { jenis: "mundur_hari", hari: 1 },
    };
    const teks = await tanya(TANYA_BUTUH_AI);
    expect(teks).toContain("masih TERBUKA sekarang");
  });

  it("'kendala kemarin' kini DITAWARI dua cara baca, bukan dipilihkan", async () => {
    /*
     * Koreksi user 2026-08-19 (DECISIONS 381): mesin klarifikasi memang dibuat
     * untuk kasus ini. Sebelumnya MARLIN memilih sendiri — menjawab semua yang
     * terbuka sekarang lalu menempel catatan bahwa itu bukan keadaan pada
     * periode yang ditanya. Jujur, tapi menjawab pertanyaan yang tidak
     * ditanyakan.
     */
    const teks = await tanya("kendala kemarin apa saja");
    expect(teks).toContain("Maksud Anda yang mana?");
    expect(teks).toContain("DIBUKA");
    expect(teks).toContain("MASIH TERBUKA");
  });
});

describe("akses istimewa Super Admin & Program Director (brief 5A, DECISIONS 371)", () => {
  const mention = [`${NOMOR_MARLIN}@c.us`];

  const tanya = async (chatId: string, dari: string, teks: string, pakaiMention = false) => {
    await jawabPertanyaanWa(
      event({ chatId, dari, teks, ...(pakaiMention ? { mention } : {}) }),
    );
    return terkirim[0]?.teks ?? "";
  };

  it("super admin dijawab lewat DM", async () => {
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(`${nomorAdmin}@c.us`, nomorAdmin, "deviasi");
    expect(teks).not.toBe("");
    // 3 lokasi org kita (A1, A2, B1) — bukan 4 (Batah Timur milik org lain).
    expect(teks).toContain("3 yang saya periksa");
  });

  it("program director dijawab lewat DM", async () => {
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(`${nomorPD}@c.us`, nomorPD, "deviasi");
    expect(teks).toContain("3 yang saya periksa");
  });

  it("keduanya dijawab di grup TIDAK tertaut, sesudah mention", async () => {
    /*
     * Ini jalur yang sebelumnya selalu ditolak. Yang membuatnya aman bukan
     * grupnya — grup itu tidak menyatakan apa pun — melainkan identitas
     * pengirim yang terverifikasi lewat nomor tersimpan.
     */
    for (const nomor of [nomorAdmin, nomorPD]) {
      terkirim.length = 0;
      await db.aiRun.deleteMany({});
      niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
      const teks = await tanya(GRUP_LEPAS, nomor, "deviasi", true);
      expect(teks, nomor).not.toContain("belum tertaut paket");
      expect(teks, nomor).toContain("3 yang saya periksa");
    }
  });

  it("jawaban di grup tak tertaut MENYEBUT dasar lingkupnya", async () => {
    // Anggota grup lain berhak tahu kenapa data proyek muncul di grup yang
    // tidak tertaut paket apa pun.
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(GRUP_LEPAS, nomorPD, "deviasi", true);
    expect(teks).toContain("Program Director");
    expect(teks).toContain("tidak tertaut paket");
  });

  it("scope-nya dari ORG + PERAN, bukan dari grupnya", async () => {
    /*
     * Super admin ORGANISASI LAIN bertanya di grup yang sama. Kalau lingkupnya
     * diambil dari grup, ia akan menerima data org kita. Yang benar: ia hanya
     * melihat organisasinya sendiri — yang di fixture ini berisi 1 lokasi.
     */
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(GRUP_LEPAS, nomorAdminLain, "deviasi", true);
    expect(teks).toContain("1 yang saya periksa");
    expect(teks).not.toContain("Kedung Mutih");
  });

  it("pengguna BIASA di grup tak tertaut TIDAK memperoleh data proyek", async () => {
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(GRUP_LEPAS, nomorSM, "deviasi", true);
    expect(teks).toContain("belum tertaut paket");
    expect(teks).not.toContain("yang saya periksa");
  });

  it("nomor TIDAK dikenal di grup tak tertaut tetap ditolak", async () => {
    // Nama tampilan yang meniru direktur tidak pernah sampai ke resolver
    // sebagai identitas — yang dibaca hanya nomor/LID.
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(GRUP_LEPAS, "6289999999999", "deviasi", true);
    expect(teks).toContain("belum tertaut paket");
  });

  it("di grup TERTAUT, super admin tetap dipotong ke paket grup", async () => {
    /*
     * Pagar yang paling gampang jebol saat aturan 5A ditambahkan. Balasannya
     * dibaca seluruh anggota grup paket A, termasuk vendornya — melebarkannya
     * karena yang bertanya direktur berarti data paket B bocor ke sana.
     */
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya(GRUP_A, nomorAdmin, "deviasi", true);
    expect(teks).toContain("2 yang saya periksa"); // A1 + A2 saja
    expect(teks).not.toContain("Tengket");
    expect(teks).toContain("hanya mencakup");
  });

  it("audit mencatat asal scope dan peran yang dipakai", async () => {
    // Brief 5A: audit harus menyebut kanal, grup tertaut atau tidak, asal
    // scope, dan perannya — tanpa itu, kejadian ini tidak bisa ditelusuri.
    // `audit_logs` append-only di level basis data (trigger menolak
    // UPDATE/DELETE), jadi barisnya tidak dibersihkan — cukup ambil yang
    // TERBARU sesudah aksi ini.
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: "hari_ini" };
    await tanya(GRUP_LEPAS, nomorPD, "deviasi", true);
    const baris = await db.auditLog.findFirst({
      where: { action: "waha.tanya" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const meta = baris?.payload as Record<string, unknown> | null;
    expect(meta?.asalScope).toBe("privileged_user");
    expect(meta?.peranDipakai).toBe("program_director");
    expect(meta?.grup).toBe(true);
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
    /*
     * Pertanyaannya sengaja yang MEMANG butuh AI (DECISIONS 375). "mana yang
     * deviasinya negatif" tidak lagi menyentuh provider sama sekali, jadi
     * memakainya di sini akan menguji matinya AI lewat jalur yang tidak pernah
     * memanggil AI — hijau yang tidak membuktikan apa pun.
     */
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: TANYA_BUTUH_AI }),
    );
    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).toContain("tidak bisa membaca");
    // Tidak ada satu pun nama lokasi di balasan gagal.
    expect(teks).not.toContain("Kedung");
  });

  it("pemakaian AI tercatat di ai_runs – kuota guard menghitung dari sana", async () => {
    const sebelum = await db.aiRun.count({ where: { runKind: "tanya" } });
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: TANYA_BUTUH_AI }),
    );
    expect(await db.aiRun.count({ where: { runKind: "tanya" } })).toBe(sebelum + 1);
  });

  it("pola JELAS dijawab tanpa menyentuh AI sama sekali (DECISIONS 375)", async () => {
    /*
     * Sisi lain dari uji di atas, dan alasan seluruh parser deterministik ada.
     *
     * Yang dibuktikan bukan "lebih murah", melainkan tiga hal yang terukur:
     * tidak ada baris `ai_runs` (kuota tidak terpakai), jawabannya tetap
     * lengkap, dan — lewat `aiSehat = false` — ia tetap terjawab WALAU provider
     * AI sedang mati total.
     */
    aiSehat = false;
    const sebelum = await db.aiRun.count({ where: { runKind: "tanya" } });
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(await db.aiRun.count({ where: { runKind: "tanya" } })).toBe(sebelum);

    const teks = terkirim[0]?.teks ?? "";
    expect(teks.toLowerCase()).not.toContain("tidak bisa membaca");
    expect(teks.toLowerCase()).toContain("deviasi");
  });

  it("jawaban yang berhasil ditulis ke audit", async () => {
    const sebelum = await db.auditLog.count({ where: { action: "waha.tanya" } });
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(await db.auditLog.count({ where: { action: "waha.tanya" } })).toBe(sebelum + 1);
  });
});

describe("mengenali penanya dari nomornya", () => {
  it("nomor tersimpan ber-sufiks @c.us tetap dikenali", async () => {
    // Cacat produksi 2026-08-17: seluruh pengguna tidak dikenali karena
    // nomornya dicocokkan sebagai TEKS terhadap varian tanpa sufiks.
    const u = await db.user.findFirstOrThrow({
      where: { fullName: "SiteManager" },
      select: { waNumber: true },
    });
    expect(u.waNumber, "data uji tidak lagi memakai bentuk simpanan asli").toContain("@c.us");

    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "mana yang deviasinya negatif" }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
  });

  it("nomor yang TIDAK terdaftar tetap didiamkan, dan ALASANNYA tercatat", async () => {
    /*
     * Diam itu benar; yang salah dulu adalah diam TANPA JEJAK. Ketika user
     * melapor "tidak ada respon sama sekali", log hit tidak bisa membedakan
     * "webhook tidak pernah datang" dari "datang, lalu sengaja didiamkan".
     */
    const r = await jawabPertanyaanWa(
      event({ chatId: "6289999999999@c.us", dari: "6289999999999", teks: "progress hari ini" }),
    );
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
    expect(r.alasan).toContain("6289999999999");
    expect(r.alasan.toLowerCase()).toContain("tidak cocok");
  });
});

describe("penanya ber-identitas privasi @lid (DECISIONS 347)", () => {
  /*
   * Laporan user 2026-08-17, log Sistem apa adanya:
   *
   *   diabaikan — chat pribadi (tidak diarsipkan) · tanya: diam — didiamkan —
   *   nomor ? tidak cocok dengan pengguna mana pun          143026840146095@lid
   *
   * Nomornya SUDAH tersimpan di data pengguna; yang tidak dikirim WhatsApp
   * adalah nomor itu sendiri. Blok ini menempuh jalur webhook yang sama persis
   * dengan pesan aslinya.
   */
  const LID = "143026840146095";
  const eventLid = (teks: string, extra: Record<string, unknown> = {}) => ({
    event: "message",
    payload: {
      id: `msg-lid-${Math.random().toString(36).slice(2)}`,
      from: `${LID}@lid`,
      fromMe: false,
      body: teks,
      timestamp: Math.floor(Date.now() / 1000),
      ...extra,
    },
  });

  it("tanpa pemetaan: DIAM, tapi log menyebut LID-nya DAN cara memperbaikinya", async () => {
    await db.user.updateMany({ where: { fullName: "SiteManager" }, data: { waLid: null } });
    const r = await jawabPertanyaanWa(eventLid("ada tanya"));
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
    // Log lama hanya berbunyi "nomor ? tidak cocok" — betul, dan tidak berguna.
    expect(r.alasan).toContain(LID);
    expect(r.alasan).toContain("@lid");
  });

  it("medan payload ikut tercatat, supaya nama medannya tidak perlu ditebak", async () => {
    const r = await jawabPertanyaanWa(eventLid("ada tanya", { participantAlt: `${LID}@lid` }));
    expect(r.alasan).toContain("medan payload");
    expect(r.alasan).toContain("participantAlt=");
  });

  it("sesudah admin memetakan LID: DIJAWAB", async () => {
    await db.user.updateMany({ where: { fullName: "SiteManager" }, data: { waLid: LID } });
    const r = await jawabPertanyaanWa(eventLid("mana yang deviasinya negatif"));
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
    // Dibalas ke JID @lid-nya — satu-satunya alamat yang kita punya untuk dia.
    expect(terkirim[0].chatId).toBe(`${LID}@lid`);
  });

  it("nomor pasangan di payload dipakai TANPA pemetaan apa pun", async () => {
    // Kalau WAHA memang mengirim nomor pasangannya, pemetaan admin tak perlu.
    await db.user.updateMany({ where: { fullName: "SiteManager" }, data: { waLid: null } });
    const r = await jawabPertanyaanWa(
      eventLid("mana yang deviasinya negatif", { senderPn: `${nomorSM}@c.us` }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
  });

  it("pemetaan ke pengguna organisasi lain tidak membocorkan lokasi kita", async () => {
    /*
     * LID dipetakan ke orang di organisasi LAIN. Ia berhak dijawab sebagai
     * dirinya sendiri — yang tidak boleh adalah jawabannya berisi lokasi kita.
     */
    await db.user.updateMany({ where: { fullName: "SiteManager" }, data: { waLid: null } });
    await db.user.updateMany({ where: { fullName: "OrangOrgLain" }, data: { waLid: LID } });
    const r = await jawabPertanyaanWa(eventLid("mana yang deviasinya negatif"));
    // Dijawab SEBAGAI DIRINYA — bukan didiamkan. Kalau ini didiamkan, baris
    // "tidak menyebut Tengket" di bawah lolos tanpa membuktikan apa pun.
    expect(r.dijawab, `didiamkan: ${r.alasan}`).toBe(true);
    const isi = terkirim.map((t) => t.teks).join("\n");
    expect(isi, `alasan: ${r.alasan}`).not.toContain("Tengket");
    expect(isi).not.toContain("Kedung");
    await db.user.updateMany({ where: { fullName: "OrangOrgLain" }, data: { waLid: null } });
  });
});

describe("mention MARLIN di grup, apa pun bentuk identitasnya (DECISIONS 349)", () => {
  /*
   * Tangkapan layar user 2026-08-17: baris log berbunyi
   *   "tersimpan ✓ · tanya: diam — grup tanpa mention ke MARLIN"
   * untuk pesan yang JELAS me-mention MARLIN. Pesannya tersimpan — jadi webhook
   * sampai, grup tertaut, parser bekerja. Yang gagal hanya pengenalan diri
   * sendiri: mention berisi @lid MARLIN, dicocokkan lewat nomor.
   */
  const grupEvent = (payload: Record<string, unknown>) => ({
    event: "message",
    payload: {
      id: `mg-${Math.random().toString(36).slice(2)}`,
      from: GRUP_A,
      author: `${nomorSM}@c.us`,
      body: "@marlin mana yang deviasinya negatif",
      timestamp: Math.floor(Date.now() / 1000),
      ...payload,
    },
  });

  it("mention ber-@lid: DIJAWAB", async () => {
    const r = await jawabPertanyaanWa(grupEvent({ mentionedIds: [`${LID_MARLIN}@lid`] }));
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
  });

  it("mention bersarang di contextInfo NOWEB: DIJAWAB", async () => {
    const r = await jawabPertanyaanWa(
      grupEvent({
        message: { extendedTextMessage: { contextInfo: { mentionedJid: [`${LID_MARLIN}@lid`] } } },
      }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
  });

  it("membalas pesan MARLIN: DIJAWAB tanpa mention sama sekali", async () => {
    const r = await jawabPertanyaanWa(
      grupEvent({
        message: { extendedTextMessage: { contextInfo: { participant: `${LID_MARLIN}@lid` } } },
      }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
  });

  it("mention ke ORANG LAIN tetap diam – pagarnya tidak ikut longgar", async () => {
    const r = await jawabPertanyaanWa(grupEvent({ mentionedIds: ["99900000000000@lid"] }));
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
  });

  it("diam di grup menyebut APA YANG DILIHAT, bukan cuma kesimpulannya", async () => {
    /*
     * Log lama hanya berbunyi "grup tanpa mention ke MARLIN" — tidak bisa
     * membedakan "daftar mention kosong" dari "berisi, tapi bukan kita".
     * Keduanya butuh tindakan yang sama sekali berbeda.
     */
    const kosong = await jawabPertanyaanWa(grupEvent({}));
    expect(kosong.alasan).toContain("tidak ada mention terbaca");

    const salah = await jawabPertanyaanWa(grupEvent({ mentionedIds: ["99900000000000@lid"] }));
    expect(salah.alasan).toContain("99900000000000@lid");
    expect(salah.alasan).toContain(NOMOR_MARLIN);
  });
});

describe("payload ASLI dari lapangan: @lid + key.remoteJidAlt (DECISIONS 350)", () => {
  /*
   * Salinan payload yang benar-benar tertangkap di log Sistem 2026-08-17 16.06,
   * sesudah DECISIONS 347 terpasang. Diagnostiknya bekerja dan menyebut nama
   * medannya — `key.remoteJidAlt` — yang tidak ada di daftar tebakan 347 dan
   * tidak berada di permukaan payload.
   *
   * Uji ini menempuh perangkai UTUH, bukan parser saja: yang gagal di produksi
   * bukan pembacaan payload-nya, melainkan penanya tidak dikenali sehingga
   * balasannya "nomor Anda belum terdaftar".
   */
  const LID = "143026840146095";
  const evLid = (extra: Record<string, unknown>) => ({
    event: "message.any",
    payload: {
      id: `asli-${Math.random().toString(36).slice(2)}`,
      timestamp: Math.floor(Date.now() / 1000),
      body: "mana yang deviasinya negatif",
      from: `${LID}@lid`,
      ...extra,
    },
  });

  it("chat pribadi: DIJAWAB tanpa pemetaan admin apa pun", async () => {
    await db.user.updateMany({ where: { fullName: "SiteManager" }, data: { waLid: null } });
    const r = await jawabPertanyaanWa(
      evLid({
        key: {
          remoteJid: `${LID}@lid`,
          remoteJidAlt: `${nomorSM}@s.whatsapp.net`,
          fromMe: false,
        },
      }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
    // Dibalas ke chat asalnya — satu-satunya alamat yang WhatsApp berikan.
    expect(terkirim[0].chatId).toBe(`${LID}@lid`);
  });

  it("di GRUP: bukan lagi 'nomor Anda belum terdaftar'", async () => {
    /*
     * Keluhan user 2026-08-17: di-mention di grup, MARLIN menjawab "Maaf, nomor
     * Anda belum terdaftar sebagai pengguna MARLIN" — padahal nomornya
     * terdaftar. Pengirim grup ber-@lid, nomornya di medan pasangan.
     */
    await db.user.updateMany({ where: { fullName: "SiteManager" }, data: { waLid: null } });
    const r = await jawabPertanyaanWa({
      event: "message.any",
      payload: {
        id: `grup-asli-${Math.random().toString(36).slice(2)}`,
        timestamp: Math.floor(Date.now() / 1000),
        body: "@marlin mana yang deviasinya negatif",
        from: GRUP_A,
        author: `${LID}@lid`,
        participantAlt: `${nomorSM}@s.whatsapp.net`,
        mentionedIds: [`${LID_MARLIN}@lid`],
      },
    });
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].teks).not.toContain("belum terdaftar");
  });

  it("nomor pasangan DIUTAMAKAN atas pemetaan LID yang salah orang", async () => {
    /*
     * Kalau admin terlanjur memetakan LID ini ke orang lain, nomor asli dari
     * payload yang menang — ia berasal dari WhatsApp, bukan dari ketikan.
     */
    await db.user.updateMany({ where: { fullName: "OrangOrgLain" }, data: { waLid: LID } });
    const r = await jawabPertanyaanWa(
      evLid({ key: { remoteJid: `${LID}@lid`, remoteJidAlt: `${nomorSM}@s.whatsapp.net` } }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    // Dijawab dalam LINGKUP SiteManager (3 lokasi), bukan lingkup orang org
    // lain (0 lokasi) — pembeda yang benar-benar ada di teks balasannya.
    expect(terkirim[0].teks).toContain("3 yang saya periksa");
    await db.user.updateMany({ where: { fullName: "OrangOrgLain" }, data: { waLid: null } });
  });
});

describe("di grup, pengirim TIDAK perlu terdaftar (DECISIONS 351)", () => {
  /*
   * Instruksi user 2026-08-17: *"untuk mention di group nomor yang mention
   * tidak perlu terdaftar. selama itu chat di dalam group, jawab sesuai paket
   * group itu."*
   *
   * Sebelumnya balasannya: "Maaf, nomor Anda belum terdaftar sebagai pengguna
   * MARLIN" — yang memblokir mandor lapangan dari data paketnya sendiri, di
   * grup paketnya sendiri.
   */
  const ORANG_ASING = "6289876543210";

  it("nomor tak terdaftar di grup tertaut: DIJAWAB dengan data paket grup", async () => {
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: ORANG_ASING,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).not.toContain("belum terdaftar");
    // Lingkupnya paket grup — dan HANYA itu.
    expect(teks).toContain("Paket A");
    expect(teks).not.toContain("Tengket");
  });

  it("pengirim ber-@lid tanpa nomor pasangan pun dijawab di grup", async () => {
    // Gabungan dua keadaan yang dulu masing-masing mematikan jawaban.
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa({
      event: "message",
      payload: {
        id: `lid-grup-${Math.random().toString(36).slice(2)}`,
        timestamp: Math.floor(Date.now() / 1000),
        from: GRUP_A,
        author: "99900000000001@lid",
        body: "siapa yang belum lapor",
        mentionedIds: [`${NOMOR_MARLIN}@c.us`],
      },
    });
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    expect(terkirim[0]?.teks ?? "").not.toContain("belum terdaftar");
  });

  it("CHAT PRIBADI tidak ikut longgar – nomor tak dikenal tetap DIDIAMKAN", async () => {
    /*
     * Pagar yang tidak boleh ikut terbuka. Di chat pribadi tidak ada grup yang
     * membatasi apa pun, jadi identitas penanya satu-satunya dasar. Balasan apa
     * pun — termasuk penolakan — mengkonfirmasi bahwa nomor ini milik sistem
     * proyek dan mengundang percobaan berikutnya.
     */
    const r = await jawabPertanyaanWa(
      event({ chatId: `${ORANG_ASING}@c.us`, dari: ORANG_ASING, teks: "progress hari ini" }),
    );
    expect(r.dijawab).toBe(false);
    expect(terkirim).toHaveLength(0);
  });

  it("grup TANPA tautan paket tetap ditolak, dan alasannya bisa ditindak", async () => {
    // Tanpa tautan tidak ada dasar memutuskan apa yang pantas dibaca anggotanya
    // — kelonggaran ini berhenti persis di situ.
    const r = await jawabPertanyaanWa(
      event({
        chatId: "12036399999999999@g.us",
        dari: ORANG_ASING,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    expect(r.dijawab).toBe(true);
    expect(terkirim[0]?.teks.toLowerCase() ?? "").toContain("belum tertaut paket");
  });

  it("jawaban grup SAMA persis, siapa pun yang bertanya", async () => {
    /*
     * Inti pembetulan sumbu: balasannya dikirim ke grup, dibaca semua anggota.
     * Kalau isinya berubah tergantung siapa mengetik, itu bukan perlindungan —
     * hanya ketidakkonsistenan di depan audiens yang sama persis.
     */
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const tanya = async (dari: string) => {
      // Uji-uji sebelumnya di berkas ini sudah memakai kuota AI per jam milik
      // SiteManager, jadi tanpa pembersihan ini yang terbandingkan adalah
      // penolakan guard — bukan isi jawabannya.
      await db.aiRun.deleteMany({});
      terkirim.length = 0;
      await jawabPertanyaanWa(
        event({
          chatId: GRUP_A,
          dari,
          teks: "siapa yang belum lapor",
          mention: [`${NOMOR_MARLIN}@c.us`],
        }),
      );
      return terkirim[0]?.teks ?? "";
    };
    const olehSM = await tanya(nomorSM);
    const olehAsing = await tanya(ORANG_ASING);
    expect(olehAsing).toBe(olehSM);
  });

  it("pemakaian AI penanya tak terdaftar TETAP tercatat – kuota tidak bocor", async () => {
    /*
     * Tanpa ini, satu grup ramai bisa menghabiskan anggaran AI sepanjang hari
     * sementara panel AI Hub melaporkan nol pemakaian. `userId` null, tapi
     * `orgId` dan `waChatId` terisi — itu yang dihitung guard.
     */
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const sebelum = await db.aiRun.count({ where: { waChatId: GRUP_A } });
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: ORANG_ASING,
        // Butuh AI: "siapa yang belum lapor" kini dijawab deterministik, dan
        // jalur itu memang TIDAK menulis ai_runs — bukan itu yang diuji di sini.
        teks: TANYA_BUTUH_AI,
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    const baris = await db.aiRun.findFirst({
      where: { waChatId: GRUP_A },
      orderBy: { createdAt: "desc" },
      select: { userId: true, orgId: true, waChatId: true },
    });
    expect(await db.aiRun.count({ where: { waChatId: GRUP_A } })).toBe(sebelum + 1);
    // Pengguna KARANGAN akan mencemari audit dan kuota per-pengguna orang lain.
    expect(baris?.userId).toBeNull();
    expect(baris?.orgId).toBe(orgId);
  });
});

describe("pembalikan yang dihilangkan DECISIONS 351", () => {
  /*
   * Kasus yang membedakan kebijakan lama dan baru, dan satu-satunya yang
   * membuktikannya lewat basis data.
   *
   * SmPaketB adalah pengguna TERDAFTAR, ditugaskan hanya ke Paket B. Ia
   * bertanya di grup Paket A.
   *
   *   aturan lama : irisan [Tengket] ∩ [Kedung*] = kosong → "Anda tidak punya
   *                 akses ke lokasi paket ini"
   *   aturan baru : lingkup = paket grup → dijawab, sama seperti anggota lain
   *
   * Digabung dengan kebijakan baru, aturan lama menghasilkan keadaan yang tak
   * bisa dipertahankan: orang TAK TERDAFTAR di grup itu dilayani, sementara
   * pengguna TERDAFTAR ini ditolak — terdaftar membuat seseorang melihat LEBIH
   * SEDIKIT, di grup yang sama.
   */
  it("pengguna terdaftar di luar penugasan paket grup: DIJAWAB, bukan ditolak", async () => {
    await db.aiRun.deleteMany({});
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSmB,
        teks: "siapa yang belum lapor",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).not.toContain("tidak punya akses");
    expect(teks).toContain("Kedung Mutih");
    // Tetap dipotong ke paket grup: Tengket miliknya sendiri pun tidak ikut.
    expect(teks).not.toContain("Tengket");
  });

  it("jawabannya identik dengan yang diterima orang tak terdaftar", async () => {
    // Kalau kedua jalur ini berbeda, berarti izin penanya masih ikut memotong.
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    const tanya = async (dari: string) => {
      await db.aiRun.deleteMany({});
      terkirim.length = 0;
      await jawabPertanyaanWa(
        event({
          chatId: GRUP_A,
          dari,
          teks: "siapa yang belum lapor",
          mention: [`${NOMOR_MARLIN}@c.us`],
        }),
      );
      return terkirim[0]?.teks ?? "";
    };
    expect(await tanya(nomorSmB)).toBe(await tanya("6289876543210"));
  });

  it("CHAT PRIBADI-nya tetap dipotong ke penugasannya sendiri", async () => {
    /*
     * Pembeda yang membuktikan kelonggaran ini berhenti di grup: orang yang
     * sama, pertanyaan yang sama, lewat chat pribadi → hanya lokasinya sendiri.
     */
    await db.aiRun.deleteMany({});
    niatPalsu = { niat: "kelengkapan", lokasiDisebut: [], periode: "hari_ini" };
    terkirim.length = 0;
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSmB}@c.us`, dari: nomorSmB, teks: "siapa yang belum lapor" }),
    );
    expect(r.dijawab, `tidak dijawab: ${r.alasan}`).toBe(true);
    const teks = terkirim[0]?.teks ?? "";
    expect(teks).toContain("Tengket");
    expect(teks).not.toContain("Kedung Mutih");
  });
});

describe("periode & niat baru – MARLIN yang luwes (DECISIONS 356)", () => {
  /*
   * Permintaan user 2026-08-17: *"aku ingin chat whatsapp ke marlin menjadi
   * seluwes mungkin … minta laporan harian, progress tanggal tertentu atau
   * kemarin, kemarin lusa"*.
   *
   * Yang diuji di sini BUKAN kepintaran AI-nya (itu dipalsukan), melainkan
   * bahwa struktur yang dihasilkan AI benar-benar SAMPAI ke pengambil data
   * dengan tanggal yang benar. Niat yang dibaca sempurna lalu diabaikan
   * perangkainya terlihat persis sama seperti AI yang bodoh.
   */
  const tanya = async (teks: string) => {
    terkirim.length = 0;
    await db.aiRun.deleteMany({});
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks }),
    );
    return { r, teks: terkirim[0]?.teks ?? "" };
  };

  it("'bantuan' menjelaskan kemampuannya sendiri, tanpa menyentuh data", async () => {
    // Kelenturan yang tidak diketahui sama dengan tidak ada: orang lapangan
    // tidak membaca dokumentasi.
    niatPalsu = { niat: "bantuan", lokasiDisebut: [], periode: { jenis: "hari_ini" } };
    const { r, teks } = await tanya("kamu bisa apa saja");
    expect(r.dijawab, r.alasan).toBe(true);
    expect(teks).toContain("Yang bisa saya jawab");
    expect(teks.toLowerCase()).toContain("kemarin lusa");
    expect(teks.toLowerCase()).toContain("laporan harian");
  });

  it("'laporan harian' mengirim ISI laporan, bukan sekadar siapa yang belum lapor", async () => {
    niatPalsu = { niat: "laporan", lokasiDisebut: [], periode: { jenis: "hari_ini" } };
    const { r, teks } = await tanya("minta laporan harian");
    expect(r.dijawab, r.alasan).toBe(true);
    expect(teks).toContain("Laporan harian");
    // Lokasi TANPA laporan tetap disebut — "belum ada laporan" tidak boleh
    // tertukar dengan "lokasi itu tidak saya periksa".
    expect(teks).toMatch(/Kedung Mutih|Kedungmalang|Tengket/);
  });

  it("'progress kemarin' memakai TANGGAL KEMARIN, dan mengatakannya", async () => {
    niatPalsu = { niat: "progress", lokasiDisebut: [], periode: { jenis: "mundur_hari", hari: 1 } };
    const { r, teks } = await tanya("progress kemarin");
    expect(r.dijawab, r.alasan).toBe(true);
    // Judulnya menyebut periode yang dijawab — kalau tidak, penanya tidak punya
    // cara tahu apakah pertanyaannya dimengerti.
    expect(teks).toContain("kemarin");
    expect(teks).not.toContain("kemarin lusa");
  });

  it("'kemarin lusa' berbeda dari 'kemarin'", async () => {
    niatPalsu = { niat: "progress", lokasiDisebut: [], periode: { jenis: "mundur_hari", hari: 2 } };
    const { teks } = await tanya("progress kemarin lusa");
    expect(teks).toContain("kemarin lusa");
  });

  it("tanggal yang DITULIS penanya dipakai apa adanya", async () => {
    niatPalsu = {
      niat: "laporan",
      lokasiDisebut: [],
      periode: { jenis: "tanggal", hari: 3, bulan: 7, tahun: 2026 },
    };
    const { teks } = await tanya("laporan tanggal 3 juli");
    expect(teks).toContain("3 Juli 2026");
  });

  it("DEVIASI untuk hari lampau kini benar-benar historis, tanpa caveat lama", async () => {
    /*
     * Uji ini DIBALIK, bukan dihapus — dan pembalikannya sengaja dicatat.
     *
     * Versi lamanya menuntut kalimat *"Deviasi ini posisi HARI INI; saya belum
     * bisa menghitung deviasi pada …"*. Waktu itu ia pagar kejujuran yang
     * benar: angkanya memang posisi hari ini apa pun periode yang ditanya.
     *
     * Audit user 2026-08-19 menunjukkan premisnya keliru sejak awal —
     * `getLocationsProgress` sudah menerima `asOf` sejak DECISIONS 275, jadi
     * yang kurang cuma meneruskan tanggalnya. Sesudah diteruskan, kalimat itu
     * berubah dari pengakuan jujur menjadi keterangan yang SALAH.
     *
     * Uji yang mengunci keterbatasan harus ikut dibalik saat keterbatasannya
     * hilang; kalau tidak, ia menjadi alasan untuk mempertahankan cacat.
     * DECISIONS 369.
     */
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: { jenis: "mundur_hari", hari: 2 } };
    const { teks } = await tanya("deviasi kemarin lusa");
    expect(teks).toContain("kemarin lusa");
    expect(teks).not.toContain("posisi HARI INI");
    expect(teks.toLowerCase()).not.toContain("belum bisa menghitung deviasi");
  });

  it("KENDALA 'terbuka sekarang' untuk hari lampau MENGAKU keadaannya sekarang", async () => {
    // Teksnya yang MEMANG lewat AI — "kendala kemarin" kini dicegat parser dan
    // ditawari dua cara baca (DECISIONS 381).
    niatPalsu = { niat: "kendala", lokasiDisebut: [], periode: { jenis: "mundur_hari", hari: 1 } };
    const { teks } = await tanya(TANYA_BUTUH_AI);
    expect(teks).toContain("masih TERBUKA sekarang");
  });

  it("niat kendala_dibuka TIDAK memakai catatan 'keadaan sekarang'", async () => {
    /*
     * Catatan itu benar untuk `terbuka_sekarang`, tapi untuk cabang periode ia
     * berubah dari pengakuan jujur menjadi keterangan yang SALAH — dan
     * keterangan salah yang terdengar berhati-hati lebih merusak daripada tidak
     * ada keterangan sama sekali.
     */
    niatPalsu = {
      niat: "kendala_dibuka",
      lokasiDisebut: [],
      periode: { jenis: "mundur_hari", hari: 1 },
    };
    const { teks } = await tanya(TANYA_BUTUH_AI);
    expect(teks).not.toContain("masih TERBUKA sekarang");
    expect(teks).toContain("Kendala yang dibuka");
  });

  it("deviasi HARI INI tidak memberi catatan yang tidak perlu", async () => {
    // Catatan yang muncul saat tidak dibutuhkan melatih orang mengabaikannya.
    niatPalsu = { niat: "deviasi", lokasiDisebut: [], periode: { jenis: "hari_ini" } };
    const { teks } = await tanya("mana yang deviasinya negatif");
    expect(teks).not.toContain("posisi HARI INI");
  });

  it("periode RENTANG 'minggu ini' menyebut pemotongan di hari ini", async () => {
    niatPalsu = {
      niat: "progress",
      lokasiDisebut: [],
      periode: { jenis: "rentang", satuan: "minggu", mundur: 0 },
    };
    const { teks } = await tanya("progress minggu ini");
    expect(teks).toContain("minggu ini");
  });

  it("periode tak terbaca jatuh ke hari ini, TIDAK menggagalkan jawaban", async () => {
    // AI bisa mengirim bentuk yang tidak kita kenal; itu tidak boleh membuat
    // penanya menerima kegagalan.
    niatPalsu = { niat: "progress", lokasiDisebut: [], periode: undefined };
    const { r, teks } = await tanya("progress");
    expect(r.dijawab, r.alasan).toBe(true);
    expect(teks).toContain("hari ini");
  });
});

describe("laporan MINGGUAN vs laporan HARIAN (DECISIONS 358)", () => {
  /*
   * Keluhan user 2026-08-18, dengan tangkapan layar: *"gak jelas apa yang
   * kuminta, sistem kasih apa"*.
   *
   * Ia mengetik "laporan mingguan kemantren, minggu kemarin" dan menerima kotak
   * berjudul **"Laporan harian — minggu lalu"** berisi SATU hari. Dua cacat
   * sekaligus, dan keduanya diuji terpisah di bawah:
   *
   *  1. niat "laporan mingguan" tidak ada sama sekali — AI terpaksa memetakannya
   *     ke laporan HARIAN;
   *  2. judulnya meminjam label rentang ("minggu lalu") padahal isinya satu
   *     tanggal — jawaban yang mengaku menjawab pertanyaan lain.
   */
  const tanya = async (teks: string) => {
    terkirim.length = 0;
    await db.aiRun.deleteMany({});
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks }),
    );
    return { r, teks: terkirim[0]?.teks ?? "" };
  };

  it("niat laporan_mingguan menjawab REKAP SEPEKAN, berjudul mingguan", async () => {
    niatPalsu = {
      niat: "laporan_mingguan",
      lokasiDisebut: [],
      periode: { jenis: "rentang", satuan: "minggu", mundur: 1 },
    };
    const { r, teks } = await tanya("laporan mingguan minggu kemarin");
    expect(r.dijawab, r.alasan).toBe(true);
    expect(teks).toContain("Laporan mingguan");
    expect(teks).not.toContain("Laporan harian");
    // Rekap sepekan menyebut penyebutnya: berapa hari sudah dilaporkan.
    expect(teks).toMatch(/\d+ dari \d+ hari sudah dilaporkan/);
  });

  it("judulnya menyebut RENTANG TANGGAL pekannya, bukan kata relatif", async () => {
    /*
     * "minggu lalu" berarti berbeda tergantung kapan dibaca, dan balasan
     * WhatsApp dibaca lagi berhari-hari kemudian — sering setelah diteruskan
     * ke PPK.
     */
    niatPalsu = {
      niat: "laporan_mingguan",
      lokasiDisebut: [],
      periode: { jenis: "rentang", satuan: "minggu", mundur: 1 },
    };
    const { teks } = await tanya("laporan mingguan minggu kemarin");
    expect(teks).toMatch(/pekan \d+ \w+ \d{4} – \d+ \w+ \d{4}/);
  });

  it("laporan HARIAN dengan periode rentang: judulnya TANGGAL, bukan 'minggu lalu'", async () => {
    /*
     * Cacat yang terlihat di tangkapan layar user. Laporan harian selalu SATU
     * tanggal; meminjam label rentang membuat kotak itu mengaku menjawab
     * sepekan padahal tidak.
     */
    niatPalsu = {
      niat: "laporan",
      lokasiDisebut: [],
      periode: { jenis: "rentang", satuan: "minggu", mundur: 1 },
    };
    const { teks } = await tanya("laporan minggu lalu");
    expect(teks).toContain("Laporan harian");
    /*
     * Baris SUBJUDUL diperiksa langsung, bukan lewat pola longgar. Versi
     * pertama uji ini memakai regex yang tidak menghitung tanda `*` penutup
     * judul, jadi ia tetap hijau ketika label rentang dikembalikan — uji gigi
     * yang membongkarnya.
     */
    const subjudul = teks.split("\n")[1];
    expect(subjudul, `subjudul: ${subjudul}`).toMatch(/^_\d+ \w+ \d{4}_$/);
    expect(subjudul).not.toContain("minggu");
    // Dan MENGAKU bahwa yang diambil hanya hari terakhirnya.
    expect(teks).toContain("Laporan harian selalu satu tanggal");
    expect(teks).toContain("laporan mingguan");
  });

  it("laporan harian SATU HARI tidak diberi catatan yang tidak perlu", async () => {
    // Catatan yang muncul saat tidak dibutuhkan melatih orang mengabaikannya.
    niatPalsu = { niat: "laporan", lokasiDisebut: [], periode: { jenis: "mundur_hari", hari: 1 } };
    const { teks } = await tanya("laporan kemarin");
    expect(teks).not.toContain("selalu satu tanggal");
  });

  it("tanpa periode, laporan mingguan memakai PEKAN BERJALAN dan mengatakannya", async () => {
    niatPalsu = { niat: "laporan_mingguan", lokasiDisebut: [], periode: { jenis: "hari_ini" } };
    const { r, teks } = await tanya("aku minta laporan mingguan");
    expect(r.dijawab, r.alasan).toBe(true);
    expect(teks).toContain("Laporan mingguan");
    expect(teks).toContain("Pekan berjalan");
  });

  it("'bantuan' membedakan laporan harian dari laporan mingguan", async () => {
    // Kalau daftarnya tidak membedakan keduanya, orang akan terus meminta yang
    // salah — dan itu persis cara keluhan ini bermula.
    niatPalsu = { niat: "bantuan", lokasiDisebut: [], periode: { jenis: "hari_ini" } };
    const { teks } = await tanya("kamu bisa apa saja");
    expect(teks).toContain("Laporan harian");
    expect(teks).toContain("Laporan mingguan");
  });
});


describe("klarifikasi tertunda – pilihan yang benar-benar bisa dijawab (DECISIONS 376)", () => {
  const ORANG_LAIN = "6289811111111";

  /** Ajukan pertanyaan kabur, kembalikan teks tawaran yang dikirim MARLIN. */
  async function tawarkan(dari = nomorSM, chatId = `${nomorSM}@c.us`) {
    const r = await jawabPertanyaanWa(
      event({ chatId, dari, teks: "bagaimana yang kemarin?" }),
    );
    return { hasil: r, teks: terkirim.at(-1)?.teks ?? "" };
  }

  it("pertanyaan kabur DITAWARI pilihan, bukan ditolak mentah", async () => {
    /*
     * Keberatan user 2026-08-19: "niat = null → tidak mengerti" terlalu cepat
     * menyerah. Tafsirnya cuma tiga, dan menyebutkannya memakai kata yang ia
     * tulis sendiri jauh lebih menolong daripada menu kemampuan generik.
     */
    const { teks } = await tawarkan();
    expect(teks).toContain("1.");
    expect(teks).toContain("2.");
    expect(teks).toContain("kemarin");
    expect(teks.toLowerCase()).not.toContain("belum mengerti");
  });

  it("tawaran TIDAK memanggil AI", async () => {
    const sebelum = await db.aiRun.count({ where: { runKind: "tanya" } });
    aiSehat = false; // provider mati — tawarannya tetap harus muncul
    const { teks } = await tawarkan();
    expect(teks).toContain("1.");
    expect(await db.aiRun.count({ where: { runKind: "tanya" } })).toBe(sebelum);
  });

  it('balasan "2" dijalankan – juga TANPA panggilan AI kedua', async () => {
    /*
     * Inti butir 22 brief. Kandidatnya sudah dihitung saat tawaran dibuat dan
     * disimpan utuh; membayar panggilan AI kedua untuk membaca ulang
     * pertanyaan yang sama adalah pemborosan yang tidak menambah apa pun.
     */
    await tawarkan();
    const sebelum = await db.aiRun.count({ where: { runKind: "tanya" } });
    aiSehat = false;
    terkirim.length = 0;

    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "2" }),
    );
    expect(r.dijawab).toBe(true);
    expect(await db.aiRun.count({ where: { runKind: "tanya" } })).toBe(sebelum);
    // Pilihan ke-2 = "laporan" (urutan kandidat: progress, laporan, kendala).
    expect(terkirim.at(-1)?.teks ?? "").toContain("Laporan harian");
  });

  it("orang LAIN di grup tidak bisa membajak klarifikasi dengan mengetik 1", async () => {
    /*
     * Pagar paling penting di fitur ini, dan alasan kuncinya chat + PENGIRIM.
     * Kalau dikunci per chat saja, jawaban orang lain akan tampil seolah
     * menjawab pertanyaan si penanya asli — dan tidak ada yang bisa
     * membedakannya.
     */
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSM,
        teks: "bagaimana yang kemarin?",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    expect(terkirim.at(-1)?.teks ?? "").toContain("1.");
    terkirim.length = 0;

    // Orang lain menjawab "1" di grup yang sama.
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: ORANG_LAIN,
        teks: "1",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    // Bukan jawaban pilihan → jatuh ke jalur biasa, BUKAN menjalankan pilihan
    // milik orang lain.
    expect(terkirim.at(-1)?.teks ?? "").not.toContain("Progress");

    // Tawaran penanya asli masih utuh — belum terpakai oleh siapa pun.
    const baris = await db.waPendingClarification.findFirst({
      where: { chatId: GRUP_A, senderKey: `${nomorSM}@c.us` },
      select: { answeredAt: true },
    });
    expect(baris?.answeredAt).toBeNull();
  });

  it("tawaran KEDALUWARSA dikatakan, tidak didiamkan", async () => {
    await tawarkan();
    // Dituakan langsung di basis data — menunggu 12 menit di uji tidak masuk akal.
    await db.waPendingClarification.updateMany({
      where: { chatId: `${nomorSM}@c.us` },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    terkirim.length = 0;

    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "1" }));
    const teks = terkirim.at(-1)?.teks ?? "";
    // Diam di sini terbaca seperti sistem rusak: penanya baru saja mengetik "1".
    expect(teks.toLowerCase()).toContain("sudah lewat");
  });

  it("angka di LUAR daftar disebut batasnya", async () => {
    await tawarkan();
    terkirim.length = 0;
    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "7" }));
    expect(terkirim.at(-1)?.teks ?? "").toContain("1–3");
  });

  it("webhook yang DIULANG tidak menawarkan dua kali", async () => {
    const id = "msg-ulang-tawaran";
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "bagaimana yang kemarin?", id }),
    );
    const setelahSatu = terkirim.length;
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "bagaimana yang kemarin?", id }),
    );
    expect(terkirim.length).toBe(setelahSatu);
    expect(r.dijawab).toBe(false);
  });

  it("jawaban yang DIULANG tidak dijalankan dua kali", async () => {
    await tawarkan();
    terkirim.length = 0;
    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "1" }));
    const setelahSatu = terkirim.length;
    expect(setelahSatu).toBe(1);

    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "1" }));
    // Balasan kedua BUKAN pengulangan jawaban pilihan.
    expect(terkirim.at(-1)?.teks ?? "").not.toContain("Progress");
  });

  it("balasan yang MENGUTIP pesan lain bukan jawaban untuk tawaran ini", async () => {
    /*
     * Di grup ramai beberapa percakapan berjalan bersamaan. Angka yang mengutip
     * pesan lain, kalau dijalankan, menjawab percakapan yang salah.
     */
    await tawarkan();
    terkirim.length = 0;
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: `${nomorSM}@c.us`,
        dari: nomorSM,
        teks: "1",
        mengutip: "pesan-percakapan-lain",
      }),
    );
    expect(terkirim.at(-1)?.teks ?? "").not.toContain("Progress");
  });

  it("pertanyaan yang JELAS tidak pernah ditawari pilihan", async () => {
    // Menawarkan pilihan untuk "progress hari ini" akan membuang waktu yang
    // justru sedang dihemat parser deterministik.
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "progress hari ini" }),
    );
    expect(terkirim.at(-1)?.teks ?? "").not.toContain("Maksud Anda yang mana?");
  });

  it("jejak audit menyebut tawaran DAN pilihannya", async () => {
    await tawarkan();
    const tawar = await db.auditLog.findFirst({
      where: { action: "waha.tanya.tawar" },
      orderBy: { createdAt: "desc" },
    });
    expect(tawar).not.toBeNull();

    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "3" }));
    const pilih = await db.auditLog.findFirst({
      where: { action: "waha.tanya.klarifikasi" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect((pilih?.payload as { pilihan?: number } | null)?.pilihan).toBe(3);
  });
});


describe("pertanyaan susulan – dilengkapi dari konteks (DECISIONS 377)", () => {
  const pribadi = () => `${nomorSM}@c.us`;

  it('"bagaimana yang kemarin?" MENYAMBUNG pertanyaan sebelumnya, bukan ditanya balik', async () => {
    /*
     * Percakapan lapangan tidak mengulang subjeknya. Menawarkan daftar pilihan
     * di sini berarti menanyakan sesuatu yang BARU SAJA kita jawab sendiri.
     */
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "progress hari ini" }),
    );
    terkirim.length = 0;

    aiSehat = false; // menyambung konteks tidak boleh memanggil AI
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "bagaimana yang kemarin?" }),
    );
    const teks = terkirim.at(-1)?.teks ?? "";
    expect(teks).not.toContain("Maksud Anda yang mana?");
    expect(teks).toContain("Progress");
  });

  it("periode diambil dari SUSULAN, niat dari konteks", async () => {
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "ada kendala apa" }),
    );
    terkirim.length = 0;
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "kalau kemarin?" }),
    );
    // Niat "kendala" dipinjam; periodenya yang ia sebut sendiri.
    expect(terkirim.at(-1)?.teks ?? "").toContain("Kendala");
  });

  it("NIAT yang disebut susulan menang atas konteks – bukan dibajak", async () => {
    /*
     * Cacat produksi 2026-08-20, dilaporkan user dengan tangkapan layar:
     *
     *   "siapa yang belum lapor kemarin?" → Kelengkapan laporan, kemarin ✓
     *   "kendala minggu lalu"             → Kelengkapan laporan, minggu lalu ✗
     *
     * Pertanyaan kedua menyebut "kendala" sejelas-jelasnya. Yang bercabang
     * cuma cara membacanya (DECISIONS 381), dan cabang itu dulu bertipe sama
     * dengan "pertanyaan tanpa niat" – jadi konteks meminjam niat lama dan
     * membuang kata yang baru saja ditulis penanya.
     *
     * Ini kelas kesalahan terburuk di fitur ini: bukan gagal menjawab,
     * melainkan menjawab pertanyaan yang TIDAK diajukan – dengan angka yang
     * benar untuk pertanyaan yang salah.
     */
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "siapa yang belum lapor kemarin?" }),
    );
    expect(terkirim.at(-1)?.teks ?? "").toContain("Kelengkapan laporan");
    terkirim.length = 0;

    aiSehat = false; // jalur deterministik: tidak boleh menyentuh AI
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "kendala minggu lalu" }),
    );
    const teks = terkirim.at(-1)?.teks ?? "";
    // Yang BENAR: ditawarkan dua cara baca kendala, bukan dijawab kelengkapan.
    expect(teks).not.toContain("Kelengkapan laporan");
    expect(teks).toContain("Maksud Anda yang mana?");
    expect(teks).toContain("MASIH TERBUKA");
  });

  it("lokasi yang DISEBUT di susulan menang atas konteks", async () => {
    // Konteks tidak pernah menambahi lokasi pada pertanyaan yang sudah
    // menyebut lokasinya sendiri.
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "progress hari ini di Kedung Mutih" }),
    );
    terkirim.length = 0;
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "bagaimana Kedungmalang kemarin?" }),
    );
    const teks = terkirim.at(-1)?.teks ?? "";
    expect(teks).toContain("Kedungmalang");
    expect(teks).not.toContain("Kedung Mutih");
  });

  it("konteks TIDAK memperlebar lingkup ke lokasi di luar hak penanya", async () => {
    /*
     * Syarat keras brief butir 23, dan alasan konteks menyimpan NAMA bukan id
     * hasil resolusi: nama dicocokkan ULANG terhadap katalog yang berlaku saat
     * susulan datang. Di sini konteks dibuat seolah penanya tadi bertanya
     * tentang lokasi milik organisasi LAIN.
     */
    // "Batah Timur" milik Paket Tetangga di organisasi LAIN — di luar katalog
    // Site Manager, apa pun isi konteksnya.
    const lokasiLain = await db.location.findFirstOrThrow({
      where: { package: { orgId: orgLainId } },
      select: { name: true },
    });
    await db.waChatContext.create({
      data: {
        chatId: pribadi(),
        senderKey: `${nomorSM}@c.us`,
        niat: "progress",
        lokasiDisebut: [lokasiLain.name],
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    terkirim.length = 0;

    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "bagaimana yang kemarin?" }),
    );
    const teks = terkirim.at(-1)?.teks ?? "";
    // Namanya tidak cocok di katalog penanya → MENGAKU tidak menemukan.
    // Yang DILARANG adalah diam-diam melebar jadi seluruh lokasi.
    expect(teks).toContain("tidak menemukan lokasi");
    // Yang DILARANG: diam-diam melebar jadi seluruh lokasi penanya.
    expect(teks).not.toContain("Kedung Mutih");
  });

  it("konteks orang LAIN bukan konteks Anda", async () => {
    const ORANG_LAIN = "6289822222222";
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: nomorSM,
        teks: "ada kendala apa",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    terkirim.length = 0;

    // Orang lain bertanya susulan di grup yang sama — tidak boleh mewarisi
    // konteks milik penanya sebelumnya.
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: GRUP_A,
        dari: ORANG_LAIN,
        teks: "bagaimana yang kemarin?",
        mention: [`${NOMOR_MARLIN}@c.us`],
      }),
    );
    // Ditawari pilihan (konteksnya sendiri kosong), BUKAN dijawab "kendala".
    expect(terkirim.at(-1)?.teks ?? "").toContain("Maksud Anda yang mana?");
  });

  it("konteks BASI tidak dipakai – ditawari pilihan seperti biasa", async () => {
    /*
     * Konteks basi lebih berbahaya daripada tidak ada konteks: ia menjawab
     * pertanyaan lama dengan percaya diri.
     */
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "ada kendala apa" }),
    );
    await db.waChatContext.updateMany({
      where: { chatId: pribadi() },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    terkirim.length = 0;

    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "bagaimana yang kemarin?" }),
    );
    expect(terkirim.at(-1)?.teks ?? "").toContain("Maksud Anda yang mana?");
  });

  it("konteks disimpan SESUDAH balasan berangkat, dan jejaknya tercatat", async () => {
    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "progress hari ini di Kedung Mutih" }),
    );
    const k = await db.waChatContext.findFirst({ where: { chatId: pribadi() } });
    expect(k?.niat).toBe("progress");
    expect(k?.lokasiDisebut).toEqual(["kedung mutih"]);

    await jawabPertanyaanWa(
      event({ chatId: pribadi(), dari: nomorSM, teks: "bagaimana yang kemarin?" }),
    );
    const jejak = await db.auditLog.findFirst({
      where: { action: "waha.tanya.lanjutan" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect((jejak?.payload as { niatDipinjam?: string } | null)?.niatDipinjam).toBe("progress");
  });
});


describe("catatan lapangan menjawab di WhatsApp (DECISIONS 383)", () => {
  const tanya = async (teks: string) => {
    await jawabPertanyaanWa(event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks }));
    return terkirim.at(-1)?.teks ?? "";
  };

  beforeEach(async () => {
    // Jejak verifikasi bersifat append-only. Laporan historis dari kelompok uji
    // di atas dibiarkan sampai TRUNCATE teardown; hanya laporan tanpa jejak yang
    // aman dibersihkan untuk menyiapkan catatan lapangan berikutnya.
    await db.dailyReport.deleteMany({
      where: { locationId: lokA1, verifications: { none: {} } },
    });
    const pelapor = await db.user.findFirstOrThrow({
      where: { fullName: "SiteManager" },
      select: { id: true },
    });
    await db.dailyReport.create({
      data: {
        locationId: lokA1,
        reportDate: new Date("2026-08-14T00:00:00.000Z"),
        status: "final",
        notes: "Pengecoran tertunda karena hujan deras, tenaga 8 orang dipulangkan.",
        createdById: pelapor.id,
      },
    });
  });

  it("pertanyaan yang dulu selalu 'belum mengerti' kini dijawab dari catatan", async () => {
    /*
     * Inilah pertanyaan yang jadi alasan seluruh Fase F: jawabannya ADA di
     * catatan pelapor, hanya tidak pernah bisa dicari. Menyodorkan menu
     * kemampuan untuk pertanyaan yang datanya justru tersedia membuat penanya
     * menyimpulkan MARLIN tidak tahu apa-apa.
     */
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya("kenapa pengecoran tertunda?");
    expect(teks).toContain("Catatan lapangan");
    expect(teks).toContain("hujan deras");
    expect(teks.toLowerCase()).not.toContain("belum mengerti");
  });

  it("KUTIPAN persis, dan ditandai sebagai kata pelapor", async () => {
    /*
     * Balasan WhatsApp di-screenshot lalu diteruskan ke PPK. Angka di dalam
     * catatan ("8 orang") adalah kata pelapor, bukan hitungan MARLIN — kalau
     * tidak dikatakan, pembacanya memperlakukannya sebagai angka resmi.
     */
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya("kenapa pengecoran tertunda?");
    expect(teks).toContain("tenaga 8 orang dipulangkan");
    expect(teks).toContain("KUTIPAN catatan pelapor");
    expect(teks).toContain("Bukan angka resmi");
  });

  it("TETAP menjawab walau layanan AI mati total", async () => {
    /*
     * Pencarian catatan tidak memanggil provider mana pun, jadi justru di saat
     * seperti inilah ia paling berguna. Menyerah tanpa mencobanya berarti
     * membuang jawaban yang sudah ada di tangan.
     */
    aiSehat = false;
    const teks = await tanya("kenapa pengecoran tertunda?");
    expect(teks).toContain("hujan deras");
    expect(teks.toLowerCase()).not.toContain("tidak bisa membaca");
  });

  it("tanpa catatan yang cocok → tetap mengaku belum mengerti", async () => {
    // Pagar arah sebaliknya: pencarian yang terlalu longgar akan menjawab
    // pertanyaan apa pun dengan catatan yang tidak berhubungan.
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    const teks = await tanya("zxqwerty tidak ada di catatan mana pun");
    expect(teks.toLowerCase()).toContain("belum mengerti");
  });

  it("jejak audit mencatat jalur catatan lapangan", async () => {
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await tanya("kenapa pengecoran tertunda?");
    const jejak = await db.auditLog.findFirst({
      where: { action: "waha.tanya.narasi" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect(jejak).not.toBeNull();
    expect((jejak?.payload as { potongan?: number } | null)?.potongan).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Empat cacat yang dilaporkan user dari PRODUKSI (DECISIONS 390)      */
/* ------------------------------------------------------------------ */

describe("cacat produksi 2026-08-20 – dilaporkan user dengan tangkapan layar", () => {
  const pribadi = () => `${nomorSM}@c.us`;

  const tanyaWa = async (teks: string) => {
    terkirim.length = 0;
    await jawabPertanyaanWa(event({ chatId: pribadi(), dari: nomorSM, teks }));
    return terkirim.map((t) => t.teks).join("\n---\n");
  };

  it('"progress terbaik" TIDAK lagi dijawab daftar yang terburuk', async () => {
    /*
     * Yang terjadi di produksi: "progress terbaik" dijawab tiga lokasi
     * ber-realisasi 0,00% – yaitu justru yang terburuk – karena kata
     * superlatifnya dibuang diam-diam lalu daftarnya diurut abjad.
     *
     * Membuang kata yang menentukan isi jawaban adalah bentuk mengarang yang
     * paling halus: yang dikarang bukan angkanya, melainkan PERTANYAANNYA.
     */
    aiSehat = false; // wajib dijawab jalur deterministik
    const teks = await tanyaWa("progress terbaik");
    // Judulnya MENGAKU diurutkan – daftar terurut yang tidak mengaku terbaca
    // sebagai "inilah lokasinya", padahal ia "inilah yang teratas".
    expect(teks).toContain("terbaik dulu");
    /*
     * Urutan angkanya SENGAJA tidak diperiksa di sini.
     *
     * Lokasi uji berkas ini semuanya berealisasi 0,00%, jadi "menurun" dan
     * "menaik" sama-sama lolos – asersi yang terlihat teliti tanpa pernah
     * menguji apa pun. Ketahuan lewat uji gigi: pengurutannya dilepas, uji ini
     * tetap hijau. Pengurutannya diuji sungguhan dengan angka berbeda di
     * `tests/unit/waha-urutan-progress.test.ts`.
     */
  });

  it('"progress terburuk" juga dijawab tanpa AI dan mengaku urutannya', async () => {
    aiSehat = false;
    expect(await tanyaWa("progress terburuk")).toContain("terburuk dulu");
  });

  it("kepala balasan menyebut TANGGAL nyata, bukan cuma 'kemarin lusa'", async () => {
    /*
     * Permintaan user: "jawaban sudah lumayan oke, tapi seharusnya jawaban ini
     * disertai tanggal". Balasan WhatsApp di-screenshot lalu diteruskan ke PPK
     * berhari-hari kemudian; di situ "kemarin lusa" bukan cuma tidak berarti,
     * tapi menyesatkan – "kemarin"-nya pembaca bukan "kemarin"-nya penanya.
     */
    aiSehat = false;
    const teks = await tanyaWa("progress kemarin lusa");
    expect(teks).toContain("kemarin lusa");
    // Ada tanggal sungguhan: "18 Agustus 2026" dst.
    expect(teks).toMatch(/\d{1,2} \w+ \d{4}/);
  });

  it('baris item TIDAK menulis "hari ini" saat yang ditanya hari lain', async () => {
    /*
     * Terlihat di tangkapan layar: pertanyaan "kalau kemarin lusa?" dijawab
     * dengan baris "2 item dilaporkan HARI INI". Itemnya memang dua, tapi
     * dilaporkan kemarin lusa – hari yang salah ditempelkan pada angka yang
     * benar, jenis kesalahan yang paling sulit dibantah.
     */
    aiSehat = false;
    const teks = await tanyaWa("progress kemarin lusa");
    expect(teks).not.toContain("dilaporkan hari ini");
    expect(teks).not.toContain("belum ada laporan hari ini");
  });
});

describe('perintah "abaikan" benar-benar melepas konteks (DECISIONS 390)', () => {
  const pribadi = () => `${nomorSM}@c.us`;
  const kirim = async (teks: string) => {
    terkirim.length = 0;
    await jawabPertanyaanWa(event({ chatId: pribadi(), dari: nomorSM, teks }));
    return terkirim.map((t) => t.teks).join("\n---\n");
  };

  it('"abaikan" mengaku melupakan, dan susulan sesudahnya TIDAK menyambung lagi', async () => {
    /*
     * User mengetik "abaikan" setelah menerima jawaban yang melenceng, dan
     * MARLIN membalas "belum mengerti" sambil TETAP memegang konteks yang
     * salah – jadi pertanyaan berikutnya melenceng lagi dengan cara yang sama.
     */
    aiSehat = false;
    await kirim("progress hari ini di Kedung Mutih");

    const lepas = await kirim("abaikan");
    expect(lepas.toLowerCase()).toContain("lupakan");
    expect(lepas.toLowerCase()).not.toContain("belum mengerti");

    // Susulan yang dulu menyambung kini tidak punya apa pun untuk disambung.
    const susulan = await kirim("kalau kemarin?");
    expect(susulan).toContain("Maksud Anda yang mana?");
  });

  it('"abaikan" saat tidak ada konteks mengatakannya apa adanya', async () => {
    aiSehat = false;
    await kirim("abaikan"); // pastikan kosong
    const teks = await kirim("abaikan");
    expect(teks.toLowerCase()).toContain("tidak ada percakapan");
  });
});

describe('pertanyaan "kenapa" & nama bespasi (DECISIONS 390)', () => {
  const pribadi = () => `${nomorSM}@c.us`;
  const kirim = async (teks: string) => {
    terkirim.length = 0;
    await jawabPertanyaanWa(event({ chatId: pribadi(), dari: nomorSM, teks }));
    return terkirim.map((t) => t.teks).join("\n---\n");
  };

  beforeAll(async () => {
    // Catatan lapangan MILIK uji ini – supaya tidak bergantung pada sisa
    // seeding blok lain, yang urutannya bisa berubah kapan saja.
    const pelapor = await db.user.findFirstOrThrow({
      where: { fullName: "SiteManager" },
      select: { id: true },
    });
    await db.dailyReport.create({
      data: {
        locationId: lokA1,
        reportDate: new Date("2026-08-13T00:00:00.000Z"),
        status: "final",
        notes: "Tertinggal karena material terlambat datang dan hujan tiap sore.",
        createdById: pelapor.id,
      },
    });
  });

  it('"kenapa … tertinggal" menjawab angka DAN sebabnya', async () => {
    /*
     * Keberatan user: *"kenapa randuputih tertinggal, malah cuma jawab
     * progress"*. Balasannya benar tapi menjawab "berapa", bukan "kenapa" –
     * dan angkanya justru sudah diketahui penanya; itulah sebabnya ia bertanya.
     */
    aiSehat = false;
    const teks = await kirim("kenapa Kedung Mutih tertinggal");
    // Angka resmi tetap di depan dan tidak tersentuh.
    expect(teks).toContain("Deviasi");
    // Sebabnya menyusul sebagai KUTIPAN bertanda, bukan karangan model.
    expect(teks).toContain("Catatan lapangan");
    expect(teks).toContain("KUTIPAN catatan pelapor");
  });

  it("pertanyaan biasa TIDAK ikut ditempeli catatan", async () => {
    // Pagar arah sebaliknya: kalau setiap jawaban dibuntuti kutipan, penanda
    // "ini kata pelapor, bukan angka MARLIN" kehilangan artinya.
    aiSehat = false;
    const teks = await kirim("progress hari ini");
    expect(teks).not.toContain("KUTIPAN catatan pelapor");
  });

  it("nama tak dikenal DISEBUT di jalur catatan lapangan", async () => {
    /*
     * Yang paling merusak di layar user bukan cakupannya, melainkan diamnya:
     * balasan berisi catatan lokasi lain tanpa satu kata pun bahwa nama yang
     * ia tulis tidak dikenali – jadi terbaca sebagai jawaban ATAS lokasi itu.
     */
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    aiSehat = true;
    const teks = await kirim("kenapa zxqwertylokasi hujan terus");
    if (teks.includes("Catatan lapangan")) {
      expect(teks).toContain("Tidak saya kenali");
    }
  });
});

/* ── Daftar panjang dijawab dengan PDF (DECISIONS 448) ───────────────────
 *
 * Permintaan user 2026-08-26: *"kalau dalam data yang banyak begitu, misal
 * kendala hari ini, alih-alih ngasih chat panjang lebar, wa merespon dengan
 * format pdf rapi"*.
 *
 * Yang dijaga di sini bukan rupa dokumennya (itu uji unit pencetaknya),
 * melainkan KEPUTUSANNYA: banyak baris → satu berkas; sedikit baris → tetap
 * teks. Dan yang paling mudah hilang: keterangan berkasnya harus tetap memuat
 * kepala jawaban, supaya pesan itu berarti tanpa membuka lampiran.
 */
describe("daftar panjang dikirim sebagai PDF", () => {
  const banyakKendala = async (jumlah: number) => {
    await db.issue.deleteMany({ where: { locationId: lokA1 } });
    for (let i = 1; i <= jumlah; i++) {
      await db.issue.create({
        data: {
          locationId: lokA1,
          title: `Kendala nomor ${i} di lokasi ini, dengan judul yang cukup panjang`,
          severity: i % 3 === 0 ? "kritis" : "sedang",
          status: "terbuka",
        },
      });
    }
  };

  afterAll(async () => {
    await db.issue.deleteMany({ where: { locationId: lokA1 } });
  });

  it("12 kendala → satu berkas PDF, bukan berkas gelembung teks", async () => {
    await banyakKendala(12);
    niatPalsu = { niat: "kendala", lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "ada kendala apa" }),
    );

    expect(r.dijawab).toBe(true);
    expect(berkasTerkirim).toHaveLength(1);
    const b = berkasTerkirim[0];
    expect(b.mime).toBe("application/pdf");
    expect(b.nama).toMatch(/^marlin-kendala-belum-selesai-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(b.bytes).toBeGreaterThan(1000);

    // Keterangannya berdiri sendiri: judul + jumlah, tanpa membuka berkas.
    // 12 kendala di SATU lokasi = 1 baris tabel (DECISIONS 450), jadi yang
    // disebut rinciannya — "1 baris" akan terbaca sebagai "cuma 1 kendala".
    expect(b.caption).toContain("Kendala belum selesai");
    expect(b.caption).toContain("12 rincian di 1 baris");

    // Dan TIDAK ada gelembung daftar panjang yang ikut terkirim.
    expect(terkirim).toHaveLength(0);
  });

  it("28 kendala → seluruhnya dinyatakan termuat di PDF, tanpa menyuruh membuka MARLIN", async () => {
    await banyakKendala(28);
    niatPalsu = { niat: "kendala", lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "kendala yang masih terbuka?" }),
    );

    expect(r.dijawab).toBe(true);
    expect(berkasTerkirim).toHaveLength(1);
    expect(berkasTerkirim[0].caption).toContain("Seluruh 28 kendala termuat di PDF");
    expect(berkasTerkirim[0].caption).not.toContain("buka MARLIN");
    expect(terkirim).toHaveLength(0);
  });

  it("2 kendala → tetap teks; berkas hanya untuk yang memang panjang", async () => {
    await banyakKendala(2);
    niatPalsu = { niat: "kendala", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "ada kendala apa" }),
    );

    expect(berkasTerkirim).toHaveLength(0);
    expect(terkirim.length).toBeGreaterThan(0);
    expect(terkirim.map((t) => t.teks).join("\n")).toContain("Kendala belum selesai");
  });
});

/* ── "progress 5 terbaik" ≠ "progress hari ini" (DECISIONS 449) ──────────
 *
 * Keberatan user 2026-08-26: *"pertanyaan ke wa 'progress hari ini' dan
 * 'progress 5 terbaik' sama sekali tidak memberikan perbedaan hasil"*.
 *
 * Dua sebab bertumpuk: "5" diperlakukan sebagai kata asing sehingga kalimatnya
 * jatuh ke AI, dan jalur AI membuang superlatifnya tanpa satu pun tanda.
 * Keduanya diuji di sini — termasuk kalimat yang MEMANG harus lewat AI.
 */
describe("urutan & cacahan tidak hilang", () => {
  const judul = () => terkirim.map((t) => t.teks).join("\n");

  it('"progress hari ini" berjudul Progress polos', async () => {
    niatPalsu = { niat: "progress", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "progress hari ini" }),
    );
    expect(judul()).toContain("*Progress*");
    expect(judul()).not.toContain("terbaik");
  });

  it('"progress 5 terbaik" berjudul lain, menyebut cacahan & arahnya', async () => {
    niatPalsu = { niat: "progress", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: "progress 5 terbaik" }),
    );
    expect(judul()).toContain("Progress – 5 terbaik");
  });

  it("kalimat yang lewat AI pun tidak kehilangan superlatifnya", async () => {
    // Kata di luar katalog memaksa jalur AI — persis keadaan yang dulu
    // membuang urutannya.
    niatPalsu = { niat: "progress", lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({
        chatId: `${nomorSM}@c.us`,
        dari: nomorSM,
        teks: "tolong progress 5 terbaik untuk wilayah pesisir",
      }),
    );
    expect(judul()).toContain("Progress – 5 terbaik");
  });
});

/* ── Jalur TANYA BEBAS dengan jawaban yang benar-benar bersumber ─────────
 *
 * Butir terbuka yang ditinggalkan sesi sebelumnya: stub selalu mengembalikan
 * `answerParts: []`, jadi jalur ini SELALU jatuh ke "sumber tidak cukup" dan
 * cabang yang lolos validator tidak pernah tersentuh uji sama sekali.
 *
 * Di sini stub menyalin satu fakta dari prompt-nya sendiri — persis seperti
 * model sungguhan yang hanya boleh mengklaim angka yang disodorkan MARLIN.
 * Yang dijaga: bagian bersumber SELAMAT, jawabannya terkirim, dan sumbernya
 * ikut disebut supaya bisa diperiksa orang.
 */
describe("tanya bebas: jawaban bersumber", () => {
  it("bagian dengan klaim yang cocok fakta resmi LOLOS dan terkirim", async () => {
    jawabanBersumber = true;
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: TANYA_BUTUH_AI }),
    );

    expect(r.dijawab).toBe(true);
    // Bukan "belum mengerti", bukan "sumber tidak cukup".
    expect(r.alasan).toBe("dijawab fleksibel dari sumber MARLIN");
    const teks = terkirim.map((t) => t.teks).join("\n");
    expect(teks).toContain("Pekerjaan tanggul masih berjalan");
    // Sumbernya disebut — jawaban bersumber yang tidak menyebut sumbernya
    // tidak bisa diperiksa siapa pun.
    expect(teks).toContain("Sumber yang bisa diperiksa");
  });

  it("run AI-nya mencatat berapa bagian yang LOLOS, bukan berapa yang dikirim model", async () => {
    jawabanBersumber = true;
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: TANYA_BUTUH_AI }),
    );
    const run = await db.aiRun.findFirst({
      where: { promptVersion: "waha-bebas-1" },
      orderBy: { createdAt: "desc" },
      select: { outputJson: true },
    });
    const keluaran = (run?.outputJson as { tanya?: { answerParts?: unknown[]; confidence?: number } })
      ?.tanya;
    expect(keluaran?.answerParts).toHaveLength(1);
    // Keyakinan DIHITUNG dari hasil validasi, bukan diakui model (yang mengaku 80).
    expect(keluaran?.confidence).toBe(100);
  });

  it("tanpa bagian bersumber, tetap mengaku – bukan mengarang", async () => {
    jawabanBersumber = false;
    niatPalsu = { niat: null, lokasiDisebut: [], periode: "hari_ini" };
    const r = await jawabPertanyaanWa(
      event({ chatId: `${nomorSM}@c.us`, dari: nomorSM, teks: TANYA_BUTUH_AI }),
    );
    expect(r.alasan).not.toBe("dijawab fleksibel dari sumber MARLIN");
    expect(terkirim.map((t) => t.teks).join("\n")).not.toContain("Pekerjaan tanggul masih berjalan");
  });
});
