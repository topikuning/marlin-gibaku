import { hash, verify } from "@node-rs/argon2";

// Parameter argon2id mengikuti rekomendasi OWASP (m=19MiB, t=2, p=1).
const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
