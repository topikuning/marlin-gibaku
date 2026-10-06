// BACKUP VOLUME, ANALISA, BAHAN & UPAH IKUT TERSIMPAN SAAT IMPOR RAB
// (DECISIONS baru 2026-10-06).
//
// Teguran user: *"data awal yang aku berikan sudah ada sheet backup volume,
// tapi sama sekali tidak diproses"* dan *"begitu pula analisa, resume analisa
// dan item bahan dan upah, yang sama sekali tidak disimpan di marlin"*.
//
// Diuji lewat aksi server `importHps` apa adanya – pratinjau lalu simpan –
// dengan berkas KKP sungguhan. Yang dijaga:
//   1. pratinjau MENYEBUT berapa item yang tertaut, sebelum apa pun disimpan;
//   2. sesudah simpan, rincian tersimpan per item, terikat ke node revisinya;
//   3. angka resmi (volume, harga, nilai) tidak berubah sedikit pun karenanya.
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
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");

const NAMA = "mc0-karangmangu-blok-cco01-tkdn.xlsx";
const isi = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);
const berkas = () =>
  new File([new Uint8Array(isi)], NAMA, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const suffix = `rr${Date.now().toString(36)}`;
let lokasiId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RR ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `rr-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket RR ${suffix}`, stage: "pelaksanaan" } });
  const lok = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Karangmangu",
      slug: `karangmangu-${suffix}`,
      village: "Karangmangu",
      regency: "Rembang",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });
  lokasiId = lok.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("impor RAB menyimpan backup volume & analisa", () => {
  it("pratinjau menyebut rinciannya, simpan menuliskannya, angka resmi tidak berubah", async () => {
    const fdPratinjau = new FormData();
    fdPratinjau.set("locationId", lokasiId);
    fdPratinjau.set("mode", "aktifkan");
    fdPratinjau.set("file", berkas());
    const pratinjau = await importHps(undefined, fdPratinjau);
    expect(pratinjau?.error, `pratinjau gagal: ${pratinjau?.error}`).toBeUndefined();
    const r = pratinjau!.preview!.rincian!;
    expect(r.ringkasan.item).toBe(583);
    expect(r.ringkasan.volumeTertaut).toBeGreaterThan(500);
    expect(r.ringkasan.analisaRumus).toBeGreaterThan(500);
    expect(r.tersembunyiDibaca).toEqual(["14. Vol Genset"]);
    // Pratinjau TIDAK menyimpan apa pun.
    expect(await db.rabRincianRevisi.count({ where: { revision: { locationId: lokasiId } } })).toBe(0);

    const fdSimpan = new FormData();
    fdSimpan.set("locationId", lokasiId);
    fdSimpan.set("mode", "aktifkan");
    fdSimpan.set("file", berkas());
    fdSimpan.set("confirm", "1");
    fdSimpan.set("previewSha", pratinjau!.preview!.sha256);
    const simpan = await importHps(undefined, fdSimpan);
    expect(simpan?.error, `simpan gagal: ${simpan?.error}`).toBeUndefined();
    expect(simpan?.success ?? "").toMatch(/Backup volume tersimpan untuk \d+ item/);

    const rev = await db.rabRevision.findFirstOrThrow({ where: { locationId: lokasiId, status: "aktif" } });
    const ringkas = await db.rabRincianRevisi.findUniqueOrThrow({ where: { revisionId: rev.id } });
    expect(ringkas.asal).toBe("impor");
    expect(ringkas.tersembunyiDibaca).toEqual(["14. Vol Genset"]);

    const items = await db.rabNode.count({ where: { revisionId: rev.id, kind: "item" } });
    expect(await db.rabBackupVolume.count({ where: { revisionId: rev.id } })).toBe(items);

    // Item baris 104 (beton revetment) → '2. Vol Revetment'!M23.
    const { parsed } = await parseHpsBuffer(isi);
    const flat = flattenParsedRab(parsed);
    const n104 = flat.find((n) => n.excelRow === 104)!;
    const bv = await db.rabBackupVolume.findUniqueOrThrow({
      where: { revisionId_lineageKey: { revisionId: rev.id, lineageKey: n104.lineageKey } },
    });
    expect(bv.status).toBe("tertaut");
    expect(bv.sumber).toEqual([{ sheet: "2. Vol Revetment", sel: "M23", tersembunyi: false, nilai: 8.7 }]);

    // Item baris 75 (batu belah) → analisa 2.2.2.1.2 dengan 6 komponen.
    const n75 = flat.find((n) => n.excelRow === 75)!;
    const ia = await db.rabItemAnalisa.findUniqueOrThrow({
      where: { revisionId_lineageKey: { revisionId: rev.id, lineageKey: n75.lineageKey } },
      include: { analisa: { include: { komponen: { orderBy: { urutan: "asc" } } } } },
    });
    expect(ia.cara).toBe("rumus");
    expect(ia.analisa.kode).toBe("2.2.2.1.2");
    expect(ia.analisa.komponen.map((k) => k.nama)).toEqual([
      "Batu Belah",
      "Semen",
      "Pasir pasang",
      "Pekerja",
      "Tukang batu",
      "Mandor",
    ]);
    expect(await db.rabHargaDasar.count({ where: { revisionId: rev.id } })).toBeGreaterThan(100);

    // Angka resmi = bacaan parser, tidak disentuh rincian.
    const node104 = await db.rabNode.findUniqueOrThrow({
      where: { revisionId_lineageKey: { revisionId: rev.id, lineageKey: n104.lineageKey } },
    });
    expect(Number(node104.volume)).toBe(n104.volume);
    expect(Number(node104.unitPrice)).toBe(n104.unitPrice);

    // RAPL: analisa KONTRAK jadi dasar (keputusan user 2026-10-06) – koefisien
    // dari berkas, satuannya satuan item, ditandai asalnya.
    const { itemUntukRapl } = await import("@/lib/ahsp/rapl");
    const rapl = await itemUntukRapl(lokasiId);
    const r75 = rapl.find((x) => x.lineageKey === n75.lineageKey)!;
    expect(r75.analisa?.sumber).toBe("kontrak");
    expect(r75.analisa?.kode).toBe("2.2.2.1.2");
    expect(r75.analisa?.komponen.map((k) => [k.nama, k.koefisien])).toEqual([
      ["Batu Belah", 1.2],
      ["Semen", 252],
      ["Pasir pasang", 0.44],
      ["Pekerja", 1.5],
      ["Tukang batu", 0.5],
      ["Mandor", 0.15],
    ]);
    // Item tanpa analisa di berkas dan tanpa padanan AHSP: tetap tanpa analisa, tidak ditebak.
    const n13 = flat.find((n) => n.excelRow === 13)!;
    expect(rapl.find((x) => x.lineageKey === n13.lineageKey)!.analisa).toBeNull();

    // Harga satuan dasar: harga komponen analisa kontrak jadi BAWAAN, jadi
    // biaya item batu belah = volume × Σ(koef × harga) = nilai RAB sebelum
    // overhead 15%. Harga yang diisi orang untuk lokasi ini MENANG.
    const { keadaanItemRapl } = await import("@/lib/ahsp/rapl");
    const k1 = (await keadaanItemRapl(lokasiId)).item.find((x) => x.lineageKey === n75.lineageKey)!;
    expect(k1.sumberAnalisa).toBe("kontrak");
    expect(k1.komponen.filter((k) => k.harga === null).map((k) => `${k.kategori}/${k.nama}/${k.satuan}`)).toEqual([]);
    expect(k1.lengkap).toBe(true);
    const nilai = Number(k1.nilaiRab);
    // Selisih kecil wajar: harga dibulatkan ke rupiah per komponen, sedangkan
    // berkas membulatkan ke atas di tingkat harga satuan pekerjaan.
    expect(Math.abs(Number(k1.biaya) - nilai / 1.15) / (nilai / 1.15)).toBeLessThan(0.001);

    await db.hargaSatuanDasar.create({
      data: { locationId: lokasiId, kategori: "bahan", nama: "Semen", satuan: "kg", harga: 2000n, sumber: "survei toko" },
    });
    const k2 = (await keadaanItemRapl(lokasiId)).item.find((x) => x.lineageKey === n75.lineageKey)!;
    expect(k2.komponen.find((k) => k.nama === "Semen")!.harga).toBe(2000n);
    expect(k2.komponen.find((k) => k.nama === "Pekerja")!.harga).toBe(104729n);
  }, 300_000);
});
