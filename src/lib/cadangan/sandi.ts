import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Transform } from "node:stream";

/**
 * SANDI CADANGAN DATABASE (DECISIONS 650).
 *
 * Isi database (nilai kontrak, data orang, hash kata sandi) disandikan SEBELUM
 * meninggalkan server, jadi yang tersimpan di Google Drive tidak bisa dibaca
 * siapa pun yang hanya memegang akun Google-nya.
 *
 * Bentuk berkas: `MARLINCAD1\n` · IV 12 byte · isi AES-256-GCM · tag 16 byte.
 * Tag di UJUNG supaya penyandian bisa mengalir (pg_dump → sandi → Drive) tanpa
 * menampung seluruh isi di memori.
 *
 * Sengaja tanpa `server-only`: skrip pembuka cadangan (`scripts/buka-cadangan.mts`)
 * memakai berkas yang sama, jadi format tulis dan baca tidak mungkin berbeda.
 */

export const KEPALA_SANDI = "MARLINCAD1\n";
const PANJANG_IV = 12;
const PANJANG_TAG = 16;

/** `BACKUP_ENCRYPTION_KEY`: 32 byte, ditulis base64 atau 64 karakter hex. Selain itu null. */
export function kunciCadanganDari(raw: string | undefined | null): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  try {
    const b = Buffer.from(s, "base64");
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

/** Aliran penyandi: masukkan isi apa adanya, keluar berkas cadangan utuh. */
export function sandiStream(kunci: Buffer): Transform {
  const iv = randomBytes(PANJANG_IV);
  const cipher = createCipheriv("aes-256-gcm", kunci, iv);
  let kepalaTerkirim = false;
  const kepala = () => {
    if (kepalaTerkirim) return [];
    kepalaTerkirim = true;
    return [Buffer.from(KEPALA_SANDI), iv];
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        for (const k of kepala()) this.push(k);
        cb(null, cipher.update(chunk));
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb) {
      try {
        for (const k of kepala()) this.push(k);
        this.push(cipher.final());
        cb(null, cipher.getAuthTag());
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

/** Buka berkas cadangan. Melempar bila kunci salah atau satu byte pun berubah. */
export function bukaSandi(berkas: Buffer, kunci: Buffer): Buffer {
  const kepala = Buffer.from(KEPALA_SANDI);
  if (berkas.length < kepala.length + PANJANG_IV + PANJANG_TAG || !berkas.subarray(0, kepala.length).equals(kepala)) {
    throw new Error("Ini bukan berkas cadangan MARLIN.");
  }
  const iv = berkas.subarray(kepala.length, kepala.length + PANJANG_IV);
  const tag = berkas.subarray(berkas.length - PANJANG_TAG);
  const isi = berkas.subarray(kepala.length + PANJANG_IV, berkas.length - PANJANG_TAG);
  const d = createDecipheriv("aes-256-gcm", kunci, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(isi), d.final()]);
  } catch {
    throw new Error("Cadangan tidak bisa dibuka: kuncinya salah, atau berkasnya rusak.");
  }
}
