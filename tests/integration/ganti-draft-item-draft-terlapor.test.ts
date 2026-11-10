/*
 * DRAFT DIGANTI BERKAS BARU – item yang hanya ada di draft lama dan SUDAH
 * dilaporkan ikut dicocokkan (DECISIONS 754).
 *
 * Keluhan user 2026-11-10 dengan tangkapan layar impor "BOTULIODU CCO.xlsx":
 * *"error apa pula ini!"* – "Impor dihentikan: 1 baris laporan harian sudah
 * diinput terhadap draft #3, tetapi itemnya TIDAK ADA di berkas ini – 2 Nov
 * 2026 – Pekerjaan Urugan Pasir t = 5 cm".
 *
 * Sebabnya: berkas baru hanya dicocokkan dengan RAB AKTIF. Item yang lahir di
 * draft lama tidak pernah ada di RAB aktif, jadi ia tidak bisa dikenali lewat
 * nama, tidak bisa dipasangkan manual, dan baru ketahuan saat simpan.
 *
 * Yang dijaga lewat tombol impor sungguhan (`importHps`):
 * 1. baris berkas yang NAMANYA sama dengan item draft lama mewarisi kuncinya,
 *    dan laporannya pindah – impor tidak lagi ditolak;
 * 2. yang tetap tidak berpasangan disebut di PRATINJAU dan ditawarkan di panel
 *    pemetaan, bukan baru ketahuan saat menyimpan.
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
const { addDraftItem } = await import("@/lib/rab/adendum");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");
const ExcelJS = (await import("exceljs")).default;

const BERKAS = "mc0-pasar-banggi-blok-cco01.xlsx";
const asli = readFileSync(new URL(`../fixtures/${BERKAS}`, import.meta.url).pathname);
const suffix = `gd${Date.now().toString(36)}`;
let locationId = "";
/** Item kontrak yang namanya diganti di berkas uji – barisnya jadi milik item draft. */
let korban: { name: string; lineageKey: string; parentLineageKey: string | null; excelRow: number } | null = null;

