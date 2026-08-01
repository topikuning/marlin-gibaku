// Dua jalan buntu navigasi (DECISIONS 204).
//
// 1. Kartu "Perlu Koreksi: 1" di dashboard eksekutif menunjuk /laporan —
//    halaman yang berisi daftar lokasi + laporan FINAL, jadi laporan yang
//    dikembalikan tidak ada di sana sama sekali. User: "diklik hanya ke halaman
//    laporan, mana laporan yang dikembalikan, mana yang perlu diperbaiki?"
// 2. Pindah lokasi sepaket harus memutar lewat halaman paket dan mendarat di
//    Ringkasan. User: "terlalu banyak klik untuk pindah2".
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));

let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/session")>("@/lib/auth/session");
  return { ...actual, accessibleLocationIds: async () => scopedLocations };
});

const { db } = await import("@/lib/db");
const { getAntreanLaporan, menungguHariSejak } = await import("@/lib/daily-report/antrean");
const { getSiblingLocations } = await import("@/app/(app)/lokasi/[slug]/get-location");

const suffix = `nb${Date.now().toString(36)}`;
let orgId = "";
let pkgId = "";
let smId = "";
let mandorId = "";
const loc: Record<string, string> = {};

const user = () => ({ id: smId, orgId, role: "project_manager", fullName: "PM" }) as never;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  const sm = await db.user.create({
    data: { orgId, username: `sm-${suffix}`, fullName: "Slamet Riyadi", role: "site_manager", passwordHash: "x" },
  });
  smId = sm.id;
  const mandor = await db.user.create({
    data: { orgId, username: `md-${suffix}`, fullName: "Paijo Sutrisno", role: "field_supervisor", passwordHash: "x" },
  });
  mandorId = mandor.id;

  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  pkgId = pkg.id;

  // Sengaja dibuat TIDAK urut abjad supaya urutan hasil membuktikan sesuatu.
  for (const [nama, kab] of [
    ["Tengket", "Bangkalan"],
    ["Batah Timur", "Bangkalan"],
    ["Labuhan Alas", "Sumbawa"],
  ] as const) {
    const l = await db.location.create({
      data: {
        packageId: pkg.id,
        name: nama,
        slug: `${nama.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
        village: nama,
        regency: kab,
        province: "P",
        status: "berjalan",
      },
    });
    loc[nama] = l.id;
  }

  // Laporan: 1 dikembalikan (dengan alasan), 1 dikirim (menunggu), 1 final.
  const dikembalikan = await db.dailyReport.create({
    data: {
      locationId: loc["Tengket"],
      reportDate: new Date("2026-07-26"),
      status: "perlu_koreksi",
      createdById: mandorId,
      submittedById: mandorId,
      submittedAt: new Date("2026-07-26T09:00:00Z"),
    },
  });
  await db.dailyReportStatusHistory.create({
    data: {
      reportId: dikembalikan.id,
      fromStatus: "dikirim",
      toStatus: "perlu_koreksi",
      changedById: smId,
      changedAt: new Date("2026-07-30T08:42:00Z"),
      reason: "Volume pasangan batu tidak sesuai foto — mohon cek ulang",
    },
  });
  await db.dailyReport.create({
    data: {
      locationId: loc["Batah Timur"],
      reportDate: new Date("2026-07-29"),
      status: "dikirim",
      createdById: mandorId,
      submittedById: mandorId,
      submittedAt: new Date("2026-07-29T10:00:00Z"),
    },
  });
  await db.dailyReport.create({
    data: {
      locationId: loc["Labuhan Alas"],
      reportDate: new Date("2026-07-29"),
      status: "final",
      createdById: mandorId,
    },
  });
});

afterAll(async () => {
  // TIDAK ada pembersihan: `daily_report_status_history` append-only (trigger
  // DB menolak DELETE), dan laporan tidak bisa dihapus selama historinya ada.
  // Tiap run memakai suffix + paket sendiri, dan setiap assertion menyaring
  // miliknya — data run lama tidak bisa mencemari hasil.
  await db.$disconnect();
});

/* ── 1. Antrean laporan ──────────────────────────────────────────────────── */

describe("KASUS INTI: angka di kartu punya jalan ke laporannya", () => {
  it("perlu-koreksi menyebut lokasi, tanggal, ALASAN, pengembali, dan pelapor", async () => {
    scopedLocations = null;
    const hasil = await getAntreanLaporan(user(), null, "perlu-koreksi");
    const punyaKita = hasil.filter((r) => r.locationSlug.endsWith(suffix));
    expect(punyaKita).toHaveLength(1);

    const r = punyaKita[0];
    expect(r.locationName).toBe("Tengket");
    expect(r.dateKey).toBe("2026-07-26");
    // Tanpa ini user cuma tahu ADA yang dikembalikan, bukan APA yang salah.
    expect(r.reason).toBe("Volume pasangan batu tidak sesuai foto — mohon cek ulang");
    expect(r.olehNama).toBe("Slamet Riyadi");
    expect(r.pelaporNama).toBe("Paijo Sutrisno");
    // Link tujuan = laporannya sendiri, bukan halaman daftar.
    expect(`/lokasi/${r.locationSlug}/harian/${r.dateKey}`).toContain("/harian/2026-07-26");
  });

  it("menunggu-verifikasi hanya berisi yang DIKIRIM — final tidak ikut", async () => {
    const hasil = await getAntreanLaporan(user(), null, "menunggu-verifikasi");
    const punyaKita = hasil.filter((r) => r.locationSlug.endsWith(suffix));
    expect(punyaKita.map((r) => r.locationName)).toEqual(["Batah Timur"]);
    expect(punyaKita[0].olehNama).toBe("Paijo Sutrisno");
  });

  it("laporan final TIDAK muncul di antrean mana pun", async () => {
    for (const kind of ["perlu-koreksi", "menunggu-verifikasi"] as const) {
      const hasil = await getAntreanLaporan(user(), null, kind);
      const punyaKita = hasil.filter((r) => r.locationSlug.endsWith(suffix));
      expect(punyaKita.some((r) => r.locationName === "Labuhan Alas")).toBe(false);
    }
  });

  it("scope dihormati: lokasi di luar penugasan tidak bocor", async () => {
    const hasil = await getAntreanLaporan(user(), [loc["Batah Timur"]], "perlu-koreksi");
    // Tengket (yang dikembalikan) tidak ditugaskan → tidak boleh muncul.
    expect(hasil.filter((r) => r.locationSlug.endsWith(suffix))).toHaveLength(0);
  });

  it("lama menunggu dihitung per HARI KALENDER Jakarta, bukan selisih jam", () => {
    const pagiIni = new Date("2026-07-31T02:00:00Z"); // 31 Jul 09.00 WIB
    // Masuk KEMARIN jam 23 WIB sudah terhitung "1 hari" walau baru 10 jam
    // berlalu — itu yang dirasakan orang yang menunggunya.
    expect(menungguHariSejak(new Date("2026-07-30T16:00:00Z"), pagiIni)).toBe(1);
    // Masuk pagi ini = belum menunggu sehari.
    expect(menungguHariSejak(new Date("2026-07-31T00:30:00Z"), pagiIni)).toBe(0);
    expect(menungguHariSejak(new Date("2026-07-28T05:00:00Z"), pagiIni)).toBe(3);
    // Tidak pernah negatif walau jam server meleset.
    expect(menungguHariSejak(new Date("2026-08-05T05:00:00Z"), pagiIni)).toBe(0);
  });
});

/* ── 2. Lokasi sepaket untuk pemilih di header ───────────────────────────── */

describe("pemilih lokasi: daftar sepaket, ter-scope, urut abjad", () => {
  it("urut ABJAD, bukan urutan pembuatan", async () => {
    scopedLocations = null;
    const { siblings, hiddenCount } = await getSiblingLocations(user(), pkgId);
    expect(siblings.map((l) => l.name)).toEqual(["Batah Timur", "Labuhan Alas", "Tengket"]);
    expect(hiddenCount).toBe(0);
  });

  it("membawa status + kabupaten supaya bisa dipilih tanpa membuka satu-satu", async () => {
    scopedLocations = null;
    const { siblings } = await getSiblingLocations(user(), pkgId);
    expect(siblings[0].status).toBe("berjalan");
    expect(siblings[0].regency).toBe("Bangkalan");
  });

  it("tanpa baseline aktif → deviasi null, BUKAN 0 (0% terbaca 'tidak ada progres')", async () => {
    scopedLocations = null;
    const { siblings } = await getSiblingLocations(user(), pkgId);
    expect(siblings.every((l) => l.deviationPct === null)).toBe(true);
  });

  it("hanya lokasi penugasan yang muncul, sisanya DISEBUT jumlahnya", async () => {
    // Inti keluhan sebelumnya: semua lokasi terlist padahal aksesnya sebagian.
    scopedLocations = [loc["Batah Timur"], loc["Tengket"]];
    const { siblings, hiddenCount } = await getSiblingLocations(user(), pkgId);
    expect(siblings.map((l) => l.name)).toEqual(["Batah Timur", "Tengket"]);
    // "Tidak muncul" tidak boleh terbaca "tidak ada".
    expect(hiddenCount).toBe(1);
  });

  it("tanpa akses sama sekali → daftar kosong, semuanya terhitung tersembunyi", async () => {
    scopedLocations = [];
    const { siblings, hiddenCount } = await getSiblingLocations(user(), pkgId);
    expect(siblings).toHaveLength(0);
    expect(hiddenCount).toBe(3);
  });
});
