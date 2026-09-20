/*
 * LOKASI PINDAH PAKET TIDAK BOLEH MEMBAWA GRUP KABUPATEN PAKET LAMA
 * (DECISIONS 596).
 *
 * FK komposit `(wa_group_ref_id, package_id)` membuat pemindahan itu MUSTAHIL
 * secara data — dan justru karena itu ia berbahaya kalau dibiarkan: tanpa
 * penanganan, `pindahkanLokasi` akan gagal dengan galat Postgres mentah di
 * tengah transaksi, dan yang membaca layar cuma melihat "terjadi kesalahan".
 *
 * Perilaku yang benar: tautan grupnya DILEPAS saat pindah, dan pelepasannya
 * DISEBUT. Lokasi yang berpindah paket memang tidak lagi punya hak atas grup
 * paket asal — tetapi orang yang memindahkannya harus tahu bahwa lokasi itu
 * kini kembali mengikuti grup paket barunya, bukan menemukannya sendiri lewat
 * pengingat yang tiba-tiba masuk ke grup yang salah.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { pindahkanLokasi } = await import("@/lib/package/pindah-lokasi");

const chat = () => `1203${randomUUID().replace(/-/g, "").slice(0, 16)}@g.us`;

let orgId = "";
let asal = "";
let tujuan = "";
let lokasiId = "";
let grupId = "";
let actor: { id: string; orgId: string };

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;

  const a = await db.package.create({
    data: { orgId, name: `Asal ${suffix}`, stage: "pelaksanaan", waGroupId: chat(), waGroupName: "Grup asal" },
    select: { id: true },
  });
  asal = a.id;
  const t = await db.package.create({
    data: { orgId, name: `Tujuan ${suffix}`, stage: "pelaksanaan", waGroupId: chat(), waGroupName: "Grup tujuan" },
    select: { id: true },
  });
  tujuan = t.id;

  const g = await db.waGroup.create({
    data: { orgId, packageId: asal, waGroupId: chat(), waGroupName: "KNMP Jepara", regency: "Jepara" },
    select: { id: true },
  });
  grupId = g.id;

  const l = await db.location.create({
    data: {
      packageId: asal,
      name: "Karanggondang",
      slug: `karanggondang-${suffix}`,
      village: "Karanggondang",
      regency: "Jepara",
      province: "Jawa Tengah",
      isActive: true,
      waGroupRefId: grupId,
    },
    select: { id: true },
  });
  lokasiId = l.id;

  const u = await db.user.create({
    data: {
      orgId,
      username: `admin-${suffix}`,
      fullName: "Admin Uji",
      passwordHash: "x",
      role: "super_admin",
    },
    select: { id: true, orgId: true },
  });
  actor = u;
});

describe("pindah paket melepas grup kabupaten, dengan disebut", () => {
  it("pindah berhasil – tidak gagal oleh FK komposit", async () => {
    await expect(
      pindahkanLokasi(
        { locationId: lokasiId, tujuanPackageId: tujuan, mode: "paksa", alasan: "uji pindah" },
        actor,
        null,
      ),
    ).resolves.toBeTruthy();
  });

  it("tautan grup kabupaten paket asal DILEPAS, bukan ikut pindah", async () => {
    const l = await db.location.findUniqueOrThrow({
      where: { id: lokasiId },
      select: { packageId: true, waGroupRefId: true },
    });
    expect(l.packageId).toBe(tujuan);
    expect(l.waGroupRefId).toBeNull();
  });

  it("grup paket asal tetap ada – ia milik paket asal, bukan milik lokasi itu", async () => {
    expect(await db.waGroup.findUnique({ where: { id: grupId } })).not.toBeNull();
  });
});
