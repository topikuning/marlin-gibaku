import "server-only";
import { encryptionKeyFromEnv, readStoredSecret, secretUntukSimpan } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * PEMBARUAN CUACA DARI SATELIT (DECISIONS 657, 659).
 *
 * Pola yang diminta user: tombol ambil cuaca di laporan harian selalu memakai
 * Open-Meteo (cepat), lalu mulai pukul 04.00 WIB laporan KEMARIN diperbarui
 * senyap dengan pengamatan satelit (awan Himawari-9 + hujan JAXA GSMaP) pada
 * jam yang datanya cukup – termasuk laporan yang sudah disetujui atau final:
 * *"prinsipnya data yang lebih valid!"*.
 *
 * BAWAAN NYALA: user sendiri yang meminta polanya. Hanya isian manual dari
 * lapangan yang tidak disentuh.
 */
export const SATELIT_SUBUH_KEY = "cuaca.satelit_subuh";
export const SATELIT_SUBUH_DEFAULT = true;
/**
 * Ringkasan putaran terakhir yang MENGUBAH sesuatu, atau yang dijalankan dari
 * tombol, untuk layar Sistem (JSON).
 */
export const SATELIT_SUBUH_TERAKHIR_KEY = "cuaca.satelit_subuh.terakhir";

export type RingkasSubuh = {
  /** Tanggal laporan (YYYY-MM-DD) yang ikut diperbarui, urut. */
  tanggal: string[];
  /** Kapan diproses (ISO). */
  pada: string;
  /** Laporan yang diperiksa. */
  laporan: number;
  diperbarui: number;
  /** Di antara yang diperbarui, yang sudah final (snapshot-nya ikut diganti). */
  final: number;
  /** PDF laporan final di Google Drive yang diantre untuk diganti. */
  drive: number;
  /** Laporan mingguan di Drive yang diantre ulang karena ringkasan cuacanya berubah. */
  mingguan: number;
  jamSatelit: number;
  jamModel: number;
  catatan: string[];
  /** true = dijalankan dari tombol, bukan penjadwal. */
  manual?: boolean;
};

async function nilaiSetelan(key: string): Promise<string | null> {
  const row = await db.appSetting.findFirst({
    where: { key },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  return row?.value.trim() ?? null;
}

async function simpanSetelan(key: string, value: string): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key, effectiveFrom } },
    update: { value },
    create: { key, value, effectiveFrom },
  });
}

export async function getSatelitSubuhAktif(): Promise<boolean> {
  const v = await nilaiSetelan(SATELIT_SUBUH_KEY);
  if (v == null || v === "") return SATELIT_SUBUH_DEFAULT;
  return v === "1" || v.toLowerCase() === "true";
}

export async function setSatelitSubuhAktif(aktif: boolean): Promise<void> {
  await simpanSetelan(SATELIT_SUBUH_KEY, aktif ? "1" : "0");
}

export async function getSubuhTerakhir(): Promise<RingkasSubuh | null> {
  const v = await nilaiSetelan(SATELIT_SUBUH_TERAKHIR_KEY);
  if (!v) return null;
  try {
    const j = JSON.parse(v) as Partial<RingkasSubuh> & { tanggal?: string | string[] };
    if (typeof j.pada !== "string") return null;
    // Ringkasan versi 657 menyimpan satu tanggal sebagai string.
    const tanggal = typeof j.tanggal === "string" ? [j.tanggal] : Array.isArray(j.tanggal) ? j.tanggal : [];
    return {
      tanggal,
      pada: j.pada,
      laporan: j.laporan ?? 0,
      diperbarui: j.diperbarui ?? 0,
      final: j.final ?? 0,
      drive: j.drive ?? 0,
      mingguan: j.mingguan ?? 0,
      jamSatelit: j.jamSatelit ?? 0,
      jamModel: j.jamModel ?? 0,
      catatan: Array.isArray(j.catatan) ? j.catatan : [],
      ...(j.manual ? { manual: true } : {}),
    };
  } catch {
    return null;
  }
}

export async function catatSubuhTerakhir(r: RingkasSubuh): Promise<void> {
  await simpanSetelan(SATELIT_SUBUH_TERAKHIR_KEY, JSON.stringify(r));
}

/**
 * AKUN FTP JAXA GSMaP – di basis data, diisi dari layar Sistem (permintaan
 * user 2026-10-07: *"masukkan aja di variable database"*). Sandinya TERSANDI
 * dengan aturan yang sama seperti kunci WAHA/AI/Google (`secretUntukSimpan`):
 * kuncinya berakhiran `.password`, jadi ikut terjaring migrasi enkripsi-ulang.
 */
export const GSMAP_USER_KEY = "cuaca.gsmap.ftp_user";
export const GSMAP_PASS_KEY = "cuaca.gsmap.password";

async function nilaiTerbaru(key: string): Promise<string> {
  const row = await db.appSetting.findFirst({
    where: { key },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  return row?.value.trim() ?? "";
}

/** Akun lengkap, atau null bila belum diisi / sandinya tidak bisa dibuka. */
export async function getAkunGsmap(): Promise<{ user: string; pass: string } | null> {
  const [user, simpan] = await Promise.all([nilaiTerbaru(GSMAP_USER_KEY), nilaiTerbaru(GSMAP_PASS_KEY)]);
  const pass = simpan ? (readStoredSecret(simpan, encryptionKeyFromEnv()) ?? "") : "";
  return user && pass ? { user, pass } : null;
}

/** Untuk layar: nama akun dan apakah sandinya tersimpan – sandinya tidak pernah dikirim. */
export async function getAkunGsmapTampil(): Promise<{ user: string; adaSandi: boolean }> {
  const [user, simpan] = await Promise.all([nilaiTerbaru(GSMAP_USER_KEY), nilaiTerbaru(GSMAP_PASS_KEY)]);
  return { user, adaSandi: simpan !== "" };
}

/** `pass` undefined = sandi lama dipertahankan; string kosong = hapus. */
export async function setAkunGsmap(input: { user: string; pass?: string }): Promise<void> {
  const effectiveFrom = jakartaToday();
  const put = (key: string, value: string) =>
    db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  // Sandi disandikan LEBIH DULU: bila kunci enkripsi tidak ada di production,
  // ia melempar sebelum apa pun tertulis.
  const pass = input.pass === undefined ? undefined : input.pass === "" ? "" : secretUntukSimpan(input.pass);
  await put(GSMAP_USER_KEY, input.user.trim());
  if (pass !== undefined) await put(GSMAP_PASS_KEY, pass);
}
