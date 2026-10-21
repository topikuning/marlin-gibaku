// KAWAL TAHAP 4 (DECISIONS 694): per sarana + aturan EWS `selisih_kawal` +
// ambang lewat AppSetting, basis data sungguhan, Kawal TIRUAN berisi data
// sintetis.
//
// Yang dijaga:
// - progres kelompok MARLIN di tabel per sarana SAMA dengan dokumentasi foto
//   per sarana (satu rumus, DECISIONS 683);
// - usulan dari nama hanya usulan; keputusan orang tersimpan, ter-audit, dan
//   menang; hanya `kawal.manage` yang boleh memutuskan;
// - EWS menyala dari tarikan Kawal terbaru dengan ambang yang berlaku;
// - ambang yang tidak sah ditolak, tidak tersimpan setengah.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { barisKawal, responsKawal } from "../fixtures/kawal-sintetis";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.AI_SECRET_ENCRYPTION_KEY = "kunci-uji-kawal-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Siapa yang sedang login saat server action dipanggil. */
let sesi: "pd" | "pelaksana" = "pd";
const orang: Record<string, string> = {};

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireUser: async () => pengguna(),
    // Kapabilitas TETAP diperiksa – yang ditiru hanya cookie sesinya.
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      const u = await pengguna();
      if (!can(u.role, cap)) throw new asli.ForbiddenError();
      return u;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { sinkronKawal } = await import("@/lib/kawal/sinkron");
const { setAkunKawal, getAmbangKawal, KAWAL_AMBANG_TINGGI_KEY, KAWAL_AMBANG_KRITIS_KEY } = await import(
  "@/lib/kawal/setelan"
);
const { kawalUntukLokasi } = await import("@/lib/kawal/queries");
const { kelompokMarlinKini, perSaranaKawal } = await import("@/lib/kawal/sarana");
const { petaSaranaKawalAction, ambangKawalAction } = await import("@/lib/kawal/peta-actions");
const { susunDokumentasiSarpras } = await import("@/lib/dokumentasi-sarpras/susun");
const { bangunEws } = await import("@/lib/ews/builder");

