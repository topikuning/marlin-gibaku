// PINDAH TANGGAL LAPORAN HARIAN — JALUR PENUHNYA (DECISIONS 415).
//
// User 2026-08-22, atas laporan yang dikembalikan dengan alasan *"salah
// penginputan tanggal pelaksanaan sondir saya input di tanggal 21 Juli 2026
// yang benar tanggal 22 Juli 2026"*:
//
//   > ini terlalu ribet untuk edit, padahal bisa sekali klik, ganti tanggal saja.
//
// Aturan murninya diuji di `tests/unit/pindah-tanggal.test.ts`. Yang HANYA bisa
// dibuktikan dengan basis data sungguhan ada di sini, dan semuanya soal akibat:
// isi laporan benar-benar ikut pindah, laporan final dibuka & difinalkan ulang,
// cuaca dibuang, penanda WA dilepas, dan snapshot laporan LAIN yang ikut
// bergeser dihitung ulang.
//
// Yang terakhir itu yang paling mudah luput: `finalSnapshot` membekukan angka
// kumulatif "s/d tanggal laporan". Memindahkan satu laporan melewati laporan
// final lain diam-diam membuat angka beku itu salah — dan angka beku tidak
// pernah mengeluh.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));

const { db } = await import("@/lib/db");
const { getOrCreateDraft, upsertItem, submitReport, approveReport, finalizeReport } = await import(
  "@/lib/daily-report/service"
);
const { pindahTanggalLaporan } = await import("@/lib/daily-report/pindah-tanggal-service");

const suffix = `pt${Date.now().toString(36)}`;

/** Kontrak mulai 1 Juni 2026 – semua tanggal uji di dalamnya, dan sudah lewat. */
const TGL_A = "2026-06-08"; // yang DIPINDAH
const TGL_B = "2026-06-10"; // final di ANTARA – snapshotnya harus ikut dihitung ulang
const TGL_TUJUAN = "2026-06-12";
const TGL_TERISI = "2026-06-14"; // sudah punya laporan – tujuan yang harus ditolak

let orgId = "";
let mandorId = "";
let pmId = "";
let adminId = "";
let locationId = "";
let batuId = "";
let laporanA = "";
let laporanB = "";
let fotoTanpaWaktu = "";

async function buatUser(nama: string, role: "site_manager" | "project_manager" | "super_admin") {
  return (
    await db.user.create({
      data: { orgId, username: `${nama}-${suffix}`, fullName: nama, passwordHash: "x", role },
      select: { id: true },
    })
  ).id;
}

/** Laporan lengkap sampai FINAL. Penyetujunya PM, pemfinalnya admin – supaya
 *  pemisahan tugas tidak ikut menghalangi (bukan itu yang diuji di sini). */
async function buatLaporanFinal(dateKey: string, volume: number) {
  const lap = await getOrCreateDraft(locationId, dateKey, mandorId);
  await upsertItem(lap.id, { rabNodeId: batuId, volumeDone: volume }, mandorId);
  await submitReport(lap.id, mandorId);
  await approveReport(lap.id, pmId);
  await finalizeReport(lap.id, adminId);
  return lap.id;
}

