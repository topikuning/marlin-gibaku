// SATU GRUP WHATSAPP HANYA BOLEH MILIK SATU PAKET (DECISIONS 370).
//
// Temuan audit user 2026-08-19: `packages.wa_group_id` tanpa batasan apa pun,
// sementara pembacaannya memakai `findFirst()` atas beberapa varian tulisan.
// Dua paket yang menunjuk grup sama membuat paket mana yang menjawab ditentukan
// urutan baris di basis data.
//
// Ini bukan kebersihan master data. Akibatnya data paket A bisa terkirim ke
// grup paket B — dan tidak ada galat apa pun yang menandainya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { kanonikGrupId } = await import("@/lib/waha/grup-id");

const suffix = `giso${Date.now().toString(36)}`;
const GRUP = "120363000000009001@g.us";
let orgId = "";
let paketA = "";
let paketB = "";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ISO ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const a = await db.package.create({
    data: { orgId, name: `Paket A ${suffix}`, waGroupId: GRUP },
    select: { id: true },
  });
  const b = await db.package.create({
    data: { orgId, name: `Paket B ${suffix}` },
    select: { id: true },
  });
  paketA = a.id;
  paketB = b.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE packages, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("indeks unik grup → paket", () => {
  it("paket kedua TIDAK bisa memakai grup yang sama", async () => {
    await expect(
      db.package.update({ where: { id: paketB }, data: { waGroupId: GRUP } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("varian tulisan yang berbeda tetap tertangkap, karena disimpan kanonik", async () => {
    /*
     * Ini yang dulu lolos. "…:5@G.US" adalah teks yang berbeda dari
     * "…@g.us", jadi indeks unik atas nilai MENTAH tidak akan menghalanginya —
     * dan sesudah tersimpan, dua paket menunjuk satu grup yang sama.
     *
     * Yang menutupnya bukan indeksnya, melainkan kanonikalisasi SEBELUM simpan.
     */
    const kanonik = kanonikGrupId("120363000000009001:5@G.US")!;
    expect(kanonik).toBe(GRUP);
    await expect(
      db.package.update({ where: { id: paketB }, data: { waGroupId: kanonik } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("banyak paket TANPA grup tetap boleh — NULL bukan nilai yang bentrok", async () => {
    // Kalau ini gagal, indeksnya terlalu ketat dan seluruh paket baru (yang
    // memang belum punya grup) akan tertolak.
    const tanpa = await Promise.all([
      db.package.create({ data: { orgId, name: `Tanpa 1 ${suffix}` }, select: { id: true } }),
      db.package.create({ data: { orgId, name: `Tanpa 2 ${suffix}` }, select: { id: true } }),
      db.package.create({ data: { orgId, name: `Tanpa 3 ${suffix}` }, select: { id: true } }),
    ]);
    expect(tanpa).toHaveLength(3);
    const jumlah = await db.package.count({ where: { orgId, waGroupId: null } });
    expect(jumlah).toBeGreaterThanOrEqual(4); // paketB + 3 baru
  });

  it("grup boleh dipindah: dilepas dari A, lalu dipakai B", async () => {
    // Batasannya tidak boleh mengunci grup selamanya pada paket pertama —
    // paket berganti, dan admin harus tetap bisa memindahkannya.
    await db.package.update({ where: { id: paketA }, data: { waGroupId: null } });
    await db.package.update({ where: { id: paketB }, data: { waGroupId: GRUP } });

    const pemilik = await db.package.findUnique({
      where: { waGroupId: GRUP },
      select: { id: true },
    });
    expect(pemilik?.id).toBe(paketB);

    // Kembalikan supaya uji lain tidak bergantung pada urutan.
    await db.package.update({ where: { id: paketB }, data: { waGroupId: null } });
    await db.package.update({ where: { id: paketA }, data: { waGroupId: GRUP } });
  });

  it("pencarian pemilik grup memakai findUnique — satu jawaban, bukan 'yang pertama'", async () => {
    /*
     * `findUnique` hanya bisa dipanggil pada kolom unik. Bahwa panggilan ini
     * mengembalikan tepat satu paket adalah janji basis data, bukan kebetulan
     * urutan baris — dan itulah bedanya dengan `findFirst` yang dipakai dulu.
     */
    const pemilik = await db.package.findUnique({
      where: { waGroupId: kanonikGrupId(" 120363000000009001@G.US ")! },
      select: { id: true },
    });
    expect(pemilik?.id).toBe(paketA);
  });
});
