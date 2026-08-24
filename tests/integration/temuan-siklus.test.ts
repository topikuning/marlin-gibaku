// Integration test siklus TEMUAN (DECISIONS 426):
// baru → klarifikasi → ditindaklanjuti → menunggu_verifikasi → (tolak) →
// menunggu_verifikasi → selesai → dibuka_kembali → selesai; bukti (tautan,
// XOR foto/dokumen, lintas lokasi ditolak); histori append-only (trigger DB).
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const {
  addFollowUp,
  askClarification,
  createFinding,
  linkEvidence,
  rejectVerification,
  reopenFinding,
  respondClarification,
  submitForVerification,
  verifyClose,
  verifyEvidence,
} = await import("@/lib/findings/service");

const suffix = `tmn-${Date.now().toString(36)}`;
let locationId: string;
let lokasiLainId: string;
let wakilId: string;
let smId: string;
let photoId: string;
let photoLainId: string;
let documentId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug: suffix,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  const lokasiLain = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi lain ${suffix}`,
      slug: `${suffix}-b`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  lokasiLainId = lokasiLain.id;
  const wakil = await db.user.create({
    data: { orgId: org.id, username: `wakil-${suffix}`, fullName: "Wakil Uji", passwordHash: "x", role: "wakil_ppk" },
  });
  const sm = await db.user.create({
    data: { orgId: org.id, username: `sm-${suffix}`, fullName: "SM Uji", passwordHash: "x", role: "site_manager" },
  });
  wakilId = wakil.id;
  smId = sm.id;
  const photo = await db.photo.create({
    data: { locationId, r2Key: `foto/${suffix}-1.jpg`, sha256: `${suffix}-1`, bytes: 10 },
  });
  photoId = photo.id;
  const photoLain = await db.photo.create({
    data: { locationId: lokasiLainId, r2Key: `foto/${suffix}-2.jpg`, sha256: `${suffix}-2`, bytes: 10 },
  });
  photoLainId = photoLain.id;
  const doc = await db.document.create({
    data: {
      orgId: org.id,
      packageId: pkg.id,
      locationId,
      phase: "pelaksanaan",
      type: "laporan",
      title: "Dok uji",
      r2Key: `dok/${suffix}.pdf`,
      fileName: "dok.pdf",
      mimeType: "application/pdf",
      bytes: 10,
      sha256: `${suffix}-doc`,
      uploadedById: sm.id,
    },
  });
  documentId = doc.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("siklus temuan", () => {
  let findingId: string;

  it("dibuat → status baru + histori pertama + audit", async () => {
    const f = await createFinding(
      {
        locationId,
        category: "mutu",
        severity: "tinggi",
        title: "Mutu beton kolom meragukan",
        findingDateKey: "2026-08-01",
        dueDateKey: "2026-08-10",
        assignedToId: smId,
      },
      wakilId,
    );
    findingId = f.id;
    const row = await db.finding.findUniqueOrThrow({ where: { id: findingId } });
    expect(row.status).toBe("baru");
    expect(row.raisedById).toBe(wakilId);
    const hist = await db.findingStatusHistory.findMany({ where: { findingId } });
    expect(hist).toHaveLength(1);
    expect(hist[0].toStatus).toBe("baru");
    const audit = await db.auditLog.findFirst({ where: { action: "finding.create", resourceId: findingId } });
    expect(audit).not.toBeNull();
  });

  it("verifikator minta klarifikasi → menunggu_klarifikasi", async () => {
    await askClarification(findingId, "Apa hasil uji tekan silinder?", "2026-08-05", wakilId);
    const row = await db.finding.findUniqueOrThrow({ where: { id: findingId } });
    expect(row.status).toBe("menunggu_klarifikasi");
  });

  it("pelaksana menjawab klarifikasi → ditindaklanjuti, jawaban tersimpan", async () => {
    const clar = await db.findingClarification.findFirstOrThrow({ where: { findingId } });
    await respondClarification(clar.id, "Hasil uji 25 MPa, terlampir.", smId);
    const sesudah = await db.findingClarification.findUniqueOrThrow({ where: { id: clar.id } });
    expect(sesudah.response).toContain("25 MPa");
    expect(sesudah.respondedById).toBe(smId);
    const row = await db.finding.findUniqueOrThrow({ where: { id: findingId } });
    expect(row.status).toBe("ditindaklanjuti");
  });

  it("klarifikasi yang sudah dijawab tidak bisa dijawab lagi", async () => {
    const clar = await db.findingClarification.findFirstOrThrow({ where: { findingId } });
    await expect(respondClarification(clar.id, "jawaban kedua", smId)).rejects.toThrow(/sudah dijawab/i);
  });

  it("ajukan verifikasi → ditolak verifikator → kembali ditindaklanjuti", async () => {
    await submitForVerification(findingId, "Perbaikan selesai", smId);
    expect((await db.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("menunggu_verifikasi");
    await rejectVerification(findingId, "Bukti belum menunjukkan perbaikan kolom as B-2", wakilId);
    expect((await db.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("ditindaklanjuti");
  });

  it("tindak lanjut lagi → ajukan → verifikator MENUTUP (catatan wajib tercatat)", async () => {
    await addFollowUp(findingId, "Kolom dibongkar dan dicor ulang", smId);
    await submitForVerification(findingId, null, smId);
    await verifyClose(findingId, "Sudah diperiksa di lapangan, sesuai.", wakilId);
    const row = await db.finding.findUniqueOrThrow({ where: { id: findingId } });
    expect(row.status).toBe("selesai");
    expect(row.closedById).toBe(wakilId);
    expect(row.closedAt).not.toBeNull();
  });

  it("dibuka kembali → reopenCount naik, closed* kosong; lalu ditutup lagi", async () => {
    await reopenFinding(findingId, "Retak muncul lagi setelah 2 minggu", wakilId);
    const dibuka = await db.finding.findUniqueOrThrow({ where: { id: findingId } });
    expect(dibuka.status).toBe("dibuka_kembali");
    expect(dibuka.reopenCount).toBe(1);
    expect(dibuka.closedAt).toBeNull();
    await verifyClose(findingId, "Perbaikan kedua diverifikasi.", wakilId);
    expect((await db.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("selesai");
  });

  it("urutan histori status lengkap dan berurut", async () => {
    const hist = await db.findingStatusHistory.findMany({ where: { findingId }, orderBy: { changedAt: "asc" } });
    // Catatan: tindak lanjut pada temuan yang SUDAH `ditindaklanjuti` sengaja
    // tidak menambah baris histori status (statusnya memang tidak berubah) —
    // catatannya tersimpan di FindingNote + audit.
    expect(hist.map((h) => h.toStatus)).toEqual([
      "baru",
      "menunggu_klarifikasi",
      "ditindaklanjuti",
      "menunggu_verifikasi",
      "ditindaklanjuti",
      "menunggu_verifikasi",
      "selesai",
      "dibuka_kembali",
      "selesai",
    ]);
  });

  it("transisi liar ditolak: temuan selesai tidak bisa langsung menunggu_verifikasi", async () => {
    await expect(submitForVerification(findingId, null, smId)).rejects.toThrow(/tidak bisa dipindah/i);
  });

  it("histori status APPEND-ONLY: UPDATE ditolak trigger DB", async () => {
    const hist = await db.findingStatusHistory.findFirstOrThrow({ where: { findingId } });
    await expect(
      db.$executeRawUnsafe(`UPDATE finding_status_history SET note = 'diubah' WHERE id = '${hist.id}'`),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("bukti (EvidenceLink)", () => {
  let findingId: string;

  beforeAll(async () => {
    const f = await createFinding(
      { locationId, category: "volume", severity: "sedang", title: "Volume urugan meragukan", findingDateKey: "2026-08-02" },
      wakilId,
    );
    findingId = f.id;
  });

  it("foto lokasi yang sama bisa ditautkan, lalu diverifikasi", async () => {
    const link = await linkEvidence({ findingId, photoId, caption: "Foto kolom" }, smId);
    await verifyEvidence(link.id, "diterima", "jelas", wakilId);
    const row = await db.evidenceLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.verifStatus).toBe("diterima");
    expect(row.verifiedById).toBe(wakilId);
  });

  it("dokumen organisasi yang sama bisa ditautkan", async () => {
    const link = await linkEvidence({ findingId, documentId }, smId);
    const row = await db.evidenceLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.documentId).toBe(documentId);
  });

  it("foto LOKASI LAIN ditolak", async () => {
    await expect(linkEvidence({ findingId, photoId: photoLainId }, smId)).rejects.toThrow(/lokasi lain/i);
  });

  it("dua sumber sekaligus / tanpa sumber ditolak", async () => {
    await expect(linkEvidence({ findingId, photoId, documentId }, smId)).rejects.toThrow(/tepat satu/i);
    await expect(linkEvidence({ findingId }, smId)).rejects.toThrow(/tepat satu/i);
  });

  it("CHECK constraint DB ikut menjaga (bukan cuma validasi aplikasi)", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO evidence_links (id, finding_id, added_by_id) VALUES (gen_random_uuid(), '${findingId}', '${smId}')`,
      ),
    ).rejects.toThrow(/evidence_links_satu_sumber|check/i);
  });

  it("satu foto boleh dirujuk dari dua temuan tanpa disalin", async () => {
    const f2 = await createFinding(
      { locationId, category: "k3", severity: "rendah", title: "APD tidak lengkap", findingDateKey: "2026-08-03" },
      wakilId,
    );
    await linkEvidence({ findingId: f2.id, photoId }, wakilId);
    const jumlahFoto = await db.photo.count({ where: { id: photoId } });
    expect(jumlahFoto).toBe(1);
    const tautan = await db.evidenceLink.count({ where: { photoId } });
    expect(tautan).toBe(2);
  });
});
