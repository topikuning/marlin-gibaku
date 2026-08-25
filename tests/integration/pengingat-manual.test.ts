// Tombol admin "Kirim pengingat sekarang" + pratinjaunya (DECISIONS 205).
//
// Permintaan user 2026-08-01: "buat juga satu tombol untuk eksekusi pengingat
// semua orang, dari admin."
//
// Yang diuji bukan cuma "terkirim", tapi tiga hal yang bisa melukai orang:
//   1. tombol ini mengirim WA ke HP orang lapangan → hanya boleh dipegang
//      pengelola sistem;
//   2. ditekan dua kali TIDAK boleh mengirim pesan dobel;
//   3. pratinjaunya harus menunjukkan orang yang SAMA dengan yang benar-benar
//      dikirimi — pratinjau yang meleset lebih buruk daripada tidak ada.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terkirim: { chatId: string; text: string }[] = [];
let wahaAktif = true;
let statusSesi = "WORKING";
/** WAHA versi tertentu membalas 2xx tanpa body — "terkirim" tanpa bukti. */
let tanpaIdPesan = false;
vi.mock("@/lib/waha/client", () => ({
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
    terkirim.push({ chatId, text });
    return tanpaIdPesan ? null : "MSGID";
  },
}));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Admin" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const {
  kirimPengingatSekarangAction,
  kirimPengingatSatuOrangAction,
  setPengingatAktifAction,
} = await import("@/lib/harian/actions");
const { jalankanTugasHarian } = await import("@/lib/harian/penjadwal");
const { getPengingatAktif, setPengingatAktif, PENGINGAT_KEY } = await import(
  "@/lib/harian/setelan"
);
const { pratinjauPengingat } = await import("@/lib/harian/pratinjau");
const { jakartaDateKey } = await import("@/lib/format");

const suffix = `pm${Date.now().toString(36)}`;
// Nomor WA UNIK per jalannya berkas ini. Berkas ini tidak melakukan TRUNCATE di
// `afterAll`, jadi pengguna dari jalan sebelumnya masih ada di DB uji; dengan
// nomor konstan, `jalankanTugasHarian()` (yang sengaja lintas-organisasi)
// menghitung mereka juga dan jumlah pesan jadi meleset tanpa ada yang rusak.
const NOMOR = `62899${Date.now().toString().slice(-9)}`;
let orgId = "";
let mandorId = "";
let tanpaNomorId = "";
let lokasiId = "";
const hariIni = jakartaDateKey(new Date());

const TUJUAN = `${NOMOR}@c.us`;
const punyaKita = () => terkirim.filter((t) => t.chatId === TUJUAN);

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  sessionOrgId = org.id;
  sessionUserId = (
    await db.user.create({
      data: { orgId, username: `adm-${suffix}`, fullName: "Admin", role: "super_admin", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  mandorId = (
    await db.user.create({
      data: {
        orgId,
        username: `md-${suffix}`,
        fullName: "Paijo Sutrisno",
        role: "field_supervisor",
        passwordHash: "x",
        waNumber: NOMOR,
      },
      select: { id: true },
    })
  ).id;
  tanpaNomorId = (
    await db.user.create({
      data: { orgId, username: `nw-${suffix}`, fullName: "Tanpa Nomor", role: "site_manager", passwordHash: "x" },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId, name: `CV ${suffix}` }, select: { id: true } });
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  await db.contract.create({
    data: {
      package: { connect: { id: pkg.id } },
      vendor: { connect: { id: vendor.id } },
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000n,
      signedDate: new Date("2026-01-01"),
      durationDays: 200,
      startDate: new Date("2026-01-05"),
      endDate: new Date("2026-12-31"),
    },
  });
  const l = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Pengaradan",
      slug: `pengaradan-${suffix}`,
      village: "Pengaradan",
      regency: "Brebes",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true },
  });
  lokasiId = l.id;
  await db.locationAssignment.create({ data: { userId: mandorId, locationId: lokasiId } });
  await db.locationAssignment.create({ data: { userId: tanpaNomorId, locationId: lokasiId } });
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  terkirim.length = 0;
  wahaAktif = true;
  statusSesi = "WORKING";
  tanpaIdPesan = false;
  role = "super_admin";
  await db.dailyReminderLog.deleteMany({ where: { userId: { in: [mandorId, tanpaNomorId] } } });
});

