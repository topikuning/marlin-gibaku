// VERIFIKASI NOMOR WHATSAPP, ALUR PENUH (DECISIONS 570).
//
// Permintaan user 2026-09-13: sesudah login, pengguna mengirim WA dari nomornya
// sendiri, dibalas kode, lalu mengetikkan kodenya. Boleh dilewati, ditanyakan
// lagi tiap login. *"itu sekaligus jadi informasi nomor wa jika nomor masih
// kosong/atau update nomor wa sebelumnya"*.
//
// Aturannya sudah diuji murni di tests/unit/verifikasi-wa-aturan.test.ts. Yang
// diuji DI SINI rangkaiannya lewat basis data: pesan masuk mengikat identitas
// pengirim, kode terkirim, kode yang benar mengisi/memperbarui nomor DAN
// memasang cap terverifikasi — plus pagar yang menjaga satu nomor tidak
// diklaim dua akun.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

/** Balasan WhatsApp DICATAT, bukan dikirim — tidak ada WAHA di uji. */
const terkirim: { chatId: string; teks: string }[] = [];
/** Dinyalakan untuk meniru pagar gateway yang menolak kiriman. */
let gagalKirim = false;
vi.mock("@/lib/waha/kirim", () => ({
  balasWa: async (chatId: string, teks: string) => {
    if (gagalKirim) throw new Error("Kiriman ke nomor pribadi sedang dimatikan (uji)");
    terkirim.push({ chatId, teks });
    return "wamid.uji";
  },
  sendText: async () => "wamid.uji",
}));

const { db } = await import("@/lib/db");
const { mulaiVerifikasi, tanganiPesanVerifikasi, konfirmasiKode, bacaKeadaan } = await import(
  "@/lib/waha/verifikasi"
);

const suffix = `vw${Date.now().toString(36)}`;

/**
 * Nomor BEDA untuk tiap kasus, dan beda tiap kali dijalankan.
 *
 * Pagar "satu nomor satu akun" itu nyata: memakai nomor yang sama di dua kasus
 * membuat kasus kedua ditolak oleh pagarnya sendiri — dan yang terbaca nanti
 * bukan "ujinya bertabrakan" melainkan "fiturnya rusak". Basis data uji tidak
 * dibersihkan antar-berkas, jadi nomornya juga harus beda antar-jalankan.
 */
let urut = 0;
const nomorBaru = () => `62${String(8_000_000_000 + (Date.now() % 900_000_000) + urut++ * 7919)}`;
let orgId: string;
let userId: string;

async function buatUser(tag: string, waNumber: string | null = null) {
  const u = await db.user.create({
    data: {
      orgId,
      username: `${tag}-${suffix}`,
      fullName: `Uji ${tag}`,
      passwordHash: "x",
      role: "site_manager",
      waNumber,
    },
  });
  return u.id;
}

/** Pesan WhatsApp masuk yang membawa frasa. */
const pesan = (frasa: string, nomor: string | null, lid: string | null = null) => ({
  body: frasa,
  chatId: nomor ? `${nomor}@c.us` : `${lid}@lid`,
  senderJid: nomor ? `${nomor}@c.us` : `${lid}@lid`,
  senderLid: lid,
  fromNumber: nomor,
  fromMe: false,
});

/** Kode yang barusan dibalaskan ke WhatsApp – dibaca dari teksnya, bukan dari DB. */
function kodeTerakhir(): string {
  const m = /(\d{6})/.exec(terkirim.at(-1)?.teks ?? "");
  if (!m) throw new Error(`balasan terakhir tidak memuat kode: ${terkirim.at(-1)?.teks}`);
  return m[1]!;
}

