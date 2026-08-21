// SATU HAMBATAN = SATU KENDALA (DECISIONS 407).
//
// Keberatan user 2026-08-21: *"saat laporan nihil/kosong, kamu membuat desain
// masukkan ke kendala. tapi saat kirim laporan ada pilihan lagi ada kendala atau
// tidak, ini terlalu rancu dan beresiko input kendala ganda, apakah kendalanya
// itu sudah menjadi satu, atau double entry."*
//
// Jawabannya waktu itu: double entry. Uji ini yang menjaga jawabannya tidak
// berlaku lagi. Yang dibuktikan HANYA lewat DB, karena yang salah dulu bukan
// tampilannya melainkan berapa BARIS yang benar-benar lahir:
//
//  1. lembar kirim yang mencatat kendala mirip dengan yang masih terbuka TIDAK
//     menambah baris kedua — dan laporannya tetap terkirim;
//  2. formulir kendala saat verifikasi memakai penjaga yang SAMA;
//  3. `paksa` tetap membuka jalan untuk masalah kedua yang kalimatnya mirip;
//  4. kendala yang sudah DITUTUP tidak menahan kendala baru.
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

const { db } = await import("@/lib/db");
const { getOrCreateDraft, addIssueFromReport } = await import("@/lib/daily-report/service");
const { submitReportAction, addIssueAction } = await import("@/lib/daily-report/actions");

const suffix = `ksp${Date.now().toString(36)}`;
let locationId = "";
let userId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
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
});

beforeEach(async () => {
  // TRUNCATE, bukan DELETE: `audit_logs` & histori status append-only dijaga
  // trigger DB, dan DELETE ditolak.
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, issues,
     audit_logs RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, issues,
     audit_logs, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
});

/** Draft hari nihil siap kirim — tanpa item, dengan pernyataan + sebab. */
async function draftNihil(dateKey: string) {
  const r = await getOrCreateDraft(locationId, dateKey, userId);
  await db.dailyReport.update({
    where: { id: r.id },
    data: { noActivity: true, noActivityReason: "menunggu_material" },
  });
  return r;
}

function fdKirim(reportId: string, judul: string) {
  const f = new FormData();
  f.set("reportId", reportId);
  f.set("kendalaPilihan", "ada");
  f.set("kendalaTitle", judul);
  f.set("kendalaSeverity", "sedang");
  return f;
}

const JUDUL = "Pekerjaan tertahan menunggu material";

describe("lembar kirim laporan harian", () => {
  it("hari kedua dengan hambatan yang SAMA tidak melahirkan kendala kedua", async () => {
    /*
     * Inti keluhannya. "Menunggu material" hari Senin dan hari Selasa adalah
     * SATU masalah berlarut; dua baris di papan membuat hitungan "berapa
     * kendala terbuka" kehilangan arti dan mendorong kendala lain turun dari
     * layar.
     */
    const senin = await draftNihil("2026-08-10");
    const h1 = await submitReportAction(undefined, fdKirim(senin.id, JUDUL));
    expect(h1?.success).toMatch(/terkirim beserta 1 kendala/i);

    const selasa = await draftNihil("2026-08-11");
    const h2 = await submitReportAction(undefined, fdKirim(selasa.id, "Pekerjaan tertahan menunggu material"));

    // Laporannya TETAP terkirim – urusan papan kendala tidak boleh menyandera
    // laporan hari itu.
    expect(h2?.error).toBeUndefined();
    expect(h2?.success).toMatch(/tidak dicatat dua kali/i);
    expect(await db.dailyReport.count({ where: { locationId, status: "dikirim" } })).toBe(2);
    expect(await db.issue.count({ where: { locationId } })).toBe(1);
  });

  it("judul yang sedikit berbeda pun tertahan – bukan cocok persis", async () => {
    // "Lahan belum bisa clear" vs "Lahan belum clear" = 0,865 (DECISIONS 392).
    // Kalau hanya kecocokan persis yang ditahan, satu kata yang hilang sudah
    // cukup meloloskan kembar.
    const a = await draftNihil("2026-08-12");
    await submitReportAction(undefined, fdKirim(a.id, "Lahan belum bisa clear"));
    const b = await draftNihil("2026-08-13");
    await submitReportAction(undefined, fdKirim(b.id, "Lahan belum clear"));
    expect(await db.issue.count({ where: { locationId } })).toBe(1);
  });

  it("hambatan yang BERBEDA tetap tercatat", async () => {
    // Penjaga yang menahan segalanya sama saja dengan mematikan papan kendala.
    const a = await draftNihil("2026-08-14");
    await submitReportAction(undefined, fdKirim(a.id, "Menunggu material besi"));
    const b = await draftNihil("2026-08-15");
    await submitReportAction(undefined, fdKirim(b.id, "Akses jalan longsor, alat tidak bisa masuk"));
    expect(await db.issue.count({ where: { locationId } })).toBe(2);
  });

  it("kendala yang sudah DITUTUP tidak menahan yang baru", async () => {
    /*
     * Masalah yang sama bisa kambuh. Kalau kendala tertutup ikut menahan,
     * kekambuhannya tidak akan pernah tercatat – dan tidak ada yang menagihnya
     * lagi.
     */
    const a = await draftNihil("2026-08-16");
    await submitReportAction(undefined, fdKirim(a.id, JUDUL));
    await db.issue.updateMany({ where: { locationId }, data: { status: "selesai" } });

    const b = await draftNihil("2026-08-17");
    await submitReportAction(undefined, fdKirim(b.id, JUDUL));
    expect(await db.issue.count({ where: { locationId } })).toBe(2);
  });
});

