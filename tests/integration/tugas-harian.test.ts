// Penjadwal harian: aktivasi SPMK + pengingat WA (DECISIONS 202).
//
// Dua hal yang paling berbahaya dari pekerjaan otomatis diuji di sini:
//   1. TERLALU CEPAT — paket naik ke Pelaksanaan sebelum tanggal SPMK;
//   2. TERLALU SERING — pesan WA dobel ke HP orang lapangan karena cron
//      dipicu ulang. Keduanya tidak menimbulkan error, cuma merusak diam-diam.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

/**
 * WAHA palsu: catat siapa dikirimi apa, tanpa menyentuh jaringan.
 *
 * Assertion memakai `punyaKita()` — DB integrasi lokal tidak direset antar
 * jalan, jadi sisa data dari jalan sebelumnya ikut tertagih. Yang diuji adalah
 * perilaku untuk NOMOR KITA, bukan jumlah global.
 */
const terkirim: { chatId: string; text: string }[] = [];
let wahaAktif = true;
let gagalKirim = false;
let statusSesi = "WORKING";
vi.mock("@/lib/waha/client", () => ({
  // ASINKRON, sama seperti aslinya (baca konfigurasi dari DB). Versi pertama
  // mock ini sinkron, sehingga bug `!isWahaConfigured()` di penjadwal — yang
  // menegasikan Promise dan karena itu tidak pernah aktif — lolos dari uji.
  isWahaConfigured: async () => wahaAktif,
  getSessionStatus: async () => ({ name: "default", status: statusSesi }),
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
  sendText: async (chatId: string, text: string) => {
    if (gagalKirim) throw new Error("WAHA mati");
    terkirim.push({ chatId, text });
    return "true_628123456789@c.us_MSGID";
  },
}));

const { db } = await import("@/lib/db");
const { aktifkanSpmkJatuhTempo, kirimPengingatHarian } = await import("@/lib/harian/penjadwal");

const suffix = `th${Date.now().toString(36)}`;
let orgId = "";
let vendorId = "";
let smId = "";
let smTanpaWaId = "";

const NOMOR_KITA = "628123456789";
/** WAHA hanya mengenal bentuk ber-`@c.us`; nomor polos diterima 2xx lalu hilang. */
const TUJUAN_KITA = `${NOMOR_KITA}@c.us`;
const punyaKita = () => terkirim.filter((t) => t.chatId === TUJUAN_KITA);

