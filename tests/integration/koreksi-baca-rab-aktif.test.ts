/*
 * PERBAIKAN PEMBACAAN RAB AKTIF – tanpa adendum (DECISIONS 680).
 *
 * Laporan user 2026-10-15 (CCO Krakahan): RAB aktif tersimpan dengan harga
 * satuan item KOSONG, jumlahnya ada. Impor ulang berkas yang sama lewat
 * "Jadikan RAB AKTIF sekarang" berakhir sebagai DRAFT menunggu dua
 * persetujuan: *"kenapa hasil impor diperlakukan seperti draft cco/adendum,
 * ini fitur bypass yang aneh"*.
 *
 * Yang dibuktikan: berkas yang isinya sama dengan RAB aktif membetulkan
 * revisi aktif DI TEMPAT – tanpa revisi baru, node yang sama, jumlah yang
 * sama – dan nilai terpasang laporan harian ikut dihitung ulang. Berkas yang
 * mengubah isi kontrak tetap lewat jalur adendum.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async () => sesi,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");

const NAMA = "rab-aktif-situbondo.xlsx";
const ISI = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);
const suffix = `kb${Date.now().toString(36)}`;
let orgId: string;
let locationId: string;
let revisionId: string;

const berkas = () =>
  new File([new Uint8Array(ISI)], NAMA, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

async function impor(confirmSha?: string) {
  const fd = new FormData();
  fd.set("locationId", locationId);
  fd.set("mode", "aktifkan");
  fd.set("file", berkas());
  if (confirmSha) {
    fd.set("confirm", "1");
    fd.set("previewSha", confirmSha);
  }
  return (await importHps(undefined, fd)) ?? {};
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KB ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const user = await db.user.create({
    data: { orgId: org.id, username: `kb-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket KB ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor KB ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 5_000_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi KB",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Situbondo",
      province: "Jawa Timur",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  const { parsed } = await parseHpsBuffer(ISI);
  const hasil = await createRevisionFromNodes(loc.id, flattenParsedRab(parsed), {
    source: "hps_awal",
    userId: sesi.id,
    note: "kontrak",
  });
  await activateRevision(hasil.revisionId, sesi.id);
  revisionId = hasil.revisionId;
}, 300_000);

afterAll(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE id = '${orgId}'`).catch(() => null);
  await db.$disconnect();
});

describe("perbaikan pembacaan RAB aktif", () => {
  it("harga satuan yang dulu kosong terisi di revisi aktif yang SAMA – tanpa draft, tanpa persetujuan", async () => {
    // Tiru bacaan lama yang salah: dua item tersimpan tanpa harga satuan.
    const rusak = await db.rabNode.findMany({
      where: { revisionId, kind: "item", unitPrice: { not: null }, volume: { gt: 1 } },
      orderBy: { sortOrder: "asc" },
      take: 2,
      select: { id: true, unitPrice: true, amount: true, volume: true },
    });
    expect(rusak).toHaveLength(2);
    await db.rabNode.updateMany({ where: { id: { in: rusak.map((n) => n.id) } }, data: { unitPrice: null } });

    // Laporan harian yang diinput selama harganya kosong tercatat Rp 0.
    const laporan = await getOrCreateDraft(locationId, "2026-09-10", sesi.id);
    await upsertItem(laporan.id, { rabNodeId: rusak[0]!.id, volumeDone: 1 }, sesi.id);
    const baris = await db.dailyReportItem.findFirstOrThrow({
      where: { reportId: laporan.id, rabNodeId: rusak[0]!.id },
      select: { id: true, valueDone: true },
    });
    expect(baris.valueDone).toBe(0n);

    const nodeSebelum = await db.rabNode.findMany({
      where: { revisionId },
      orderBy: { id: "asc" },
      select: { id: true, amount: true, volume: true },
    });

    const pratinjau = await impor();
    expect(pratinjau.error, `pratinjau gagal: ${pratinjau.error}`).toBeUndefined();
    const k = pratinjau.preview!.koreksi;
    expect(k).toMatchObject({ boleh: true, hargaTerisi: 2, hargaBerubah: 0 });

    const simpan = await impor(pratinjau.preview!.sha256);
    expect(simpan.error, `simpan gagal: ${simpan.error}`).toBeUndefined();
    expect(simpan.success).toMatch(/sudah dibetulkan/);
    expect(simpan.success).toMatch(/2 harga satuan yang kosong kini terisi/);
    expect(simpan.success).toMatch(/1 baris laporan harian/);

    // Tidak ada revisi baru, tidak ada draft.
    const revisi = await db.rabRevision.findMany({ where: { locationId }, select: { id: true, status: true } });
    expect(revisi).toEqual([{ id: revisionId, status: "aktif" }]);

    // Node yang sama, volume & jumlah yang sama; harganya kembali.
    const nodeSesudah = await db.rabNode.findMany({
      where: { revisionId },
      orderBy: { id: "asc" },
      select: { id: true, amount: true, volume: true },
    });
    expect(nodeSesudah.map((n) => [n.id, n.amount, String(n.volume)])).toEqual(
      nodeSebelum.map((n) => [n.id, n.amount, String(n.volume)]),
    );
    for (const n of rusak) {
      const kini = await db.rabNode.findUniqueOrThrow({ where: { id: n.id }, select: { unitPrice: true } });
      expect(String(kini.unitPrice)).toBe(String(n.unitPrice));
    }

    // Nilai terpasang laporan harian dihitung ulang dengan harga yang benar.
    const barisKini = await db.dailyReportItem.findUniqueOrThrow({ where: { id: baris.id }, select: { valueDone: true } });
    expect(barisKini.valueDone).toBe(BigInt(Math.round(Number(rusak[0]!.unitPrice))));

    const jejak = await db.auditLog.findFirst({ where: { action: "rab.koreksi_baca", resourceId: revisionId } });
    expect(jejak).not.toBeNull();
  }, 300_000);

  it("berkas yang sama persis: tidak ada yang diubah", async () => {
    const pratinjau = await impor();
    expect(pratinjau.preview!.koreksi).toMatchObject({ boleh: true, jumlahBaris: 0 });
    const simpan = await impor(pratinjau.preview!.sha256);
    expect(simpan.success).toMatch(/sudah sama dengan RAB aktif/);
    expect(await db.rabRevision.count({ where: { locationId } })).toBe(1);
  }, 300_000);

  it("berkas yang mengubah volume kontrak TIDAK dibetulkan di tempat – tetap jalur adendum", async () => {
    const item = await db.rabNode.findFirstOrThrow({
      where: { revisionId, kind: "item", volume: { gt: 1 } },
      orderBy: { sortOrder: "desc" },
      select: { id: true, volume: true, name: true },
    });
    // RAB aktif kini berbeda volume dari berkas – sama artinya dengan berkas
    // yang membawa volume baru.
    await db.rabNode.update({ where: { id: item.id }, data: { volume: Number(item.volume) + 1 } });
    try {
      const pratinjau = await impor();
      const k = pratinjau.preview!.koreksi;
      expect(k?.boleh).toBe(false);
      expect(k && !k.boleh ? k.sebab.join(" ") : "").toMatch(/volumenya berbeda/);
    } finally {
      await db.rabNode.update({ where: { id: item.id }, data: { volume: item.volume } });
    }
  }, 300_000);
});