describe("formulir kendala saat verifikasi", () => {
  it("memakai penjaga yang SAMA – tidak lagi jadi pintu belakang", async () => {
    /*
     * Pintu inilah yang dulu paling mudah terlewat: papan kendala lokasi dan
     * kegiatan lapangan sudah punya penjaganya sejak DECISIONS 392, sementara
     * dua pintu laporan harian tidak.
     */
    const r = await draftNihil("2026-08-18");
    await submitReportAction(undefined, fdKirim(r.id, JUDUL));

    const f = new FormData();
    f.set("reportId", r.id);
    f.set("title", JUDUL);
    f.set("severity", "tinggi");
    const hasil = await addIssueAction(undefined, f);

    expect(hasil?.kendalaDuplikat?.title).toBe(JUDUL);
    // Yang sudah diketik dikembalikan – "Tetap buat baru" tidak boleh berarti
    // mengetik ulang.
    expect(hasil?.kendalaNilai?.severity).toBe("tinggi");
    expect(hasil?.success).toBeUndefined();
    expect(await db.issue.count({ where: { locationId } })).toBe(1);
  });

  it("`paksa` tetap membuka jalan untuk masalah kedua yang kalimatnya mirip", async () => {
    // Menolak tanpa jalan keluar hanya melatih orang menulis judul yang sengaja
    // dibedakan supaya lolos – dan duplikat yang menyamar lebih sulit dikenali.
    const r = await draftNihil("2026-08-19");
    await submitReportAction(undefined, fdKirim(r.id, JUDUL));

    const f = new FormData();
    f.set("reportId", r.id);
    f.set("title", JUDUL);
    f.set("severity", "sedang");
    f.set("paksa", "1");
    const hasil = await addIssueAction(undefined, f);

    expect(hasil?.success).toMatch(/tercatat/i);
    expect(await db.issue.count({ where: { locationId } })).toBe(2);
    // Pengabaian itu TERCATAT, bukan senyap: papan yang isinya kembar harus
    // bisa ditelusuri ke keputusan yang membuatnya.
    const jejak = await db.auditLog.findFirst({
      where: { action: "issue.create" },
      orderBy: { createdAt: "desc" },
    });
    expect((jejak?.payload as { duplikatDiabaikan?: boolean })?.duplikatDiabaikan).toBe(true);
  });
});

describe("penjaganya di dalam fungsi, bukan di layar", () => {
  it("pemanggil BARU pun ikut terjaga tanpa menambah apa pun", async () => {
    /*
     * Ini yang membuat perbaikannya bertahan. Penjaga yang dipasang per layar
     * sudah dua kali tertinggal di layar berikutnya (DECISIONS 360, 400).
     * Di sini `addIssueFromReport` dipanggil LANGSUNG – tanpa lewat action mana
     * pun – dan tetap menolak melahirkan kembar.
     */
    const r = await draftNihil("2026-08-20");
    await submitReportAction(undefined, fdKirim(r.id, JUDUL));

    const hasil = await addIssueFromReport(r.id, { title: JUDUL, severity: "sedang" }, userId);
    expect(hasil.jadi).toBe("duplikat");
    expect(await db.issue.count({ where: { locationId } })).toBe(1);
  });
});
