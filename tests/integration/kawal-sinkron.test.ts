// SINKRON KAWAL KNMP TAHAP 2 (DECISIONS 690).
//
// Lewat titik masuk yang dipakai cron & tombol (`sinkronKawal`), terhadap
// Kawal TIRUAN (alur masuk sama dengan uji sambungan sungguhan: GET / → POST
// /login 302 → API JSON). Yang dijaga:
// - data pribadi tidak pernah tersimpan;
// - baris tanpa petunjuk lokasi MARLIN dibuang, hanya dihitung;
// - pasangan otomatis hanya bila buktinya tunggal, sisanya antre;
// - isi yang sama tidak membuat snapshot baru (idempoten);
// - bentuk berubah = gagal keras, tidak ada yang tersimpan setengah;
// - snapshot append-only.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { barisKawal, RAHASIA, responsKawal } from "../fixtures/kawal-sintetis";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.AI_SECRET_ENCRYPTION_KEY = "kunci-uji-kawal-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { sinkronKawal } = await import("@/lib/kawal/sinkron");
const { setAkunKawal, KAWAL_ALAMAT_KEY, KAWAL_AKUN_KEY, KAWAL_SANDI_KEY } = await import("@/lib/kawal/setelan");
const { kawalUntukLokasi } = await import("@/lib/kawal/queries");

const suffix = `kw${Date.now().toString(36)}`;
const FORM = `<html><head><meta name="csrf-token" content="t"></head><body>
<form method="post" action="/login"><input type="hidden" name="_token" value="t">
<input type="email" name="email"><input type="password" name="password"></form></body></html>`;

let respons: unknown = null;
const fetchTiruan = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const cookie = new Headers(init?.headers).get("cookie") ?? "";
  const html = (s: string, h: Record<string, string> = {}) =>
    new Response(s, { status: 200, headers: { "content-type": "text/html", ...h } });
  if (url.pathname === "/" || (url.pathname === "/login" && (init?.method ?? "GET") === "GET")) {
    return html(FORM, { "set-cookie": "sesi=tamu; Path=/" });
  }
  if (url.pathname === "/login") {
    return new Response(null, { status: 302, headers: { location: "/knmp", "set-cookie": "sesi=masuk; Path=/" } });
  }
  if (url.pathname === "/knmp") return html("<html>Peta</html>");
  if (url.pathname === "/api/knmp/locations" && cookie.includes("sesi=masuk")) {
    return new Response(JSON.stringify(respons), { status: 200, headers: { "content-type": "application/json" } });
  }
  return html(FORM);
}) as typeof fetch;

const ids = { orgId: "", lokasiA: "", lokasiB: "", lokasiC: "" };

async function bersihKawal() {
  await db.$executeRawUnsafe(
    "TRUNCATE TABLE kawal_sarana_snapshots, kawal_location_snapshots, kawal_snapshots, kawal_location_maps, kawal_sync_runs",
  );
  await db.appSetting.deleteMany({ where: { key: { in: [KAWAL_ALAMAT_KEY, KAWAL_AKUN_KEY, KAWAL_SANDI_KEY] } } });
}

beforeAll(async () => {
  await bersihKawal();
  const org = await db.organization.create({ data: { name: `Org KW ${suffix}`, slug: `kw-${suffix}` } });
  ids.orgId = org.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: "PT Contoh" } });
  const p1 = await db.package.create({ data: { orgId: org.id, name: `Paket 1 ${suffix}`, stage: "pelaksanaan" } });
  const p2 = await db.package.create({ data: { orgId: org.id, name: `Paket 2 ${suffix}`, stage: "pelaksanaan" } });
  for (const [pkg, nomor] of [
    [p1, `KTR/A/${suffix}`],
    [p2, `KTR/B/${suffix}`],
  ] as const) {
    await db.contract.create({
      data: {
        packageId: pkg.id,
        vendorId: vendor.id,
        contractNumber: nomor,
        contractValue: 1_000_000_000n,
        signedDate: new Date("2026-07-20"),
      },
    });
  }
  const lokasi = (packageId: string, nama: string, desa: string, kab: string) =>
    db.location.create({
      data: {
        packageId,
        name: nama,
        slug: `${desa.toLowerCase()}-${suffix}`,
        village: desa,
        regency: kab,
        province: "Provinsi Contoh",
      },
    });
  ids.lokasiA = (await lokasi(p1.id, "Bajo", "Bajo", "Kabupaten Contoh")).id;
  ids.lokasiB = (await lokasi(p1.id, "Ketapang", "Ketapang", "Contoh")).id;
  await lokasi(p1.id, "Pasir Putih", "Pasir Putih", "Contoh");
  // Paket 2: satu lokasi, nama & desanya ditulis lain dari Kawal.
  ids.lokasiC = (await lokasi(p2.id, "Lokasi C", "Sumbermakmur", "Contoh")).id;
  await setAkunKawal({ alamat: "https://kawal.contoh.test", akun: "kontraktor@contoh.test", sandi: "rahasia" });
});

