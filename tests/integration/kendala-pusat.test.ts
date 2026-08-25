// SATU PUSAT KENDALA (DECISIONS 392) — yang hanya bisa dibuktikan lewat DB.
//
// Modul murninya sudah diuji terpisah (`kendala-dari-kegiatan`,
// `kendala-pesan-tenggat`, `kendala-prioritas`, `kendala-duplikat`). Yang TIDAK
// bisa dibuktikan di sana justru bagian yang paling merusak kalau salah:
//
//  1. Kendala kegiatan lapangan benar-benar MENDARAT sebagai `Issue` yang bisa
//     ditagih — keadaan sebelumnya ia teks bebas yang tidak pernah muncul di
//     daftar mana pun.
//  2. Finalisasi ULANG (kegiatan dibuka lagi lalu difinalkan lagi) tidak
//     melahirkan kendala kembar, dan tidak MENIMPA kendala yang sudah diberi
//     PIC/tenggat oleh orang lain.
//  3. Penjaga duplikat menahan baris kedua — keluhan asli user: "Lahan belum
//     bisa clear" tercatat tiga kali.
//  4. Peredam pengingat WA tidak mengirim daftar yang sama tiap 24 jam.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => penggunaUji(),
    requireCapability: async () => penggunaUji(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

/** Pesan WA yang "terkirim" — dicegat supaya isinya bisa diperiksa. */
const terkirim: { chatId: string; teks: string }[] = [];
vi.mock("@/lib/waha/kirim", () => ({
  sendText: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return `wamid-${terkirim.length}`;
  },
}));

const { db } = await import("@/lib/db");
const { naikkanKendalaKegiatan } = await import("@/lib/kendala/naikkan");
const { kirimPengingatKendalaTerjadwal, JEDA_HARI } = await import(
  "@/lib/kendala/penjadwal-tenggat"
);
const { gabungkanKendala, updateIssueStatus, hapusKendala } = await import("@/lib/issues");
const { papanKendala } = await import("@/lib/kendala/queries");

/**
 * Pengguna uji — `super_admin` supaya `accessibleLocationIds` (yang TIDAK
 * dimock) benar-benar mencakup lokasi fixture. Melonggarkan lingkupnya lewat
 * mock akan membuat uji papan membuktikan mock-nya, bukan kuerinya.
 */
async function penggunaUji() {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, orgId: true, username: true, email: true,
      fullName: true, role: true, mustChangePassword: true,
    },
  });
}

const suffix = `kp${Date.now().toString(36)}`;
let packageId = "";
let locationId = "";
let userId = "";

/** Kegiatan draft baru — pengembalinya id-nya saja. */
async function kegiatan(kendala: string | null): Promise<string> {
  const fa = await db.fieldActivity.create({
    data: {
      locationId,
      type: "rapat",
      title: `Rapat ${Math.random().toString(36).slice(2, 8)}`,
      activityDate: new Date("2026-08-10"),
      status: "draft",
      kendala,
      createdById: userId,
    },
  });
  return fa.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({
    data: {
      orgId: org.id,
      name: `Paket ${suffix}`,
      stage: "pelaksanaan",
      waGroupId: `620000${suffix}@g.us`,
    },
  });
  packageId = pkg.id;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Kedungrejo ${suffix}`,
      slug: `lok-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `sm-${suffix}`,
      fullName: "Budi Uji",
      role: "super_admin",
      passwordHash: "x",
    },
  });
  userId = u.id;
});

