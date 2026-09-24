// GERBANG EMPAT MATA AKTIVASI ADENDUM (DECISIONS 234).
//
// Keputusan user 2026-08-03: "pengaktifan adendum harus dua orang, program
// director dan satu orang di level yang ditugaskan bisa AM/SM/PM, bahkan super
// admin pun tidak boleh mengaktifkan sendiri."
//
// Aturannya sendiri diuji murni di tests/unit/adendum-persetujuan.test.ts.
// Yang diuji DI SINI: gerbangnya benar-benar terpasang di jalur database —
// termasuk penggugurannya saat draft berubah, dan pengecualian HPS awal.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Siapa yang sedang login saat server action dipanggil. */
let sesi = "sa";

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async () => pengguna(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { pastikanBolehAktivasi, setujuiRevisi, cabutPersetujuan, ringkasPersetujuan, PersetujuanError } =
  await import("@/lib/rab/persetujuan");
const { activateDraftAction, approveRevisionAction } = await import(
  "@/app/(app)/lokasi/[slug]/rab/actions",
);
const { addAmendment } = await import("@/lib/package/actions");

const suffix = `em${Date.now().toString(36)}`;
let locationId: string;
let orgId: string;
let packageId: string;
let nomorCco = 0;
const orang: Record<string, { id: string; role: never }> = {};

/** Pengguna sesi saat ini, dibaca dari DB supaya bentuknya persis SessionUser. */
async function pengguna() {
  return db.user.findUniqueOrThrow({
    where: { id: orang[sesi]!.id },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

async function buatUser(tag: string, role: string) {
  const u = await db.user.create({
    data: { orgId, username: `${tag}-${suffix}`, fullName: tag.toUpperCase(), passwordHash: "x", role: role as never },
  });
  orang[tag] = { id: u.id, role: role as never };
  return u.id;
}

/** Revisi + satu node, supaya totalValue-nya nyata. */
async function buatRevisi(no: number, status: "aktif" | "draft") {
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo: no,
      status,
      source: no === 1 ? "hps_awal" : "adendum",
      totalValue: 1_000_000n * BigInt(no),
      createdById: orang.pd!.id,
    },
  });
  return rev;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org EM ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket EM ${suffix}` } });
  packageId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });
  await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000_000n,
      durationDays: 180,
      signedDate: new Date("2026-06-01T00:00:00.000Z"),
    },
  });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Lokasi EM", slug: `lokasi-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
  await buatUser("pd", "program_director");
  await buatUser("am", "regional_manager");
  await buatUser("pm", "project_manager");
  await buatUser("sm", "site_manager");
  await buatUser("sa", "super_admin");
  await buatUser("mandor", "field_supervisor");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  await db.rabRevision.deleteMany({ where: { locationId } });
});

describe("KASUS INTI: adendum butuh dua tanda tangan", () => {
  it("tanpa persetujuan → aktivasi ditolak", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
  });

  it("PD saja → masih ditolak, pesannya menyebut yang kurang", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(/Area Manager/i);
  });

  it("SM saja → masih ditolak, pesannya menyebut Program Director", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.sm!);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(/Program Director/i);
  });

  it("PD + SM → lolos", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();
  });
});

describe("super admin tidak bisa mengaktifkan sendiri", () => {
  it("super_admin ditolak saat mencoba menandatangani", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(setujuiRevisi(draft.id, orang.sa!)).rejects.toThrow(/tidak berhak/i);
  });

  it("super_admin + PD tidak cukup – kursi penugasan tetap kosong", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await expect(setujuiRevisi(draft.id, orang.sa!)).rejects.toThrow();
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
  });

  it("mandor juga ditolak", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(setujuiRevisi(draft.id, orang.mandor!)).rejects.toThrow(/tidak berhak/i);
  });
});

describe("HPS awal bukan adendum", () => {
  it("belum ada RAB aktif → aktivasi tidak menuntut persetujuan", async () => {
    const draft = await buatRevisi(1, "draft");
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();
  });
});

describe("draft berubah → persetujuan gugur", () => {
  it("mengubah totalValue menggugurkan suara yang sudah masuk", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.am!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();

    // Editor menulis ulang totalValue tiap mutasi → updatedAt bergerak.
    await new Promise((r) => setTimeout(r, 10));
    await db.rabRevision.update({ where: { id: draft.id }, data: { totalValue: 9_999_999n } });

    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
    const r = await ringkasPersetujuan(draft.id);
    expect(r.berlaku).toHaveLength(0);
    expect(r.gugur.map((g) => g.nama).sort()).toEqual(["AM", "PD"]);
  });

  it("menyetujui ulang setelah perubahan memulihkan kelayakan", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.pm!);
    await new Promise((r) => setTimeout(r, 10));
    await db.rabRevision.update({ where: { id: draft.id }, data: { totalValue: 5_000_000n } });
    await new Promise((r) => setTimeout(r, 10));

    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.pm!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();
  });
});

