// LAPORAN PROGRES MINGGUAN → GRUP WHATSAPP (DECISIONS 311).
//
// Permintaan user 2026-08-12: kirim rutin otomatis + tombol manual ke grup WA.
//
// Yang paling berbahaya di fitur ini BUKAN formatnya (itu sudah diuji unit),
// melainkan KAPAN ia berbunyi. Tujuannya grup berisi PPK dan konsultan, dan
// pesan WhatsApp tidak bisa ditarik kembali. Dua kegagalan yang harus mustahil:
//
//   1. mengumumkan minggu yang sama DUA KALI — cron berjalan tiap hari, jadi
//      tanpa penjagaan satu minggu bisa diumumkan tujuh kali berturut-turut;
//   2. berbunyi di hari yang BUKAN akhir minggu kontrak.
//
// Keduanya hanya bisa dibuktikan lewat DB sungguhan: pengamannya adalah UNIQUE
// (paket, minggu) di Postgres, bukan sebuah `if` di TypeScript.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** WAHA palsu: catat apa yang dikirim ke mana, tanpa menyentuh jaringan. */
const terkirim: { chatId: string; text: string }[] = [];
let wahaHidup = true;
let gagalKirim = false;

vi.mock("@/lib/waha/client", () => ({
  isWahaConfigured: async () => wahaHidup,
  getSessionStatus: async () => ({ name: "default", status: "WORKING" }),
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
    return `wamid.${terkirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { akhirMingguKontrak, kirimLaporanMingguan, mingguKontrak, pratinjauMingguan } = await import(
  "@/lib/mingguan/kirim"
);
const { kirimLaporanMingguanTerjadwal } = await import("@/lib/mingguan/penjadwal");
const { setMingguanAktif } = await import("@/lib/mingguan/setelan");

const suffix = `lm${Date.now().toString(36)}`;
let locationId = "";
/** SPMK Senin 6 Juli 2026 → hari terakhir minggu ke-1 = 12 Juli. */
const SPMK = new Date("2026-07-06T00:00:00.000Z");
let packageId = "";
const GRUP = "628000@g.us";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org LM ${suffix}`, slug: `org-${suffix}` },
  });
  const vendor = await db.vendor.create({
    data: { orgId: org.id, name: "CV. ALKOMBER KARYA" },
    select: { id: true },
  });
  const pkg = await db.package.create({
    data: {
      orgId: org.id,
      name: `Paket LM ${suffix}`,
      stage: "pelaksanaan",
      waGroupId: GRUP,
    },
    select: { id: true },
  });
  packageId = pkg.id;
  await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `SPK-LM-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-07-01"),
      durationDays: 140,
      startDate: SPMK,
      endDate: new Date("2026-11-23"),
    },
  });
  await db.location.create({
    data: {
      packageId,
      name: "Pasir",
      slug: `pasir-${suffix}`,
      village: "Pasir",
      regency: "Kebumen",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });
  await setMingguanAktif(true);

  /*
   * DATA PROGRES SUNGGUHAN — tanpa ini uji "minggu lampau" tidak membuktikan
   * apa pun.
   *
   * Uji gigi membongkarnya: dengan lokasi yang realisasinya 0 di semua tanggal,
   * MENCABUT `asOf` sama sekali tidak membuat satu uji pun merah. Angka minggu
   * ke-4 dan angka hari ini kebetulan sama-sama nol, jadi cacat paling senyap
   * dari fitur ini — judul "Minggu Ke : 4" berisi realisasi hari ini — lolos
   * tanpa terlihat.
   *
   * Karena itu di sini ada RAB, baseline, dan DUA laporan harian di minggu yang
   * berbeda: realisasi s/d minggu ke-4 harus lebih kecil daripada s/d hari ini.
   */
  const lokasi = await db.location.findFirstOrThrow({
    where: { packageId },
    select: { id: true },
  });
  locationId = lokasi.id;
  const rab = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 0n },
    select: { id: true },
  });
  const kategori = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      kind: "kategori",
      lineageKey: `kat-${suffix}`,
      code: "1",
      name: "Pekerjaan Persiapan",
      sortOrder: 1,
      amount: 100_000_000n,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      parentId: kategori.id,
      kind: "item",
      lineageKey: `itm-${suffix}`,
      code: "1.1",
      name: "Bulldozer",
      sortOrder: 2,
      unit: "unit",
      volume: 10,
      unitPrice: 10_000_000,
      amount: 100_000_000n,
    },
    select: { id: true },
  });
  const baseline = await db.baseline.create({
    data: {
      locationId,
      baselineNo: 1,
      source: "auto",
      status: "aktif",
      contractDays: 140,
    },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      baselineId: baseline.id,
      weekNumber: i + 1,
      plannedPct: Math.round(((i + 1) / 20) * 100 * 1000) / 1000,
    })),
  });
  const pelapor = await db.user.create({
    data: {
      orgId: org.id,
      username: `lapor-${suffix}`,
      fullName: "Pelapor",
      role: "field_supervisor",
      passwordHash: "x",
    },
    select: { id: true },
  });
  // Satu laporan di minggu ke-3 (20 Juli), satu lagi di minggu ke-7 (17 Agustus).
  for (const [tanggal, volume, nilai] of [
    ["2026-07-20", 1, 10_000_000n],
    ["2026-08-17", 3, 30_000_000n],
  ] as const) {
    const lap = await db.dailyReport.create({
      data: {
        locationId,
        reportDate: new Date(`${tanggal}T00:00:00.000Z`),
        status: "final",
        createdById: pelapor.id,
      },
      select: { id: true },
    });
    await db.dailyReportItem.create({
      data: {
        reportId: lap.id,
        rabNodeId: item.id,
        lineageKey: `itm-${suffix}`,
        basis: "aktif",
        volumeDone: volume,
        valueDone: nilai,
      },
    });
  }
});

beforeEach(() => {
  terkirim.length = 0;
  wahaHidup = true;
  gagalKirim = false;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("kapan minggu kontrak berakhir", () => {
  it("hari ke-6 sejak SPMK adalah akhir minggu ke-1, hari ke-13 akhir minggu ke-2", () => {
    // Minggu ke-N = hari (N−1)×7 … N×7−1. Hari terakhirnya sisa-bagi 6.
    expect(akhirMingguKontrak(SPMK, new Date("2026-07-12T00:00:00Z"))).toBe(true);
    expect(mingguKontrak(SPMK, new Date("2026-07-12T00:00:00Z"))).toBe(1);
    expect(akhirMingguKontrak(SPMK, new Date("2026-07-19T00:00:00Z"))).toBe(true);
    expect(mingguKontrak(SPMK, new Date("2026-07-19T00:00:00Z"))).toBe(2);
  });

  it("hari-hari lain BUKAN akhir minggu", () => {
    for (const t of ["2026-07-06", "2026-07-09", "2026-07-11", "2026-07-13"]) {
      expect(akhirMingguKontrak(SPMK, new Date(`${t}T00:00:00Z`)), t).toBe(false);
    }
  });

  it("nomor minggu TIDAK dibatasi panjang kurva-S — kontrak molor tetap jujur", () => {
    // Kalau angka ini di-clamp ke jumlah minggu baseline, kontrak yang lewat
    // jadwal akan selamanya melaporkan "Minggu Ke : 20" padahal sudah 25.
    expect(mingguKontrak(SPMK, new Date("2027-01-04T00:00:00Z"))).toBe(27);
  });
});

describe("penjadwal", () => {
  it("DIAM di hari yang bukan akhir minggu kontrak", async () => {
    const h = await kirimLaporanMingguanTerjadwal(new Date("2026-07-09T09:00:00Z"));
    expect(h.diperiksa).toBe(0);
    expect(terkirim).toHaveLength(0);
  });

  it("mengirim tepat di hari terakhir minggu kontrak", async () => {
    const h = await kirimLaporanMingguanTerjadwal(new Date("2026-07-12T09:00:00Z"));
    expect(h.terkirim).toBe(1);
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].chatId).toBe(GRUP);
    expect(terkirim[0].text).toContain("Laporan Progres Mingguan");
    expect(terkirim[0].text).toContain("Nama Pelaksana : CV. ALKOMBER KARYA");
    expect(terkirim[0].text).toContain("Minggu Ke : 1");
    expect(terkirim[0].text).toContain("Nama Desa/KNMP : Pasir");
  });

  it("KASUS INTI: putaran cron berikutnya di hari yang sama tidak mengirim ulang", async () => {
    // Cron dipanggil tiap hari dan boleh dipicu manual berkali-kali. Tanpa
    // UNIQUE (paket, minggu), satu minggu bisa diumumkan berkali-kali ke grup
    // pemberi kerja — dan pesan WhatsApp tidak bisa ditarik kembali.
    const lagi = await kirimLaporanMingguanTerjadwal(new Date("2026-07-12T15:00:00Z"));
    expect(terkirim).toHaveLength(0);
    expect(lagi.dilewati).toBe(1);
    expect(lagi.terkirim).toBe(0);
  });

  it("minggu BERIKUTNYA tetap dikirim — yang dikunci minggunya, bukan paketnya", async () => {
    const h = await kirimLaporanMingguanTerjadwal(new Date("2026-07-19T09:00:00Z"));
    expect(h.terkirim).toBe(1);
    expect(terkirim[0].text).toContain("Minggu Ke : 2");
  });

  it("sakelar MATI membuat penjadwal diam total", async () => {
    await setMingguanAktif(false);
    const h = await kirimLaporanMingguanTerjadwal(new Date("2026-07-26T09:00:00Z"));
    expect(h.aktif).toBe(false);
    expect(terkirim).toHaveLength(0);
    await setMingguanAktif(true);
  });
});

describe("kegagalan kirim", () => {
  it("percobaan yang GAGAL tidak mengunci minggu itu selamanya", async () => {
    // Kalau baris `gagal` ikut menghalangi, satu WAHA yang mati lima menit
    // membuat laporan minggu itu hilang untuk selamanya — padahal yang tidak
    // boleh berulang adalah pesan yang BENAR-BENAR sampai.
    const saat = new Date("2026-07-26T09:00:00Z");
    // Nomor minggunya DITURUNKAN, bukan diketik: angka yang dipatok tangan di
    // uji cuma memindahkan salah hitung dari kode ke ujinya.
    const minggu = mingguKontrak(SPMK, saat);

    gagalKirim = true;
    const rusak = await kirimLaporanMingguan(packageId, { now: saat });
    expect(rusak.ok).toBe(false);
    const log = await db.weeklyWaLog.findUnique({
      where: { packageId_weekNumber: { packageId, weekNumber: minggu } },
      select: { status: true },
    });
    expect(log?.status).toBe("gagal");

    gagalKirim = false;
    const ulang = await kirimLaporanMingguan(packageId, {
      now: new Date("2026-07-26T10:00:00Z"),
    });
    expect(ulang.ok).toBe(true);
    expect(terkirim).toHaveLength(1);
  });

  it("WAHA belum dikonfigurasi ditolak dengan sebabnya, bukan diam-diam sukses", async () => {
    wahaHidup = false;
    const r = await kirimLaporanMingguan(packageId, { now: new Date("2026-08-02T09:00:00Z") });
    expect(r.ok).toBe(false);
    expect("alasan" in r && r.alasan).toMatch(/WAHA|dikonfigurasi/i);
    expect(terkirim).toHaveLength(0);
  });
});

describe("jejak kirim", () => {
  it("teks yang dikirim DISIMPAN apa adanya, bukan disusun ulang belakangan", async () => {
    // Laporan resmi ke pemberi kerja harus bisa dibuktikan isinya bulan depan.
    // Menyusunnya ulang dari angka hari ini akan menghasilkan teks yang
    // berbeda — angka hari ini sudah bergerak.
    const log = await db.weeklyWaLog.findUnique({
      where: { packageId_weekNumber: { packageId, weekNumber: 1 } },
      select: { body: true, chatId: true, waMessageId: true, locations: true },
    });
    expect(log?.body).toContain("Minggu Ke : 1");
    expect(log?.chatId).toBe(GRUP);
    expect(log?.waMessageId).toMatch(/^wamid\./);
    expect(log?.locations).toBe(1);
  });
});

describe("memilih minggu yang dilaporkan (DECISIONS 357)", () => {
  /*
   * Permintaan user 2026-08-17: *"saat ini kirim minggu berjalan, padahal
   * kadang kita butuh kirim minggu terakhir"*.
   *
   * Yang dijaga di sini bukan sekadar "nomor mingguanya berubah" — itu mudah
   * dan tidak membuktikan apa pun. Yang berbahaya adalah pesan yang berjudul
   * "Minggu Ke : 5" tapi berisi realisasi HARI INI: tetap terkirim, tetap
   * rapi, tetap ke grup berisi PPK, dan tidak ada yang bisa membedakannya.
   */
  const KINI = new Date("2026-08-19T03:00:00.000Z"); // minggu berjalan ke-7

  it("tanpa pilihan: tetap minggu BERJALAN — kebiasaan lama tidak berubah", async () => {
    const r = await pratinjauMingguan(packageId, KINI);
    expect("alasan" in r, "alasan" in r ? r.alasan : "").toBe(false);
    if ("alasan" in r) return;
    expect(r.mingguKe).toBe(mingguKontrak(SPMK, KINI));
    expect(r.berjalan).toBe(true);
  });

  it("minggu berjalan DITANDAI di badan pesan", async () => {
    // Penerima yang mengira ini laporan minggu penuh akan membandingkannya
    // dengan minggu-minggu genap sebelumnya — perbandingan yang selalu membuat
    // minggu berjalan terlihat tertinggal.
    const r = await pratinjauMingguan(packageId, KINI);
    if ("alasan" in r) throw new Error(r.alasan);
    expect(r.body).toContain("minggu berjalan");
  });

  it("minggu SELESAI bisa dipilih, dan tidak ditandai berjalan", async () => {
    const r = await pratinjauMingguan(packageId, KINI, 5);
    if ("alasan" in r) throw new Error(r.alasan);
    expect(r.mingguKe).toBe(5);
    expect(r.berjalan).toBe(false);
    expect(r.body).toContain("Minggu Ke : 5");
    expect(r.body).not.toContain("minggu berjalan");
  });

  it("badan pesan menyebut RENTANG TANGGAL minggunya", async () => {
    /*
     * Nomor minggu saja tidak cukup begitu yang dilaporkan bisa BUKAN minggu
     * berjalan: PPK & konsultan yang menerima pesannya tidak punya cara tahu
     * periode mana yang dimaksud, dan pesan WhatsApp tidak bisa ditarik kembali
     * untuk diperjelas.
     */
    const r = await pratinjauMingguan(packageId, KINI, 5);
    if ("alasan" in r) throw new Error(r.alasan);
    // Minggu ke-5 dari SPMK 6 Juli = 3–9 Agustus. Singkatan bulannya mengikuti
    // `formatTanggal` aplikasi ("Agt"), bukan ejaan yang diasumsikan uji.
    expect(r.body).toContain("Minggu Ke : 5 (3 Agt – 9 Agt 2026)");
  });

  it("minggu yang BELUM TERJADI ditolak, dengan menyebut minggu berjalannya", async () => {
    const r = await pratinjauMingguan(packageId, KINI, 99);
    expect("alasan" in r).toBe(true);
    if (!("alasan" in r)) return;
    expect(r.alasan).toContain("belum terjadi");
    expect(r.alasan).toContain(String(mingguKontrak(SPMK, KINI)));
  });

  it("kirim minggu lampau tercatat di bawah NOMOR MINGGU ITU, bukan minggu berjalan", async () => {
    // Kunci UNIQUE (paket, minggu) yang menjaga penjadwal tidak mengumumkan
    // minggu sama dua kali harus tetap berarti setelah pilihan ini ada.
    const hasil = await kirimLaporanMingguan(packageId, {
      manual: true,
      paksa: true,
      now: KINI,
      mingguKe: 4,
    });
    expect(hasil.ok, hasil.ok ? "" : hasil.alasan).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.mingguKe).toBe(4);
    const baris = await db.weeklyWaLog.findUnique({
      where: { packageId_weekNumber: { packageId, weekNumber: 4 } },
      select: { weekNumber: true, body: true },
    });
    expect(baris?.weekNumber).toBe(4);
    expect(baris?.body).toContain("Minggu Ke : 4");
    expect(terkirim.at(-1)?.text).toContain("Minggu Ke : 4");
  });

  it("mengirim minggu lampau TIDAK mengunci minggu berjalan", async () => {
    /*
     * Kalau keduanya terlanjur berbagi satu baris log, mengirim laporan susulan
     * minggu lalu akan membuat penjadwal DIAM pada minggu berjalan — laporan
     * yang seharusnya otomatis jadi hilang tanpa ada yang sadar.
     */
    await db.weeklyWaLog.deleteMany({ where: { packageId } });
    await kirimLaporanMingguan(packageId, { manual: true, paksa: true, now: KINI, mingguKe: 4 });
    const berjalan = mingguKontrak(SPMK, KINI);
    const lagi = await kirimLaporanMingguan(packageId, { manual: true, now: KINI });
    expect(lagi.ok, lagi.ok ? "" : lagi.alasan).toBe(true);
    if (!lagi.ok) return;
    expect(lagi.mingguKe).toBe(berjalan);
  });
});

describe("angka minggu lampau adalah angka MINGGU ITU (DECISIONS 357)", () => {
  /*
   * Klaim inti fitur ini, dan satu-satunya yang benar-benar berbahaya kalau
   * salah. Pesan berjudul "Minggu Ke : 4" yang memuat realisasi HARI INI tetap
   * terkirim, tetap rapi, tetap ke grup berisi PPK — dan tidak ada yang bisa
   * membedakannya tanpa menghitung ulang sendiri.
   *
   * Data uji sengaja punya DUA laporan di minggu berbeda (minggu ke-3 dan
   * minggu ke-7), jadi realisasi "s/d minggu ke-4" HARUS lebih kecil daripada
   * "s/d hari ini". Kalau keduanya sama, `asOf` tidak sampai ke calc layer.
   */
  const KINI = new Date("2026-08-19T03:00:00.000Z"); // minggu berjalan ke-7

  it("realisasi minggu ke-4 LEBIH KECIL daripada minggu berjalan", async () => {
    const lampau = await pratinjauMingguan(packageId, KINI, 4);
    const berjalan = await pratinjauMingguan(packageId, KINI);
    if ("alasan" in lampau) throw new Error(lampau.alasan);
    if ("alasan" in berjalan) throw new Error(berjalan.alasan);

    const angka = (body: string) =>
      Number(
        (/Realisasi\s*:\s*([\d.,]+)/i.exec(body)?.[1] ?? "0").replace(/\./g, "").replace(",", "."),
      );
    const aLampau = angka(lampau.body);
    const aBerjalan = angka(berjalan.body);

    // 1 dari 10 unit (10%) s/d minggu ke-4; 4 dari 10 (40%) s/d hari ini.
    expect(aLampau, `lampau=${aLampau} berjalan=${aBerjalan}`).toBeGreaterThan(0);
    expect(aLampau).toBeLessThan(aBerjalan);
  });

  it("laporan SESUDAH minggu target tidak ikut terhitung", async () => {
    // Laporan 17 Agustus (minggu ke-7) tidak boleh masuk ke laporan minggu ke-4.
    const r = await pratinjauMingguan(packageId, KINI, 4);
    if ("alasan" in r) throw new Error(r.alasan);
    expect(r.body).toContain("10,000");
    expect(r.body).not.toContain("40,000");
  });

  it("minggu berjalan memuat SELURUH laporan sampai hari ini", async () => {
    const r = await pratinjauMingguan(packageId, KINI);
    if ("alasan" in r) throw new Error(r.alasan);
    expect(r.body).toContain("40,000");
  });
});
