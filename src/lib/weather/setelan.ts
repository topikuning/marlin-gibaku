import "server-only";
import { encryptionKeyFromEnv, readStoredSecret, secretUntukSimpan } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * PEMBARUAN CUACA DARI SATELIT TIAP PUKUL 04.00 WIB (DECISIONS 657).
 *
 * Pola yang diminta user: tombol ambil cuaca di laporan harian selalu memakai
 * Open-Meteo (cepat), lalu pukul 04.00 WIB laporan KEMARIN diperbarui senyap
 * dengan pengamatan satelit (awan Himawari-9 + hujan JAXA GSMaP) pada jam yang
 * datanya cukup. Laporan belum dikirim ke mana pun hari itu juga, jadi
 * memperbaruinya sebelum diperiksa dan difinalkan tidak mengubah apa yang
 * sudah diterima orang lain.
 *
 * BAWAAN NYALA: user sendiri yang meminta polanya. Isian manual dari lapangan
 * dan laporan yang sudah disetujui/final tetap tidak disentuh.
 */
export const SATELIT_SUBUH_KEY = "cuaca.satelit_subuh";
export const SATELIT_SUBUH_DEFAULT = true;
/** Ringkasan putaran terakhir (terjadwal atau tombol) untuk layar Sistem (JSON). */
export const SATELIT_SUBUH_TERAKHIR_KEY = "cuaca.satelit_subuh.terakhir";
/** Tanggal laporan terakhir yang sudah diproses PENJADWAL – penanda susulan. */
export const SATELIT_SUBUH_TANGGAL_KEY = "cuaca.satelit_subuh.tanggal";

export type RingkasSubuh = {
  /** Tanggal laporan (YYYY-MM-DD) yang diproses. */
  tanggal: string;
  /** Kapan diproses (ISO). */
  pada: string;
  laporan: number;
  diperbarui: number;
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
    const j = JSON.parse(v) as RingkasSubuh;
    return typeof j.tanggal === "string" && typeof j.pada === "string" ? j : null;
  } catch {
    return null;
  }
}

export async function catatSubuhTerakhir(r: RingkasSubuh): Promise<void> {
  await simpanSetelan(SATELIT_SUBUH_TERAKHIR_KEY, JSON.stringify(r));
}

/**
 * Penanda penjadwal terpisah dari ringkasan layar: tombol "Perbarui sekarang"
 * yang ditekan sebelum data hujan sehari penuh terbit tidak boleh membuat
 * penjadwal pukul 04.00 melewati tanggal itu.
 */
export async function getSubuhTanggalTerjadwal(): Promise<string | null> {
  return (await nilaiSetelan(SATELIT_SUBUH_TANGGAL_KEY)) || null;
}

export async function catatSubuhTanggalTerjadwal(tanggal: string): Promise<void> {
  await simpanSetelan(SATELIT_SUBUH_TANGGAL_KEY, tanggal);
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