beforeEach(async () => {
  terkirim.length = 0;
  if (!orgId) {
    const org = await db.organization.create({ data: { name: `Org VW ${suffix}`, slug: `org-${suffix}` } });
    orgId = org.id;
  }
  userId = await buatUser(`u${Math.random().toString(36).slice(2, 8)}`);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("verifikasi nomor WhatsApp", () => {
  it("alur lengkap: frasa → pesan masuk → kode → nomor terisi & terverifikasi", async () => {
    expect(await bacaKeadaan(userId)).toEqual({ tahap: "belum" });

    const { frasa } = await mulaiVerifikasi(userId);
    expect((await bacaKeadaan(userId)).tahap).toBe("menunggu-pesan");

    const nomor = nomorBaru();
    const hasil = await tanganiPesanVerifikasi(pesan(frasa, nomor, "99887766"));
    expect(hasil).toEqual({ ditangani: true, hasil: "kode-dikirim" });
    expect(terkirim).toHaveLength(1);
    expect((await bacaKeadaan(userId)).tahap).toBe("menunggu-kode");

    const ok = await konfirmasiKode(userId, kodeTerakhir());
    expect(ok).toMatchObject({ ok: true, nomor, nomorLama: null });

    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.waNumber).toBe(nomor);
    expect(u.waLid).toBe("99887766");
    expect(u.waVerifiedAt).not.toBeNull();
    // Barisnya dihapus: percobaan yang selesai bukan data yang perlu disimpan,
    // dan kode lama yang tertinggal hanya menambah yang bisa bocor.
    expect(await db.waVerification.findUnique({ where: { userId } })).toBeNull();
  });

  it("nomor LAMA diperbarui, bukan dibiarkan – dan perubahannya dikatakan", async () => {
    const lama = nomorBaru();
    const baru = nomorBaru();
    const id = await buatUser("lama", lama);
    const { frasa } = await mulaiVerifikasi(id);
    await tanganiPesanVerifikasi(pesan(frasa, baru));
    const r = await konfirmasiKode(id, kodeTerakhir());
    expect(r).toMatchObject({ ok: true, nomor: baru, nomorLama: lama });
    expect((await db.user.findUniqueOrThrow({ where: { id } })).waNumber).toBe(baru);
  });

  it("yang dipakai nomor dari PESAN, bukan yang sudah tercatat", async () => {
    // Inti dari verifikasi dua arah: klaim di basis data tidak boleh menang
    // atas fakta pengirim. Kalau menang, nomor salah ketik tetap awet.
    const id = await buatUser("beda", nomorBaru());
    const dariPesan = nomorBaru();
    const { frasa } = await mulaiVerifikasi(id);
    await tanganiPesanVerifikasi(pesan(frasa, dariPesan));
    await konfirmasiKode(id, kodeTerakhir());
    expect((await db.user.findUniqueOrThrow({ where: { id } })).waNumber).toBe(dariPesan);
  });

  it("kode salah tidak memverifikasi apa pun, dan percobaannya terhitung", async () => {
    const { frasa } = await mulaiVerifikasi(userId);
    await tanganiPesanVerifikasi(pesan(frasa, nomorBaru()));
    const r = await konfirmasiKode(userId, "000001");
    expect(r.ok).toBe(false);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.waVerifiedAt).toBeNull();
    expect(u.waNumber).toBeNull();
    expect((await db.waVerification.findUniqueOrThrow({ where: { userId } })).attempts).toBe(1);
  });

  it("SATU NOMOR SATU AKUN: nomor yang sudah terverifikasi orang lain ditolak", async () => {
    /*
     * Kalau ini lolos, dua akun mengaku nomor yang sama — dan jawaban WhatsApp,
     * pengingat laporan, serta penagih tenggat semuanya mencari orang dari
     * nomor pengirim. Yang salah alamat tidak akan pernah kelihatan salah.
     */
    const nomor = nomorBaru();
    const pemilik = await buatUser("pemilik");
    const { frasa: f1 } = await mulaiVerifikasi(pemilik);
    await tanganiPesanVerifikasi(pesan(f1, nomor));
    await konfirmasiKode(pemilik, kodeTerakhir());

    const penyusup = await buatUser("penyusup");
    const { frasa: f2 } = await mulaiVerifikasi(penyusup);
    const hasil = await tanganiPesanVerifikasi(pesan(f2, nomor));
    expect(hasil).toEqual({ ditangani: true, hasil: "nomor-dipakai-orang-lain" });
    expect(terkirim.at(-1)!.teks).toMatch(/sudah terdaftar atas nama pengguna MARLIN yang lain/i);
    expect((await db.waVerification.findUniqueOrThrow({ where: { userId: penyusup } })).code).toBeNull();
  });

  it("mengulang verifikasi membuang kode & identitas percobaan lama", async () => {
    // Tanpa ini, frasa BARU bisa dipakai menuntaskan percobaan LAMA yang
    // identitasnya sudah terikat ke nomor yang berbeda.
    const { frasa } = await mulaiVerifikasi(userId);
    await tanganiPesanVerifikasi(pesan(frasa, nomorBaru()));
    await mulaiVerifikasi(userId);
    const b = await db.waVerification.findUniqueOrThrow({ where: { userId } });
    expect(b.code).toBeNull();
    expect(b.waNumber).toBeNull();
    expect(b.senderKey).toBeNull();
    expect(b.attempts).toBe(0);
  });

  it("menekan Mulai dua kali TIDAK mengganti frasa yang masih berlaku", async () => {
    /*
     * Tiap layar yang masih memajang frasa sebelumnya — ketukan ganda, tab
     * kedua, tombol kembali, halaman yang dipulihkan PWA — berubah jadi jebakan
     * kalau frasanya diganti tiap kali tombolnya ditekan: yang dikirim orangnya
     * frasa yang sudah tidak ada lagi di basis data.
     */
    const a = await mulaiVerifikasi(userId);
    const b = await mulaiVerifikasi(userId);
    expect(b.frasa).toBe(a.frasa);

    // Dan frasa dari layar LAMA itu tetap sah dipakai.
    terkirim.length = 0;
    const r = await tanganiPesanVerifikasi(pesan(a.frasa, nomorBaru()));
    expect(r).toEqual({ ditangani: true, hasil: "kode-dikirim" });
  });

  it("kode yang GAGAL dikirim tidak pernah mengaku terkirim", async () => {
    /*
     * Layar membaca `code` yang terisi sebagai "kode sudah sampai di
     * WhatsApp". Mengisinya sebelum kirimannya berhasil membuat layar
     * mengumumkan sesuatu yang tidak terjadi — persis yang dilaporkan user
     * 2026-09-14: *"kamu tidak merespon kode"* sementara layarnya bilang
     * "Kode sudah dibalas ke WhatsApp yang sama".
     */
    gagalKirim = true;
    try {
      const { frasa } = await mulaiVerifikasi(userId);
      const r = await tanganiPesanVerifikasi(pesan(frasa, nomorBaru()));
      expect(r).toEqual({ ditangani: true, hasil: "kode-gagal-dikirim" });

      const b = await db.waVerification.findUniqueOrThrow({ where: { userId } });
      expect(b.code).toBeNull();
      // Tapi identitas pengirimnya TETAP tercap: pesannya memang sampai.
      expect(b.senderKey).not.toBeNull();
      expect(await bacaKeadaan(userId)).toMatchObject({ tahap: "gagal-kirim" });
    } finally {
      gagalKirim = false;
    }
  });

  it("pesan biasa TIDAK ditangani jalur verifikasi", async () => {
    // Kalau ini salah, tiap pertanyaan lapangan berhenti di sini dan tidak
    // pernah sampai ke jalur tanya-jawab.
    expect(await tanganiPesanVerifikasi(pesan("progres hari ini?", nomorBaru()))).toEqual({
      ditangani: false,
    });
    expect(terkirim).toHaveLength(0);
  });

  it("frasa yang TIDAK dikenal tetap dijawab di sini, tidak dilempar ke AI", async () => {
    /*
     * Versi pertama mengembalikan `ditangani: false` di sini, dan itu yang
     * dilihat user 2026-09-14: "MARLIN-KVNH9K" dijawab AI sebagai *catatan
     * lapangan*, lengkap dengan kutipan kendala Asemdoyong yang tidak ada
     * hubungannya, ditutup "Tidak saya kenali: kvnh9k". Orang yang sedang
     * memverifikasi nomornya membaca itu sebagai sistem yang rusak.
     *
     * Frasa berawalan MARLIN- hanya punya satu arti. Tidak ketemu berarti
     * dikatakan, bukan ditebak.
     */
    terkirim.length = 0;
    expect(await tanganiPesanVerifikasi(pesan("MARLIN-ACDEFG", nomorBaru()))).toEqual({
      ditangani: true,
      hasil: "tidak-dikenal",
    });
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0]!.teks).toContain("tidak dikenali");
    // Yang penting BUKAN kalimatnya, melainkan jalan keluarnya: orangnya harus
    // tahu apa yang mesti dilakukan berikutnya.
    expect(terkirim[0]!.teks).toContain("Verifikasi WhatsApp");
  });

  it("pesan dari MARLIN sendiri diabaikan", async () => {
    const { frasa } = await mulaiVerifikasi(userId);
    const r = await tanganiPesanVerifikasi({ ...pesan(frasa, nomorBaru()), fromMe: true });
    expect(r).toEqual({ ditangani: false });
  });

  it("frasa kedaluwarsa dibalas apa adanya, tanpa kode", async () => {
    const { frasa } = await mulaiVerifikasi(userId);
    await db.waVerification.update({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const r = await tanganiPesanVerifikasi(pesan(frasa, nomorBaru()));
    expect(r).toEqual({ ditangani: true, hasil: "kedaluwarsa" });
    expect(terkirim.at(-1)!.teks).toMatch(/kedaluwarsa/i);
    expect((await db.waVerification.findUniqueOrThrow({ where: { userId } })).code).toBeNull();
  });
});