const HARI_INI = new Date("2026-08-01T10:00:00+07:00");
const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function buatPaket(opts: {
  spmk: string | null;
  stage: "kontrak" | "pelaksanaan";
  lokasi: string[];
  statusLokasi?: "persiapan" | "berjalan";
}) {
  const tag = Math.random().toString(36).slice(2, 8);
  const nama = `Paket ${tag}`;
  const pkg = await db.package.create({
    data: { orgId, name: nama, stage: opts.stage },
    select: { id: true },
  });
  if (opts.spmk) {
    await db.contract.create({
      data: {
        package: { connect: { id: pkg.id } },
        vendor: { connect: { id: vendorId } },
        contractNumber: `K-${tag}`,
        contractValue: 1_000_000n,
        signedDate: tgl("2026-07-30"),
        durationDays: 135,
        startDate: tgl(opts.spmk),
        endDate: tgl("2026-12-16"),
      },
    });
  }
  const ids: string[] = [];
  for (const nama of opts.lokasi) {
    const l = await db.location.create({
      data: {
        packageId: pkg.id,
        name: nama,
        slug: `${nama.toLowerCase()}-${tag}`,
        village: nama,
        regency: "K",
        province: "P",
        status: opts.statusLokasi ?? "persiapan",
        isActive: opts.statusLokasi === "berjalan",
      },
      select: { id: true },
    });
    ids.push(l.id);
  }
  return { packageId: pkg.id, locationIds: ids, nama };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org TH ${suffix}`, slug: `th-${suffix}` } });
  orgId = org.id;
  vendorId = (
    await db.vendor.create({ data: { orgId, name: `CV Uji ${suffix}` }, select: { id: true } })
  ).id;
  const sm = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      fullName: "Prio Yulianto",
      role: "site_manager",
      passwordHash: "x",
      waNumber: NOMOR_KITA,
    },
    select: { id: true },
  });
  smId = sm.id;
  const tanpa = await db.user.create({
    data: {
      orgId,
      username: `nowa-${suffix}`,
      fullName: "Tanpa Nomor",
      role: "site_manager",
      passwordHash: "x",
    },
    select: { id: true },
  });
  smTanpaWaId = tanpa.id;
});

afterAll(async () => {
  // package_stage_history & location_status_history append-only → data
  // sengaja tidak dibersihkan (lihat pola di tes lain).
  await db.$disconnect();
});

beforeEach(async () => {
  terkirim.length = 0;
  wahaAktif = true;
  gagalKirim = false;
  statusSesi = "WORKING";
  await db.dailyReminderLog.deleteMany({ where: { userId: { in: [smId, smTanpaWaId] } } });
  // Lepas SEMUA penugasan lama: lokasi dari tes sebelumnya tidak dihapus
  // (histori status append-only), jadi tanpa ini tagihan menumpuk lintas tes.
  await db.locationAssignment.updateMany({
    where: { userId: { in: [smId, smTanpaWaId] }, unassignedAt: null },
    data: { unassignedAt: new Date() },
  });
});

describe("KASUS INTI: SPMK 3 Agustus tidak boleh jalan pada 1 Agustus", () => {
  it("paket dengan SPMK masa depan TIDAK diaktifkan", async () => {
    const { packageId, locationIds, nama } = await buatPaket({
      spmk: "2026-08-03",
      stage: "kontrak",
      lokasi: ["Alfa"],
    });
    const hasil = await aktifkanSpmkJatuhTempo(HARI_INI);
    /*
     * Diperiksa per NAMA PAKET, bukan lewat hitungan global.
     *
     * `aktifkanSpmkJatuhTempo` menyapu SELURUH basis data, sedangkan berkas ini
     * sengaja tidak membersihkan fixture-nya (histori tahap & status bersifat
     * append-only). Akibatnya paket "kontrak" sisa RUN SEBELUMNYA ikut
     * teraktivasi, dan `diaktifkan === 0` gagal — bukan karena kode salah,
     * melainkan karena uji ini tidak bisa dijalankan dua kali.
     *
     * Terbukti: pada basis data bersih uji ini lulus, lalu dijalankan lagi
     * tanpa pembersihan ia merah. Menyandarkan pemeriksaan pada nama paketnya
     * sendiri membuatnya kebal baris asing TANPA melemahkan apa pun — tiga
     * pemeriksaan di bawah tetap membuktikan paket & lokasi ini tidak bergerak.
     */
    expect(hasil.paket).not.toContain(nama);

    const p = await db.package.findUniqueOrThrow({ where: { id: packageId }, select: { stage: true } });
    expect(p.stage).toBe("kontrak");
    const l = await db.location.findUniqueOrThrow({
      where: { id: locationIds[0] },
      select: { status: true },
    });
    expect(l.status).toBe("persiapan");
  });

  it("pada tanggal SPMK-nya: paket naik + lokasi jadi Berjalan", async () => {
    const { packageId, locationIds, nama } = await buatPaket({
      spmk: "2026-08-03",
      stage: "kontrak",
      lokasi: ["Beta", "Gama"],
    });
    const hasil = await aktifkanSpmkJatuhTempo(new Date("2026-08-03T06:00:00+07:00"));
    // Nama paketnya sendiri — LEBIH kuat daripada "≥ 1", yang bisa hijau
    // gara-gara paket lain yang kebetulan ikut teraktivasi.
    expect(hasil.paket).toContain(nama);

    const p = await db.package.findUniqueOrThrow({ where: { id: packageId }, select: { stage: true } });
    expect(p.stage).toBe("pelaksanaan");
    const lokasi = await db.location.findMany({
      where: { id: { in: locationIds } },
      select: { status: true, isActive: true },
    });
    expect(lokasi.every((l) => l.status === "berjalan" && l.isActive)).toBe(true);
  });

  it("riwayat mencatat SISTEM sebagai pelaku, bukan manusia mana pun", async () => {
    const { packageId } = await buatPaket({ spmk: "2026-07-25", stage: "kontrak", lokasi: ["Delta"] });
    await aktifkanSpmkJatuhTempo(HARI_INI);
    const h = await db.packageStageHistory.findFirstOrThrow({
      where: { packageId },
      orderBy: { changedAt: "desc" },
      select: { changedById: true, note: true, toStage: true },
    });
    expect(h.toStage).toBe("pelaksanaan");
    expect(h.changedById).toBeNull();
    expect(h.note).toMatch(/otomatis/i);
  });

  it("dijalankan dua kali tidak menaikkan apa pun untuk kedua kalinya", async () => {
    await buatPaket({ spmk: "2026-07-20", stage: "kontrak", lokasi: ["Eta"] });
    const satu = await aktifkanSpmkJatuhTempo(HARI_INI);
    expect(satu.diaktifkan).toBeGreaterThanOrEqual(1);
    const dua = await aktifkanSpmkJatuhTempo(HARI_INI);
    expect(dua.diaktifkan).toBe(0);
  });
});

describe("pengingat WA harian", () => {
  async function siapkanLokasiBerjalan(nama: string) {
    const { locationIds } = await buatPaket({
      spmk: "2026-07-20",
      stage: "pelaksanaan",
      lokasi: [nama],
      statusLokasi: "berjalan",
    });
    await db.locationAssignment.create({ data: { userId: smId, locationId: locationIds[0] } });
    return locationIds[0];
  }

  it("KASUS INTI: penanggung jawab yang lokasinya belum ada laporan ditagih", async () => {
    await siapkanLokasiBerjalan("Zeta");
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()).toHaveLength(1);
    expect(punyaKita()[0].text).toContain("Zeta – belum ada laporan");
    expect(punyaKita()[0].text).toContain("Prio Yulianto");
  });

  it("yang sudah mengirim laporan TIDAK diganggu", async () => {
    const locId = await siapkanLokasiBerjalan("Theta");
    await db.dailyReport.create({
      data: {
        locationId: locId,
        reportDate: tgl("2026-08-01"),
        status: "dikirim",
        createdById: smId,
      },
    });
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()).toHaveLength(0);
  });

  it("laporan yang masih DRAF tetap ditagih, dengan kalimat berbeda", async () => {
    const locId = await siapkanLokasiBerjalan("Iota");
    await db.dailyReport.create({
      data: {
        locationId: locId,
        reportDate: tgl("2026-08-01"),
        status: "draft",
        createdById: smId,
      },
    });
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()[0].text).toContain("Iota – masih DRAF");
  });

  it("dua lokasi milik satu orang → SATU pesan berisi dua baris", async () => {
    await siapkanLokasiBerjalan("Kappa");
    await siapkanLokasiBerjalan("Lambda");
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()).toHaveLength(1);
    expect(punyaKita()[0].text).toContain("Kappa");
    expect(punyaKita()[0].text).toContain("Lambda");
    expect(punyaKita()[0].text).toContain("2 lokasi");
  });

  it("IDEMPOTEN: dipicu dua kali di hari yang sama tidak mengirim dobel", async () => {
    await siapkanLokasiBerjalan("Mu");
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()).toHaveLength(1);
    const dua = await kirimPengingatHarian(HARI_INI);
    // Percobaan kedua ditolak UNIQUE (user, tanggal) — bukan dikirim ulang.
    expect(dua.terkirim).toBe(0);
    expect(dua.dilewati).toBeGreaterThanOrEqual(1);
    expect(punyaKita()).toHaveLength(1);
  });

  it("pengguna tanpa nomor WA dilewati tanpa error", async () => {
    const locId = await siapkanLokasiBerjalan("Nu");
    await db.locationAssignment.create({ data: { userId: smTanpaWaId, locationId: locId } });
    const hasil = await kirimPengingatHarian(HARI_INI);
    // Hanya SM ber-nomor yang dikirimi; yang tanpa nomor tidak menggagalkan apa pun.
    expect(punyaKita()).toHaveLength(1);
    expect(hasil.gagal).toBe(0);
  });

  it("lokasi yang SPMK-nya belum tiba tidak ditagih", async () => {
    // Menagih laporan untuk hari yang pekerjaannya belum boleh dimulai adalah
    // persis kekacauan yang bug SPMK tadi hasilkan.
    const { locationIds } = await buatPaket({
      spmk: "2026-08-20",
      stage: "pelaksanaan",
      lokasi: ["Xi"],
      statusLokasi: "berjalan",
    });
    await db.locationAssignment.create({ data: { userId: smId, locationId: locationIds[0] } });
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()).toHaveLength(0);
  });

  it("WAHA belum dikonfigurasi → tidak melakukan apa-apa, bukan melempar error", async () => {
    await siapkanLokasiBerjalan("Omicron");
    wahaAktif = false;
    const sebelum = await db.dailyReminderLog.count({ where: { dateKey: "2026-08-01" } });
    const hasil = await kirimPengingatHarian(HARI_INI);
    expect(hasil).toEqual({
      terkirim: 0,
      gagal: 0,
      dilewati: 0,
      sesi: "belum dikonfigurasi",
      rincian: [],
    });
    // Yang paling penting: TIDAK ada baris pengingat yang ditulis. Kalau
    // ditulis, UNIQUE (user, hari) akan memblokir percobaan yang benar
    // berikutnya di hari itu — WAHA yang mati sejenak jadi kehilangan
    // pengingat sehari penuh.
    expect(await db.dailyReminderLog.count({ where: { dateKey: "2026-08-01" } })).toBe(sebelum);
  });

  it("status sesi DILAPORKAN, tapi tidak dipakai membatalkan pengiriman", async () => {
    // DECISIONS 207. Versi sebelumnya memakai status sesi sebagai pagar: bukan
    // WORKING → tidak mengirim apa pun. Itu menjadikan satu bacaan yang meleset
    // (nama status berbeda antar versi/engine WAHA, endpoint tak terjangkau
    // sesaat) sebagai penghenti pengiriman yang sebenarnya sehat. Statusnya
    // tetap dilaporkan supaya "0 terkirim" bisa dibaca, bukan ditebak.
    await siapkanLokasiBerjalan("Sigma");
    statusSesi = "SCAN_QR_CODE";
    const hasil = await kirimPengingatHarian(HARI_INI);

    expect(hasil.sesi).toBe("SCAN_QR_CODE");
    expect(hasil.terkirim).toBe(1);
    expect(punyaKita()).toHaveLength(1);
  });

  it("nomor lama tanpa @c.us dinormalkan SAAT KIRIM – WAHA hanya kenal bentuk itu", async () => {
    // Baris lama (dibuat sebelum normalisasi di form, atau hasil impor) bisa
    // berisi "0812…". WAHA menerima bentuk itu dengan 2xx lalu tidak mengirim
    // apa pun — persis "terkirim tapi tidak sampai".
    const lawas = await db.user.create({
      data: {
        orgId,
        username: `lawas-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
        fullName: "Nomor Lawas",
        role: "site_manager",
        passwordHash: "x",
        waNumber: "0895 1122 3344",
      },
      select: { id: true },
    });
    const { locationIds } = await buatPaket({
      spmk: "2026-07-01",
      stage: "pelaksanaan",
      lokasi: ["Upsilon"],
      statusLokasi: "berjalan",
    });
    await db.locationAssignment.create({
      data: { userId: lawas.id, locationId: locationIds[0] },
    });
    try {
      await kirimPengingatHarian(HARI_INI);
      expect(terkirim.map((t) => t.chatId)).toContain("6289511223344@c.us");
    } finally {
      await db.dailyReminderLog.deleteMany({ where: { userId: lawas.id } });
      await db.locationAssignment.deleteMany({ where: { userId: lawas.id } });
      await db.user.delete({ where: { id: lawas.id } });
    }
  });

  it("PAKSA mengirim ulang di hari yang sama, dan menghitung percobaannya", async () => {
    // Tombol admin memakai jalur ini (DECISIONS 207): cron sekali sehari, admin
    // sebanyak yang ia mau.
    await siapkanLokasiBerjalan("Phi");
    await kirimPengingatHarian(HARI_INI);
    expect(punyaKita()).toHaveLength(1);

    // Tanpa paksa = tetap sekali sehari.
    const lagi = await kirimPengingatHarian(HARI_INI);
    expect(lagi.dilewati).toBeGreaterThanOrEqual(1);
    expect(punyaKita()).toHaveLength(1);

    // Dengan paksa = benar-benar dikirim lagi.
    const paksa = await kirimPengingatHarian(HARI_INI, undefined, { paksa: true });
    expect(paksa.terkirim).toBeGreaterThanOrEqual(1);
    expect(paksa.dilewati).toBe(0);
    expect(punyaKita()).toHaveLength(2);

    const log = await db.dailyReminderLog.findFirstOrThrow({
      where: { userId: smId, dateKey: "2026-08-01" },
      select: { attempts: true, chatId: true, lastSentAt: true },
    });
    expect(log.attempts).toBe(2);
    expect(log.chatId).toBe(TUJUAN_KITA);
    expect(log.lastSentAt).not.toBeNull();
  });

  it("rincian menyebut tiap penerima + tujuannya – hasil tidak perlu ditebak", async () => {
    await siapkanLokasiBerjalan("Chi");
    const hasil = await kirimPengingatHarian(HARI_INI);
    const kita = hasil.rincian.find((r) => r.tujuan === TUJUAN_KITA);
    expect(kita).toBeDefined();
    expect(kita!.nama).toBe("Prio Yulianto");
    expect(kita!.ok).toBe(true);
    expect(kita!.waMessageId).toBe("true_628123456789@c.us_MSGID");
  });

  it("ID pesan dari WAHA disimpan – bukti bahwa 'sukses' bukan sekadar 2xx", async () => {
    await siapkanLokasiBerjalan("Tau");
    await kirimPengingatHarian(HARI_INI);
    const log = await db.dailyReminderLog.findFirstOrThrow({
      where: { userId: smId, dateKey: "2026-08-01" },
      select: { status: true, waMessageId: true },
    });
    expect(log.status).toBe("sukses");
    expect(log.waMessageId).toBe("true_628123456789@c.us_MSGID");
  });

  it("kegagalan kirim tercatat sebagai gagal, tidak diam-diam dianggap sukses", async () => {
    await siapkanLokasiBerjalan("Pi");
    gagalKirim = true;
    const hasil = await kirimPengingatHarian(HARI_INI);
    expect(hasil.gagal).toBeGreaterThanOrEqual(1);
    const log = await db.dailyReminderLog.findFirstOrThrow({
      where: { userId: smId, dateKey: "2026-08-01" },
      select: { status: true, error: true },
    });
    expect(log.status).toBe("gagal");
    expect(log.error).toMatch(/WAHA mati/);
  });
});
