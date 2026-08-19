// PENCARIAN NARASI LAPANGAN (DECISIONS 382, Fase F1).
//
// Yang dijaga berkas ini bukan "ada pencarian", melainkan tiga hal yang kalau
// longgar membuat fiturnya berbahaya, bukan sekadar kurang berguna:
//
//   1. LINGKUP — catatan lokasi di luar hak penanya tidak pernah ikut, bahkan
//      tidak ikut diperingkat.
//   2. STATUS — laporan draft/perlu_koreksi tidak pernah dicari; menjawab dari
//      laporan yang sedang diperbaiki berarti menyebarkan yang belum sah.
//   3. KESEGARAN — teks yang dikoreksi langsung terbawa, karena tsvector-nya
//      dihitung saat query dari kolom teks aslinya (tidak ada salinan tersimpan
//      yang bisa basi).
//
// Ditambah satu penjaga yang sifatnya beda: bahwa indeks ekspresinya BENAR-BENAR
// terpakai (DECISIONS 384). Kalau ekspresi di query bergeser satu huruf dari
// yang diindeks, PostgreSQL tidak mengeluh — ia hanya memindai seluruh tabel.
// Di basis data uji yang kecil itu tak terasa; di produksi yang sudah berisi
// banyak data, itu bedanya jawaban seketika dengan jawaban yang menggantung.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { cariNarasi, cariNarasiAman, EKSPRESI_TSV, ALIAS_TSV } = await import("@/lib/narasi/cari");
const { Prisma } = await import("@/generated/prisma/client");

