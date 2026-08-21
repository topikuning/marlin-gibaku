// PELAKSANA LAPANGAN MENEKEN LAPORAN HARIAN & MINGGUAN (DECISIONS 402) —
// yang hanya bisa dibuktikan lewat DB.
//
// Aturan murninya sudah diuji di `tests/unit/penandatangan.test.ts`. Yang TIDAK
// bisa dibuktikan di sana justru yang paling merugikan kalau salah, karena
// akibatnya adalah kertas yang sudah diserahkan ke KKP:
//
//  1. Nama yang benar-benar SAMPAI ke kop laporan harian — bukan sekadar
//     fungsinya mengembalikan nilai yang benar bila dipanggil.
//  2. Penimpaan lokasi menang atas paket pada data yang sungguhan dibaca.
//  3. Laporan BULANAN tetap direktur sementara MINGGUAN pelaksana, dari SATU
//     baris basis data yang sama.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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
const { getKkpDailyData } = await import("@/lib/daily-report/queries");
const { buildPeriodHeader, HEADER_LOCATION_SELECT } = await import("@/lib/periodic-report");
const { penyediaLaporan } = await import("@/lib/laporan/penandatangan");

const suffix = `pl${Date.now().toString(36)}`;
const slugPaket = `lok-paket-${suffix}`;
const slugSendiri = `lok-sendiri-${suffix}`;
let pkgId = "";
let userId = "";

const DIREKTUR = "Andi Prasetyo";
const PELAKSANA_PAKET = "Joko Susilo";
const PELAKSANA_LOKASI = "Sari Handayani";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Uji ${suffix}` } });
  const pkg = await db.package.create({
    data: {
      orgId: org.id,
      name: `Paket ${suffix}`,
      stage: "pelaksanaan",
      pelaksanaName: PELAKSANA_PAKET,
      pelaksanaTitle: "Pelaksana Lapangan",
      pelaksanaTtdKey: "ttd/paket.webp",
    },
  });
  pkgId = pkg.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `pm-${suffix}`,
      fullName: "PM Uji",
      role: "project_manager",
      passwordHash: "x",
    },
  });
  userId = u.id;
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000n,
      ppnPercent: 11,
      signedDate: new Date("2026-01-05"),
      durationDays: 150,
      startDate: new Date("2026-01-10"),
      endDate: new Date("2026-06-09"),
      contractorSignerName: DIREKTUR,
      contractorSignerTitle: "Direktur",
      supervisorName: "Rina Wijaya",
      supervisorFirm: "CV Pengawas",
    },
  });

  // Lokasi A: mengikuti pelaksana paket.
  await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi Ikut ${suffix}`,
      slug: slugPaket,
      village: "D",
      regency: "K",
      province: "P",
      isActive: true,
      status: "berjalan",
    },
  });

  // Lokasi B: punya pelaksana sendiri, TANPA gambar tanda tangan.
  await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi Sendiri ${suffix}`,
      slug: slugSendiri,
      village: "D",
      regency: "K",
      province: "P",
      isActive: true,
      status: "berjalan",
      pelaksanaName: PELAKSANA_LOKASI,
      pelaksanaTitle: "Site Manager",
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_reports, contracts, locations, packages, vendors, users, organizations
     RESTART IDENTITY CASCADE`,
  );
});

describe("laporan HARIAN diteken Pelaksana Lapangan", () => {
  it("memakai pelaksana PAKET bila lokasi tidak menimpanya", async () => {
    const d = await getKkpDailyData(slugPaket, "2026-02-10");
    expect(d).not.toBeNull();
    expect(d!.contractorName).toBe(PELAKSANA_PAKET);
    expect(d!.contractorSub).toBe("Pelaksana Lapangan");
  });

  it("REGRESI: TIDAK memakai nama Direktur", async () => {
    /*
     * Keadaan sebelum DECISIONS 402: blok "Dibuat Oleh" pada laporan harian
     * memuat `contractorSignerName` — nama direktur — padahal yang mengisi dan
     * meneken di lapangan orang lain. Itu bukan salah tampilan melainkan
     * pernyataan yang tidak benar pada dokumen resmi.
     */
    const d = await getKkpDailyData(slugPaket, "2026-02-10");
    expect(d!.contractorName).not.toBe(DIREKTUR);
  });

  it("penimpaan lokasi menang atas paket", async () => {
    const d = await getKkpDailyData(slugSendiri, "2026-02-10");
    expect(d!.contractorName).toBe(PELAKSANA_LOKASI);
    expect(d!.contractorSub).toBe("Site Manager");
  });
});

