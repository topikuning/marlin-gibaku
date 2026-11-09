// BERKAS KKP PER LOKASI DARI TANYA MARLIN DI GRUP (DECISIONS 752) – terhadap
// DATABASE ASLI.
//
// Permintaan user 2026-11-09: di grup, "laporan hari ini" mengirim blanko KKP
// satu berkas per lokasi; "laporan hari ini <lokasi>" hanya lokasi itu;
// "laporan mingguan" mengirim laporan mingguan KKP; "rekap harian seminggu"
// mengirim berkas KKP rekap laporan harian satu minggu.
//
// Yang dipalsukan hanya jaringan WhatsApp dan penyedia AI (seperti
// `waha-tanya-jawab.test.ts`); data, resolver grup, dan renderer PDF asli.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terkirim: { chatId: string; teks: string }[] = [];
const berkasTerkirim: { chatId: string; nama: string; caption: string; data: Buffer }[] = [];

const NOMOR_MARLIN = "6281200000077";
const LID_MARLIN = "77712345670077";

vi.mock("@/lib/waha/client", () => ({
  getIdentitasMarlin: async () => ({ nomor: NOMOR_MARLIN, lid: LID_MARLIN }),
}));
vi.mock("@/lib/waha/kirim", () => ({
  balasWa: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  sendText: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  balasFileWa: async (chatId: string, file: { filename: string; data: string }, caption?: string) => {
    berkasTerkirim.push({ chatId, nama: file.filename, caption: caption ?? "", data: Buffer.from(file.data, "base64") });
    return "mock-id";
  },
}));
// Semua kalimat di sini terbaca parser deterministik; AI yang terpanggil
// berarti jalurnya bocor – dibuat gagal supaya ketahuan.
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async () => ({ ok: false, errorCode: "provider_down", error: "uji", meta: null, attempts: 1 }),
}));

const { db } = await import("@/lib/db");
const { jawabPertanyaanWa } = await import("@/lib/waha/tanya");
const { setWahaConfig } = await import("@/lib/waha/config");
const { normalizeWaTarget } = await import("@/lib/contacts/model");
const { jakartaDateKey } = await import("@/lib/format");

const suffix = `bk${Date.now().toString(36)}`;
const GRUP = "12036300000000752@g.us";
const nomorSM = "6285700000752";
const DAY = 86_400_000;
const hariIni = jakartaDateKey(new Date());
const tgl = (geser: number) => new Date(new Date(`${hariIni}T00:00:00.000Z`).getTime() + geser * DAY);
const key = (d: Date) => d.toISOString().slice(0, 10);

/*
 * SPMK 16 hari lalu, mode 7 hari: M1 = H-16…H-10, M2 = H-9…H-3, M3 = H-2…H+4.
 * Jadi "minggu ini" = minggu ke-3, dan H-2 (draft), H-1 (dikirim), H (final)
 * ketiganya di dalamnya.
 */
const MINGGU_INI = 3;

let slugKM = "";
let slugKML = "";
let lokKM = "";
let lokKML = "";

function event(teks: string, chatId = GRUP) {
  const grup = chatId.endsWith("@g.us");
  return {
    event: "message",
    payload: {
      id: `msg-${Math.random().toString(36).slice(2)}`,
      from: grup ? chatId : `${nomorSM}@c.us`,
      author: grup ? `${nomorSM}@c.us` : undefined,
      fromMe: false,
      body: grup ? `@${NOMOR_MARLIN} ${teks}` : teks,
      timestamp: Math.floor(Date.now() / 1000),
      mentionedIds: grup ? [`${NOMOR_MARLIN}@c.us`] : [],
    },
  };
}

