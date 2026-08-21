// HARI TANPA KEGIATAN (DECISIONS 396) — yang hanya bisa dibuktikan lewat DB.
//
// Aturan murninya sudah diuji di `tests/unit/hari-nihil.test.ts`. Yang TIDAK
// bisa dibuktikan di sana justru yang paling berbahaya kalau salah:
//
//  1. Laporan KOSONG tetap DITOLAK. Itu satu-satunya alasan hari nihil bisa
//     dipercaya sebagai pernyataan — begitu laporan kosong ikut lolos, "lupa
//     diisi" dan "memang nihil" jadi tidak bisa dibedakan.
//  2. Hari nihil yang DINYATAKAN bisa dikirim, dan sebabnya wajib.
//  3. Peringatan pekerjaan-berhenti berbunyi pada hari ketiga, bukan pertama.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => penggunaUji(),
    requireCapability: async () => penggunaUji(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

async function penggunaUji() {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, orgId: true, username: true, email: true,
      fullName: true, role: true, mustChangePassword: true,
    },
  });
}

const terkirim: { chatId: string; teks: string }[] = [];
vi.mock("@/lib/waha/kirim", () => ({
  sendText: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return `wamid-${terkirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { getOrCreateDraft, submitReport, setHariNihil } = await import("@/lib/daily-report/service");
const { kirimPengingatNihilTerjadwal } = await import("@/lib/daily-report/penjadwal-nihil");
const { setHariNihilAction } = await import("@/lib/daily-report/actions");

const suffix = `hn${Date.now().toString(36)}`;
let locationId = "";
let userId = "";
let nodeId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({
    data: {
      orgId: org.id,
      name: `Paket ${suffix}`,
      stage: "pelaksanaan",
      waGroupId: `6299${suffix}@g.us`,
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug: `lok-${suffix}`,
      village: "D",
      regency: "K",
      province: "P",
      isActive: true,
      status: "berjalan",
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `sm-${suffix}`,
      fullName: "Mandor Uji",
      role: "site_manager",
      passwordHash: "x",
    },
  });
  userId = u.id;
  const rev = await db.rabRevision.create({
    data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 1_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "UJI", amount: 1_000n, lineageKey: "I", sortOrder: 1 },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan",
      volume: 100, unit: "m3", unitPrice: 10, amount: 1_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  nodeId = node.id;
});

beforeEach(async () => {
  terkirim.length = 0;
  /*
   * TRUNCATE, bukan DELETE: `daily_report_status_history` dan `audit_logs`
   * append-only dijaga trigger DB, dan DELETE ditolak. Peredam peringatan
   * MEMBACA audit, jadi sisa uji sebelumnya akan meredam uji berikutnya.
   */
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, audit_logs
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, issues,
     rab_nodes, rab_revisions, audit_logs, locations, packages, users, organizations
     RESTART IDENTITY CASCADE`,
  );
});

describe("mengirim laporan hari nihil", () => {
  it("REGRESI: laporan kosong TANPA pernyataan tetap DITOLAK", async () => {
    /*
     * Ini penjaga yang membuat seluruh fitur bermakna. Begitu laporan kosong
     * ikut lolos, "lupa diisi" dan "memang nihil" jadi tidak bisa dibedakan —
     * dan justru ambiguitas itu yang membuat data harian tidak berguna.
     */
    const r = await getOrCreateDraft(locationId, "2026-08-10", userId);
    await expect(submitReport(r.id, userId)).rejects.toThrow(/masih kosong/i);
  });

  it("hari yang DINYATAKAN nihil bisa dikirim", async () => {
    const r = await getOrCreateDraft(locationId, "2026-08-11", userId);
    await setHariNihil(r.id, { nihil: true, alasan: "hujan", catatan: "deras sejak subuh" }, userId);
    const hasil = await submitReport(r.id, userId);
    expect(hasil.status).toBe("dikirim");

    const tersimpan = await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(tersimpan.noActivity).toBe(true);
    expect(tersimpan.noActivityReason).toBe("hujan");
  });

  it("REGRESI: nihil TANPA sebab ditolak saat dikirim", async () => {
    const r = await getOrCreateDraft(locationId, "2026-08-12", userId);
    // Ditulis langsung ke DB — memodelkan data yang lolos lewat jalur lain.
    await db.dailyReport.update({ where: { id: r.id }, data: { noActivity: true } });
    await expect(submitReport(r.id, userId)).rejects.toThrow(/sebab/i);
  });

  it("REGRESI: nihil ditolak bila sudah ada item pekerjaan", async () => {
    const { upsertItem } = await import("@/lib/daily-report/service");
    const r = await getOrCreateDraft(locationId, "2026-08-13", userId);
    await upsertItem(r.id, { rabNodeId: nodeId, volumeDone: 1, notes: null }, userId);
    await expect(
      setHariNihil(r.id, { nihil: true, alasan: "hujan" }, userId),
    ).rejects.toThrow(/item pekerjaan/i);
  });

  it("membatalkan nihil ikut mengosongkan sebabnya", async () => {
    /*
     * Sebab yang tertinggal dari pernyataan yang sudah dicabut akan terbaca
     * lagi oleh laporan periodik dan hitungan hari hujan.
     */
    const r = await getOrCreateDraft(locationId, "2026-08-14", userId);
    await setHariNihil(r.id, { nihil: true, alasan: "hujan", catatan: "x" }, userId);
    await setHariNihil(r.id, { nihil: false }, userId);
    const t = await db.dailyReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(t.noActivity).toBe(false);
    expect(t.noActivityReason).toBeNull();
    expect(t.noActivityNote).toBeNull();
  });
});