describe("laporan MINGGUAN vs BULANAN dari baris DB yang sama", () => {
  async function kop(slug: string) {
    const lokasi = await db.location.findUniqueOrThrow({
      where: { slug },
      select: HEADER_LOCATION_SELECT,
    });
    const h = buildPeriodHeader(lokasi, {
      grandTotal: 1_000_000,
      startDate: new Date("2026-01-10"),
      periodeStart: new Date("2026-02-09"),
      periodeEnd: new Date("2026-02-15"),
    });
    expect(h).not.toBeNull();
    return h!;
  }

  it("mingguan → Pelaksana, bulanan → Direktur", async () => {
    const h = await kop(slugPaket);
    expect(penyediaLaporan("mingguan", h).nama).toBe(PELAKSANA_PAKET);
    expect(penyediaLaporan("bulanan", h).nama).toBe(DIREKTUR);
  });

  it("MC dan CCO ikut Direktur", async () => {
    const h = await kop(slugPaket);
    expect(penyediaLaporan("mc", h).nama).toBe(DIREKTUR);
    expect(penyediaLaporan("cco", h).nama).toBe(DIREKTUR);
  });

  it("penimpaan lokasi hanya menyentuh yang diteken Pelaksana", async () => {
    // Lokasi B punya pelaksana sendiri, tapi direkturnya tetap direktur paket:
    // penimpaan pelaksana tidak boleh merembet ke dokumen yang bukan miliknya.
    const h = await kop(slugSendiri);
    expect(penyediaLaporan("mingguan", h).nama).toBe(PELAKSANA_LOKASI);
    expect(penyediaLaporan("bulanan", h).nama).toBe(DIREKTUR);
  });
});