/** Volume kumulatif "s/d hari ini" yang DIBEKUKAN di snapshot cetak. */
async function kumulatifBeku(reportId: string) {
  const r = await db.dailyReport.findUniqueOrThrow({
    where: { id: reportId },
    select: { finalSnapshot: true },
  });
  const snap = r.finalSnapshot as unknown as {
    reportDate: string;
    items: { volumeBefore: number; volumeCumulative: number }[];
  };
  return {
    tanggal: snap.reportDate,
    sebelum: snap.items[0].volumeBefore,
    kumulatif: snap.items[0].volumeCumulative,
  };
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org PT ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  mandorId = await buatUser("Mandor", "site_manager");
  pmId = await buatUser("PM", "project_manager");
  adminId = await buatUser("Admin", "super_admin");

  const vendor = await db.vendor.create({
    data: { orgId, name: `PT Vendor PT ${suffix}`, address: "Jl. Uji No. 1" },
  });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket PT ${suffix}`, stage: "pelaksanaan" },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-PT-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 30,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-30"),
      workTitle: "Pembangunan Uji Pindah",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Pindah",
      slug: `pindah-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: 100_000_000n,
      createdAt: new Date("2026-05-26"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN UJI",
      amount: 100_000_000n,
      lineageKey: "I",
      sortOrder: 1,
    },
  });
  batuId = (
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        code: "1",
        name: "Pasangan batu",
        volume: 100,
        unit: "m3",
        unitPrice: 1_000_000,
        amount: 100_000_000n,
        lineageKey: "I#1",
        sortOrder: 2,
      },
      select: { id: true },
    })
  ).id;

  laporanA = await buatLaporanFinal(TGL_A, 10);
  laporanB = await buatLaporanFinal(TGL_B, 20);
  await buatLaporanFinal(TGL_TERISI, 5);

  // Dua foto dengan nasib berbeda: yang punya waktu jepret sendiri TIDAK ikut
  // salah capnya, yang tidak punya IKUT salah.
  await db.photo.create({
    data: {
      locationId,
      reportId: laporanA,
      r2Key: `photos/${suffix}/ada-waktu.webp`,
      sha256: `sha-${suffix}-1`,
      bytes: 100,
      uploadedById: mandorId,
      exifTakenAt: new Date("2026-06-12T09:00:00+07:00"),
      originalKey: `photos/${suffix}/ada-waktu.orig.jpg`,
    },
  });
  fotoTanpaWaktu = (
    await db.photo.create({
      data: {
        locationId,
        reportId: laporanA,
        r2Key: `photos/${suffix}/tanpa-waktu.webp`,
        sha256: `sha-${suffix}-2`,
        bytes: 100,
        uploadedById: mandorId,
        exifTakenAt: null,
        originalKey: `photos/${suffix}/tanpa-waktu.orig.jpg`,
      },
      select: { id: true },
    })
  ).id;

  // Cuaca otomatis + penanda WA: dua fakta yang menempel ke TANGGAL, dan karena
  // itu tidak boleh ikut pindah begitu saja.
  await db.dailyReport.update({
    where: { id: laporanA },
    data: {
      weather: "hujan_ringan",
      weatherHourly: [{ hour: 7, category: "Hujan", precipMm: 3 }],
      weatherSource: "otomatis",
      weatherFetchedAt: new Date("2026-06-08T10:00:00Z"),
      waSentAt: new Date("2026-06-08T12:00:00Z"),
      waSentById: mandorId,
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("pemindahan yang berhasil", () => {
  let hasil: Awaited<ReturnType<typeof pindahTanggalLaporan>>;
  let bekuSebelum: Awaited<ReturnType<typeof kumulatifBeku>>;

  beforeAll(async () => {
    bekuSebelum = await kumulatifBeku(laporanB);
    hasil = await pindahTanggalLaporan({
      reportId: laporanA,
      tanggalBaru: TGL_TUJUAN,
      alasan: "salah input tanggal pelaksanaan sondir",
      userId: adminId,
    });
  });

  it("tanggalnya benar-benar berpindah, dan isinya IKUT", async () => {
    const r = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanA },
      select: {
        reportDate: true,
        status: true,
        _count: { select: { items: true, photos: true } },
      },
    });
    expect(r.reportDate.toISOString().slice(0, 10)).toBe(TGL_TUJUAN);
    // Yang membuat pemindahan lebih baik daripada "hapus lalu input ulang":
    // tidak ada satu pun yang perlu diunggah atau diketik ulang.
    expect(r._count.items).toBe(1);
    expect(r._count.photos).toBe(2);
  });

  it("laporan final dibuka & difinalkan ulang – statusnya kembali final", async () => {
    const r = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanA },
      select: { status: true, finalizedAt: true },
    });
    expect(hasil.lewatFinal).toBe(true);
    expect(r.status).toBe("final");
    expect(r.finalizedAt).not.toBeNull();
  });

  it("snapshot cetaknya dibangun ulang DI TANGGAL BARU", async () => {
    /*
     * Bukan sekadar kolom tanggal yang berubah: nomor minggu dan angka
     * kumulatif "s/d" ikut dihitung ulang. Snapshot yang dibiarkan beku akan
     * mencetak dokumen resmi bertanggal lama — dan itulah satu-satunya versi
     * yang benar-benar dikirim ke KKP.
     */
    const beku = await kumulatifBeku(laporanA);
    expect(beku.tanggal).toBe(TGL_TUJUAN);
    // Di 12 Juni, laporan B (10 Juni, 20 m³) sudah ikut terhitung.
    expect(beku.sebelum).toBe(20);
    expect(beku.kumulatif).toBe(30);
  });

  it("snapshot laporan final DI ANTARA ikut dihitung ulang", async () => {
    /*
     * Inti yang paling mudah luput. Sebelum pindah, laporan B (10 Juni)
     * menghitung laporan A (8 Juni) sebagai "s/d laporan lalu". Sesudah A
     * pindah ke 12 Juni, A tidak lagi mendahului B — jadi angka beku B salah
     * kalau tidak dibangun ulang, dan tidak ada yang akan bersuara.
     */
    expect(bekuSebelum.sebelum).toBe(10);
    expect(bekuSebelum.kumulatif).toBe(30);

    const bekuSesudah = await kumulatifBeku(laporanB);
    expect(bekuSesudah.sebelum).toBe(0);
    expect(bekuSesudah.kumulatif).toBe(20);
    expect(hasil.snapshotDibangunUlang).toBe(1);
  });

  it("cuaca otomatis dibuang – bukan diseret ke hari yang salah", async () => {
    /*
     * `weatherHourly` adalah bacaan mesin UNTUK TANGGAL ITU, dan dipakai
     * menghitung "berapa hari hujan" — dasar klaim perpanjangan waktu.
     * Membiarkannya ikut pindah berarti menyimpan bacaan tentang hari yang
     * salah, lalu memakainya sebagai bukti.
     */
    const r = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanA },
      select: { weather: true, weatherHourly: true, weatherSource: true, weatherFetchedAt: true },
    });
    expect(r.weather).toBeNull();
    expect(r.weatherHourly).toBeNull();
    expect(r.weatherSource).toBeNull();
    expect(r.weatherFetchedAt).toBeNull();
    expect(hasil.cuacaDibuang).toBe(true);
  });

  it("penanda \"sudah dikirim WA\" dilepas, tapi faktanya tersimpan di audit", async () => {
    /*
     * Yang terlanjur terkirim ke grup bertanggal LAMA. Kalau penandanya
     * dibiarkan, laporan ini hilang dari hitungan "belum dikirim" dan tidak
     * akan pernah dikirim ulang oleh siapa pun.
     */
    const r = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanA },
      select: { waSentAt: true, waSentById: true },
    });
    expect(r.waSentAt).toBeNull();
    expect(r.waSentById).toBeNull();
    expect(hasil.waDilepas).toBe(true);

    const jejak = await db.auditLog.findFirst({
      where: { action: "daily_report.move_date", resourceId: laporanA },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const p = jejak?.payload as Record<string, unknown> | null;
    expect(p?.dari).toBe(TGL_A);
    expect(p?.ke).toBe(TGL_TUJUAN);
    // Fakta bahwa pengiriman PERNAH terjadi tidak boleh ikut hilang bersama
    // penandanya – yang dilepas cuma klaim "laporan ini sudah diserahkan".
    expect(p?.waSentAtSebelumnya).toBeTruthy();
  });

  it("hanya foto tanpa waktu jepret yang dilaporkan perlu dicap ulang", async () => {
    /*
     * Foto yang membawa waktu jepret sendiri capnya menyebut kapan foto itu
     * benar-benar diambil — sesudah laporan pindah, justru capnya yang cocok.
     * Mencap ulang di situ akan merusak yang sudah benar.
     */
    expect(hasil.foto.perluCapUlang).toBe(1);
    expect(hasil.foto.takBisaDiperbaiki).toBe(0);
    expect(fotoTanpaWaktu).toBeTruthy();
  });

  it("TIDAK mencap ulang foto diam-diam", async () => {
    // Cap dibakar ke gambar: itu menulis bukti, dan sudah punya layarnya
    // sendiri dengan alasan + riwayat revisi (DECISIONS 198). Menjalankannya
    // sebagai efek samping pindah tanggal berarti bukti berubah tanpa ada yang
    // memutuskan.
    const f = await db.photo.findUniqueOrThrow({
      where: { id: fotoTanpaWaktu },
      select: { stampRevision: true },
    });
    expect(f.stampRevision).toBe(0);
  });
});

