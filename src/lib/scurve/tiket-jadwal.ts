import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * TIKET HASIL PEMERIKSAAN JADWAL (DECISIONS 774).
 *
 * "Periksa" membaca berkas Excel lalu mengembalikan tiket ini: jadwal yang
 * terbaca + tanda tangan HMAC. "Terapkan" mengirim tiket, BUKAN berkasnya lagi.
 * Dulu kedua langkah mengunggah dan membaca berkas yang sama – di jaringan
 * lapangan unggahan itulah yang lama, dan dibayar dua kali (pertanyaan user
 * 2026-11-24: *"kenapa import jadwal sangat lambat"*).
 *
 * Tiket mengikat lokasi dan orang, berlaku 30 menit, dan tidak bisa diubah
 * tanpa ketahuan. Server tetap memeriksa ulang jumlah minggu & kategori saat
 * menerapkan – tiket hanya menggantikan unggahan, bukan pemeriksaannya.
 */

export const TIKET_JADWAL_MS = 30 * 60_000;

export type IsiTiketJadwal = {
  lokasi: string;
  user: string;
  namaBerkas: string;
  input: { lineageKey: string; weekly: number[] }[];
};

type Badan = IsiTiketJadwal & { v: 1; dibuat: number };

const tanda = (badan: string, kunci: string) =>
  createHmac("sha256", kunci).update(`jadwal:${badan}`).digest("base64url");

export function buatTiketJadwal(isi: IsiTiketJadwal, kunci: string, sekarang = Date.now()): string {
  const badan: Badan = { v: 1, dibuat: sekarang, ...isi };
  const teks = Buffer.from(JSON.stringify(badan), "utf8").toString("base64url");
  return `${teks}.${tanda(teks, kunci)}`;
}

/** Tiket → isinya, atau null bila palsu, diubah, kedaluwarsa, atau milik lokasi/orang lain. */
export function bacaTiketJadwal(
  tiket: string,
  harap: { lokasi: string; user: string },
  kunci: string,
  sekarang = Date.now(),
): IsiTiketJadwal | null {
  const [teks, t] = tiket.split(".");
  if (!teks || !t) return null;
  const benar = Buffer.from(tanda(teks, kunci));
  const dikirim = Buffer.from(t);
  if (benar.length !== dikirim.length || !timingSafeEqual(benar, dikirim)) return null;
  let b: Badan;
  try {
    b = JSON.parse(Buffer.from(teks, "base64url").toString("utf8")) as Badan;
  } catch {
    return null;
  }
  if (b.v !== 1 || b.lokasi !== harap.lokasi || b.user !== harap.user) return null;
  if (!(sekarang - b.dibuat <= TIKET_JADWAL_MS)) return null;
  if (!Array.isArray(b.input)) return null;
  return { lokasi: b.lokasi, user: b.user, namaBerkas: b.namaBerkas, input: b.input };
}