describe("tanda tangan tidak dipinjam antar orang", () => {
  it("lokasi berpelaksana sendiri TANPA gambar tetap tanpa gambar", async () => {
    /*
     * Lokasi B menyebut nama sendiri tapi belum mengunggah tanda tangan,
     * sedangkan paketnya PUNYA (`ttd/paket.webp`). Kalau gambarnya jatuh ke
     * milik paket, yang tercetak adalah coretan Joko di bawah nama Sari.
     *
     * Diperiksa di lapisan pemilihan kunci, bukan lewat R2: yang menentukan
     * benar-salahnya adalah kunci mana yang dipilih, dan itu tidak perlu
     * jaringan untuk dibuktikan.
     */
    const { pilihPelaksana } = await import("@/lib/laporan/penandatangan");
    const lok = await db.location.findUniqueOrThrow({
      where: { slug: slugSendiri },
      select: {
        pelaksanaName: true,
        pelaksanaTitle: true,
        pelaksanaTtdKey: true,
        pelaksanaStempelKey: true,
        package: {
          select: {
            pelaksanaName: true,
            pelaksanaTitle: true,
            pelaksanaTtdKey: true,
            pelaksanaStempelKey: true,
          },
        },
      },
    });
    const blok = pilihPelaksana(lok, lok.package);
    expect(blok.nama).toBe(PELAKSANA_LOKASI);
    expect(blok.ttdKey).toBeNull();
  });

  it("lokasi yang MENGIKUTI paket mewarisi gambar paket", async () => {
    const { pilihPelaksana } = await import("@/lib/laporan/penandatangan");
    const paket = await db.package.findUniqueOrThrow({
      where: { id: pkgId },
      select: {
        pelaksanaName: true,
        pelaksanaTitle: true,
        pelaksanaTtdKey: true,
        pelaksanaStempelKey: true,
      },
    });
    const blok = pilihPelaksana(null, paket);
    expect(blok.ttdKey).toBe("ttd/paket.webp");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * SATU FORMULIR, DUA TABEL (DECISIONS 404)
 *
 * Keberatan user: *"kamu terlalu mengistimewakan pelaksana di paket, jadikan
 * saja satu form dengan penginputan ppk pengawas dsb."* Pelaksana lalu ikut
 * `updateContractSignatories`, yang menulis `contracts` DAN `packages`.
 *
 * Uji ini ada karena cacatnya sudah terjadi sekali: sisipan ke `safeParse`
 * tidak pernah masuk, jadi aksinya melapor **"Penanda tangan kontrak
 * diperbarui"** sambil menulis `null` — sukses palsu yang MENGHAPUS nama yang
 * sudah ada. Ketahuan hanya karena formulirnya benar-benar diisi lewat
 * peramban; typecheck, lint, dan 1987 uji unit semuanya hijau.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("formulir penanda tangan menulis pelaksana ke paket", () => {
  it("menyimpan nama & jabatan Pelaksana bersama PPK/pengawas/direktur", async () => {
    const { updateContractSignatories } = await import("@/lib/package/actions");
    const kontrak = await db.contract.findFirstOrThrow({
      where: { packageId: pkgId },
      select: { id: true },
    });

    const f = new FormData();
    f.set("contractId", kontrak.id);
    f.set("ppkName", "Budi PPK");
    f.set("supervisorName", "Rina Pengawas");
    f.set("contractorSignerName", DIREKTUR);
    f.set("contractorSignerTitle", "Direktur");
    f.set("pelaksanaName", "Pelaksana Baru");
    f.set("pelaksanaTitle", "Site Engineer");

    const r = await updateContractSignatories(undefined, f);
    expect(r?.error).toBeUndefined();

    const p = await db.package.findUniqueOrThrow({
      where: { id: pkgId },
      select: { pelaksanaName: true, pelaksanaTitle: true },
    });
    expect(p.pelaksanaName).toBe("Pelaksana Baru");
    expect(p.pelaksanaTitle).toBe("Site Engineer");
  });

  it("REGRESI: tidak melapor berhasil sambil menghapus nama yang ada", async () => {
    /*
     * Bentuk cacat aslinya. Medan pelaksana tetap DIKIRIM formulir, tapi tidak
     * dibaca — hasilnya null tersimpan dan pesannya tetap "diperbarui". Yang
     * dijaga di sini: nilai yang dikirim benar-benar mendarat.
     */
    const { updateContractSignatories } = await import("@/lib/package/actions");
    const kontrak = await db.contract.findFirstOrThrow({
      where: { packageId: pkgId },
      select: { id: true },
    });

    await db.package.update({
      where: { id: pkgId },
      data: { pelaksanaName: "Sudah Ada", pelaksanaTitle: "Pelaksana Lapangan" },
    });

    const f = new FormData();
    f.set("contractId", kontrak.id);
    f.set("ppkName", "PPK diganti");
    f.set("pelaksanaName", "Sudah Ada");
    f.set("pelaksanaTitle", "Pelaksana Lapangan");
    await updateContractSignatories(undefined, f);

    const p = await db.package.findUniqueOrThrow({
      where: { id: pkgId },
      select: { pelaksanaName: true },
    });
    expect(p.pelaksanaName).toBe("Sudah Ada");
  });

  it("mengosongkan medan memang mengosongkan – bukan diam-diam", async () => {
    const { updateContractSignatories } = await import("@/lib/package/actions");
    const kontrak = await db.contract.findFirstOrThrow({
      where: { packageId: pkgId },
      select: { id: true },
    });
    const f = new FormData();
    f.set("contractId", kontrak.id);
    f.set("pelaksanaName", "");
    await updateContractSignatories(undefined, f);

    const p = await db.package.findUniqueOrThrow({
      where: { id: pkgId },
      select: { pelaksanaName: true },
    });
    expect(p.pelaksanaName).toBeNull();
  });
});