async function teksPdf(buf: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const halaman: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const isi = await (await pdf.getPage(i)).getTextContent();
    halaman.push(isi.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return halaman.join("\n");
}

beforeAll(async () => {
  await setWahaConfig({ tanyaAktif: true, tanyaGrupAktif: true });
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const user = await db.user.create({
    data: {
      orgId: org.id,
      username: `sm-${suffix}`,
      fullName: "SM Berkas",
      role: "site_manager",
      passwordHash: "x",
      waNumber: normalizeWaTarget(nomorSM),
    },
  });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Uji ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, waGroupId: GRUP } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: tgl(-16),
      durationDays: 8 * 7,
      startDate: tgl(-16),
      endDate: tgl(-16 + 8 * 7 - 1),
      weekMode: "tujuh_hari",
    },
  });
  const lokasi = async (nama: string) =>
    db.location.create({
      data: {
        packageId: pkg.id,
        name: nama,
        slug: `${nama.toLowerCase().replace(/\s+/g, "")}-${suffix}`,
        village: nama,
        regency: "Demak",
        province: "Jawa Tengah",
        isActive: true,
      },
    });
  const km = await lokasi("Kedung Mutih");
  const kml = await lokasi("Kedungmalang");
  await lokasi("Tengket");
  lokKM = km.id;
  lokKML = kml.id;
  slugKM = km.slug;
  slugKML = kml.slug;
  for (const locationId of [km.id, kml.id]) {
    await db.locationAssignment.create({ data: { userId: user.id, locationId } });
  }

  // Kedung Mutih: RAB aktif + baseline (laporan mingguan butuh keduanya).
  const rev = await db.rabRevision.create({
    data: { locationId: km.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 150_000_000n },
  });
  await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN TANAH", amount: 150_000_000n, lineageKey: "I", sortOrder: 0 },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "item",
      code: "1.1",
      name: "Galian tanah",
      volume: 1000,
      unit: "m3",
      unitPrice: 150_000,
      amount: 150_000_000n,
      lineageKey: "I#1.1",
      sortOrder: 1,
    },
  });
  const baseline = await db.baseline.create({
    data: { locationId: km.id, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: 56 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / 8) * 100 })),
  });

  const lapor = async (locationId: string, geser: number, status: "draft" | "dikirim" | "final", vol: number) => {
    const r = await db.dailyReport.create({
      data: { locationId, reportDate: tgl(geser), status, createdById: user.id, weather: "cerah" },
    });
    await db.dailyReportItem.create({
      data: { reportId: r.id, rabNodeId: item.id, lineageKey: "I#1.1", volumeDone: vol, valueDone: BigInt(vol * 150_000) },
    });
  };
  await lapor(km.id, 0, "final", 10);
  await lapor(km.id, -1, "dikirim", 5);
  await lapor(km.id, -2, "draft", 7);
  await db.dailyReport.create({
    data: { locationId: kml.id, reportDate: tgl(0), status: "draft", createdById: user.id, weather: "cerah" },
  });
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { in: ["waha.tanya_aktif", "waha.tanya_grup_aktif"] } } });
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, location_assignments, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  terkirim.length = 0;
  berkasTerkirim.length = 0;
  await db.waChatContext.deleteMany({});
  await db.waPendingClarification.deleteMany({});
});

const semuaTeks = () => terkirim.map((t) => t.teks).join("\n---\n");

describe("grup: laporan hari ini → blanko KKP per lokasi", () => {
  it("satu berkas per lokasi yang laporannya sudah dikirim; draft dan yang belum lapor disebut", async () => {
    const r = await jawabPertanyaanWa(event("laporan hari ini"));
    expect(r.dijawab, r.alasan).toBe(true);
    expect(berkasTerkirim.map((b) => b.nama), semuaTeks()).toEqual([`laporan-harian-kkp-${slugKM}-${hariIni}.pdf`]);
    expect(berkasTerkirim[0].chatId).toBe(GRUP);
    expect(berkasTerkirim[0].caption).toContain("Kedung Mutih");
    const teks = semuaTeks();
    expect(teks).toContain("Laporan harian KKP");
    expect(teks).toMatch(/Kedungmalang \(draft\)/i);
    expect(teks).toMatch(/Belum ada laporan: Tengket/);
    // Tabel PDF lama TIDAK ikut – satu jawaban, satu bentuk.
    expect(berkasTerkirim.some((b) => /^laporan-harian-(?!kkp-)/.test(b.nama))).toBe(false);
  });

  it("berkasnya blanko KKP sungguhan", async () => {
    await jawabPertanyaanWa(event("laporan hari ini"));
    const isi = await teksPdf(berkasTerkirim[0].data);
    expect(isi).toMatch(/LAPORAN HARIAN/i);
  });

  it("'laporan hari ini <lokasi>' → hanya lokasi itu", async () => {
    await jawabPertanyaanWa(event("laporan hari ini kedung mutih"));
    expect(berkasTerkirim.map((b) => b.nama)).toEqual([`laporan-harian-kkp-${slugKM}-${hariIni}.pdf`]);
    expect(semuaTeks()).not.toContain("Tengket");
    expect(semuaTeks()).not.toContain("Kedungmalang");
  });

  it("lokasi yang laporannya masih draft: tidak ada berkas, sebabnya dikatakan", async () => {
    await jawabPertanyaanWa(event("laporan hari ini kedungmalang"));
    expect(berkasTerkirim).toHaveLength(0);
    expect(semuaTeks()).toMatch(/Kedungmalang \(draft\)/i);
  });

  it("'kirim laporan hari ini' (kata kerja produksi) tetap mengirim blanko KKP", async () => {
    await jawabPertanyaanWa(event("kirim laporan hari ini"));
    expect(berkasTerkirim.map((b) => b.nama)).toEqual([`laporan-harian-kkp-${slugKM}-${hariIni}.pdf`]);
  });
});

