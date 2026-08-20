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
const { kirimPengingatKendalaTerjadwal } = await import("@/lib/kendala/penjadwal-tenggat");

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
      role: "site_manager",
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
    `TRUNCATE TABLE issues, field_activities, audit_logs, locations, packages, users,
     organizations RESTART IDENTITY CASCADE`,
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
    await kendalaLewatTenggat("Lahan belum bisa clear");
    await kirimPengingatKendalaTerjadwal(HARI_INI);
    const empatHari = new Date("2026-08-24T09:00:00.000Z");
    expect((await kirimPengingatKendalaTerjadwal(empatHari)).terkirim).toBe(1);
  });
});