describe("cabut persetujuan", () => {
  it("mencabut mengembalikan kunci", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    await expect(pastikanBolehAktivasi(draft.id)).resolves.toBeUndefined();

    await cabutPersetujuan(draft.id, orang.pd!);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(/Program Director/i);
  });

  it("mencabut yang belum pernah diberikan ditolak jelas", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await expect(cabutPersetujuan(draft.id, orang.sm!)).rejects.toThrow(/belum menyetujui/i);
  });
});

describe("GERBANGNYA TERPASANG di server action, bukan cuma ada", () => {
  // Aturan yang benar tapi tidak dipanggil sama saja dengan tidak ada. Blok ini
  // menembak `addAmendment` (pintu "Catat CCO", DECISIONS 613/614) dan
  // `activateDraftAction` (tombol Aktifkan lokasi) — supaya menghapus satu
  // baris gerbang empat mata di jalur mana pun membuat uji ini merah.
  const aktifkan = async (revisionId: string) => {
    const fd = new FormData();
    fd.set("packageId", packageId);
    fd.set("ccoNumber", `CCO-EM-${++nomorCco}`);
    fd.set("effectiveDate", "2026-08-01");
    fd.set("endDateDelta", "0");
    fd.set("reason", "Uji gerbang empat mata");
    fd.append("revisionIds", revisionId);
    return addAmendment(undefined, fd);
  };

  it("super_admin memberlakukan tanpa persetujuan → ditolak, draft tetap draft, tanpa CCO", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    sesi = "sa";
    const sebelum = await db.contractAmendment.count({ where: { contract: { packageId } } });
    const hasil = await aktifkan(draft.id);
    expect(hasil?.error).toMatch(/belum lengkap persetujuannya/i);
    expect(hasil?.success).toBeUndefined();
    const sesudah = await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(sesudah.status).toBe("draft");
    expect(await db.contractAmendment.count({ where: { contract: { packageId } } })).toBe(sebelum);
  });

  it("pesan penolakan menyebut peran yang kurang, bukan 'Terjadi kesalahan'", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    sesi = "sa";
    const hasil = await aktifkan(draft.id);
    expect(hasil?.error).toMatch(/Area Manager/i);
    expect(hasil?.error).not.toMatch(/^Terjadi kesalahan/);
  });

  it("dengan PD + SM → revisi aktif DAN tertaut ke CCO yang lahir bersamanya", async () => {
    const lama = await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    sesi = "sa";
    const hasil = await aktifkan(draft.id);
    // Regenerate baseline boleh gagal di lingkungan uji (revisi tanpa node);
    // yang diuji di sini adalah GERBANGNYA dan tautannya.
    expect(hasil?.error ?? "").not.toMatch(/belum lengkap/i);
    const sesudah = await db.rabRevision.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true, amendment: { select: { ccoNumber: true, valueDelta: true, valueDeltaRab: true } } },
    });
    expect(sesudah.status).toBe("aktif");
    expect(sesudah.amendment?.ccoNumber).toBe(`CCO-EM-${nomorCco}`);
    // 1 jt → 2 jt pra-PPN = +1 jt; PPN bawaan 11% → +1,11 jt.
    expect(sesudah.amendment?.valueDeltaRab).toBe(1_110_000n);
    expect(sesudah.amendment?.valueDelta).toBe(1_110_000n);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: lama.id } })).status).not.toBe("aktif");
  });

  it("nilai CCO yang DIKETIK dipakai apa adanya, turunan RAB tetap tersimpan", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    sesi = "sa";
    const fd = new FormData();
    fd.set("packageId", packageId);
    fd.set("ccoNumber", `CCO-EM-${++nomorCco}`);
    fd.set("effectiveDate", "2026-08-01");
    fd.set("endDateDelta", "14");
    fd.set("reason", "Selisih pembulatan dokumen");
    fd.set("valueDelta", "1.109.500");
    fd.append("revisionIds", draft.id);
    const hasil = await addAmendment(undefined, fd);
    expect(hasil?.error ?? hasil?.success).toMatch(/selisih/i);
    const a = await db.contractAmendment.findFirstOrThrow({
      where: { contract: { packageId }, ccoNumber: `CCO-EM-${nomorCco}` },
    });
    expect(a.valueDelta).toBe(1_109_500n);
    expect(a.valueDeltaRab).toBe(1_110_000n);
    expect(a.endDateDelta).toBe(14);
  });

  it("tombol Aktifkan per lokasi tetap tergembok empat mata", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    sesi = "sa";
    const fd = new FormData();
    fd.set("revisionId", draft.id);
    const hasil = await activateDraftAction(undefined, fd);
    expect(hasil?.error).toMatch(/butuh persetujuan DUA orang/i);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
  });

  it("dua persetujuan → Aktifkan per lokasi BERLAKU sekarang; CCO dicatat menyusul tanpa aktivasi ulang", async () => {
    // Koreksi user 2026-09-24 (DECISIONS 614): dua persetujuan = berlaku;
    // nomor CCO administrasi yang menyusul.
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    await setujuiRevisi(draft.id, orang.sm!);
    sesi = "sa";
    const fd = new FormData();
    fd.set("revisionId", draft.id);
    const hasil = await activateDraftAction(undefined, fd);
    expect(hasil?.error ?? "").not.toMatch(/butuh persetujuan/i);
    const aktif = await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(aktif.status).toBe("aktif");
    expect(aktif.awaitingCco).toBe(true);
    expect(aktif.amendmentId).toBeNull();

    const cco = await aktifkan(draft.id);
    expect(cco?.success ?? cco?.error).toMatch(/sudah berlaku kini bernomor CCO/);
    const sesudah = await db.rabRevision.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true, awaitingCco: true, amendment: { select: { ccoNumber: true, valueDeltaRab: true } } },
    });
    expect(sesudah.status).toBe("aktif");
    expect(sesudah.awaitingCco).toBe(false);
    expect(sesudah.amendment?.ccoNumber).toBe(`CCO-EM-${nomorCco}`);
    // Dasar selisih = RAB tercakup CCO sebelumnya (#1, 1 jt), bukan revisi
    // yang sedang aktif: +1 jt pra-PPN → +1,11 jt.
    expect(sesudah.amendment?.valueDeltaRab).toBe(1_110_000n);
  });

  it("CCO tanpa draft apa pun (waktu saja) tetap bisa dicatat", async () => {
    sesi = "sa";
    const fd = new FormData();
    fd.set("packageId", packageId);
    fd.set("ccoNumber", `CCO-EM-${++nomorCco}`);
    fd.set("effectiveDate", "2026-08-01");
    fd.set("endDateDelta", "30");
    fd.set("reason", "Perpanjangan waktu saja");
    const hasil = await addAmendment(undefined, fd);
    expect(hasil?.success).toMatch(/berlaku/i);
    const a = await db.contractAmendment.findFirstOrThrow({
      where: { contract: { packageId }, ccoNumber: `CCO-EM-${nomorCco}` },
    });
    expect(a.valueDelta).toBe(0n);
    expect(a.endDateDelta).toBe(30);
  });
});