describe("REGRESI: hari kosong belum punya draft sama sekali", () => {
  it("menyatakan nihil MEMBUAT draftnya sendiri", async () => {
    /*
     * Ketahuan 2026-08-20 saat menjajal alurnya di aplikasi yang berjalan:
     * draft laporan baru lahir ketika item pertama disimpan, jadi hari yang
     * benar-benar tanpa kegiatan TIDAK punya draft — dan aksi yang menuntut
     * `reportId` membuat fiturnya mustahil dipakai justru di hari yang
     * membutuhkannya.
     *
     * Uji unit tidak akan pernah menangkap ini: yang salah bukan aturannya,
     * melainkan dari mana aksinya mengambil laporannya.
     */
    const tanggal = "2026-08-09";
    expect(
      await db.dailyReport.findFirst({ where: { locationId, reportDate: new Date(tanggal) } }),
    ).toBeNull();

    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("dateKey", tanggal);
    fd.set("nihil", "1");
    fd.set("alasan", "hujan");
    const r = await setHariNihilAction(undefined, fd);
    expect(r?.error).toBeUndefined();

    const dibuat = await db.dailyReport.findFirstOrThrow({
      where: { locationId, reportDate: new Date(tanggal) },
    });
    expect(dibuat.noActivity).toBe(true);
    expect(dibuat.noActivityReason).toBe("hujan");
  });
});

describe("peringatan pekerjaan berhenti", () => {
  async function nihilkan(tanggal: string, alasan: "hujan" | "menunggu_material" = "hujan") {
    const r = await getOrCreateDraft(locationId, tanggal, userId);
    await setHariNihil(r.id, { nihil: true, alasan }, userId);
    await db.dailyReport.update({ where: { id: r.id }, data: { status: "dikirim" } });
  }

  const HARI_INI = new Date("2026-08-20T09:00:00.000Z");

  it("DUA hari nihil belum menagih – satu dua hari hujan itu biasa", async () => {
    await nihilkan("2026-08-19");
    await nihilkan("2026-08-20");
    const h = await kirimPengingatNihilTerjadwal(HARI_INI);
    expect(h.terkirim).toBe(0);
    expect(terkirim).toHaveLength(0);
  });

  it("TIGA hari berturut-turut menagih ke grup paket", async () => {
    await nihilkan("2026-08-18");
    await nihilkan("2026-08-19");
    await nihilkan("2026-08-20");
    const h = await kirimPengingatNihilTerjadwal(HARI_INI);
    expect(h.terkirim).toBe(1);
    expect(terkirim[0].chatId).toContain("@g.us");
    expect(terkirim[0].teks).toContain("3 hari");
    expect(terkirim[0].teks).toContain("Hujan");
  });

  it("REGRESI: hari TANPA laporan memutus hitungan – bukan dianggap nihil", async () => {
    /*
     * "Belum lapor" bukan pernyataan apa pun. Memperlakukannya sebagai nihil
     * melahirkan peringatan berhenti-bekerja untuk lokasi yang sebenarnya cuma
     * telat mengisi, dan peringatan salah sasaran akan dimatikan orang.
     */
    await nihilkan("2026-08-18");
    // 19 sengaja tidak ada laporannya
    await nihilkan("2026-08-20");
    expect((await kirimPengingatNihilTerjadwal(HARI_INI)).terkirim).toBe(0);
  });

  it("REGRESI: hari nihil yang masih DRAFT tidak dihitung", async () => {
    /*
     * Draft belum menyatakan apa pun — ia bisa berubah, dan sering memang
     * berubah. Menghitungnya sebagai pernyataan membuat peringatan
     * "pekerjaan berhenti 3 hari" berbunyi untuk hari yang bahkan belum
     * dikirim pelapornya.
     *
     * Ditulis setelah uji gigi memperlihatkan bahwa uji sebelumnya TIDAK
     * membuktikan apa pun tentang saringan ini: seluruh fixture memang sudah
     * berstatus "dikirim", jadi melepas saringannya tidak memerahkan apa pun.
     */
    await nihilkan("2026-08-18");
    const draft = await getOrCreateDraft(locationId, "2026-08-19", userId);
    await setHariNihil(draft.id, { nihil: true, alasan: "hujan" }, userId);
    // SENGAJA dibiarkan draft.
    await nihilkan("2026-08-20");

    const h = await kirimPengingatNihilTerjadwal(HARI_INI);
    expect(h.terkirim).toBe(0);
    expect(terkirim).toHaveLength(0);
  });

  it("kabar yang SAMA tidak diulang keesokan harinya", async () => {
    await nihilkan("2026-08-18");
    await nihilkan("2026-08-19");
    await nihilkan("2026-08-20");
    expect((await kirimPengingatNihilTerjadwal(HARI_INI)).terkirim).toBe(1);
    const kedua = await kirimPengingatNihilTerjadwal(HARI_INI);
    expect(kedua.terkirim).toBe(0);
    expect(kedua.diredam).toBe(1);
  });

  it("hari KEEMPAT kabar baru – peredamnya lepas", async () => {
    await nihilkan("2026-08-18");
    await nihilkan("2026-08-19");
    await nihilkan("2026-08-20");
    await kirimPengingatNihilTerjadwal(HARI_INI);
    await nihilkan("2026-08-21");
    const h = await kirimPengingatNihilTerjadwal(new Date("2026-08-21T09:00:00.000Z"));
    expect(h.terkirim).toBe(1);
    expect(terkirim[1].teks).toContain("4 hari");
  });
});