afterAll(async () => {
  await bersihKawal();
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const RESPON_DASAR = () =>
  responsKawal([
    barisKawal({ id: 1, desa: "Desa Bajo", kabupaten: "Kab. Contoh", kontrak: `ktr/a/${suffix}`, actual: 6 }),
    barisKawal({ id: 2, desa: "Ketapang", kabupaten: "Kabupaten Contoh", kontrak: `KTR/A/${suffix}`, actual: 9 }),
    barisKawal({ id: 3, desa: "Sumber Makmur", kabupaten: "Contoh", kontrak: `KTR/B/${suffix}` }),
    // Nama sama di kabupaten lain, tanpa kontrak yang cocok → antrean.
    barisKawal({ id: 4, desa: "Pasir Putih", kabupaten: "Kabupaten Seberang", kontrak: "KTR/LAIN/1" }),
    // Milik entitas lain sama sekali → dibuang.
    barisKawal({ id: 5, desa: "Jauh", kabupaten: "Entah", kontrak: "KTR/LAIN/2" }),
  ]);

describe("sinkron Kawal", () => {
  it("tanpa akun: tidak menulis apa pun", async () => {
    await db.appSetting.deleteMany({ where: { key: KAWAL_SANDI_KEY } });
    const r = await sinkronKawal({ pemicu: "cron", fetchFn: fetchTiruan });
    expect(r.status).toBe("belum_diatur");
    expect(await db.kawalSyncRun.count()).toBe(0);
    await setAkunKawal({ alamat: "https://kawal.contoh.test", akun: "kontraktor@contoh.test", sandi: "rahasia" });
  });

  it("tarikan pertama: berpasangan otomatis, antre, dibuang – dan snapshot tersimpan", async () => {
    respons = RESPON_DASAR();
    const r = await sinkronKawal({ pemicu: "cron", fetchFn: fetchTiruan });
    expect(r).toMatchObject({ status: "berhasil", diterima: 5, berpasangan: 3, pasanganBaru: 3, antre: 1, dibuang: 1 });

    const peta = await db.kawalLocationMap.findMany({ orderBy: { kawalId: "asc" } });
    expect(peta.map((p) => [p.kawalId, p.locationId, p.status, p.basis])).toEqual([
      [1, ids.lokasiA, "otomatis", "kontrak_desa"],
      [2, ids.lokasiB, "otomatis", "kontrak_desa"],
      [3, ids.lokasiC, "otomatis", "kontrak_satu_lokasi"],
    ]);

    const snap = await db.kawalSnapshot.findFirstOrThrow({ include: { lokasi: { include: { sarana: true } } } });
    expect(snap.rowCount).toBe(5);
    expect(snap.storedCount).toBe(4);
    expect(snap.lokasi.map((l) => l.kawalId).sort()).toEqual([1, 2, 3, 4]);
    const satu = snap.lokasi.find((l) => l.kawalId === 1)!;
    expect(Number(satu.actualPct)).toBe(6);
    expect(satu.weekNo).toBe(12);
    expect(satu.mulai?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(satu.sarana.map((s) => s.nama).sort()).toEqual(["Dermaga", "Gudang Beku"]);

    const run = await db.kawalSyncRun.findFirstOrThrow({ where: { id: r.runId } });
    expect(run).toMatchObject({ outcome: "berhasil", rowCount: 5, matchedCount: 3, queueCount: 1, discardedCount: 1 });
  });

  it("tidak ada satu pun nilai pribadi atau baris yang dibuang di basis data", async () => {
    const isi = JSON.stringify(
      await db.$queryRawUnsafe(
        `SELECT row_to_json(t)::text AS j FROM (
           SELECT * FROM kawal_location_snapshots) t
         UNION ALL SELECT row_to_json(s)::text FROM kawal_sarana_snapshots s
         UNION ALL SELECT row_to_json(r)::text FROM kawal_sync_runs r`,
      ),
    );
    for (const v of Object.values(RAHASIA)) expect(isi, v).not.toContain(v);
    expect(isi).not.toContain("rahasia.jpg");
    expect(isi).not.toContain("KTR/LAIN/2");
    expect(isi).not.toContain("Jauh");
  });

  it("isi sama → tidak ada snapshot baru (idempoten), putarannya tetap tercatat", async () => {
    const r = await sinkronKawal({ pemicu: "manual", fetchFn: fetchTiruan });
    expect(r.status).toBe("tidak_berubah");
    expect(await db.kawalSnapshot.count()).toBe(1);
    // Urutan baris dari Kawal tidak mengubah hash.
    respons = { ...RESPON_DASAR(), data: [...(RESPON_DASAR().data as unknown[])].reverse() };
    expect((await sinkronKawal({ pemicu: "cron", fetchFn: fetchTiruan })).status).toBe("tidak_berubah");
    expect(await db.kawalSyncRun.count()).toBe(3);
  });

  it("angka berubah → snapshot baru; snapshot lama tetap utuh", async () => {
    const data = RESPON_DASAR();
    (data.data as Record<string, unknown>[])[0].progres_final = 7.25;
    respons = data;
    const r = await sinkronKawal({ pemicu: "cron", fetchFn: fetchTiruan });
    expect(r.status).toBe("berhasil");
    expect(r.pasanganBaru).toBe(0);
    const nilai = await db.kawalLocationSnapshot.findMany({
      where: { kawalId: 1 },
      orderBy: { snapshot: { capturedAt: "asc" } },
      select: { actualPct: true },
    });
    expect(nilai.map((n) => Number(n.actualPct))).toEqual([6, 7.25]);
  });

  it("bentuk berubah → gagal keras, tidak ada yang tersimpan, sebabnya menyebut field", async () => {
    const sebelum = await db.kawalSnapshot.count();
    const data = RESPON_DASAR();
    delete (data.data as Record<string, unknown>[])[2].target_fisik;
    respons = data;
    const r = await sinkronKawal({ pemicu: "cron", fetchFn: fetchTiruan });
    expect(r.status).toBe("gagal");
    expect(r.pesan).toContain("target_fisik tidak ada");
    expect(await db.kawalSnapshot.count()).toBe(sebelum);
    const run = await db.kawalSyncRun.findFirstOrThrow({ where: { id: r.runId } });
    expect(run.outcome).toBe("gagal");
    expect(run.error).toContain("Bentuk data Kawal berubah");
  });

  it("putaran yang tumpang tindih ditolak; putaran basi ditutup sebagai gagal", async () => {
    respons = RESPON_DASAR();
    const jalan = await db.kawalSyncRun.create({ data: { outcome: "berjalan", trigger: "cron" } });
    expect((await sinkronKawal({ pemicu: "manual", fetchFn: fetchTiruan })).status).toBe("sedang_berjalan");

    const nanti = new Date(Date.now() + 11 * 60_000);
    const r = await sinkronKawal({ pemicu: "manual", fetchFn: fetchTiruan, now: nanti });
    expect(r.status).not.toBe("sedang_berjalan");
    const basi = await db.kawalSyncRun.findUniqueOrThrow({ where: { id: jalan.id } });
    expect(basi).toMatchObject({ outcome: "gagal", error: "Putaran terhenti sebelum selesai." });
  });

  it("data Kawal per lokasi: angka TERBARU, hanya lokasi yang berpasangan", async () => {
    const per = await kawalUntukLokasi([ids.lokasiA, ids.lokasiB, ids.lokasiC]);
    expect([...per.keys()].sort()).toEqual([ids.lokasiA, ids.lokasiB, ids.lokasiC].sort());
    // Riwayat lokasi A: 6 → 7,25 → 6 (putaran terakhir di uji sebelumnya
    // menarik data dasar lagi). Yang dipakai harus snapshot TERBARU.
    const riwayat = await db.kawalLocationSnapshot.findMany({
      where: { kawalId: 1 },
      orderBy: { snapshot: { capturedAt: "asc" } },
      select: { actualPct: true },
    });
    expect(riwayat.map((r) => Number(r.actualPct))).toEqual([6, 7.25, 6]);
    expect(per.get(ids.lokasiA)).toMatchObject({ kawalId: 1, actualPct: 6, weekNo: 12 });
    expect(per.get(ids.lokasiA)!.sarana.map((x) => x.nama)).toEqual(["Dermaga", "Gudang Beku"]);
    // Pasangan "bukan MARLIN" tidak pernah muncul.
    await db.kawalLocationMap.update({ where: { kawalId: 2 }, data: { status: "bukan_marlin", locationId: null } });
    expect((await kawalUntukLokasi([ids.lokasiB])).size).toBe(0);
  });

  it("snapshot append-only: UPDATE dan DELETE ditolak basis data", async () => {
    const s = await db.kawalLocationSnapshot.findFirstOrThrow();
    await expect(db.kawalLocationSnapshot.update({ where: { id: s.id }, data: { namaKnmp: "x" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(db.kawalSnapshot.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