describe("YANG MENANDATANGANI HARUS TAHU HASILNYA", () => {
  /*
   * Dilaporkan user 2026-09-12: Program Director menekan tombol, lalu yang
   * muncul hanya spanduk MERAH "butuh persetujuan DUA orang". Tidak ada
   * penanda bahwa tanda tangannya sendiri tercatat, dan tidak ada daftar siapa
   * yang sudah menyetujui.
   *
   * Penolakan yang benar tapi bisu soal apa yang BERHASIL membuat orang
   * menekan tombolnya berulang kali, lalu menyimpulkan sistemnya rusak. Empat
   * mata itu prosedur dua langkah; langkah pertama harus terasa selesai.
   */
  const setujui = async (revisionId: string) => {
    const fd = new FormData();
    fd.set("revisionId", revisionId);
    return approveRevisionAction(undefined, fd);
  };

  it("tanda tangan pertama berhasil DAN menyebut siapa yang masih ditunggu", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    sesi = "pd";
    const hasil = await setujui(draft.id);
    expect(hasil?.error).toBeUndefined();
    expect(hasil?.success).toMatch(/Anda setujui/i);
    expect(hasil?.success, "tidak menyebut siapa yang masih ditunggu").toMatch(
      /Area Manager|Project Manager|Site Manager/i,
    );
  });

  it("tanda tangan kedua mengatakan drafnya sudah siap diaktifkan", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.pd!);
    sesi = "sm";
    const hasil = await setujui(draft.id);
    expect(hasil?.success).toMatch(/siap diaktifkan/i);
  });
});

describe("satu orang = satu tanda tangan", () => {
  it("menyetujui dua kali tidak mengisi dua kursi", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiRevisi(draft.id, orang.sm!);
    await setujuiRevisi(draft.id, orang.sm!);
    expect(await db.rabRevisionApproval.count({ where: { revisionId: draft.id } })).toBe(1);
    await expect(pastikanBolehAktivasi(draft.id)).rejects.toThrow(PersetujuanError);
  });
});