describe("grup: laporan mingguan → laporan mingguan KKP per lokasi", () => {
  it("lokasi ber-RAB aktif dapat berkas minggu kontrak berjalan; yang lain disebut sebabnya", async () => {
    await jawabPertanyaanWa(event("laporan mingguan"));
    expect(berkasTerkirim.map((b) => b.nama), semuaTeks()).toEqual([`laporan-mingguan-${slugKM}-${MINGGU_INI}.pdf`]);
    expect(berkasTerkirim[0].caption).toContain(`minggu ke-${MINGGU_INI}`);
    const teks = semuaTeks();
    expect(teks).toMatch(new RegExp(`Laporan mingguan KKP – minggu ke-${MINGGU_INI}`));
    expect(teks).toMatch(/Tidak ada berkas untuk Kedungmalang dan Tengket: belum punya RAB aktif\./);
    expect(teks).toMatch(/masih berjalan/);
  });

  it("berkasnya laporan mingguan KKP yang sama dengan unduhan web", async () => {
    await jawabPertanyaanWa(event("laporan mingguan kedung mutih"));
    expect(berkasTerkirim).toHaveLength(1);
    const isi = await teksPdf(berkasTerkirim[0].data);
    expect(isi).toMatch(new RegExp(`MINGGU KE-?\\s*${MINGGU_INI}`, "i"));
    expect(isi).toMatch(/LAPORAN MINGGUAN PEKERJAAN/);
  });

  it("'laporan mingguan minggu lalu' → minggu kontrak sebelumnya", async () => {
    await jawabPertanyaanWa(event("laporan mingguan minggu lalu kedung mutih"));
    expect(berkasTerkirim.map((b) => b.nama)).toEqual([`laporan-mingguan-${slugKM}-${MINGGU_INI - 1}.pdf`]);
  });
});

describe("rekap harian seminggu → berkas KKP rekap laporan harian satu minggu", () => {
  it("grup: satu berkas per lokasi yang punya laporan terkirim minggu itu", async () => {
    await jawabPertanyaanWa(event("rekap harian seminggu"));
    expect(berkasTerkirim.map((b) => b.nama), semuaTeks()).toEqual([
      `laporan-harian-minggu-${MINGGU_INI}-${slugKM}.pdf`,
    ]);
    const teks = semuaTeks();
    expect(teks).toMatch(new RegExp(`Rekap laporan harian KKP – minggu ke-${MINGGU_INI}`));
    expect(teks).toMatch(/Tidak ada berkas untuk Kedungmalang dan Tengket: belum ada laporan yang dikirim pelapor minggu itu\./);
    // 7 hari: H-1 dikirim, H final, H-2 masih draft (tercetak kosong), H+1…H+4
    // belum tiba – dan yang belum tiba tidak dihitung "belum lapor".
    expect(berkasTerkirim[0].caption).toMatch(/1 hari belum ada laporan terkirim · 4 hari belum tiba/);
  });

  it("draft TIDAK ikut tercetak di berkas grup", async () => {
    const { renderMingguanKkpPdf } = await import("@/lib/pdf/mingguan-kkp");
    const { COUNTED_REPORT_STATUSES } = await import("@/lib/lifecycle");
    const semua = await renderMingguanKkpPdf(slugKM, MINGGU_INI);
    const terkirimSaja = await renderMingguanKkpPdf(slugKM, MINGGU_INI, { hanyaStatus: COUNTED_REPORT_STATUSES });
    expect(semua?.hariKosong).toBe(4);
    expect(terkirimSaja?.hariKosong).toBe(5);
  });

  it("chat pribadi: rekap harian lokasi yang disebut ikut dikirim", async () => {
    await jawabPertanyaanWa(event("rekap harian seminggu kedung mutih", `${nomorSM}@c.us`));
    expect(berkasTerkirim.map((b) => b.nama), semuaTeks()).toEqual([
      `laporan-harian-minggu-${MINGGU_INI}-${slugKM}.pdf`,
    ]);
    expect(berkasTerkirim[0].chatId).toBe(`${nomorSM}@c.us`);
  });
});

describe("yang tidak berubah", () => {
  it("chat pribadi 'laporan hari ini' tetap dijawab teks, tanpa blanko per lokasi", async () => {
    await jawabPertanyaanWa(event("laporan hari ini", `${nomorSM}@c.us`));
    expect(berkasTerkirim.filter((b) => b.nama.startsWith("laporan-harian-kkp-"))).toHaveLength(0);
    expect(semuaTeks()).toContain("Laporan harian");
  });

  it("audit mencatat berkas yang benar-benar terkirim", async () => {
    await jawabPertanyaanWa(event("laporan hari ini"));
    const a = await db.auditLog.findFirst({
      where: { action: "waha.tanya.berkas_kkp" },
      orderBy: { createdAt: "desc" },
    });
    expect(a, "tidak ada jejak audit").not.toBeNull();
    const isi = a!.payload as { jenis: string; terkirim: { lokasiId: string }[]; dilewati: { lokasiId: string }[] };
    expect(isi.jenis).toBe("harian");
    expect(isi.terkirim.map((t) => t.lokasiId)).toEqual([lokKM]);
    expect(isi.dilewati.map((t) => t.lokasiId)).toContain(lokKML);
  });
});

void slugKML;
