// LARIK SEJAJAR MATERIAL & ALAT DI FORM PELENGKAP.
//
// Form pelengkap mengirim tiap baris material sebagai EMPAT field bernama sama
// (`materialId`, `materialName`, `materialUnit`, `materialQty`), dan server
// menyatukannya kembali PER INDEKS. Susunan itu rapuh dengan cara yang senyap:
// satu baris yang lupa memancarkan salah satu field akan menggeser seluruh
// baris sesudahnya, sehingga nama barang A menempel pada id barang B — dan foto
// bukti ikut berpindah barang tanpa ada yang tahu (DECISIONS 304).
//
// Uji `foto-material-alat` memanggil `setEnrichment` langsung, jadi ia melompati
// penguraian FormData ini sama sekali. Yang di sini sengaja masuk lewat AKSI-nya
// dengan FormData yang disusun persis seperti peramban menyusunnya, lalu membaca
// hasilnya lewat query yang dipakai halaman.
//
// Yang dijaga: baris baru (id kosong) tersimpan, dan pada penyimpanan kedua id
// yang dikirim balik dipakai untuk MEMPERBARUI baris yang sama — bukan membuat
// baris baru — sementara baris betulan yang baru tetap ikut masuk.
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

let userId = "";
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => ({ id: userId, role: "site_manager", fullName: "SM Uji", orgId: orgId }),
    requireCapability: async () => ({ id: userId, role: "site_manager", fullName: "SM Uji", orgId }),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { getOrCreateDraft } = await import("@/lib/daily-report/service");
const { saveEnrichmentAction } = await import("@/lib/daily-report/actions");
const { getWorkspaceData } = await import("@/lib/daily-report/queries");

const suffix = `rp${Date.now().toString(36)}`;
let orgId = "";
let slug = "";
let reportId = "";
const HARI = "2026-06-11";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const user = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      fullName: "SM Uji",
      passwordHash: "x",
      role: "site_manager",
    },
  });
  userId = user.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  slug = `lok-${suffix}`;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug,
      village: "Desa",
      regency: "Kab",
      province: "Jawa Timur",
      status: "berjalan",
      isActive: true,
    },
  });
  const rep = await getOrCreateDraft(loc.id, HARI, userId);
  reportId = rep.id;
});

/** FormData persis seperti enrichment-form.tsx memancarkannya. */
function formPelengkap(
  materials: { id: string; name: string; unit: string; qty: string }[],
  equipment: { id: string; name: string; count: string }[],
) {
  const fd = new FormData();
  fd.set("reportId", reportId);
  fd.set("workStart", "08:00");
  fd.set("workEnd", "16:00");
  fd.set("notes", "catatan uji");
  for (const role of ["mandor", "tukang", "pekerja"]) fd.set(`worker_${role}`, "2");
  for (const m of materials) {
    fd.append("materialId", m.id);
    fd.append("materialName", m.name);
    fd.append("materialUnit", m.unit);
    fd.append("materialQty", m.qty);
  }
  for (const e of equipment) {
    fd.append("equipmentId", e.id);
    fd.append("equipmentName", e.name);
    fd.append("equipmentCount", e.count);
  }
  return fd;
}

describe("simpan pelengkap lewat form", () => {
  it("baris material & alat baru tersimpan dan muncul kembali", async () => {
    const hasil = await saveEnrichmentAction(
      undefined,
      formPelengkap(
        [{ id: "", name: "Semen 50kg", unit: "zak", qty: "20" }],
        [{ id: "", name: "Molen beton", count: "1" }],
      ),
    );
    console.log("HASIL SIMPAN 1:", JSON.stringify(hasil));

    const ws = await getWorkspaceData(slug, HARI);
    console.log("materials:", JSON.stringify(ws?.report?.materials));
    console.log("equipment:", JSON.stringify(ws?.report?.equipment));
    console.log("workStart:", ws?.report?.workStart, "notes:", ws?.report?.notes);
    expect(hasil?.error).toBeUndefined();
    expect(ws?.report?.materials).toHaveLength(1);
    expect(ws?.report?.equipment).toHaveLength(1);
  });

  it("simpan ulang dengan id: baris bertahan, tambah baris baru masuk", async () => {
    const awal = await getWorkspaceData(slug, HARI);
    const mid = awal!.report!.materials[0].id;
    const eid = awal!.report!.equipment[0].id;

    const hasil = await saveEnrichmentAction(
      undefined,
      formPelengkap(
        [
          { id: mid, name: "Semen 50kg", unit: "zak", qty: "25" },
          { id: "", name: "Pasir", unit: "m3", qty: "5" },
        ],
        [{ id: eid, name: "Molen beton", count: "2" }],
      ),
    );
    console.log("HASIL SIMPAN 2:", JSON.stringify(hasil));

    const ws = await getWorkspaceData(slug, HARI);
    console.log("materials:", JSON.stringify(ws?.report?.materials));
    console.log("equipment:", JSON.stringify(ws?.report?.equipment));
    expect(hasil?.error).toBeUndefined();
    expect(ws?.report?.materials.map((m) => m.name).sort()).toEqual(["Pasir", "Semen 50kg"]);
    expect(ws?.report?.materials.some((m) => m.id === mid)).toBe(true);
    expect(ws?.report?.equipment[0].count).toBe(2);
  });
});
