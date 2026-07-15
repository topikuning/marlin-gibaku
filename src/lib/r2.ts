import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/**
 * Client R2 (S3-compatible). Endpoint sudah divalidasi + dinormalisasi di env.ts.
 * TLS TIDAK pernah di-bypass (NODE_TLS_REJECT_UNAUTHORIZED dilarang).
 */

let client: S3Client | null = null;

export function isR2Configured(): boolean {
  return env.r2 !== null;
}

function r2(): S3Client {
  if (!env.r2) throw new Error("R2 belum dikonfigurasi (R2_ENDPOINT dkk kosong)");
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: env.r2.endpoint,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return client;
}

export async function r2Put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await r2().send(
    new PutObjectCommand({ Bucket: env.r2!.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function r2GetBuffer(key: string): Promise<Buffer> {
  const res = await r2().send(new GetObjectCommand({ Bucket: env.r2!.bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function r2PresignGet(key: string, expiresIn = 300): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: env.r2!.bucket, Key: key }), { expiresIn });
}

export async function r2Delete(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: env.r2!.bucket, Key: key }));
}

export type R2SelfTestStep = { step: string; ok: boolean; detail?: string };

/** Round-trip diagnostik: PUT → GET (byte compare) → presign → DELETE. */
export async function r2SelfTest(): Promise<{ ok: boolean; steps: R2SelfTestStep[] }> {
  const steps: R2SelfTestStep[] = [];
  if (!isR2Configured()) {
    return { ok: false, steps: [{ step: "konfigurasi", ok: false, detail: "Env R2 belum diisi" }] };
  }
  steps.push({ step: "konfigurasi", ok: true, detail: `${env.r2!.endpoint} / ${env.r2!.bucket}` });
  const key = `healthcheck/${crypto.randomUUID()}.txt`;
  const payload = Buffer.from(`marlin-selftest-${Date.now()}`);
  const run = async (step: string, fn: () => Promise<string | undefined>) => {
    try {
      const detail = await fn();
      steps.push({ step, ok: true, detail });
      return true;
    } catch (err) {
      steps.push({ step, ok: false, detail: classifyR2Error(err) });
      return false;
    }
  };
  // PUT & DELETE tidak mengembalikan body — beri detail eksplisit supaya
  // "berhasil" tampak jelas (bukan baris hijau kosong yang terbaca "tak ada respon").
  const putOk = await run("PUT", async () => {
    await r2Put(key, payload, "text/plain");
    return `${payload.length} bytes terunggah`;
  });
  if (!putOk) return { ok: false, steps };
  await run("GET", async () => {
    const buf = await r2GetBuffer(key);
    if (!buf.equals(payload)) throw new Error("Isi tidak sama (checksum mismatch)");
    return `${buf.length} bytes, checksum cocok`;
  });
  await run("PRESIGN", async () => {
    const url = await r2PresignGet(key, 60);
    return url.slice(0, 64) + "…";
  });
  await run("DELETE", async () => {
    await r2Delete(key);
    return "objek uji terhapus";
  });
  return { ok: steps.every((s) => s.ok), steps };
}

/** Bedakan jenis error R2 agar diagnosanya jelas. */
export function classifyR2Error(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return `DNS gagal — endpoint salah? (${msg})`;
  if (/certificate|TLS|SSL/i.test(msg)) return `TLS gagal — jangan bypass, cek endpoint (${msg})`;
  if (name === "InvalidAccessKeyId" || /InvalidAccessKeyId/.test(msg)) return "Access Key ID salah";
  if (name === "SignatureDoesNotMatch" || /SignatureDoesNotMatch/.test(msg)) return "Secret Access Key salah";
  if (name === "NoSuchBucket" || /NoSuchBucket/.test(msg)) return "Bucket tidak ada";
  if (name === "AccessDenied" || /AccessDenied/.test(msg)) return "Ditolak — cek permission token R2";
  if (/ETIMEDOUT|timeout/i.test(msg)) return `Timeout jaringan (${msg})`;
  return msg;
}