describe("KASUS INTI: admin bisa menagih semua orang tanpa menunggu penjadwal", () => {
  it("satu tekan → pesan benar-benar terkirim ke penanggung jawab", async () => {
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(res?.error).toBeUndefined();
    expect(res?.success).toMatch(/terkirim/i);
    expect(punyaKita()).toHaveLength(1);
    expect(punyaKita()[0].text).toContain("Pengaradan");
  });

  it("BOLEH dikirim berkali-kali – admin tidak dikunci sehari sekali", async () => {
    // DECISIONS 207, permintaan user 2026-08-02: "di halaman admin aku bebas
    // kirim berapa kali pun … kamu cukup mencegah atau menambah aksi ganda
    // untuk kirim ulang, misal konfirmasi kalau kirim ulang, bukan me-lock
    // admin sama sekali." Pesan pertama yang tidak sampai adalah keadaan nyata;
    // menjawab "sudah dikirim hari ini" pada keadaan itu tidak menolong siapa
    // pun. Pengaman pengiriman tak sengaja ada di UI (daftar penerima +
    // konfirmasi yang menyebut berapa orang menerima pesan kedua).
    await kirimPengingatSekarangAction(undefined, new FormData());
    const res2 = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(punyaKita()).toHaveLength(2);
    expect(res2?.error).toBeUndefined();
    expect(res2?.success).toMatch(/terkirim/i);

    // Jejaknya bertambah, bukan tertimpa diam-diam.
    const log = await db.dailyReminderLog.findFirstOrThrow({
      where: { userId: mandorId, dateKey: hariIni },
      select: { attempts: true, chatId: true },
    });
    expect(log.attempts).toBe(2);
    expect(log.chatId).toBe(TUJUAN);
  });

  it("hasil per orang dilaporkan – 'berhasil atau tidak' tidak perlu ditebak", async () => {
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    const kita = res?.rincian?.find((r) => r.tujuan === TUJUAN);
    expect(kita).toBeDefined();
    expect(kita!.nama).toBe("Paijo Sutrisno");
    expect(kita!.ok).toBe(true);
    // Bukti nyata, bukan kata "sukses": tanpa ID pesan, 2xx dari WAHA tidak
    // membuktikan apa pun.
    expect(kita!.waMessageId).toBe("MSGID");
  });

  it("tercatat di audit – pengiriman ke orang lain harus punya jejak pelakunya", async () => {
    await kirimPengingatSekarangAction(undefined, new FormData());
    const log = await db.auditLog.findFirst({
      where: { action: "reminder.manual_send", userId: sessionUserId },
      orderBy: { createdAt: "desc" },
      select: { userId: true, payload: true },
    });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(sessionUserId);
    expect((log!.payload as { terkirim?: number }).terkirim).toBeGreaterThanOrEqual(1);
  });
});

describe("pagar tombol", () => {
  it("peran tanpa system.manage DITOLAK – bukan cuma menunya disembunyikan", async () => {
    for (const r of ["project_manager", "site_manager", "field_supervisor", "wakil_ppk"]) {
      role = r;
      const res = await kirimPengingatSekarangAction(undefined, new FormData());
      expect(res?.error).toMatch(/izin/i);
      expect(punyaKita()).toHaveLength(0);
    }
  });

  it("WAHA mati → ditolak dengan alasan, dan TIDAK menghanguskan jatah hari ini", async () => {
    wahaAktif = false;
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(res?.error).toMatch(/WAHA|WhatsApp/i);
    expect(await db.dailyReminderLog.count({ where: { userId: mandorId, dateKey: hariIni } })).toBe(0);

    // Setelah WAHA hidup, pengiriman hari ini masih bisa dilakukan.
    wahaAktif = true;
    await kirimPengingatSekarangAction(undefined, new FormData());
    expect(punyaKita()).toHaveLength(1);
  });
});

