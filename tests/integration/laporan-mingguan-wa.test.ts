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
  sendText: async (chatId: string, text: string) => {
    if (gagalKirim) throw new Error("WAHA mati");
    terkirim.push({ chatId, text });
    return `wamid.${terkirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { akhirMingguKontrak, kirimLaporanMingguan, mingguKontrak } = await import(
  "@/lib/mingguan/kirim"
);
const { kirimLaporanMingguanTerjadwal } = await import("@/lib/mingguan/penjadwal");
const { setMingguanAktif } = await import("@/lib/mingguan/setelan");

const suffix = `lm${Date.now().toString(36)}`;
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
