import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { Transform } from "node:stream";

/**
 * SANDI CADANGAN DATABASE (DECISIONS 650).
 *
 * Isi database (nilai kontrak, data orang, hash kata sandi) disandikan SEBELUM
 * meninggalkan server, jadi yang tersimpan di Google Drive tidak bisa dibaca
 * siapa pun yang hanya memegang akun Google-nya.
 *
 * `BACKUP_ENCRYPTION_KEY` boleh dua bentuk (permintaan user 2026-10-05: *"apakah
 * kunci enkripsinya bisa kuset sendiri?"*):
 *   - kunci acak 32 byte (base64 / 64 hex) → dipakai langsung
 *       berkas: `MARLINCAD1\n` · IV 12 · isi AES-256-GCM · tag 16
 *   - kalimat sandi buatan sendiri, minimal 12 karakter → kunci diturunkan
 *     dengan scrypt dan GARAM ACAK per berkas (disimpan di kepala berkas)
 *       berkas: `MARLINCAD2\n` · garam 16 · IV 12 · isi · tag 16
 * Pembuka mengenali bentuknya dari kepala berkas.
 *
 * Tag di UJUNG supaya penyandian bisa mengalir (pg_dump → sandi → Drive) tanpa
 * menampung seluruh isi di memori.
 *
 * Sengaja tanpa `server-only`: skrip pembuka cadangan (`scripts/buka-cadangan.mts`)
 * memakai berkas yang sama, jadi format tulis dan baca tidak mungkin berbeda.
 */

export const KEPALA_SANDI = "MARLINCAD1\n";
const KEPALA_FRASA = "MARLINCAD2\n";
const PANJANG_IV = 12;
const PANJANG_TAG = 16;
const PANJANG_GARAM = 16;
export const FRASA_MINIMUM = 12;
/** scrypt N=2^15: ±0,1 detik per berkas, cukup mahal untuk menebak kalimat sandi. */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type KunciCadangan = { jenis: "kunci"; kunci: Buffer } | { jenis: "frasa"; frasa: string };

/** Isi `BACKUP_ENCRYPTION_KEY` → kunci, atau null bila kosong / kurang dari 12 karakter. */
export function kunciCadanganDari(raw: string | undefined | null): KunciCadangan | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return { jenis: "kunci", kunci: Buffer.from(s, "hex") };
  if (/^[A-Za-z0-9+/]{43}=$/.test(s)) {
    const b = Buffer.from(s, "base64");
    if (b.length === 32) return { jenis: "kunci", kunci: b };
  }
  return s.length >= FRASA_MINIMUM ? { jenis: "frasa", frasa: s } : null;
}

const sebagaiKunci = (k: KunciCadangan | Buffer): KunciCadangan =>
  Buffer.isBuffer(k) ? { jenis: "kunci", kunci: k } : k;

const turunkan = (frasa: string, garam: Buffer) => scryptSync(frasa.normalize("NFC"), garam, 32, SCRYPT);

/** Aliran penyandi: masukkan isi apa adanya, keluar berkas cadangan utuh. */
export function sandiStream(k: KunciCadangan | Buffer): Transform {
  const kc = sebagaiKunci(k);
  const iv = randomBytes(PANJANG_IV);
  const garam = kc.jenis === "frasa" ? randomBytes(PANJANG_GARAM) : null;
  const kunci = kc.jenis === "frasa" ? turunkan(kc.frasa, garam!) : kc.kunci;
  const cipher = createCipheriv("aes-256-gcm", kunci, iv);
  let kepalaTerkirim = false;
  const kepala = () => {
    if (kepalaTerkirim) return [];
    kepalaTerkirim = true;
    return garam ? [Buffer.from(KEPALA_FRASA), garam, iv] : [Buffer.from(KEPALA_SANDI), iv];
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        for (const b of kepala()) this.push(b);
        cb(null, cipher.update(chunk));
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb) {
      try {
        for (const b of kepala()) this.push(b);
        this.push(cipher.final());
        cb(null, cipher.getAuthTag());
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

/** Buka berkas cadangan. Melempar bila kunci salah atau satu byte pun berubah. */
export function bukaSandi(berkas: Buffer, k: KunciCadangan | Buffer): Buffer {
  const kc = sebagaiKunci(k);
  const v1 = Buffer.from(KEPALA_SANDI);
  const v2 = Buffer.from(KEPALA_FRASA);
  let awal: number;
  let kunci: Buffer;
  if (berkas.subarray(0, v2.length).equals(v2)) {
    if (kc.jenis !== "frasa") throw new Error("Cadangan ini dibuat dengan kalimat sandi, bukan kunci acak.");
    const garam = berkas.subarray(v2.length, v2.length + PANJANG_GARAM);
    kunci = turunkan(kc.frasa, garam);
    awal = v2.length + PANJANG_GARAM;
  } else if (berkas.subarray(0, v1.length).equals(v1)) {
    if (kc.jenis !== "kunci") throw new Error("Cadangan ini dibuat dengan kunci acak, bukan kalimat sandi.");
    kunci = kc.kunci;
    awal = v1.length;
  } else {
    throw new Error("Ini bukan berkas cadangan MARLIN.");
  }
  if (berkas.length < awal + PANJANG_IV + PANJANG_TAG) throw new Error("Berkas cadangan terpotong.");
  const iv = berkas.subarray(awal, awal + PANJANG_IV);
  const tag = berkas.subarray(berkas.length - PANJANG_TAG);
  const isi = berkas.subarray(awal + PANJANG_IV, berkas.length - PANJANG_TAG);
  const d = createDecipheriv("aes-256-gcm", kunci, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(isi), d.final()]);
  } catch {
    throw new Error("Cadangan tidak bisa dibuka: kuncinya salah, atau berkasnya rusak.");
  }
}