describe("sesi WhatsApp: dilaporkan, bukan dijadikan pagar", () => {
  it("status di luar WORKING TIDAK membatalkan pengiriman, hanya disebut", async () => {
    // DECISIONS 207: status sesi adalah keterangan untuk membaca hasil. Kalau
    // dijadikan syarat, satu bacaan yang meleset mengunci admin dari tindakan
    // yang sebenarnya bisa berhasil.
    statusSesi = "SCAN_QR_CODE";
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(punyaKita()).toHaveLength(1);
    expect(res?.success).toMatch(/SCAN_QR_CODE/);
  });

  it("terkirim tanpa satu pun ID pesan DIANGKAT sebagai masalah, bukan 'sukses'", async () => {
    // Persis kejadian 2026-08-02: "7 terkirim", nol sampai. 2xx dari WAHA bukan
    // bukti pengiriman; tanpa ID pesan, kata "sukses" menyesatkan.
    tanpaIdPesan = true;
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(punyaKita()).toHaveLength(1);
    expect(res?.success).toBeUndefined();
    expect(res?.error).toMatch(/tidak satu pun mengembalikan id pesan/i);
    expect(res?.rincian?.[0].waMessageId).toBeNull();
  });

  it("pratinjau menyebut status sesi supaya admin tahu SEBELUM menekan", async () => {
    statusSesi = "FAILED";
    expect((await pratinjauPengingat(orgId)).sesiStatus).toBe("FAILED");
    statusSesi = "WORKING";
    expect((await pratinjauPengingat(orgId)).sesiStatus).toBe("WORKING");
  });
});

