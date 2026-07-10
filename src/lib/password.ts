import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing (DECISIONS 003 & 019).
 * @node-rs/argon2 default = Argon2id (lebih tahan GPU/side-channel dari bcrypt).
 * `verify` membaca parameter dari encoded hash tersimpan.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export function verifyPassword(
  storedHash: string,
  plain: string
): Promise<boolean> {
  return verify(storedHash, plain);
}
