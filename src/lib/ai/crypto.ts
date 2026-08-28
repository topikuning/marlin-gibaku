import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Enkripsi rahasia AI (API key provider) at-rest di AppSetting — AES-256-GCM,
 * Node crypto murni (tanpa dependency baru). Format tersimpan:
 *   enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 * Kunci dari env AI_SECRET_ENCRYPTION_KEY (string bebas ≥ 16 char; diturunkan
 * ke 32 byte via SHA-256). Fungsi MURNI (kunci di-inject) supaya unit-testable.
 * Baca kompatibel-mundur: nilai lama plaintext tetap terbaca; simpan berikutnya
 * menulis terenkripsi. DECISIONS 133.
 */

const PREFIX = "enc:v1:";

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Turunkan kunci 32-byte dari passphrase env. Null bila env kosong/terlalu pendek. */
export function deriveEncryptionKey(passphrase: string | undefined | null): Buffer | null {
  const raw = passphrase?.trim();
  if (!raw || raw.length < 16) return null;
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Kunci dari env proses (dipakai layer config; test meng-inject sendiri). */
export function encryptionKeyFromEnv(): Buffer | null {
  return deriveEncryptionKey(process.env.AI_SECRET_ENCRYPTION_KEY);
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12); // nonce unik per enkripsi (GCM)
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export class SecretDecryptError extends Error {}

/** Dekripsi nilai terenkripsi. Lempar SecretDecryptError bila format/tag/kunci salah. */
export function decryptSecret(stored: string, key: Buffer): string {
  if (!isEncryptedSecret(stored)) throw new SecretDecryptError("bukan format terenkripsi");
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new SecretDecryptError("format enc:v1 tidak valid");
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ct = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError("dekripsi gagal – kunci salah atau data rusak");
  }
}

/**
 * Baca nilai rahasia dari storage (masa transisi): plaintext lama → apa adanya;
 * terenkripsi → dekripsi (null bila kunci tak tersedia/salah — pemanggil
 * perlakukan sebagai "belum dikonfigurasi", jangan bocorkan ciphertext).
 */
export function readStoredSecret(stored: string, key: Buffer | null): string | null {
  if (!isEncryptedSecret(stored)) return stored;
  if (!key) return null;
  try {
    return decryptSecret(stored, key);
  } catch {
    return null;
  }
}

export class SecretEncryptionUnavailable extends Error {}

/**
 * Bentuk simpan untuk SATU nilai rahasia — SATU aturan untuk semua penyimpan.
 *
 * Sampai audit 2026-08-28 ada tiga penyimpan dengan tiga perilaku berbeda:
 * `ai/config.ts` mengenkripsi dan MENOLAK menulis plaintext di production;
 * `gdrive/config.ts` diam-diam menulis plaintext bila kunci tak ada; dan
 * `waha/config.ts` tidak pernah mengenkripsi sama sekali. Akibatnya terlihat di
 * cadangan lapangan 24 Agustus: kredensial Google terenkripsi, tetapi
 * `waha.api_key` dan `waha.webhook_secret` telanjang — dan siapa pun yang
 * memegang salinan basis data memegang kuncinya.
 *
 * Aturan yang berlaku sekarang, satu tempat:
 *   - ada `AI_SECRET_ENCRYPTION_KEY` → selalu terenkripsi;
 *   - tidak ada, di production → MELEMPAR. Rahasia tidak boleh masuk basis data
 *     telanjang hanya karena satu env lupa dipasang, dan kegagalan yang senyap
 *     di sini tidak akan pernah ketahuan sampai basis datanya bocor;
 *   - tidak ada, di dev/test → plaintext, supaya pengembangan tetap jalan.
 */
export function secretUntukSimpan(plain: string): string {
  const key = encryptionKeyFromEnv();
  if (key) return encryptSecret(plain, key);
  if ((process.env.APP_ENV ?? "development") === "production") {
    throw new SecretEncryptionUnavailable(
      "AI_SECRET_ENCRYPTION_KEY belum diset di server – rahasia TIDAK disimpan. " +
        "Set env tersebut lalu ulangi.",
    );
  }
  return plain;
}

/**
 * Kunci `AppSetting` yang isinya rahasia — dipakai migrasi enkripsi-ulang.
 *
 * Berbasis POLA, bukan daftar nama: kunci rahasia berikutnya (`*.api_key`
 * provider baru, misalnya) ikut terjaring tanpa siapa pun harus ingat
 * memperbarui daftar. Daftar nama yang harus diingat manusia adalah daftar yang
 * akan tertinggal.
 */
export function kunciRahasia(key: string): boolean {
  return /(^|\.)(api_key|client_secret|refresh_token|webhook_secret)$/.test(key);
}