describe("pratinjau menunjukkan yang SAMA dengan yang akan dikirim", () => {
  it("menyebut nama, lokasi, dan keadaan laporannya", async () => {
    const p = await pratinjauPengingat(orgId);
    const kita = p.akanDitagih.find((x) => x.nama === "Paijo Sutrisno");
    expect(kita).toBeDefined();
    expect(kita!.lokasi).toContain("Pengaradan");
    expect(kita!.adaDraft[0]).toBe(false); // belum ada laporan sama sekali
    // Nomor tujuan ikut disebut: "terkirim tapi tidak sampai" paling sering
    // berarti nomornya, dan itu hanya kelihatan kalau nomornya ditulis.
    expect(kita!.tujuan).toBe(TUJUAN);
  });

  it("penanggung jawab TANPA nomor WA disebut namanya – 'terkirim 1' bukan berarti semua tertagih", async () => {
    const p = await pratinjauPengingat(orgId);
    expect(p.tanpaNomor).toContain("Tanpa Nomor");
  });

  it("setelah dikirim orangnya TETAP di daftar – tombolnya memang akan mengirim lagi", async () => {
    // DECISIONS 207: daftar "akan menerima" harus persis sama dengan yang
    // benar-benar dikirimi. Menyembunyikan yang sudah dikirimi tadi membuat
    // pratinjau berbohong, karena tombolnya tetap mengirim ke mereka.
    await kirimPengingatSekarangAction(undefined, new FormData());
    const p = await pratinjauPengingat(orgId);
    const kita = p.akanDitagih.find((x) => x.nama === "Paijo Sutrisno");
    expect(kita).toBeDefined();
    // Dan riwayatnya melekat, supaya "kirim lagi" adalah pilihan sadar.
    expect(kita!.riwayat).not.toBeNull();
    expect(kita!.riwayat!.attempts).toBe(1);
    expect(kita!.riwayat!.adaBukti).toBe(true);

    const sudah = p.sudahDikirim.find((x) => x.nama === "Paijo Sutrisno");
    expect(sudah).toBeDefined();
    expect(sudah!.status).toBe("sukses");
    expect(sudah!.tujuan).toBe(TUJUAN);
  });

  it("laporan yang sudah dikirim lapangan → orangnya tidak ditagih lagi", async () => {
    const laporan = await db.dailyReport.create({
      data: {
        locationId: lokasiId,
        reportDate: new Date(`${hariIni}T00:00:00.000Z`),
        status: "dikirim",
        createdById: mandorId,
        submittedById: mandorId,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    try {
      const p = await pratinjauPengingat(orgId);
      expect(p.akanDitagih.some((x) => x.nama === "Paijo Sutrisno")).toBe(false);
      const res = await kirimPengingatSekarangAction(undefined, new FormData());
      expect(res?.error).toBeUndefined();
      expect(punyaKita()).toHaveLength(0);
    } finally {
      await db.dailyReport.delete({ where: { id: laporan.id } });
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SAKELAR PENGINGAT OTOMATIS (DECISIONS 260)
   Permintaan user 2026-08-05: "aku perlu flag disable dan enable pengingat
   harian, lalu tombol per orang untuk pengingat manual".

   Yang dikunci di sini adalah BATAS kekuasaan sakelar itu. Sakelar yang
   mematikan lebih banyak daripada namanya adalah cacat senyap: tidak ada
   pesan error, cuma angka yang diam-diam salah beberapa minggu kemudian.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("sakelar pengingat: mematikan PENJADWAL, bukan kemampuan menagih", () => {
  let paketSpmkId = "";

  beforeAll(async () => {
    // Paket yang SPMK-nya sudah tiba tetapi masih berstatus `kontrak` —
    // dipakai membuktikan aktivasi SPMK tidak ikut mati.
    const vendor = await db.vendor.create({
      data: { orgId, name: `CV SPMK ${suffix}` },
      select: { id: true },
    });
    const pkg = await db.package.create({
      data: { orgId, name: `Paket SPMK ${suffix}`, stage: "kontrak" },
      select: { id: true },
    });
    paketSpmkId = pkg.id;
    await db.contract.create({
      data: {
        package: { connect: { id: pkg.id } },
        vendor: { connect: { id: vendor.id } },
        contractNumber: `KS-${suffix}`,
        contractValue: 500_000n,
        signedDate: new Date("2026-01-01"),
        durationDays: 100,
        startDate: new Date("2026-01-10"), // sudah lewat
        endDate: new Date("2026-12-31"),
      },
    });
  });

  afterAll(async () => {
    // Setelan ini GLOBAL (AppSetting tanpa orgId). Ia WAJIB dikembalikan,
    // kalau tidak berkas uji berikutnya berjalan dengan pengingat mati.
    await db.appSetting.deleteMany({ where: { key: PENGINGAT_KEY } });
  });

  beforeEach(async () => {
    await db.appSetting.deleteMany({ where: { key: PENGINGAT_KEY } });
    // Tiap `jalankanTugasHarian` di suite ini ikut menaikkan paket SPMK, jadi
    // statusnya dikembalikan supaya uji aktivasi menguji aktivasi — bukan
    // menemukan pekerjaan yang sudah dilakukan uji sebelumnya.
    await db.package.update({ where: { id: paketSpmkId }, data: { stage: "kontrak" } });
  });

  it("belum pernah disetel = NYALA – setelan kosong tidak boleh diam-diam mematikan tagihan", async () => {
    expect(await getPengingatAktif()).toBe(true);
  });

  it("MATI → penjadwal tidak mengirim apa pun, dan mengatakan sebabnya", async () => {
    await setPengingatAktif(false);
    const hasil = await jalankanTugasHarian();
    expect(punyaKita()).toHaveLength(0);
    // "0 terkirim" punya dua arti berlawanan: tidak ada yang perlu ditagih,
    // ATAU sakelarnya mati. Tanpa penanda ini log cron tidak bisa dibaca.
    expect(hasil.pengingat.dimatikan).toBe(true);
    expect(hasil.pengingat.terkirim).toBe(0);
  });

  it("MATI → tombol manual TETAP mengirim (inti keputusannya)", async () => {
    // Admin yang mematikan pengingat otomatis karena libur bersama tetap harus
    // bisa menagih lokasi yang jalan terus. Sakelar ini mematikan cron, bukan
    // hak admin menagih.
    await setPengingatAktif(false);
    const res = await kirimPengingatSekarangAction(undefined, new FormData());
    expect(res?.error).toBeUndefined();
    expect(punyaKita()).toHaveLength(1);
  });

  it("MATI → aktivasi SPMK jatuh tempo TETAP berjalan", async () => {
    // Kalau ini ikut mati, paket tidak naik ke `pelaksanaan` pada tanggalnya,
    // dan seluruh kurva-S + deviasi ikut salah. Sakelar pengingat tidak boleh
    // punya kekuasaan sebesar itu.
    await setPengingatAktif(false);
    const hasil = await jalankanTugasHarian();
    expect(hasil.spmk.diaktifkan).toBeGreaterThanOrEqual(1);
    const kini = await db.package.findUniqueOrThrow({
      where: { id: paketSpmkId },
      select: { stage: true },
    });
    expect(kini.stage).toBe("pelaksanaan");
  });

  it("NYALA lagi → penjadwal menagih seperti biasa", async () => {
    await setPengingatAktif(true);
    const hasil = await jalankanTugasHarian();
    expect(hasil.pengingat.dimatikan).toBeUndefined();
    expect(punyaKita()).toHaveLength(1);
  });

  it("hanya pengelola sistem yang boleh menggeser sakelarnya", async () => {
    for (const r of ["project_manager", "site_manager", "field_supervisor", "wakil_ppk"]) {
      role = r;
      const fd = new FormData();
      fd.set("aktif", "0");
      const res = await setPengingatAktifAction(undefined, fd);
      expect(res?.error).toMatch(/izin/i);
      expect(await getPengingatAktif()).toBe(true); // tetap default
    }
  });

  it("perubahannya tercatat di audit – mematikan tagihan lapangan harus ada pelakunya", async () => {
    const fd = new FormData();
    fd.set("aktif", "0");
    const res = await setPengingatAktifAction(undefined, fd);
    expect(res?.success).toMatch(/dimatikan/i);
    const log = await db.auditLog.findFirst({
      where: { action: "reminder.toggle", userId: sessionUserId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect(log).not.toBeNull();
    expect((log!.payload as { aktif?: boolean }).aktif).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   TOMBOL PENGINGAT PER ORANG
   ═══════════════════════════════════════════════════════════════════════════ */

describe("pengingat per orang: menagih satu, bukan mengganggu semua", () => {
  const NOMOR2 = `62877${Date.now().toString().slice(-9)}`;
  const TUJUAN2 = `${NOMOR2}@c.us`;
  const punyaOrangKedua = () => terkirim.filter((t) => t.chatId === TUJUAN2);
  let mandor2Id = "";
  let orangOrgLainId = "";
  let orgLainId = "";

  beforeAll(async () => {
    mandor2Id = (
      await db.user.create({
        data: {
          orgId,
          username: `md2-${suffix}`,
          fullName: "Sukarno Hatta",
          role: "field_supervisor",
          passwordHash: "x",
          waNumber: NOMOR2,
        },
        select: { id: true },
      })
    ).id;
    await db.locationAssignment.create({ data: { userId: mandor2Id, locationId: lokasiId } });

    const lain = await db.organization.create({
      data: { name: `Org Lain ${suffix}`, slug: `ol-${suffix}` },
      select: { id: true },
    });
    orgLainId = lain.id;
    orangOrgLainId = (
      await db.user.create({
        data: {
          orgId: orgLainId,
          username: `asing-${suffix}`,
          fullName: "Orang Organisasi Lain",
          role: "field_supervisor",
          passwordHash: "x",
          waNumber: `62866${Date.now().toString().slice(-9)}`,
        },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    await db.dailyReminderLog.deleteMany({ where: { userId: { in: [mandor2Id, orangOrgLainId] } } });
  });

  const kirimKe = (userId: string) => {
    const fd = new FormData();
    fd.set("userId", userId);
    return kirimPengingatSatuOrangAction(undefined, fd);
  };

  it("KASUS INTI: hanya orang yang dipilih yang menerima pesan", async () => {
    // Tanpa ini, menagih ulang satu mandor berarti mengirimi ulang semua orang
    // yang sudah menerima — dan pengingat yang datang berkali-kali tanpa sebab
    // akan berhenti dibaca.
    const res = await kirimKe(mandor2Id);
    expect(res?.error).toBeUndefined();
    expect(res?.success).toMatch(/Sukarno Hatta/);
    expect(punyaOrangKedua()).toHaveLength(1);
    expect(punyaKita()).toHaveLength(0); // mandor pertama TIDAK diganggu
  });

  it("isi pesannya sama persis dengan versi massal – bukan jalur kedua yang menyimpang", async () => {
    await kirimKe(mandor2Id);
    const satuan = punyaOrangKedua()[0].text;
    terkirim.length = 0;
    await kirimPengingatSekarangAction(undefined, new FormData());
    const massal = punyaOrangKedua()[0].text;
    expect(satuan).toBe(massal);
  });

  it("jejaknya tercatat per orang, dan boleh diulang", async () => {
    await kirimKe(mandor2Id);
    await kirimKe(mandor2Id);
    expect(punyaOrangKedua()).toHaveLength(2);
    const log = await db.dailyReminderLog.findFirstOrThrow({
      where: { userId: mandor2Id, dateKey: hariIni },
      select: { attempts: true, chatId: true },
    });
    expect(log.attempts).toBe(2);
    expect(log.chatId).toBe(TUJUAN2);
  });

  it("TENANCY: userId organisasi lain tidak menerima apa pun", async () => {
    // Endpoint server action bisa dipanggil siapa pun yang tahu id-nya.
    // Penyaringan organisasi harus ada di SERVER, bukan di daftar yang dirender.
    const res = await kirimKe(orangOrgLainId);
    expect(terkirim).toHaveLength(0);
    expect(res?.success).toBeUndefined();
    expect(res?.error).toMatch(/tidak ada yang dikirim/i);
    expect(
      await db.dailyReminderLog.count({ where: { userId: orangOrgLainId, dateKey: hariIni } }),
    ).toBe(0);
  });

  it("orang yang sudah melapor → dikatakan tidak perlu ditagih, BUKAN 'terkirim'", async () => {
    const laporan = await db.dailyReport.create({
      data: {
        locationId: lokasiId,
        reportDate: new Date(`${hariIni}T00:00:00.000Z`),
        status: "dikirim",
        createdById: mandor2Id,
        submittedById: mandor2Id,
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    try {
      const res = await kirimKe(mandor2Id);
      expect(punyaOrangKedua()).toHaveLength(0);
      expect(res?.success).toBeUndefined();
      expect(res?.error).toMatch(/tidak ada yang dikirim/i);
    } finally {
      await db.dailyReport.delete({ where: { id: laporan.id } });
    }
  });

  it("2xx tanpa ID pesan TIDAK dinyatakan berhasil", async () => {
    tanpaIdPesan = true;
    const res = await kirimKe(mandor2Id);
    expect(punyaOrangKedua()).toHaveLength(1);
    expect(res?.success).toBeUndefined();
    expect(res?.error).toMatch(/tanpa id pesan/i);
  });

  it("hanya pengelola sistem yang boleh menekannya", async () => {
    for (const r of ["project_manager", "site_manager", "field_supervisor", "wakil_ppk"]) {
      role = r;
      const res = await kirimKe(mandor2Id);
      expect(res?.error).toMatch(/izin/i);
      expect(terkirim).toHaveLength(0);
    }
  });

  it("tercatat di audit BESERTA orang yang dituju", async () => {
    await kirimKe(mandor2Id);
    const log = await db.auditLog.findFirst({
      where: { action: "reminder.manual_send_one", userId: sessionUserId },
      orderBy: { createdAt: "desc" },
      select: { resourceId: true, resourceType: true, payload: true },
    });
    expect(log).not.toBeNull();
    expect(log!.resourceType).toBe("user");
    expect(log!.resourceId).toBe(mandor2Id);
    expect((log!.payload as { tujuan?: string[] }).tujuan).toContain(TUJUAN2);
  });
});