describe("pemindahan yang ditolak", () => {
  it("tanggal tujuan yang sudah berisi ditolak, dan TIDAK ada yang berubah", async () => {
    const sebelum = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanB },
      select: { reportDate: true, status: true },
    });
    await expect(
      pindahTanggalLaporan({
        reportId: laporanB,
        tanggalBaru: TGL_TERISI,
        alasan: "mencoba menimpa laporan yang sudah ada",
        userId: adminId,
      }),
    ).rejects.toThrow(/sudah punya laporan/i);

    const sesudah = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanB },
      select: { reportDate: true, status: true },
    });
    expect(sesudah).toEqual(sebelum);
  });

  it("alasan yang terlalu pendek ditolak sebelum apa pun disentuh", async () => {
    await expect(
      pindahTanggalLaporan({
        reportId: laporanB,
        tanggalBaru: "2026-06-11",
        alasan: "salah",
        userId: adminId,
      }),
    ).rejects.toThrow(/[Aa]lasan/);
    const r = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporanB },
      select: { reportDate: true },
    });
    expect(r.reportDate.toISOString().slice(0, 10)).toBe(TGL_B);
  });

  it("tanggal yang belum terjadi ditolak", async () => {
    /*
     * "Besok" dihitung dari HARI KERJA Asia/Jakarta — sama dengan pagarnya.
     * Versi lama memakai UTC: antara pukul 17.00–24.00 UTC, "besok UTC" masih
     * "hari ini WIB", jadi pemindahannya SAH dan ujinya merah bukan karena
     * kode salah melainkan karena ujinya memakai zona waktu yang lain.
     */
    const { jakartaDateKey } = await import("@/lib/format");
    const besok = new Date(`${jakartaDateKey(new Date())}T00:00:00+07:00`);
    besok.setUTCDate(besok.getUTCDate() + 1);
    const besokKey = `${jakartaDateKey(besok)}`;
    await expect(
      pindahTanggalLaporan({
        reportId: laporanB,
        tanggalBaru: besokKey,
        alasan: "mencoba membuat laporan bertanggal besok",
        userId: adminId,
      }),
    ).rejects.toThrow(/belum terjadi/i);
  });
});

describe("laporan yang belum terhitung", () => {
  it("dipindah tanpa membangun ulang snapshot siapa pun", async () => {
    /*
     * Draft tidak pernah masuk angka resmi, jadi memindahkannya tidak menggeser
     * kumulatif laporan mana pun. Membangun ulang snapshot di situ berarti
     * menulis ulang dokumen beku tanpa satu angka pun berubah.
     */
    const draft = await getOrCreateDraft(locationId, "2026-06-16", mandorId);
    const hasil = await pindahTanggalLaporan({
      reportId: draft.id,
      tanggalBaru: "2026-06-17",
      alasan: "draft salah tanggal, belum dikirim sama sekali",
      userId: adminId,
    });
    expect(hasil.lewatFinal).toBe(false);
    expect(hasil.snapshotDibangunUlang).toBe(0);

    const r = await db.dailyReport.findUniqueOrThrow({
      where: { id: draft.id },
      select: { reportDate: true, status: true },
    });
    expect(r.reportDate.toISOString().slice(0, 10)).toBe("2026-06-17");
    expect(r.status).toBe("draft");
  });
});
