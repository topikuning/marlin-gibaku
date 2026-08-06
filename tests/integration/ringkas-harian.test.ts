// LAPORAN HARIAN RINGKAS + PAPAN STATUS HARIAN (DECISIONS 261/262).
//
// Permintaan user 2026-08-05: satu PDF ringkas per lokasi untuk dikirim ke grup
// WA, dan satu halaman untuk melihat status laporan + jejak Google Drive.
//
// Yang dikunci berkas ini semuanya cacat SENYAP — dokumennya tetap terbentuk,
// halamannya tetap rapi, dan tak ada pesan error:
//
//  1. baris atas usulan ADENDUM ikut dihitung sebagai prestasi resmi;
//  2. posisi kemajuan diambil per HARI INI, bukan per tanggal laporan, sehingga
//     dokumen 1 Juli memuat realisasi 20 Juli;
//  3. koordinat cadangan titik proyek terbaca sebagai bukti GPS;
//  4. jejak Drive tertukar antar lokasi karena refKey salah pasang;
//  5. hari yang benar-benar kosong tetap dikirim ke grup pejabat;
//  6. pagar capability/akses lokasi hanya menyembunyikan tombol.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Aksi WA memanggil `getRequestOrigin()` (→ next/headers) untuk menautkan foto
// PDF ke gambar penuh di cloud. Di luar request scope Next melempar, jadi
// header disediakan di sini — bukan dengan menelan galatnya di produksi.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));

const terkirim: { chatId: string; text?: string; fileName?: string }[] = [];
vi.mock("@/lib/waha/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/waha/client")>("@/lib/waha/client");
  return {
    ...actual,
    isWahaConfigured: async () => true,
    getSessionStatus: async () => ({ name: "default", status: "WORKING" }),
    sendText: async (chatId: string, text: string) => {
      terkirim.push({ chatId, text });
      return "MSGID";
    },
    sendFile: async (chatId: string, file: { filename?: string }) => {
      terkirim.push({ chatId, fileName: file.filename });
    },
  };
});

// R2 mati: foto TIDAK ditanam ke PDF, tapi metadatanya tetap dihitung. Itu
// justru jalur yang perlu diuji — dokumen harus tetap terbentuk, dan jumlah
// foto yang tak dimuat harus dikatakan.
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2GetBuffer: async () => {
    throw new Error("R2 mati di uji");
  },
}));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";
let aksesDitolak = false;
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
    hasLocationAccess: async () => !aksesDitolak,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {
      if (aksesDitolak) throw new ForbiddenError("Tanpa akses lokasi");
    },
  };
});

const { db } = await import("@/lib/db");
const { getRingkasHarian } = await import("@/lib/daily-report/ringkas");
const { getStatusHarian } = await import("@/lib/daily-report/status-harian");
const { buildHarianRingkasPdf } = await import("@/lib/pdf/harian-ringkas");
const { sendDailyRingkasToWaAction } = await import("@/lib/waha/actions");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `rh${Date.now().toString(36)}`;
const HARI = "2026-06-10"; // minggu 2
const HARI_KOSONG = "2026-06-12";
const GRUP = "120363000000000001@g.us";

