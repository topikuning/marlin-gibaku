// LAPISAN PENGENDALIAN BENAR-BENAR SAMPAI KE AI (DECISIONS 459).
//
// Permintaan user 2026-08-28: *"pastikan semua hal yang ada di marlin bisa
// ditanyakan secara jelas di ai (kecuali keuangan)"*.
//
// `tests/unit/ai-cakupan.test.ts` menjaga PETANYA — bahwa tiap wilayah punya
// jalur dan tiap adapter terdaftar. Yang tidak bisa dijaga peta: apakah
// adapternya benar-benar mengeluarkan fakta dari basis data. Peta yang rapi di
// atas adapter yang diam adalah janji yang sama kosongnya.
//
// Karena itu di sini fakta & sitasinya diperiksa terhadap basis data sungguhan,
// satu wilayah per uji, dengan data yang memang bisa diperiksa mata.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { buildAdapterFacts } = await import("@/lib/ai-hub/adapters");
const { parseDateKey } = await import("@/lib/format");
import type { SessionUser } from "@/lib/auth/session";

const suffix = `cpn${Date.now().toString(36)}`;
const PERIODE = "2026-08-28";
let locId = "";
let slug = "";
let sa: SessionUser;
let sm: SessionUser;

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org CPN ${suffix}`, slug: `org-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket CPN ${suffix}`, stage: "pelaksanaan" },
  });
  slug = `sidoharjo-${suffix}`;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Sidoharjo ${suffix}`,
      slug,
      village: "Sidoharjo",
      regency: "Tegal",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;

  const buatUser = async (username: string, role: "super_admin" | "site_manager") =>
    db.user.create({
      data: { orgId: org.id, username, fullName: username, role, passwordHash: "x" },
      select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true },
    });
  sa = { ...(await buatUser(`sa-${suffix}`, "super_admin")), mustChangePassword: false };
  sm = { ...(await buatUser(`sm-${suffix}`, "site_manager")), mustChangePassword: false };

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV CPN ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      ppnPercent: 11,
      signedDate: parseDateKey("2026-05-20")!,
      durationDays: 140,
      startDate: parseDateKey("2026-06-01")!,
      endDate: parseDateKey("2026-10-19")!,
    },
  });

  // Laporan harian: satu sudah diperiksa Wakil PPK, satu belum.
  const buatLaporan = async (dateKey: string) =>
    db.dailyReport.create({
      data: {
        locationId: locId,
        reportDate: parseDateKey(dateKey)!,
        status: "dikirim",
        createdById: sa.id,
      },
      select: { id: true },
    });
  const lapDiperiksa = await buatLaporan("2026-08-24");
  await buatLaporan("2026-08-25");
  await db.reportVerification.create({
    data: {
      reportId: lapDiperiksa.id,
      status: "diverifikasi",
      note: "Cocok dengan lapangan.",
      verifiedById: sa.id,
    },
  });

  // Inspeksi lapangan yang sudah final.
  await db.inspection.create({
    data: {
      locationId: locId,
      title: "Inspeksi mutu pondasi",
      inspectionDate: parseDateKey("2026-08-26")!,
      status: "final",
      inspectorId: sa.id,
    },
  });

  /*
   * Dokumen paket yang SUDAH kadaluarsa → peringatan dini tingkat PAKET.
   *
   * Inilah yang dulu tidak pernah sampai ke AI (temuan review 2026-08-28):
   * href-nya `/paket/<id>/dokumen`, sementara adapter menyaring warning dengan
   * `href.includes("/lokasi/<slug>")`. Dokumen jaminan yang mati menahan
   * seluruh paket — justru peringatan yang paling perlu terjawab.
   */
  await db.document.create({
    data: {
      orgId: org.id,
      packageId: pkg.id,
      phase: "kontrak",
      type: "jaminan",
      title: "Jaminan Pelaksanaan",
      status: "aktif",
      // Kadaluarsa jauh sebelum hari ini, apa pun tanggal uji ini dijalankan.
      expiryDate: new Date(Date.now() - 30 * 86_400_000),
      uploadedById: sa.id,
      r2Key: `dok-${suffix}`,
      fileName: "jaminan.pdf",
      mimeType: "application/pdf",
      bytes: 1024,
      sha256: `sha-${suffix}`,
    },
  });

  // Surat yang menuntut jawaban dan sudah lewat tenggat.
  await db.letter.create({
    data: {
      orgId: org.id,
      packageId: pkg.id,
      agendaNo: 1,
      agendaYear: 2026,
      direction: "masuk",
      handledDate: parseDateKey("2026-08-01")!,
      subject: "Permintaan klarifikasi volume galian",
      needsReply: true,
      replyDueDate: parseDateKey("2026-08-10")!,
      createdById: sa.id,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE report_verifications, inspections, letters, documents, daily_reports, contracts, vendors, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

async function refs() {
  const h = await buildAdapterFacts(sa, [locId], PERIODE);
  return { hasil: h, id: (akhiran: string) => h.refs.find((r) => r.id === `${slug}:${akhiran}`) };
}

describe("wilayah pengendalian mengeluarkan fakta", () => {
  it("verifikasi eksternal: sudah vs belum diperiksa", async () => {
    const { hasil, id } = await refs();
    const ref = id("verifikasi");
    expect(ref, "sitasi verifikasi wajib ada").toBeTruthy();
    expect(ref?.value).toContain("1 sudah diperiksa");
    expect(ref?.value).toContain("1 belum diperiksa");
    const metrik = hasil.fakta.filter((f) => f.sourceRefId === ref?.id).map((f) => f.metric);
    expect(metrik).toContain("laporan_sudah_diverifikasi");
    expect(metrik).toContain("laporan_belum_diverifikasi");
  });

  it("inspeksi lapangan: hanya yang FINAL, berikut yang terakhir", async () => {
    const { id } = await refs();
    const ref = id("inspeksi");
    expect(ref?.value).toContain("1 inspeksi final");
    expect(ref?.value).toContain("Inspeksi mutu pondasi");
  });

  it("surat: utang jawab dan yang lewat tenggat", async () => {
    const { hasil, id } = await refs();
    const ref = id("surat");
    expect(ref?.value).toContain("1 perlu dijawab");
    expect(ref?.value).toContain("1 lewat tenggat");
    expect(hasil.fakta.some((f) => f.metric === "surat_perlu_jawab" && f.value === 1)).toBe(true);
  });

  it("REGRESI: peringatan tingkat PAKET ikut, bukan cuma yang ber-href lokasi", async () => {
    /*
     * Adapter versi pertama memetakan warning dengan
     * `href.includes("/lokasi/<slug>")`. Peringatan dokumen kadaluarsa
     * ber-href `/paket/<id>/dokumen`, jadi ia tidak pernah masuk — adapter yang
     * mengaku "peringatan dini" hanya membawa sebagian, tanpa mengaku sebagian.
     */
    const { id } = await refs();
    const ref = id("peringatan");
    expect(ref, "sitasi peringatan dini wajib ada").toBeTruthy();
    /*
     * DUA peringatan tingkat paket di fixture ini, dan keduanya dulu tidak
     * pernah terpetakan: dokumen kadaluarsa (`/paket/<id>/dokumen`) dan surat
     * lewat tenggat jawab (`/surat?sorot=<id>`).
     */
    expect(ref?.value).toContain("2 tingkat paket");
  });

  it("kesiapan termin/PHO/FHO ikut, dan labelnya menyebut PAKET", async () => {
    /*
     * Kesiapan diputuskan per PAKET. Label yang menyebut nama lokasi saja akan
     * membuat orang mengajukan termin atas dasar yang salah.
     */
    const { id } = await refs();
    const ref = id("kesiapan");
    expect(ref, "sitasi kesiapan wajib ada").toBeTruthy();
    expect(ref?.label).toContain("Paket");
    expect(ref?.value).toContain("syarat belum terpenuhi");
  });
});

describe("pagar kapabilitas tetap berlaku lewat pintu AI", () => {
  it("REGRESI: peran tanpa hak TIDAK menerima angkanya, dan penahanannya dikatakan", async () => {
    /*
     * `site_manager` punya `ai.ask` tetapi tidak punya `finance.view`,
     * `report.verify_external`, maupun `inspection.manage`. Kalau fakta-fakta
     * itu ikut ke prompt, ia bisa menanyakan — dan menerima — hal yang di layar
     * MARLIN sendiri tidak boleh ia lihat. Lubang seperti itu tidak
     * menghasilkan galat apa pun; ia hanya menjawab dengan sopan.
     */
    const h = await buildAdapterFacts(sm, [locId], PERIODE);
    const punya = (akhiran: string) => h.refs.some((r) => r.id === `${slug}:${akhiran}`);
    expect(punya("verifikasi")).toBe(false);
    expect(punya("inspeksi")).toBe(false);
    // Dan yang ditahan DISEBUT, supaya tidak terbaca sebagai "datanya kosong".
    expect(h.dilewati).toContain("verifikasi");
    expect(h.dilewati).toContain("inspeksi");
    expect(h.dilewati).toContain("keuangan");
  });
});