const suffix = `nrs${Date.now().toString(36)}`;
let orgId = "";
let lokA = "";
let lokB = "";
let laporanFinalId = "";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org NRS ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket NRS ${suffix}`, stage: "pelaksanaan" },
  });
  const buatLokasi = async (nama: string) =>
    (
      await db.location.create({
        data: {
          packageId: pkg.id,
          name: `${nama} ${suffix}`,
          slug: `${nama.toLowerCase()}-${suffix}`,
          village: nama,
          regency: "Demak",
          province: "Jawa Tengah",
          isActive: true,
        },
        select: { id: true },
      })
    ).id;
  lokA = await buatLokasi("Alfa");
  lokB = await buatLokasi("Beta");

  const pelapor = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      email: `sm-${suffix}@contoh.id`,
      fullName: "SM NRS",
      role: "site_manager",
      passwordHash: "x",
    },
    select: { id: true },
  });

  const buatLaporan = async (
    locationId: string,
    tanggal: string,
    status: "draft" | "final",
    notes: string,
  ) =>
    (
      await db.dailyReport.create({
        data: {
          locationId,
          reportDate: new Date(`${tanggal}T00:00:00.000Z`),
          status,
          notes,
          createdById: pelapor.id,
        },
        select: { id: true },
      })
    ).id;

  laporanFinalId = await buatLaporan(
    lokA,
    "2026-08-10",
    "final",
    "Pengecoran lantai tertunda karena hujan deras sejak siang.",
  );
  // Draft dengan kata kunci yang SAMA — kalau ikut terjaring, pagarnya bocor.
  await buatLaporan(lokA, "2026-08-11", "draft", "Hujan deras lagi, cor batal.");
  // Lokasi LAIN, kata kunci sama — untuk menguji pagar lingkup.
  await buatLaporan(lokB, "2026-08-10", "final", "Hujan deras menghambat pekerjaan.");

  await db.fieldActivity.create({
    data: {
      locationId: lokA,
      activityDate: new Date("2026-08-12T00:00:00.000Z"),
      type: "rapat",
      title: "Rapat percepatan",
      notes: "Menyepakati tambahan tenaga untuk mengejar keterlambatan.",
      status: "final",
      createdById: pelapor.id,
    },
  });
  await db.issue.create({
    data: {
      locationId: lokA,
      title: "Material besi belum datang",
      description: "Pengiriman besi tertahan di gudang pemasok.",
      severity: "tinggi",
      status: "terbuka",
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE issues, field_activities, daily_reports, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("menemukan catatan lapangan dengan stemming Indonesia", () => {
  it('"hujan" menemukan catatan laporan harian', async () => {
    const r = await cariNarasi({ locationIds: [lokA], pertanyaan: "kenapa terlambat, hujan?" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((p) => p.teks.includes("hujan deras sejak siang"))).toBe(true);
  });

  it("STEMMING bekerja: 'pengecoran' ditemukan lewat kata 'cor'", async () => {
    /*
     * Ini alasan memakai konfigurasi `indonesian`, bukan pencocokan kata biasa.
     * Diperiksa langsung: 'pengecoran' → 'ecor', 'tertunda' → 'tunda'.
     */
    const r = await cariNarasi({ locationIds: [lokA], pertanyaan: "pengecoran" });
    expect(r.some((p) => p.teks.includes("Pengecoran"))).toBe(true);
  });

  it("kegiatan lapangan & kendala ikut tercari", async () => {
    const kegiatan = await cariNarasi({ locationIds: [lokA], pertanyaan: "rapat percepatan" });
    expect(kegiatan.some((p) => p.jenis === "kegiatan")).toBe(true);

    const kendala = await cariNarasi({ locationIds: [lokA], pertanyaan: "besi pemasok" });
    expect(kendala.some((p) => p.jenis === "kendala")).toBe(true);
  });

  it("tanda baca & kalimat tanya tidak membuatnya melempar", async () => {
    /*
     * `to_tsquery` MELEMPAR pada tanda baca biasa; pertanyaan orang akan
     * menjadi galat 500 alih-alih jawaban. Karena itu `plainto_tsquery`.
     */
    await expect(
      cariNarasi({ locationIds: [lokA], pertanyaan: "kenapa telat, hujan? material!" }),
    ).resolves.toBeInstanceOf(Array);
  });

  it("pertanyaan tanpa kata pencarian → kosong, bukan galat", async () => {
    expect(await cariNarasi({ locationIds: [lokA], pertanyaan: "   " })).toEqual([]);
    expect(await cariNarasi({ locationIds: [], pertanyaan: "hujan" })).toEqual([]);
  });
});

describe("pagar yang membuat fitur ini aman", () => {
  it("LINGKUP: catatan lokasi lain tidak pernah ikut", async () => {
    /*
     * Lokasi B memuat kata kunci yang sama persis. Kalau penyaringan lingkup
     * terjadi SESUDAH peringkat — atau tidak terjadi — catatannya akan muncul.
     */
    const r = await cariNarasi({ locationIds: [lokA], pertanyaan: "hujan deras" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => p.locationId === lokA)).toBe(true);
    expect(r.some((p) => p.teks.includes("menghambat pekerjaan"))).toBe(false);
  });

  it("STATUS: laporan draft TIDAK pernah dicari", async () => {
    // Draft memuat "hujan deras" juga. Menjawab dari laporan yang sedang
    // diperbaiki berarti menyebarkan keterangan yang belum sah.
    const r = await cariNarasi({ locationIds: [lokA], pertanyaan: "hujan deras" });
    expect(r.some((p) => p.teks.includes("cor batal"))).toBe(false);
  });

  it("KESEGARAN: teks yang dikoreksi langsung terbawa", async () => {
    /*
     * Indeksnya kolom GENERATED yang dipelihara PostgreSQL sendiri — tidak ada
     * kode sinkronisasi yang bisa lupa, dan tidak ada jendela basi. Tanpa itu,
     * MARLIN bisa menjawab dari kalimat yang sudah dihapus pelapornya.
     */
    await db.dailyReport.update({
      where: { id: laporanFinalId },
      data: { notes: "Sudah diperbaiki: pengecoran selesai, cuaca cerah." },
    });
    const lama = await cariNarasi({ locationIds: [lokA], pertanyaan: "hujan deras" });
    expect(lama.some((p) => p.id === `narasi:laporan:${laporanFinalId}`)).toBe(false);

    const baru = await cariNarasi({ locationIds: [lokA], pertanyaan: "cuaca cerah" });
    expect(baru.some((p) => p.id === `narasi:laporan:${laporanFinalId}`)).toBe(true);
  });

  it("setiap potongan punya tautan yang bisa dibuka", async () => {
    // Kutipan tanpa jalan memeriksanya adalah cacat sitasi yang sama dengan id
    // mentah yang diperbaiki DECISIONS 378.
    const r = await cariNarasi({ locationIds: [lokA], pertanyaan: "besi" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => p.href.startsWith("/lokasi/"))).toBe(true);
  });
});

describe("kegagalan pencarian tidak menjatuhkan jalur balasan (DECISIONS 384)", () => {
  /*
   * Pencarian catatan dipasang persis di jalur MENYERAH — niat tak dikenali,
   * atau AI mati. Jalur itu dulu SELALU berhasil mengirim "saya belum
   * mengerti". Kalau pencariannya melempar, jalur yang dulu selalu menjawab
   * berubah jadi diam; di lapangan itu lebih buruk daripada sebelum fiturnya
   * ada.
   */
  it("id lokasi yang bukan uuid → larik kosong, bukan lemparan", async () => {
    // `cariNarasi` mentah memang melempar — itu yang dijaga `cariNarasiAman`.
    await expect(
      cariNarasi({ locationIds: ["bukan-uuid"], pertanyaan: "hujan" }),
    ).rejects.toThrow();
    await expect(cariNarasiAman({ locationIds: ["bukan-uuid"], pertanyaan: "hujan" })).resolves
      .toEqual([]);
  });

  it("pencarian yang berhasil tetap mengembalikan hasilnya lewat jalur aman", async () => {
    // Supaya penjaga di atas tidak berubah jadi "selalu kosong".
    const r = await cariNarasiAman({ locationIds: [lokA], pertanyaan: "besi" });
    expect(r.length).toBeGreaterThan(0);
  });
});

describe("indeks ekspresi benar-benar terpakai (DECISIONS 384)", () => {
  /*
   * Kenapa `enable_seqscan = off`.
   *
   * Basis data uji berisi belasan baris; di situ pemindaian seluruh tabel
   * memang LEBIH MURAH daripada lewat indeks, jadi perencana akan memilihnya
   * apa pun ekspresinya — dan ujinya jadi tidak menguji apa-apa. Dengan
   * seqscan dimatikan, satu-satunya cara perencana bisa memakai indeks adalah
   * kalau ekspresi di query cocok dengan yang diindeks. Itulah yang diperiksa
   * di sini: BUKAN "mana yang lebih cepat", melainkan "indeksnya berlaku".
   *
   * Ekspresinya diambil dari `EKSPRESI_TSV` — objek yang sama yang dipakai
   * `cariNarasi` — sehingga mengubah query tanpa mengubah migrasinya (atau
   * sebaliknya) membuat uji ini merah.
   */
  const TABEL = [
    "daily_reports",
    "daily_report_items",
    "field_activities",
    "issues",
    "recovery_actions",
  ] as const;

  for (const tabel of TABEL) {
    it(`${tabel} memakai ${tabel}_tsv_idx`, async () => {
      // `SET LOCAL` di dalam transaksi, bukan `SET` biasa: Prisma memakai kolam
      // koneksi, jadi `SET` polos bisa mendarat di koneksi yang berbeda dengan
      // EXPLAIN-nya — dan ujinya lolos tanpa pernah mematikan seqscan.
      const teks = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        const rencana = await tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
          EXPLAIN SELECT ${Prisma.raw(ALIAS_TSV[tabel])}.id
            FROM ${Prisma.raw(tabel)} ${Prisma.raw(ALIAS_TSV[tabel])}
           WHERE ${EKSPRESI_TSV[tabel]} @@ to_tsquery('indonesian', 'hujan')
        `);
        return rencana.map((b) => b["QUERY PLAN"]).join("\n");
      });
      expect(teks).toContain(`${tabel}_tsv_idx`);
      expect(teks).not.toContain("Seq Scan");
    });
  }
});