async function pengguna() {
  return db.user.findUniqueOrThrow({
    where: { id: orang[sesi]! },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

const suffix = `k4${Date.now().toString(36)}`;
const DAY = 24 * 3600 * 1000;
const hariIni = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
const geser = (n: number) => new Date(hariIni.getTime() + n * DAY);
let locationId = "";
let slug = "";

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

/** RAB: I Persiapan, II Dermaga, III Gudang Beku – nama sintetis. */
type Simpul = { key: string; kind: "kategori" | "item"; code: string; name: string; parent?: string; vol?: number; price?: number };
const POHON: Simpul[] = [
  { key: "I", kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN" },
  { key: "I#1", kind: "item", code: "1", name: "Mobilisasi", parent: "I", vol: 1, price: 20_000_000 },
  { key: "II", kind: "kategori", code: "II", name: "PEKERJAAN DERMAGA" },
  { key: "II#1", kind: "item", code: "1", name: "Tiang pancang", parent: "II", vol: 40, price: 1_000_000 },
  { key: "II#2", kind: "item", code: "2", name: "Lantai dermaga", parent: "II", vol: 20, price: 2_000_000 },
  { key: "III", kind: "kategori", code: "III", name: "PEKERJAAN GUDANG BEKU" },
  { key: "III#1", kind: "item", code: "1", name: "Panel", parent: "III", vol: 10, price: 2_000_000 },
];
const amt = (s: Simpul) => BigInt((s.vol ?? 0) * (s.price ?? 0));
const totalDi = (root: string) =>
  POHON.filter((s) => s.kind === "item" && s.key.startsWith(`${root}#`)).reduce((a, s) => a + amt(s), 0n);

beforeAll(async () => {
  await db.$executeRawUnsafe(
    "TRUNCATE TABLE kawal_sarana_maps, kawal_sarana_snapshots, kawal_location_snapshots, kawal_snapshots, kawal_location_maps, kawal_sync_runs",
  );
  await db.appSetting.deleteMany({ where: { key: { startsWith: "kawal." } } });
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  for (const [tag, role] of [
    ["pd", "program_director"],
    ["pelaksana", "field_supervisor"],
  ] as const) {
    orang[tag] = (
      await db.user.create({
        data: { orgId: org.id, username: `${tag}-${suffix}`, fullName: tag.toUpperCase(), passwordHash: "x", role },
      })
    ).id;
  }
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Uji ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  const grand = totalDi("I") + totalDi("II") + totalDi("III");
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR/K4/${suffix}`,
      contractValue: grand,
      signedDate: geser(-40),
      durationDays: 140,
      startDate: geser(-35),
      endDate: geser(104),
    },
  });
  slug = `bajo-${suffix}`;
  locationId = (
    await db.location.create({
      data: {
        packageId: pkg.id,
        name: "Bajo",
        slug,
        village: "Bajo",
        regency: "Kabupaten Contoh",
        province: "Provinsi Contoh",
        status: "berjalan",
      },
    })
  ).id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: grand },
  });
  const idOf = new Map<string, string>();
  let sort = 0;
  for (const s of POHON) {
    const isItem = s.kind === "item";
    const n = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: s.parent ? idOf.get(s.parent) : null,
        kind: s.kind,
        code: s.code,
        name: s.name,
        amount: isItem ? amt(s) : totalDi(s.key),
        lineageKey: s.key,
        sortOrder: sort++,
        ...(isItem ? { volume: s.vol, unit: "m3", unitPrice: s.price } : {}),
      },
      select: { id: true },
    });
    idOf.set(s.key, n.id);
  }
  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: 140 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / 20) * 100 })),
  });
  // Mobilisasi tuntas, dermaga separuh tiang pancang – progres MARLIN ≈ 30%.
  const rep = await db.dailyReport.create({
    data: { locationId, reportDate: geser(-3), status: "final", createdById: orang.pd!, weather: "cerah" },
  });
  for (const [k, v] of [
    ["I#1", 1],
    ["II#1", 20],
  ] as const) {
    const s = POHON.find((x) => x.key === k)!;
    await db.dailyReportItem.create({
      data: {
        reportId: rep.id,
        rabNodeId: idOf.get(k)!,
        lineageKey: k,
        basis: "aktif",
        volumeDone: v,
        valueDone: BigInt(v * (s.price ?? 0)),
        reportedById: orang.pd!,
      },
    });
  }

  // Kawal: satu lokasi yang menunjuk Bajo, progres pengawas 6%.
  await setAkunKawal({ alamat: "https://kawal.contoh.test", akun: "kontraktor@contoh.test", sandi: "rahasia" });
  respons = responsKawal([
    barisKawal({ id: 1, desa: "Desa Bajo", kabupaten: "Kab. Contoh", kontrak: `ktr/k4/${suffix}`, actual: 6 }),
  ]);
  const r = await sinkronKawal({ pemicu: "manual", olehId: orang.pd, fetchFn: fetchTiruan });
  expect(r, JSON.stringify(r)).toMatchObject({ status: "berhasil" });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    "TRUNCATE TABLE kawal_sarana_maps, kawal_sarana_snapshots, kawal_location_snapshots, kawal_snapshots, kawal_location_maps, kawal_sync_runs",
  );
  await db.appSetting.deleteMany({ where: { key: { startsWith: "kawal." } } });
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE slug = 'org-${suffix}'`).catch(() => null);
  await db.$disconnect();
});

const form = (isi: Record<string, string | number>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, String(v));
  return f;
};

async function saranaTerbaru() {
  const k = (await kawalUntukLokasi([locationId])).get(locationId)!;
  return k.sarana;
}

describe("per sarana Kawal vs kelompok RAB MARLIN", () => {
  it("progres kelompok = progres sarana di dokumentasi foto (satu rumus)", async () => {
    const kelompok = await kelompokMarlinKini(locationId);
    const dok = (await susunDokumentasiSarpras(locationId))!;
    expect(kelompok.map((k) => [k.kunci, k.progresPct])).toEqual(dok.sarpras.map((s) => [s.kunci, s.progresKini]));
    expect(kelompok.map((k) => k.kunci)).toEqual(["I", "II", "III"]);
    expect(kelompok.find((k) => k.kunci === "I")!.progresPct).toBeCloseTo(100, 6);
  });

  it("usulan dari nama: Dermaga → II, Gudang Beku → III; selisih MARLIN − Kawal", async () => {
    const h = await perSaranaKawal(locationId, await saranaTerbaru());
    expect(h.baris.map((b) => [b.sarana.nama, b.kelompok?.kunci, b.asal])).toEqual([
      ["Dermaga", "II", "usulan"],
      ["Gudang Beku", "III", "usulan"],
    ]);
    const dermaga = h.baris[0]!;
    // Kawal sintetis: Dermaga 40%. MARLIN II: tiang pancang 20/40 × 40 jt dari 80 jt = 25%.
    expect(dermaga.kelompok!.progresPct).toBeCloseTo(25, 6);
    expect(dermaga.selisihPp).toBe(-15);
    expect(h.kelompokTanpaPasangan.map((k) => k.kunci)).toEqual(["I"]);
  });

  it("hanya kawal.manage yang boleh memutuskan", async () => {
    const [dermaga] = await saranaTerbaru();
    sesi = "pelaksana";
    const r = await petaSaranaKawalAction(
      undefined,
      form({ aksi: "pasangkan", locationId, kawalItemId: dermaga!.kawalItemId, lineageKey: "I" }),
    );
    sesi = "pd";
    expect(r?.error).toMatch(/izin/);
    expect(await db.kawalSaranaMap.count({ where: { locationId } })).toBe(0);
  });

  it("keputusan orang tersimpan, ter-audit, dan menang atas usulan; kembalikan = usulan lagi", async () => {
    const [dermaga, gudang] = await saranaTerbaru();
    const a = await petaSaranaKawalAction(
      undefined,
      form({ aksi: "pasangkan", locationId, kawalItemId: dermaga!.kawalItemId, lineageKey: "I" }),
    );
    expect(a?.success).toContain("Dermaga dipasangkan dengan PEKERJAAN PERSIAPAN");
    const b = await petaSaranaKawalAction(
      undefined,
      form({ aksi: "tidak_ada", locationId, kawalItemId: gudang!.kawalItemId }),
    );
    expect(b?.success).toContain("tidak ada padanannya");

    let h = await perSaranaKawal(locationId, await saranaTerbaru());
    expect(h.baris.map((x) => [x.sarana.nama, x.kelompok?.kunci ?? null, x.asal])).toEqual([
      ["Dermaga", "I", "dikonfirmasi"],
      ["Gudang Beku", null, "tidak_ada"],
    ]);
    const jejak = await db.auditLog.findMany({
      where: { action: "kawal.peta_sarana", resourceId: locationId },
      orderBy: { createdAt: "asc" },
    });
    expect(jejak.map((j) => (j.payload as { aksi: string }).aksi)).toEqual(["pasangkan", "tidak_ada"]);

    const c = await petaSaranaKawalAction(
      undefined,
      form({ aksi: "kembalikan", locationId, kawalItemId: dermaga!.kawalItemId }),
    );
    expect(c?.success).toContain("usulan otomatis");
    h = await perSaranaKawal(locationId, await saranaTerbaru());
    expect(h.baris[0]).toMatchObject({ asal: "usulan", kelompok: { kunci: "II" } });
  });

  it("kelompok harus kategori RAB aktif lokasi ini; sarana harus ada di tarikan terbaru", async () => {
    const [dermaga] = await saranaTerbaru();
    const bukanKategori = await petaSaranaKawalAction(
      undefined,
      form({ aksi: "pasangkan", locationId, kawalItemId: dermaga!.kawalItemId, lineageKey: "II#1" }),
    );
    expect(bukanKategori?.error).toMatch(/tidak ada di RAB aktif/);
    const saranaAsing = await petaSaranaKawalAction(
      undefined,
      form({ aksi: "pasangkan", locationId, kawalItemId: 999_999, lineageKey: "II" }),
    );
    expect(saranaAsing?.error).toMatch(/tidak ada lagi di data Kawal/);
  });

  it("CHECK basis data: tidak_ada tanpa kelompok, dikonfirmasi wajib berkelompok", async () => {
    await expect(
      db.kawalSaranaMap.create({ data: { locationId, kawalItemId: 77, status: "tidak_ada", lineageKey: "I" } }),
    ).rejects.toThrow();
    await expect(db.kawalSaranaMap.create({ data: { locationId, kawalItemId: 78, status: "dikonfirmasi" } })).rejects.toThrow();
    await expect(
      db.kawalSaranaMap.create({ data: { locationId, kawalItemId: 79, status: "otomatis", lineageKey: "I" } }),
    ).rejects.toThrow();
  });
});

describe("ambang + aturan EWS selisih_kawal", () => {
  const selisihKawal = async () => (await bangunEws(await pengguna())).filter((w) => w.ruleId === "selisih_kawal");

  it("bawaan 5/10: MARLIN ≈ 30% lawan Kawal 6% → kritis, arah ditulis, menunjuk tab Kawal", async () => {
    expect(await getAmbangKawal()).toEqual({ tinggiPp: 5, kritisPp: 10 });
    const w = await selisihKawal();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "kritis", kategori: "progress", href: `/lokasi/${slug}/kawal`, locationSlug: slug });
    expect(w[0]!.alasan).toContain("MARLIN lebih tinggi");
    expect(w[0]!.alasan).toContain("Kawal 6,00%");
  });

  it("ambang yang disimpan dipakai EWS; yang tidak sah ditolak tanpa mengubah apa pun", async () => {
    const tolak = await ambangKawalAction(undefined, form({ tinggiPp: "10", kritisPp: "5" }));
    expect(tolak?.error).toBeTruthy();
    expect(await getAmbangKawal()).toEqual({ tinggiPp: 5, kritisPp: 10 });

    sesi = "pelaksana";
    const tanpaIzin = await ambangKawalAction(undefined, form({ tinggiPp: "20", kritisPp: "40" }));
    sesi = "pd";
    expect(tanpaIzin?.error).toMatch(/izin/);

    const ok = await ambangKawalAction(undefined, form({ tinggiPp: "20", kritisPp: "40,5" }));
    expect(ok?.success).toContain("kritis 40,5 pp");
    expect(await getAmbangKawal()).toEqual({ tinggiPp: 20, kritisPp: 40.5 });
    expect((await selisihKawal())[0]?.severity).toBe("tinggi");

    await ambangKawalAction(undefined, form({ tinggiPp: "50", kritisPp: "60" }));
    expect(await selisihKawal()).toEqual([]);
    // Dua simpanan sah = dua jejak; penolakan tidak menulis apa pun.
    expect(await db.auditLog.count({ where: { action: "kawal.ambang", userId: orang.pd } })).toBe(2);
  });

  it("setelan rusak (sebelah hilang) → kembali ke bawaan sepasang", async () => {
    await db.appSetting.deleteMany({ where: { key: KAWAL_AMBANG_KRITIS_KEY } });
    expect(await db.appSetting.count({ where: { key: KAWAL_AMBANG_TINGGI_KEY } })).toBeGreaterThan(0);
    expect(await getAmbangKawal()).toEqual({ tinggiPp: 5, kritisPp: 10 });
  });

  it("pagar minggu-0: lokasi yang belum dikerjakan tidak dinilai", async () => {
    await db.location.update({ where: { id: locationId }, data: { status: "persiapan" } });
    expect(await selisihKawal()).toEqual([]);
    await db.location.update({ where: { id: locationId }, data: { status: "berjalan" } });
  });
});
