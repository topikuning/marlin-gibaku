import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

/**
 * Cloudflare R2 (S3-compatible). Env di Railway:
 * R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 */
export const R2_BUCKET = process.env.R2_BUCKET ?? "";

let _client: S3Client | null = null;

export function r2Client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey || !R2_BUCKET) {
    throw new Error(
      "R2 belum dikonfigurasi (R2_ENDPOINT/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)."
    );
  }
  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return _client;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
}

/** Upload buffer ke R2. */
export async function r2Put(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/** Ambil objek dari R2 sebagai Buffer (server-side). */
export async function r2GetBuffer(key: string): Promise<Buffer> {
  const res = await r2Client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Presigned URL untuk download (privat, berlaku singkat). */
export function r2PresignGet(key: string, expiresIn = 300): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { expiresIn }
  );
}

export async function r2Delete(key: string): Promise<void> {
  await r2Client().send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
  );
}

export type R2TestStep = { name: string; ok: boolean; detail?: string };
export type R2TestResult = {
  configured: boolean;
  env: { endpoint: boolean; bucket: boolean; accessKey: boolean; secretKey: boolean };
  endpointHost: string | null;
  bucket: string | null;
  steps: R2TestStep[];
  ok: boolean;
  error?: string;
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Tes koneksi R2 secara nyata: PUT → GET (cek isi) → presign → DELETE.
 * Tidak menyimpan file permanen (auto cleanup). Untuk halaman Diagnostik.
 */
export async function r2SelfTest(): Promise<R2TestResult> {
  const env = {
    endpoint: !!process.env.R2_ENDPOINT,
    bucket: !!process.env.R2_BUCKET,
    accessKey: !!process.env.R2_ACCESS_KEY_ID,
    secretKey: !!process.env.R2_SECRET_ACCESS_KEY,
  };
  let endpointHost: string | null = null;
  try {
    endpointHost = process.env.R2_ENDPOINT ? new URL(process.env.R2_ENDPOINT).host : null;
  } catch {
    endpointHost = process.env.R2_ENDPOINT ?? null;
  }
  const res: R2TestResult = {
    configured: isR2Configured(),
    env,
    endpointHost,
    bucket: process.env.R2_BUCKET ?? null,
    steps: [],
    ok: false,
  };
  if (!res.configured) {
    res.error = "Variabel R2 belum lengkap (cek R2_ENDPOINT/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY).";
    return res;
  }

  const key = `healthcheck/${randomUUID()}.txt`;
  const payload = Buffer.from(`marlin-r2-test ${key}`);

  try {
    await r2Put(key, payload, "text/plain");
    res.steps.push({ name: "Upload (PUT)", ok: true });
  } catch (e) {
    res.steps.push({ name: "Upload (PUT)", ok: false, detail: errMsg(e) });
    res.error = errMsg(e);
    return res; // tak ada gunanya lanjut kalau upload gagal
  }

  try {
    const back = await r2GetBuffer(key);
    const match = back.equals(payload);
    res.steps.push({ name: "Ambil (GET)", ok: match, detail: match ? undefined : "isi file tidak cocok" });
  } catch (e) {
    res.steps.push({ name: "Ambil (GET)", ok: false, detail: errMsg(e) });
  }

  try {
    const url = await r2PresignGet(key, 60);
    res.steps.push({ name: "Presign URL (untuk tampil foto)", ok: Boolean(url) });
  } catch (e) {
    res.steps.push({ name: "Presign URL (untuk tampil foto)", ok: false, detail: errMsg(e) });
  }

  try {
    await r2Delete(key);
    res.steps.push({ name: "Hapus (cleanup)", ok: true });
  } catch (e) {
    res.steps.push({ name: "Hapus (cleanup)", ok: false, detail: errMsg(e) });
  }

  res.ok = res.steps.length > 0 && res.steps.every((s) => s.ok);
  return res;
}