const berkasForm = (buf: Buffer, nama = BERKAS) =>
  new File([new Uint8Array(buf)], nama, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

async function pratinjau(buf: Buffer) {
  const fd = new FormData();
  fd.set("locationId", locationId);
  fd.set("mode", "draft");
  fd.set("file", berkasForm(buf));
  return importHps(undefined, fd);
}

async function imporDraft(buf: Buffer) {
  const p = await pratinjau(buf);
  if (!p?.preview) return { error: p?.error ?? "pratinjau kosong" };
  const fd = new FormData();
  fd.set("locationId", locationId);
  fd.set("mode", "draft");
  fd.set("file", berkasForm(buf));
  fd.set("confirm", "1");
  fd.set("previewSha", p.preview.sha256);
  return (await importHps(undefined, fd)) ?? {};
}

/** Berkas yang sama dengan satu NAMA item diganti. */
async function berkasDenganNama(baris: number, namaLama: string, namaBaru: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(asli as unknown as ArrayBuffer);
  let diganti = 0;
  for (const ws of wb.worksheets) {
    const row = ws.getRow(baris);
    row.eachCell((c) => {
      if (typeof c.value === "string" && c.value.trim() === namaLama.trim()) {
        c.value = namaBaru;
        diganti++;
      }
    });
    if (diganti) break;
  }
  if (!diganti) throw new Error(`nama "${namaLama}" tidak ketemu di baris ${baris}`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const draftLokasi = () =>
  db.rabRevision.findFirst({ where: { locationId, status: "draft" }, select: { id: true, revisionNo: true } });

/** Item BARU di draft (hanya ada di draft), lalu dilaporkan terhadapnya. */
async function itemDraftTerlapor(nama: string, tanggal: string) {
  const d = await draftLokasi();
  const induk = await db.rabNode.findFirstOrThrow({
    where: { revisionId: d!.id, lineageKey: korban!.parentLineageKey! },
    select: { id: true },
  });
  const { nodeId } = await addDraftItem(locationId, d!.id, induk.id, { code: `Z${tanggal.slice(-2)}`, name: nama, unit: "m3", volume: 5, unitPrice: 100_000 }, sesi.id);
  const laporan = await getOrCreateDraft(locationId, tanggal, sesi.id);
  await upsertItem(laporan.id, { rabNodeId: nodeId, volumeDone: 1 }, sesi.id);
  return db.dailyReportItem.findFirstOrThrow({ where: { rabNodeId: nodeId }, select: { id: true, lineageKey: true } });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org GD ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `gd-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket GD ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor GD ${suffix}` } });
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
      name: "Lokasi GD",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Gorontalo",
      province: "Gorontalo",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  const { parsed } = await parseHpsBuffer(asli);
  const nodes = flattenParsedRab(parsed);
  const hasil = await createRevisionFromNodes(loc.id, nodes, { source: "hps_awal", userId: sesi.id, note: "kontrak" });
  await activateRevision(hasil.revisionId, sesi.id);
  // Item yang namanya TUNGGAL di antara saudaranya – supaya pencocokan nama pasti.
  const kandidat = nodes.filter((n) => n.kind === "item" && n.excelRow != null && n.parentLineageKey);
  korban =
    kandidat
      .map((n) => ({ name: n.name, lineageKey: n.lineageKey, parentLineageKey: n.parentLineageKey, excelRow: n.excelRow! }))
      .find((n) => kandidat.filter((x) => x.parentLineageKey === n.parentLineageKey && x.name === n.name).length === 1) ?? null;
  expect(korban, "tidak ada item uji").not.toBeNull();
  const pertama = await imporDraft(asli);
  expect(pertama.error, `impor draft pertama gagal: ${pertama.error}`).toBeFalsy();
}, 900_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("draft diganti berkas baru", () => {
  it("yang belum berpasangan disebut di PRATINJAU dan ditawarkan untuk dipasangkan", async () => {
    await itemDraftTerlapor("Pekerjaan Uji Tanpa Pasangan", "2026-09-20");
    const p = await pratinjau(asli);
    expect(p?.preview, p?.error).toBeTruthy();
    const pv = p!.preview!;
    expect(pv.warnings.join("\n")).toMatch(/1 baris laporan harian yang diinput terhadap draft #\d+ belum punya pasangan/);
    expect(pv.warnings.join("\n")).toMatch(/20 Sep 2026 – Pekerjaan Uji Tanpa Pasangan/);
    expect(pv.padanan.lama.find((l) => l.sebab === "draft")?.name).toBe("Pekerjaan Uji Tanpa Pasangan");
    // Bersihkan: baris laporannya dihapus supaya uji berikut berdiri sendiri.
    await db.dailyReportItem.deleteMany({ where: { rabNode: { name: "Pekerjaan Uji Tanpa Pasangan" } } });
    await db.rabNode.deleteMany({ where: { name: "Pekerjaan Uji Tanpa Pasangan" } });
  }, 900_000);

  it("REGRESI BOTULIODU: baris berkas bernama sama mewarisi kunci item draft, laporannya pindah, impor tidak ditolak", async () => {
    const NAMA = "Pekerjaan Urugan Pasir Uji t = 5 cm";
    const baris = await itemDraftTerlapor(NAMA, "2026-09-21");
    // Berkas baru: item kontrak `korban` berganti nama menjadi item draft itu.
    const buf = await berkasDenganNama(korban!.excelRow, korban!.name, NAMA);
    const h = await imporDraft(buf);
    expect(h.error, `impor ditolak: ${h.error}`).toBeFalsy();
    const draft = await draftLokasi();
    const pindah = await db.dailyReportItem.findUniqueOrThrow({
      where: { id: baris.id },
      select: { lineageKey: true, rabNode: { select: { revisionId: true, name: true } } },
    });
    expect(pindah.rabNode.revisionId).toBe(draft!.id);
    expect(pindah.rabNode.name).toBe(NAMA);
    expect(pindah.lineageKey).toBe(baris.lineageKey);
  }, 900_000);
});