let orgId = "";
let locationId = "";
let slug = "";
let lainId = "";
let lainSlug = "";
let batuId = "";
let galianId = "";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org RH ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  sessionOrgId = org.id;
  sessionUserId = (
    await db.user.create({
      data: {
        orgId,
        username: `rh-${suffix}`,
        fullName: "Admin RH",
        passwordHash: "x",
        role: "super_admin",
      },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor RH ${suffix}` } });
  const pkg = await db.package.create({
    data: {
      orgId,
      name: `Paket RH ${suffix}`,
      stage: "pelaksanaan",
      waGroupId: GRUP,
      driveFolderId: "FOLDER_UJI",
    },
  });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 200_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 21,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-21"),
      workTitle: "Pembangunan Uji Ringkas",
    },
  });

  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Ringkas",
      slug: `ringkas-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true, slug: true },
  });
  locationId = loc.id;
  slug = loc.slug;

  // Lokasi kedua di paket yang sama — dipakai membuktikan jejak Drive tidak
  // tertukar antar lokasi.
  const lain = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Lain",
      slug: `lain-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
    select: { id: true, slug: true },
  });
  lainId = lain.id;
  lainSlug = lain.slug;

  // RAB aktif: grandTotal 125 juta.
  //
  // `createdAt` DIMUNDURKAN ke sebelum SPMK dengan sengaja. `getLocationProgress`
  // dengan `asOf` memilih revisi & baseline yang EFEKTIF pada tanggal itu; baris
  // yang dibuat "sekarang" tidak efektif pada Juni 2026, sehingga grandTotal
  // jadi 0 dan seluruh uji posisi kehilangan artinya.
  const rev = await db.rabRevision.create({
    data: {
      locationId, revisionNo: 1, source: "hps_awal", status: "aktif",
      totalValue: 125_000_000n, createdAt: new Date("2026-05-26"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: 125_000_000n, lineageKey: "I", sortOrder: 1,
    },
  });
  batuId = (
    await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
        volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
      },
      select: { id: true },
    })
  ).id;
  galianId = (
    await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "2", name: "Galian tanah",
        volume: 50, unit: "m3", unitPrice: 500_000, amount: 25_000_000n, lineageKey: "I#2", sortOrder: 3,
      },
      select: { id: true },
    })
  ).id;

  const baseline = await db.baseline.create({
    data: {
      locationId, baselineNo: 1, source: "auto", status: "aktif",
      rabRevisionId: rev.id, contractDays: 21, createdAt: new Date("2026-05-26"),
    },
  });
  await db.baselinePoint.createMany({
    data: [
      { baselineId: baseline.id, weekNumber: 1, plannedPct: 30 },
      { baselineId: baseline.id, weekNumber: 2, plannedPct: 70 },
      { baselineId: baseline.id, weekNumber: 3, plannedPct: 100 },
    ],
  });

  // Realisasi HARI (10 Juni): batu 20 m3 = 20 juta = 16% dari 125 juta.
  const lap = await getOrCreateDraft(locationId, HARI, sessionUserId);
  await upsertItem(lap.id, { rabNodeId: batuId, volumeDone: 20 }, sessionUserId);
  await submitReport(lap.id, sessionUserId);

  // Realisasi JAUH SESUDAHNYA (18 Juni) — TIDAK boleh muncul di dokumen 10 Juni.
  const kemudian = await getOrCreateDraft(locationId, "2026-06-18", sessionUserId);
  await upsertItem(kemudian.id, { rabNodeId: galianId, volumeDone: 50 }, sessionUserId);
  await submitReport(kemudian.id, sessionUserId);
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => {
  terkirim.length = 0;
  role = "super_admin";
  aksesDitolak = false;
});

describe("KASUS INTI: ringkasan memuat hari itu, dan HANYA hari itu", () => {
  it("pekerjaan hari itu terangkum dengan bobot dari progress-calc", async () => {
    const d = await getRingkasHarian(slug, HARI);
    expect(d).not.toBeNull();
    expect(d!.pekerjaan).toHaveLength(1);
    expect(d!.pekerjaan[0].name).toBe("Pasangan batu");
    expect(d!.pekerjaan[0].volumeToday).toBe(20);
    expect(d!.nilaiHariIni).toBe(20_000_000n);
    // 20 juta dari grand total 125 juta = 16,00%
    expect(d!.bobotHariIni).toBeCloseTo(16, 2);
    expect(d!.pekerjaan[0].bobotToday).toBeCloseTo(16, 2);
  });

  it("posisi kemajuan dihitung PER TANGGAL LAPORAN, bukan per hari ini", async () => {
    // Realisasi 18 Juni (galian 50 m3 = 25 juta) TIDAK boleh masuk ke dokumen
    // bertanggal 10 Juni hanya karena dokumennya dicetak belakangan. Ini cacat
    // CALC-01 yang sama, dalam wujud baru.
    const d = await getRingkasHarian(slug, HARI);
    expect(d!.realizedPct).toBeCloseTo(16, 2); // batu saja
    const sesudah = await getRingkasHarian(slug, "2026-06-18");
    expect(sesudah!.realizedPct).toBeCloseTo(36, 2); // batu + galian
  });

  it("identitas & minggu terbawa dari kontrak", async () => {
    const d = await getRingkasHarian(slug, HARI);
    expect(d!.workTitle).toBe("Pembangunan Uji Ringkas");
    expect(d!.locationName).toBe("Lokasi Ringkas");
    expect(d!.weekNumber).toBe(2);
    expect(d!.totalWeeks).toBeGreaterThanOrEqual(3);
    expect(d!.planPct).toBeCloseTo(70, 2);
    expect(d!.status).toBe("dikirim");
  });

  it("hari tanpa laporan TETAP menghasilkan data — bukan null", async () => {
    // Kegiatan lapangan hari itu bisa saja ada, dan "belum ada laporan harian"
    // adalah keterangan yang berguna, bukan alasan menolak mencetak.
    const d = await getRingkasHarian(slug, HARI_KOSONG);
    expect(d).not.toBeNull();
    expect(d!.status).toBeNull();
    expect(d!.pekerjaan).toHaveLength(0);
  });

  it("lokasi tidak dikenal → null", async () => {
    expect(await getRingkasHarian("tidak-ada-xyz", HARI)).toBeNull();
  });
});

describe("baris atas usulan ADENDUM tidak dihitung, tapi disebut", () => {
  it("basis draft_adendum keluar dari angka DAN jumlahnya dilaporkan", async () => {
    // DECISIONS 210/215: pekerjaan atas usulan adendum belum punya dasar
    // kontrak. Menghitungnya sebagai prestasi resmi menaikkan realisasi tanpa
    // dasar; menghilangkannya diam-diam membuat dokumen berbohong.
    const lap = await db.dailyReport.findFirstOrThrow({
      where: { locationId, reportDate: new Date(`${HARI}T00:00:00.000Z`) },
      select: { id: true },
    });
    const baris = await db.dailyReportItem.create({
      data: {
        reportId: lap.id,
        rabNodeId: galianId,
        lineageKey: "I#2",
        basis: "draft_adendum",
        volumeDone: 10,
        valueDone: 5_000_000n,
      },
      select: { id: true },
    });
    try {
      const d = await getRingkasHarian(slug, HARI);
      expect(d!.pekerjaan).toHaveLength(1); // tetap hanya batu
      expect(d!.nilaiHariIni).toBe(20_000_000n); // tidak bertambah 5 juta
      expect(d!.draftItemCount).toBe(1); // TAPI disebut
    } finally {
      await db.dailyReportItem.delete({ where: { id: baris.id } });
    }
  });
});

describe("foto: asal-usulnya ikut, koordinat cadangan ditandai", () => {
  it("foto laporan + foto kegiatan digabung dengan penanda sumbernya", async () => {
    const lap = await db.dailyReport.findFirstOrThrow({
      where: { locationId, reportDate: new Date(`${HARI}T00:00:00.000Z`) },
      select: { id: true },
    });
    const keg = await db.fieldActivity.create({
      data: {
        locationId,
        activityDate: new Date(`${HARI}T00:00:00.000Z`),
        type: "rapat",
        title: "Rapat koordinasi mingguan",
        notes: "Membahas percepatan",
        status: "final",
        createdById: sessionUserId,
      },
      select: { id: true },
    });
    const f1 = await db.photo.create({
      data: {
        locationId,
        reportId: lap.id,
        r2Key: `uji/${suffix}/a.jpg`,
        sha256: `${suffix}a`,
        bytes: 10,
        gpsSource: "exif",
        exifGpsLat: -6.9,
        exifGpsLng: 110.6,
      },
      select: { id: true },
    });
    const f2 = await db.photo.create({
      data: {
        locationId,
        activityId: keg.id,
        r2Key: `uji/${suffix}/b.jpg`,
        sha256: `${suffix}b`,
        bytes: 10,
        // Koordinat CADANGAN titik proyek — bukan GPS perangkat (DECISIONS 197).
        gpsSource: "project",
        exifGpsLat: -6.91,
        exifGpsLng: 110.61,
      },
      select: { id: true },
    });
    try {
      const d = await getRingkasHarian(slug, HARI);
      expect(d!.kegiatan).toHaveLength(1);
      expect(d!.kegiatan[0].title).toBe("Rapat koordinasi mingguan");
      expect(d!.foto).toHaveLength(2);

      const fotoLaporan = d!.foto.find((f) => f.sumber === "Pekerjaan harian");
      expect(fotoLaporan).toBeDefined();
      expect(fotoLaporan!.gpsCadangan).toBe(false);

      const fotoKegiatan = d!.foto.find((f) => f.sumber.startsWith("Kegiatan:"));
      expect(fotoKegiatan).toBeDefined();
      // Inti DECISIONS 197: cadangan titik proyek TIDAK boleh dihitung sebagai
      // bukti GPS. Tanpa penanda ini, dokumen resmi menyatakan yang tak diketahui.
      expect(fotoKegiatan!.gpsCadangan).toBe(true);
    } finally {
      await db.photo.deleteMany({ where: { id: { in: [f1.id, f2.id] } } });
      await db.fieldActivity.delete({ where: { id: keg.id } });
    }
  });
});

describe("PDF benar-benar terbentuk (bukan cuma lolos typecheck)", () => {
  it("hari berisi → PDF valid", async () => {
    const d = await getRingkasHarian(slug, HARI);
    const buf = await buildHarianRingkasPdf(d!, []);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(3_000);
  });

  it("foto DITAUTKAN ke gambar penuh di cloud — bukti yang dipangkas harus punya jalan pulang", async () => {
    // Keluhan user 2026-08-06: PDF kegiatan lapangan menautkan fotonya ke
    // cloud, ringkasan ini tidak. Fotonya DIPANGKAS ke kotak 4:3; memangkas
    // bukti tanpa menyisakan jalan ke aslinya berarti menghilangkan bagian
    // gambar tanpa ada yang bisa memeriksanya (DECISIONS 125).
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({
      create: { width: 60, height: 40, channels: 3, background: "#334155" },
    })
      .jpeg()
      .toBuffer();

    const d = await getRingkasHarian(slug, HARI);
    const url = "https://marlin.uji/api/foto/TOKENUJI";
    const buf = await buildHarianRingkasPdf(d!, [
      { jpeg, sumber: "Pekerjaan harian", sub: null, link: url },
    ]);
    // Teks PDF terkompresi, jadi yang bisa dicari di buffer mentah adalah
    // ANOTASI tautannya — dan justru itu yang menentukan foto bisa diketuk.
    expect(buf.toString("latin1")).toContain(url);

    // Tanpa link (origin tak diketahui) → TIDAK mengarang URL.
    const tanpa = await buildHarianRingkasPdf(d!, [
      { jpeg, sumber: "Pekerjaan harian", sub: null, link: null },
    ]);
    expect(tanpa.toString("latin1")).not.toContain("/api/foto/");
  });

  it("hari KOSONG → PDF tetap terbentuk", async () => {
    // Jalur kosong paling sering terlewat: tabel tanpa baris, status null,
    // catatan null, tanpa foto. Semuanya harus tetap menghasilkan dokumen.
    const d = await getRingkasHarian(slug, HARI_KOSONG);
    const buf = await buildHarianRingkasPdf(d!, []);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("papan status harian", () => {
  const user = () => ({ id: sessionUserId, orgId, role: "super_admin" }) as never;

  it("menyusun status per lokasi untuk tanggal terpilih", async () => {
    const s = await getStatusHarian(user(), null, HARI);
    expect(s).not.toBeNull();
    const baris = s!.rows.find((r) => r.slug === slug);
    expect(baris).toBeDefined();
    expect(baris!.status).toBe("dikirim");
    expect(baris!.itemCount).toBe(1);
    expect(baris!.driveFolderId).toBe("FOLDER_UJI");
    expect(baris!.waGroupId).toBe(GRUP);

    // Lokasi kedua belum melapor — ditulis apa adanya, bukan dihilangkan.
    const lain = s!.rows.find((r) => r.slug === lainSlug);
    expect(lain).toBeDefined();
    expect(lain!.status).toBeNull();
  });

  it("jejak Drive dipasangkan lewat refKey — TIDAK tertukar antar lokasi", async () => {
    const pkgId = (
      await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { packageId: true } })
    ).packageId;
    const u1 = await db.gDriveUpload.create({
      data: {
        packageId: pkgId, locationId, kind: "laporan_harian", refKey: `${slug}:${HARI}`,
        fileName: "a.pdf", status: "sukses", webLink: "https://drive/a", fileId: "A",
      },
      select: { id: true },
    });
    const u2 = await db.gDriveUpload.create({
      data: {
        packageId: pkgId, locationId: lainId, kind: "laporan_harian", refKey: `${lainSlug}:${HARI}`,
        fileName: "b.pdf", status: "gagal", error: "folder ditolak",
      },
      select: { id: true },
    });
    try {
      const s = await getStatusHarian(user(), null, HARI);
      const baris = s!.rows.find((r) => r.slug === slug)!;
      expect(baris.drive.status).toBe("sukses");
      expect(baris.drive.webLink).toBe("https://drive/a");

      const lain = s!.rows.find((r) => r.slug === lainSlug)!;
      expect(lain.drive.status).toBe("gagal");
      expect(lain.drive.error).toBe("folder ditolak");
      // Yang gagal TIDAK mewarisi tautan lokasi lain.
      expect(lain.drive.webLink).toBeNull();

      expect(s!.sudahDrive).toBe(1);
    } finally {
      await db.gDriveUpload.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
    }
  });

  it("tanggal ngawur → null, bukan diam-diam jatuh ke hari ini", async () => {
    expect(await getStatusHarian(user(), null, "bukan-tanggal")).toBeNull();
  });

  it("scope lokasi dihormati — daftar kosong bila tak ada akses", async () => {
    const s = await getStatusHarian(user(), [], HARI);
    expect(s!.rows).toHaveLength(0);
  });
});

describe("kirim ringkasan ke grup WA", () => {
  const kirim = (s: string, d: string) => {
    const fd = new FormData();
    fd.set("slug", s);
    fd.set("dateKey", d);
    return sendDailyRingkasToWaAction(undefined, fd);
  };

  it("KASUS INTI: teks + PDF berangkat ke grup paket", async () => {
    const res = await kirim(slug, HARI);
    expect(res?.error).toBeUndefined();
    expect(terkirim).toHaveLength(2);
    expect(terkirim[0].chatId).toBe(GRUP);
    expect(terkirim[0].text).toContain("LAPORAN HARIAN");
    expect(terkirim[1].fileName).toBe(`laporan-harian-${slug}-${HARI}.pdf`);
  });

  it("status non-final DISEBUT di pesan hasil — pengirim tahu apa yang ia kirim", async () => {
    const res = await kirim(slug, HARI);
    expect(res?.success).toMatch(/dikirim/); // status laporannya
  });

  it("penanda waSentAt tercatat", async () => {
    await kirim(slug, HARI);
    const lap = await db.dailyReport.findFirstOrThrow({
      where: { locationId, reportDate: new Date(`${HARI}T00:00:00.000Z`) },
      select: { waSentAt: true, waSentById: true },
    });
    expect(lap.waSentAt).not.toBeNull();
    expect(lap.waSentById).toBe(sessionUserId);
  });

  it("hari KOSONG ditolak — tidak melatih grup pejabat mengabaikan pesan MARLIN", async () => {
    const res = await kirim(slug, HARI_KOSONG);
    expect(res?.error).toMatch(/tidak ada yang bisa dilaporkan/i);
    expect(terkirim).toHaveLength(0);
  });

  it("peran tanpa report.export DITOLAK", async () => {
    // field_supervisor sengaja dipilih: ia peran lapangan yang TIDAK punya
    // report.export (wakil_ppk justru punya).
    role = "field_supervisor";
    const res = await kirim(slug, HARI);
    expect(res?.error).toMatch(/izin/i);
    expect(terkirim).toHaveLength(0);
  });

  it("tanpa akses lokasi DITOLAK di server, bukan cuma tombolnya disembunyikan", async () => {
    aksesDitolak = true;
    const res = await kirim(slug, HARI);
    expect(res?.error).toMatch(/akses/i);
    expect(terkirim).toHaveLength(0);
  });

  it("tercatat di audit beserta tujuan & statusnya", async () => {
    await kirim(slug, HARI);
    const log = await db.auditLog.findFirst({
      where: { action: "report.wa_send_ringkas", userId: sessionUserId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect(log).not.toBeNull();
    const p = log!.payload as { chatId?: string; status?: string; items?: number };
    expect(p.chatId).toBe(GRUP);
    expect(p.status).toBe("dikirim");
    expect(p.items).toBe(1);
  });
});
