// "RENCANA PEKAN DEPAN" TIDAK BOLEH DIAM-DIAM JADI PEKAN BERJALAN
// (temuan review 2026-08-28).
//
// Di minggu TERAKHIR kontrak, `getRencanaMingguan(n + 1)` mengembalikan null —
// nomornya melewati `totalWeeks`. Versi pertama jatuh kembali ke pekan berjalan
// tanpa berkata apa-apa, sementara kepala balasannya tetap berbunyi "pekan
// depan": jawaban yang benar untuk pekan yang salah, jenis kesalahan yang
// paling sulit dibantah karena angkanya sendiri tidak keliru.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { dataRencana } = await import("@/lib/waha/tanya-data");
const { jakartaToday } = await import("@/lib/format");
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

const suffix = `rpd${Date.now().toString(36)}`;
const HARI = 86_400_000;
let katalog: LokasiKatalog[] = [];

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org RPD ${suffix}`, slug: `org-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket RPD ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Ujung ${suffix}`,
      slug: `ujung-${suffix}`,
      village: "Ujung",
      regency: "Tegal",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true, name: true },
  });
  katalog = [
    {
      id: loc.id,
      nama: loc.name,
      desa: "Ujung",
      kecamatan: null,
      kabupaten: "Tegal",
      provinsi: "Jawa Tengah",
    },
  ];

  /*
   * Kontrak SATU MINGGU yang mulai HARI INI, mode `tujuh_hari`: minggu ke-1
   * membentang hari ini s/d enam hari lagi, dan itu satu-satunya minggunya.
   * "Pekan depan" karenanya dijamin di luar masa kontrak, tanpa bergantung
   * pada hari apa uji ini kebetulan dijalankan.
   *
   * Mode-nya disebut EKSPLISIT: pada `senin_minggu`, kontrak tujuh hari yang
   * mulai di tengah pekan membentang dua kolom minggu, dan "pekan depan"
   * justru masih ada — uji yang membiarkan modenya bawaan akan hijau/merah
   * tergantung hari, bukan tergantung kodenya.
   */
  const mulai = jakartaToday();
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV RPD ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 10_000_000n,
      ppnPercent: 11,
      signedDate: new Date(mulai.getTime() - 7 * HARI),
      durationDays: 7,
      startDate: mulai,
      endDate: new Date(mulai.getTime() + 6 * HARI),
      weekMode: "tujuh_hari",
    },
  });

  const rab = await db.rabRevision.create({
    data: { locationId: loc.id, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 0n },
    select: { id: true },
  });
  const kategori = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      kind: "kategori",
      lineageKey: `kat-${suffix}`,
      code: "1",
      name: "Pekerjaan Persiapan",
      sortOrder: 1,
      amount: 10_000_000n,
    },
    select: { id: true },
  });
  await db.rabNode.create({
    data: {
      revisionId: rab.id,
      parentId: kategori.id,
      kind: "item",
      lineageKey: `itm-${suffix}`,
      code: "1.1",
      name: "Pembersihan lahan",
      sortOrder: 2,
      unit: "m2",
      volume: 100,
      unitPrice: 100_000,
      amount: 10_000_000n,
    },
  });
  const baseline = await db.baseline.create({
    data: { locationId: loc.id, baselineNo: 1, source: "auto", status: "aktif", contractDays: 7 },
    select: { id: true },
  });
  await db.baselinePoint.create({
    data: { baselineId: baseline.id, weekNumber: 1, plannedPct: 100 },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE weekly_plan_items, weekly_plans, rab_nodes, rab_revisions, baseline_points, baselines, contracts, vendors, locations, packages, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("pekan depan di luar masa kontrak", () => {
  it("REGRESI: kejatuhannya DIKATAKAN, bukan diam-diam jadi pekan berjalan", async () => {
    const d = await dataRencana(katalog, true);
    const b = d.baris[0];
    expect(b, "lokasi wajib tetap dijawab").toBeTruthy();
    expect(b.catatan, "kejatuhan ke pekan berjalan wajib disebut").toBeTruthy();
    expect(b.catatan).toContain("di luar masa kontrak");
    // Yang ditampilkan memang pekan berjalan – dan itu boleh, ASAL dikatakan.
    expect(b.minggu).toBe(1);
  });

  it("permintaan pekan BERJALAN tidak membawa catatan apa pun", async () => {
    // Penjagaan arah sebaliknya: catatan yang muncul di jawaban yang benar
    // membuat pembacanya curiga pada angka yang sebenarnya tidak bermasalah.
    const d = await dataRencana(katalog, false);
    expect(d.baris[0].catatan).toBeNull();
  });
});