beforeEach(async () => {
  terkirim.length = 0;
  await db.issue.deleteMany({ where: { locationId } });
  // TRUNCATE, bukan DELETE: `audit_logs` append-only dijaga trigger DB, dan
  // DELETE ditolak. Peredam pengingat MEMBACA tabel ini, jadi sisa dari uji
  // sebelumnya akan meredam uji berikutnya.
  await db.$executeRawUnsafe(`TRUNCATE TABLE audit_logs`);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE issues, daily_reports, field_activities, audit_logs, locations,
     packages, users, organizations RESTART IDENTITY CASCADE`,
  );
});

describe("kendala kegiatan lapangan dinaikkan jadi Issue", () => {
  it("mendarat sebagai Issue yang bisa ditagih, bukan teks bebas", async () => {
    const faId = await kegiatan("Lahan belum bisa clear, pemilik menolak alat masuk");
    const hasil = await naikkanKendalaKegiatan({
      activityId: faId,
      locationId,
      kendala: "Lahan belum bisa clear, pemilik menolak alat masuk",
      userId,
    });
    expect(hasil.jadi).toBe("dibuat");

    const issue = await db.issue.findFirstOrThrow({ where: { fieldActivityId: faId } });
    expect(issue.source).toBe("kegiatan_lapangan");
    expect(issue.status).toBe("terbuka");
    // Tautan balik ke kegiatannya harus ada — tanpa itu kendala tidak bisa
    // ditelusuri kembali ke catatan yang melahirkannya.
    expect(issue.fieldActivityId).toBe(faId);
  });

  it("'tidak ada kendala' TIDAK melahirkan apa pun", async () => {
    const faId = await kegiatan("-");
    const hasil = await naikkanKendalaKegiatan({
      activityId: faId,
      locationId,
      kendala: "-",
      userId,
    });
    expect(hasil.jadi).toBe("dilewati");
    expect(await db.issue.count({ where: { locationId } })).toBe(0);
  });

  it("REGRESI: finalisasi ULANG tidak menimpa PIC & tenggat yang sudah diisi", async () => {
    /*
     * Kegiatan bisa dibuka kembali lalu difinalkan lagi. Kalau jalur ini
     * menulis ulang Issue-nya, PIC dan tenggat yang sudah ditetapkan orang lain
     * hilang tanpa jejak — dan yang menetapkannya tidak akan pernah tahu.
     */
    const faId = await kegiatan("Akses jalan longsor");
    await naikkanKendalaKegiatan({
      activityId: faId,
      locationId,
      kendala: "Akses jalan longsor",
      userId,
    });
    const issue = await db.issue.findFirstOrThrow({ where: { fieldActivityId: faId } });
    await db.issue.update({
      where: { id: issue.id },
      data: { picName: "Pak Camat", dueDate: new Date("2026-08-25"), severity: "kritis" },
    });

    const ulang = await naikkanKendalaKegiatan({
      activityId: faId,
      locationId,
      kendala: "Akses jalan longsor DIPERBAIKI SENDIRI",
      userId,
    });
    expect(ulang.jadi).toBe("sudah_ada");

    const sesudah = await db.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(sesudah.picName).toBe("Pak Camat");
    expect(sesudah.severity).toBe("kritis");
    expect(await db.issue.count({ where: { fieldActivityId: faId } })).toBe(1);
  });

  it("REGRESI: kendala serupa yang MASIH TERBUKA tidak dicatat dua kali", async () => {
    // Keluhan asli user: "Lahan belum bisa clear" tiga kali, tanggal sama.
    const fa1 = await kegiatan("Lahan belum bisa clear");
    await naikkanKendalaKegiatan({
      activityId: fa1,
      locationId,
      kendala: "Lahan belum bisa clear",
      userId,
    });
    const fa2 = await kegiatan("Lahan belum clear");
    const kedua = await naikkanKendalaKegiatan({
      activityId: fa2,
      locationId,
      kendala: "Lahan belum clear",
      userId,
    });
    expect(kedua.jadi).toBe("duplikat");
    expect(await db.issue.count({ where: { locationId } })).toBe(1);
  });

  it("kendala yang sudah SELESAI tidak menahan kendala baru yang sama", async () => {
    /*
     * Masalah yang sama bisa kambuh. Menahannya karena pernah ada dan sudah
     * ditutup akan membuat kekambuhan tidak pernah tercatat.
     */
    const fa1 = await kegiatan("Air bersih tidak ada");
    await naikkanKendalaKegiatan({
      activityId: fa1,
      locationId,
      kendala: "Air bersih tidak ada",
      userId,
    });
    await db.issue.updateMany({
      where: { locationId },
      data: { status: "selesai", closedAt: new Date() },
    });

    const fa2 = await kegiatan("Air bersih tidak ada");
    const lagi = await naikkanKendalaKegiatan({
      activityId: fa2,
      locationId,
      kendala: "Air bersih tidak ada",
      userId,
    });
    expect(lagi.jadi).toBe("dibuat");
  });
});

describe("pengingat kendala lewat tenggat ke grup paket", () => {
  const KEMARIN = new Date("2026-08-14T00:00:00.000Z");
  const HARI_INI = new Date("2026-08-20T09:00:00.000Z");

  async function kendalaLewatTenggat(judul: string) {
    return db.issue.create({
      data: {
        locationId,
        title: judul,
        severity: "tinggi",
        status: "terbuka",
        dueDate: KEMARIN,
        picName: "Budi",
      },
    });
  }

  it("tidak ada yang lewat tenggat → grup TIDAK dikirimi apa pun", async () => {
    await db.issue.create({
      data: { locationId, title: "Belum jatuh tempo", severity: "sedang", status: "terbuka" },
    });
    const h = await kirimPengingatKendalaTerjadwal(HARI_INI);
    expect(h.terkirim).toBe(0);
    expect(terkirim).toHaveLength(0);
  });

  it("mengirim ke grup paket dan menyebut judul, lokasi, PIC, lama terlambat", async () => {
    await kendalaLewatTenggat("Lahan belum bisa clear");
    const h = await kirimPengingatKendalaTerjadwal(HARI_INI);
    expect(h.terkirim).toBe(1);
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].chatId).toContain("@g.us");
    expect(terkirim[0].teks).toContain("Lahan belum bisa clear");
    expect(terkirim[0].teks).toContain("Kedungrejo");
    expect(terkirim[0].teks).toContain("PIC Budi");
    expect(terkirim[0].teks).toContain("lewat 6 hari");
  });

  it("kendala yang sudah SELESAI tidak pernah ditagih, berapa pun tenggatnya", async () => {
    const i = await kendalaLewatTenggat("Sudah beres");
    await db.issue.update({
      where: { id: i.id },
      data: { status: "selesai", closedAt: new Date() },
    });
    const h = await kirimPengingatKendalaTerjadwal(HARI_INI);
    expect(h.terkirim).toBe(0);
  });

  it("REGRESI: daftar yang SAMA tidak dikirim ulang keesokan harinya", async () => {
    /*
     * Daftar kendala lewat tenggat hampir tidak berubah dari hari ke hari.
     * Mengirimnya tiap 24 jam adalah cara tercepat membuat grup berhenti
     * membaca peringatan MARLIN — dan saat itu terjadi, peringatan yang
     * sungguhan ikut hilang.
     */
    await kendalaLewatTenggat("Lahan belum bisa clear");
    expect((await kirimPengingatKendalaTerjadwal(HARI_INI)).terkirim).toBe(1);

    const besok = new Date("2026-08-21T09:00:00.000Z");
    const kedua = await kirimPengingatKendalaTerjadwal(besok);
    expect(kedua.terkirim).toBe(0);
    expect(kedua.diredam).toBe(1);
    expect(terkirim).toHaveLength(1);
  });

  it("daftar yang BERUBAH menembus peredam pada hari yang sama", async () => {
    await kendalaLewatTenggat("Lahan belum bisa clear");
    expect((await kirimPengingatKendalaTerjadwal(HARI_INI)).terkirim).toBe(1);

    await kendalaLewatTenggat("Material besi belum datang");
    const kedua = await kirimPengingatKendalaTerjadwal(HARI_INI);
    expect(kedua.terkirim).toBe(1);
    expect(terkirim).toHaveLength(2);
    expect(terkirim[1].teks).toContain("Material besi belum datang");
  });

  it("sesudah jeda, daftar yang sama boleh ditagih lagi", async () => {
    /*
     * Waktu kedua diambil dari CATATAN yang baru saja ditulis, bukan dari
     * tanggal yang diketik di sini.
     *
     * Peredamnya membandingkan `now` yang disuntik dengan `createdAt` baris
     * audit — dan `createdAt` itu jam DINDING sungguhan, bukan jam uji. Versi
     * sebelumnya menuliskan `2026-08-24` mati: hijau selama uji ini dijalankan
     * pada atau sebelum 2026-08-21, lalu merah dengan sendirinya begitu
     * kalender maju, tanpa satu baris kode pun berubah. Persis itu yang
     * terjadi — CI memerah di sini pada penggabungan yang tidak menyentuh
     * kendala sama sekali.
     *
     * Sidiknya sengaja TIDAK memuat `lewatHari` (lihat `sidikTenggat`), jadi
     * memajukan `now` tidak mengubah sidik: yang diuji tetap jedanya, bukan
     * daftar yang kebetulan berbeda.
     */
    await kendalaLewatTenggat("Lahan belum bisa clear");
    await kirimPengingatKendalaTerjadwal(HARI_INI);

    const catatan = await db.auditLog.findFirstOrThrow({
      where: { action: "kendala.pengingat_tenggat" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    // Sehari lewat ambang, supaya uji ini tidak bergantung pada presisi jam.
    const sesudahJeda = new Date(catatan.createdAt.getTime() + (JEDA_HARI + 1) * 86_400_000);

    expect((await kirimPengingatKendalaTerjadwal(sesudahJeda)).terkirim).toBe(1);
  });

  it("TEPAT sebelum jeda habis masih diredam", async () => {
    /*
     * Sisi sebaliknya, dan ia yang membuat uji di atas berarti: tanpa ini,
     * "boleh ditagih lagi" bisa hijau hanya karena peredamnya tidak pernah
     * bekerja sama sekali.
     */
    await kendalaLewatTenggat("Lahan belum bisa clear");
    await kirimPengingatKendalaTerjadwal(HARI_INI);

    const catatan = await db.auditLog.findFirstOrThrow({
      where: { action: "kendala.pengingat_tenggat" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const belumJeda = new Date(catatan.createdAt.getTime() + JEDA_HARI * 86_400_000 - 60_000);

    const kedua = await kirimPengingatKendalaTerjadwal(belumJeda);
    expect(kedua.terkirim).toBe(0);
    expect(kedua.diredam).toBe(1);
  });
});

describe("menggabungkan kendala kembar (DECISIONS 393)", () => {
  async function kendala(judul: string, extra: Record<string, unknown> = {}) {
    return db.issue.create({
      data: { locationId, title: judul, severity: "sedang", status: "terbuka", ...extra },
    });
  }

  function fd(v: Record<string, string>) {
    const f = new FormData();
    for (const [k, val] of Object.entries(v)) f.set(k, val);
    return f;
  }

  it("kembarnya ditutup dan ditandai – TIDAK dihapus", async () => {
    const induk = await kendala("Lahan belum bisa clear");
    const dup = await kendala("Lahan belum clear");

    const r = await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));
    expect(r?.error).toBeUndefined();

    const sesudah = await db.issue.findUniqueOrThrow({ where: { id: dup.id } });
    expect(sesudah.status).toBe("selesai");
    expect(sesudah.mergedIntoId).toBe(induk.id);
    expect(sesudah.closedAt).not.toBeNull();
    // Catatan penutup menyebut judul induknya — tanpa itu jejaknya buntu.
    expect(sesudah.closingNote).toContain("Lahan belum bisa clear");
    // Induknya tidak tersentuh.
    expect((await db.issue.findUniqueOrThrow({ where: { id: induk.id } })).status).toBe("terbuka");
  });

  it("REGRESI: aksi pemulihan ikut PINDAH, tidak ikut terkubur", async () => {
    /*
     * Kalau seseorang sudah merencanakan pemulihan di baris kembarnya, rencana
     * itu tetap berlaku untuk masalah yang sama. Menguburnya berarti pekerjaan
     * orang hilang tanpa pemberitahuan.
     */
    const induk = await kendala("Akses jalan longsor");
    const dup = await kendala("Jalan akses longsor");
    await db.recoveryAction.create({
      data: { issueId: dup.id, description: "Sewa ekskavator dari dinas", createdById: userId },
    });

    const r = await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));
    expect(r?.success).toContain("1 aksi pemulihan");

    expect(await db.recoveryAction.count({ where: { issueId: dup.id } })).toBe(0);
    expect(await db.recoveryAction.count({ where: { issueId: induk.id } })).toBe(1);
  });

  it("REGRESI: kembar yang digabungkan hilang dari papan DAN dari hitungannya", async () => {
    const induk = await kendala("Material besi belum datang");
    const dup = await kendala("Besi belum datang");
    await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));

    const papan = await papanKendala(await penggunaUji(), {});
    const idsTampil = papan.baris.map((b) => b.id);
    expect(idsTampil).toContain(induk.id);
    expect(idsTampil).not.toContain(dup.id);
    // Bukan hanya hilang dari daftar — juga tidak menambah hitungan "selesai".
    expect(papan.ringkas.selesai30Hari).toBe(0);
  });

  it("REGRESI: kembar yang digabungkan tidak ikut ditagih pengingat WA", async () => {
    const kemarin = new Date("2026-08-14T00:00:00.000Z");
    const induk = await kendala("Lahan belum bisa clear", { dueDate: kemarin, picName: "Budi" });
    const dup = await kendala("Lahan belum clear", { dueDate: kemarin, picName: "Budi" });
    await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));

    await kirimPengingatKendalaTerjadwal(new Date("2026-08-20T09:00:00.000Z"));
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].teks).toContain("1 kendala sudah lewat tenggat");
    expect(terkirim[0].teks).not.toContain("Lahan belum clear –");
  });

  it("kembar yang digabungkan tidak bisa dibuka kembali lewat kontrol status", async () => {
    /*
     * Kalau boleh, kembar yang baru saja dirapikan hidup lagi — dan kali ini
     * dengan status yang tidak cocok dengan catatan penutupnya, sehingga layar
     * mengatakan dua hal sekaligus.
     */
    const induk = await kendala("Lahan belum bisa clear");
    const dup = await kendala("Lahan belum clear");
    await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));

    const r = await updateIssueStatus(undefined, fd({ issueId: dup.id, status: "terbuka" }));
    expect(r?.error).toMatch(/sudah digabungkan/i);
    expect((await db.issue.findUniqueOrThrow({ where: { id: dup.id } })).status).toBe("selesai");
  });

  it("REGRESI: kembar yang TERLANJUR terbuka tetap tidak ditagih pengingat WA", async () => {
    /*
     * Statusnya diubah LANGSUNG di basis data, bukan lewat aksi — memodelkan
     * data yang lahir sebelum penjaga status ada, atau yang disunting di luar
     * aplikasi.
     *
     * Ditulis setelah uji gigi memperlihatkan bahwa uji sebelumnya TIDAK
     * membuktikan apa pun tentang saringan `mergedIntoId` di penagih: kembar
     * yang baru digabungkan selalu berstatus `selesai`, jadi saringan status
     * sudah membuangnya lebih dulu. Baru dengan status terbuka, saringan
     * kembarnya benar-benar menanggung beban.
     */
    const kemarin = new Date("2026-08-14T00:00:00.000Z");
    const induk = await kendala("Lahan belum bisa clear", { dueDate: kemarin, picName: "Budi" });
    const dup = await kendala("Lahan belum clear", { dueDate: kemarin, picName: "Budi" });
    await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));
    await db.issue.update({ where: { id: dup.id }, data: { status: "terbuka" } });

    await kirimPengingatKendalaTerjadwal(new Date("2026-08-20T09:00:00.000Z"));
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].teks).toContain("1 kendala sudah lewat tenggat");
  });

  it("lintas lokasi ditolak, dan tidak ada yang berubah", async () => {
    const lain = await db.location.create({
      data: {
        packageId,
        name: `Lokasi lain ${suffix}`,
        slug: `lain-${suffix}`,
        village: "D",
        regency: "K",
        province: "P",
        isActive: true,
      },
    });
    const induk = await kendala("Lahan belum bisa clear");
    const dup = await db.issue.create({
      data: { locationId: lain.id, title: "Lahan belum clear", severity: "sedang" },
    });

    const r = await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));
    expect(r?.error).toMatch(/lokasi yang sama/i);
    expect((await db.issue.findUniqueOrThrow({ where: { id: dup.id } })).mergedIntoId).toBeNull();
    await db.issue.delete({ where: { id: dup.id } });
    await db.location.delete({ where: { id: lain.id } });
  });

  it("rantai ditolak: A tidak bisa digabungkan ke B yang sudah digabung ke C", async () => {
    const c = await kendala("Induk asli");
    const b = await kendala("Kembar pertama");
    await gabungkanKendala(undefined, fd({ duplikatId: b.id, indukId: c.id }));

    const a = await kendala("Kembar kedua");
    const r = await gabungkanKendala(undefined, fd({ duplikatId: a.id, indukId: b.id }));
    expect(r?.error).toMatch(/sudah digabungkan/i);
  });
});

describe("menghapus kendala salah catat (DECISIONS 394)", () => {
  async function kendala(judul: string, extra: Record<string, unknown> = {}) {
    return db.issue.create({
      data: { locationId, title: judul, severity: "sedang", status: "terbuka", ...extra },
    });
  }

  function fd(v: Record<string, string>) {
    const f = new FormData();
    for (const [k, val] of Object.entries(v)) f.set(k, val);
    return f;
  }

  it("REGRESI: isi kendala tersimpan di audit SEBELUM barisnya hilang", async () => {
    /*
     * Sesudah barisnya hilang, audit adalah SATU-SATUNYA tempat isinya masih
     * bisa dibaca. Penghapusan yang tidak meninggalkan apa-apa tidak bisa
     * dipertanggungjawabkan ke siapa pun.
     */
    const i = await kendala("asdf salah ketik");
    const r = await hapusKendala(
      undefined,
      fd({ issueId: i.id, alasan: "salah ketik saat mencoba" }),
    );
    expect(r?.error).toBeUndefined();
    expect(await db.issue.findUnique({ where: { id: i.id } })).toBeNull();

    const jejak = await db.auditLog.findFirstOrThrow({
      where: { action: "issue.hapus", resourceId: i.id },
    });
    const p = jejak.payload as Record<string, unknown>;
    expect(p.title).toBe("asdf salah ketik");
    expect(p.alasan).toBe("salah ketik saat mencoba");
    expect(p.severity).toBe("sedang");
  });

  it("alasan WAJIB – tanpa alasan tidak ada yang dihapus", async () => {
    const i = await kendala("Salah lokasi");
    const r = await hapusKendala(undefined, fd({ issueId: i.id, alasan: "" }));
    expect(r?.error).toMatch(/alasan/i);
    expect(await db.issue.findUnique({ where: { id: i.id } })).not.toBeNull();
  });

  it("REGRESI: yang punya aksi pemulihan tidak bisa dihapus", async () => {
    const i = await kendala("Lahan belum bisa clear");
    await db.recoveryAction.create({
      data: { issueId: i.id, description: "Rapat dengan pemilik lahan", createdById: userId },
    });
    const r = await hapusKendala(undefined, fd({ issueId: i.id, alasan: "coba hapus" }));
    expect(r?.error).toMatch(/aksi pemulihan/i);
    expect(await db.issue.findUnique({ where: { id: i.id } })).not.toBeNull();
  });

  it("REGRESI: induk penggabungan tidak bisa dihapus – kembarnya akan muncul lagi", async () => {
    const induk = await kendala("Lahan belum bisa clear");
    const dup = await kendala("Lahan belum clear");
    await gabungkanKendala(undefined, fd({ duplikatId: dup.id, indukId: induk.id }));

    const r = await hapusKendala(undefined, fd({ issueId: induk.id, alasan: "coba hapus" }));
    expect(r?.error).toMatch(/digabungkan ke kendala ini/i);
    expect(await db.issue.findUnique({ where: { id: induk.id } })).not.toBeNull();
  });

  it("REGRESI: kendala di laporan harian FINAL tidak bisa dihapus", async () => {
    const laporan = await db.dailyReport.create({
      data: {
        locationId,
        reportDate: new Date("2026-08-11"),
        status: "final",
        createdById: userId,
      },
    });
    const i = await kendala("Kendala di laporan final", { reportId: laporan.id });
    const r = await hapusKendala(undefined, fd({ issueId: i.id, alasan: "coba hapus" }));
    expect(r?.error).toMatch(/FINAL/);
    expect(await db.issue.findUnique({ where: { id: i.id } })).not.toBeNull();
    await db.issue.delete({ where: { id: i.id } });
    await db.dailyReport.delete({ where: { id: laporan.id } });
  });

  it("kendala dari kegiatan lapangan: pesannya mengingatkan teks kegiatannya belum berubah", async () => {
    /*
     * Menghapus Issue-nya TIDAK menyentuh kolom kendala di kegiatannya. Kalau
     * layar tidak mengatakan itu, orang mengira sudah beres – lalu kendalanya
     * lahir lagi pada finalisasi berikutnya dan tampak seperti hantu.
     */
    const faId = await kegiatan("Akses jalan longsor");
    await naikkanKendalaKegiatan({
      activityId: faId,
      locationId,
      kendala: "Akses jalan longsor",
      userId,
    });
    const i = await db.issue.findFirstOrThrow({ where: { fieldActivityId: faId } });
    const r = await hapusKendala(undefined, fd({ issueId: i.id, alasan: "salah lokasi" }));
    expect(r?.success).toMatch(/kegiatan lapangannya belum berubah/i);
  });
});
