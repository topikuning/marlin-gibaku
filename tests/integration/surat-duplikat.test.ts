// PAGAR DUPLIKAT SURAT BENAR-BENAR MENAHAN (DECISIONS 436).
//
// Laporan user 2026-08-26: setelah "Surat tercatat", formulir tetap aktif;
// menekan simpan lagi membuat baris kedua yang bisa ditindaklanjuti
// sendiri-sendiri — *"berantakan total, tiap duplikasi bisa dilakukan tindak
// lanjut berbeda"*.
//
// Layar sudah ditutup setelah simpan, tapi layar bukan pagar: kiriman ganda
// bisa datang dari tombol yang ditekan dua kali, jaringan yang mengulang, atau
// tab kedua. Yang diuji di sini adalah pagar di `buatSurat()` — satu-satunya
// pintu pembuatan surat.
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { buatSurat } = await import("@/lib/surat/lampiran-actions");
const { SuratDuplikatError } = await import("@/lib/surat/duplikat");

const suffix = `dup${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
let packageId = "";

const dasar = () => ({
  orgId,
  createdById: userId,
  packageId,
  direction: "masuk" as const,
  party: "penyedia" as const,
  partyName: "CV. SINAR MULYA",
  subject: "Pemberhentian Sementara",
  letterNumber: "16/PPM/VIII/2026",
  letterDate: new Date("2026-08-25T00:00:00.000Z"),
  handledDate: new Date("2026-08-26T00:00:00.000Z"),
  category: "koordinasi" as const,
  needsReply: true,
  replyDueDate: null,
});

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  orgId = org.id;
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  packageId = pkg.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `admin-${suffix}`,
      fullName: "Admin Uji",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = u.id;
});

describe("duplikat nomor surat", () => {
  it("surat pertama tercatat dan mendapat nomor agenda", async () => {
    const s = await buatSurat(dasar());
    expect(s.agendaNo).toBeGreaterThan(0);
  });

  it("kiriman kedua yang persis sama DITOLAK, bukan membuat baris kedua", async () => {
    await expect(buatSurat(dasar())).rejects.toThrow(SuratDuplikatError);
    const jumlah = await db.letter.count({ where: { orgId, letterNumber: "16/PPM/VIII/2026" } });
    expect(jumlah).toBe(1);
  });

  it("nomor yang sama diketik beda spasi/huruf tetap tertahan", async () => {
    await expect(buatSurat({ ...dasar(), letterNumber: "16 / ppm / VIII / 2026" })).rejects.toThrow(
      SuratDuplikatError,
    );
  });

  it("pesannya menyebut agenda yang bentrok, supaya orang tahu ke mana", async () => {
    await expect(buatSurat(dasar())).rejects.toThrow(/agenda \d+\/\d+/);
  });

  it("nomor yang BERBEDA tetap boleh – pagar tidak menghalangi pekerjaan sah", async () => {
    const s = await buatSurat({ ...dasar(), letterNumber: "17/PPM/VIII/2026" });
    expect(s.agendaNo).toBeGreaterThan(0);
  });

  it("arah yang berbeda bukan duplikat: surat keluar boleh bernomor sama", async () => {
    const s = await buatSurat({ ...dasar(), direction: "keluar" });
    expect(s.agendaNo).toBeGreaterThan(0);
  });

  it("surat tanpa nomor tidak saling menghalangi", async () => {
    const a = await buatSurat({ ...dasar(), letterNumber: null, subject: "Tanpa nomor A" });
    const b = await buatSurat({ ...dasar(), letterNumber: null, subject: "Tanpa nomor B" });
    expect(b.agendaNo).toBeGreaterThan(a.agendaNo);
  });
});

describe("duplikat berkas", () => {
  // Kunci R2 berkas surat = sha256 isinya, jadi kunci sama = berkas sama persis.
  const kunci = `surat/${"a".repeat(64)}`;

  it("berkas pertama tercatat", async () => {
    const s = await buatSurat({
      ...dasar(),
      letterNumber: "20/PPM/VIII/2026",
      fileR2Key: kunci,
      fileName: "surat.pdf",
    });
    expect(s.agendaNo).toBeGreaterThan(0);
  });

  it("berkas yang sama persis ditolak walau nomornya lain", async () => {
    await expect(
      buatSurat({ ...dasar(), letterNumber: "21/PPM/VIII/2026", fileR2Key: kunci, fileName: "salinan.pdf" }),
    ).rejects.toThrow(SuratDuplikatError);
    expect(await db.letter.count({ where: { orgId, fileR2Key: kunci } })).toBe(1);
  });

  it("pesannya menyebut nama berkas yang sudah tercatat", async () => {
    await expect(
      buatSurat({ ...dasar(), letterNumber: "22/PPM/VIII/2026", fileR2Key: kunci }),
    ).rejects.toThrow(/surat\.pdf/);
  });
});

describe("pembatalan melepaskan nomornya (DECISIONS 437)", () => {
  it("nomor surat yang DIBATALKAN boleh dicatat ulang", async () => {
    const salah = await buatSurat({ ...dasar(), letterNumber: "30/PPM/VIII/2026", subject: "Salah ketik" });
    // Selama masih berdiri, nomornya memang terkunci.
    await expect(buatSurat({ ...dasar(), letterNumber: "30/PPM/VIII/2026" })).rejects.toThrow(
      SuratDuplikatError,
    );

    await db.letter.update({
      where: { id: salah.id },
      data: { status: "dibatalkan", voidedAt: new Date(), voidReason: "salah ketik" },
    });

    // Setelah dibatalkan, nomor yang benar bisa dipakai — kalau tidak, satu
    // salah ketik menjadi hukuman seumur register.
    const benar = await buatSurat({ ...dasar(), letterNumber: "30/PPM/VIII/2026", subject: "Yang benar" });
    expect(benar.id).not.toBe(salah.id);

    // Barisnya TIDAK hilang: yang dibatalkan tetap ada dengan sebabnya.
    const batal = await db.letter.findUnique({
      where: { id: salah.id },
      select: { status: true, voidReason: true, agendaNo: true },
    });
    expect(batal!.status).toBe("dibatalkan");
    expect(batal!.voidReason).toBe("salah ketik");

    // Nomor agendanya TIDAK didaur ulang.
    expect(benar.agendaNo).not.toBe(batal!.agendaNo);
  });

  it("berkas milik surat yang dibatalkan boleh dicatat ulang", async () => {
    const kunci = `surat/${"b".repeat(64)}`;
    const salah = await buatSurat({
      ...dasar(),
      letterNumber: "31/PPM/VIII/2026",
      fileR2Key: kunci,
      fileName: "salah.pdf",
    });
    await db.letter.update({ where: { id: salah.id }, data: { status: "dibatalkan" } });
    const benar = await buatSurat({
      ...dasar(),
      letterNumber: "32/PPM/VIII/2026",
      fileR2Key: kunci,
      fileName: "benar.pdf",
    });
    expect(benar.id).not.toBe(salah.id);
  });
});
