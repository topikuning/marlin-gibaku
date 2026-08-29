// SATU JAWABAN TIDAK BOLEH MENCAMPUR DUA WAKTU (review 2026-08-29).
//
// Adapter menerima `periodKey` — akhir periode yang DITANYAKAN — lalu
// menstempelkannya ke setiap fakta. Tetapi sebagian adapter membaca keadaan
// SEKARANG: temuan yang masih terbuka, surat yang masih menunggu jawaban, RAB
// aktif, kesiapan, peringatan dini. Pertanyaan "kondisi per 30 Juni" karenanya
// bisa memadukan progres 30 Juni dengan temuan hari ini, dan tidak ada apa pun
// di jawabannya yang memberi tahu pembacanya.
//
// Yang membuatnya sulit terbantah: angkanya masing-masing BENAR. Yang salah
// hanya labelnya — dan label itulah yang dipakai pembaca untuk memutuskan.
//
// Keputusan user (jalan a): jujur dulu, akurat kemudian.
//   - yang bertanggal (inspeksi, laporan, sisa hari kontrak) DIBATASI ke akhir
//     periode;
//   - yang inheren sekarang distempel TANGGAL HARI INI dan labelnya berkata
//     demikian — bukan dipaksa direkonstruksi dari histori yang belum tentu ada.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { buildAdapterFacts } = await import("@/lib/ai-hub/adapters");
const { parseDateKey, jakartaDateKey, jakartaToday } = await import("@/lib/format");
import type { SessionUser } from "@/lib/auth/session";

const suffix = `wh${Date.now().toString(36)}`;
const HARI = 86_400_000;
/** Periode yang ditanyakan: jelas di masa lalu, apa pun hari ujinya dijalankan. */
const PERIODE_LAMA = "2026-06-30";
let locId = "";
let slug = "";
let sa: SessionUser;
let kunciHariIni = "";

beforeAll(async () => {
  kunciHariIni = jakartaDateKey(jakartaToday());
  const org = await db.organization.create({
    data: { name: `Org WH ${suffix}`, slug: `org-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket WH ${suffix}`, stage: "pelaksanaan" },
  });
  slug = `waktu-${suffix}`;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Waktu ${suffix}`,
      slug,
      village: "Waktu",
      regency: "Tegal",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;

  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `sa-${suffix}`,
      fullName: "Super",
      role: "super_admin",
      passwordHash: "x",
    },
    select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true },
  });
  sa = { ...u, mustChangePassword: false };

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV WH ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      ppnPercent: 11,
      signedDate: parseDateKey("2026-05-01")!,
      durationDays: 200,
      startDate: parseDateKey("2026-06-01")!,
      // Selesai jauh di depan supaya "sisa hari" positif di kedua patokan, dan
      // yang dibandingkan benar-benar SELISIHNYA, bukan tanda.
      endDate: new Date(jakartaToday().getTime() + 100 * HARI),
    },
  });

  /*
   * Inspeksi SESUDAH periode yang ditanyakan. Ia punya tanggalnya sendiri, jadi
   * tidak ada alasan ia muncul di jawaban "per 30 Juni" — itu inspeksi yang
   * pada tanggal itu belum terjadi.
   */
  await db.inspection.create({
    data: {
      locationId: locId,
      title: "Inspeksi sesudah periode",
      inspectionDate: new Date(jakartaToday().getTime() - 1 * HARI),
      status: "final",
      inspectorId: sa.id,
    },
  });

  // Temuan yang terbuka SEKARANG — tidak bisa dibaca ulang ke 30 Juni tanpa
  // histori status, dan menebaknya lebih buruk daripada mengaku.
  await db.finding.create({
    data: {
      locationId: locId,
      title: "Temuan terbuka hari ini",
      severity: "kritis",
      status: "baru",
      findingDate: parseDateKey("2026-08-20")!,
      raisedById: sa.id,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE findings, inspections, contracts, vendors, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

const ambil = async (periodKey: string) => {
  const h = await buildAdapterFacts(sa, [locId], periodKey);
  return {
    h,
    ref: (akhiran: string) => h.refs.find((r) => r.id === `${slug}:${akhiran}`),
    fakta: (metric: string) => h.fakta.find((f) => f.metric === metric),
  };
};

describe("pertanyaan HISTORIS", () => {
  it("REGRESI: fakta keadaan sekarang distempel HARI INI, bukan periode yang diminta", async () => {
    /*
     * Stempel ini bukan kosmetik. `validasiKlaim` membandingkan `periodKey`
     * klaim dengan `periodKey` fakta, jadi klaim yang memakai angka ini
     * TERPAKSA mengaku "per hari ini" — kalau ia mengaku "per 30 Juni",
     * bagiannya dibuang.
     */
    const { fakta } = await ambil(PERIODE_LAMA);
    const temuan = fakta("temuan_terbuka");
    expect(temuan, "fakta temuan wajib ada").toBeTruthy();
    expect(temuan?.periodKey, "temuan terbuka adalah keadaan SEKARANG").toBe(kunciHariIni);
    expect(temuan?.periodKey).not.toBe(PERIODE_LAMA);
  });

  it("REGRESI: sitasi keadaan sekarang MENGAKU dirinya hari ini", async () => {
    // Angkanya benar; yang dulu salah cuma labelnya — dan label itulah yang
    // dipakai pembaca untuk memutuskan.
    const { ref } = await ambil(PERIODE_LAMA);
    const t = ref("temuan");
    expect(t?.value).toContain("KEADAAN HARI INI");
    expect(t?.value).toContain(PERIODE_LAMA);
  });

  it("REGRESI: inspeksi SESUDAH periode tidak ikut terjawab", async () => {
    // Inspeksi bertanggal, jadi ia memang bisa dijawab benar untuk masa lalu —
    // dan membawa inspeksi yang belum terjadi adalah kesalahan yang tak bisa
    // dibela dengan "tidak bisa direkonstruksi".
    const { ref } = await ambil(PERIODE_LAMA);
    expect(ref("inspeksi"), "inspeksi setelah 30 Juni tidak boleh muncul").toBeFalsy();
  });

  it("sisa hari kontrak dihitung terhadap AKHIR PERIODE, bukan hari ini", async () => {
    const lama = await ambil(PERIODE_LAMA);
    const kini = await ambil(kunciHariIni);
    const a = lama.fakta("sisa_hari_kontrak")?.value ?? 0;
    const b = kini.fakta("sisa_hari_kontrak")?.value ?? 0;
    // Per 30 Juni sisanya LEBIH BANYAK daripada hari ini — itu seluruh maksudnya.
    expect(a).toBeGreaterThan(b);
  });
});

describe("pertanyaan HARI INI tidak berubah sama sekali", () => {
  it("tanpa cap, dan seluruh stempelnya sama", async () => {
    /*
     * Uji pasangan. Mayoritas pertanyaan memang tentang hari ini; kalau tiap
     * labelnya ikut dibubuhi "keadaan hari ini", peringatan itu jadi bising —
     * dan bising membuat orang berhenti membaca peringatan yang sungguhan.
     */
    const { h, ref } = await ambil(kunciHariIni);
    expect(ref("temuan")?.value).not.toContain("KEADAAN HARI INI");
    for (const f of h.fakta) expect(f.periodKey, f.metric).toBe(kunciHariIni);
    // Dan inspeksinya kini IKUT, karena tanggalnya memang sudah lewat.
    expect(ref("inspeksi")).toBeTruthy();
  });
});
