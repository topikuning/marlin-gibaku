// DUA BELAHAN YANG HARUS COCOK: klien MARLIN vs penerima di mesin sendiri.
//
// `tests/integration/arsip-asli-putaran.test.ts` menguji URUTAN kejadiannya
// memakai arsip tiruan. Yang diuji DI SINI hal lain: penerima sungguhan
// (`arsip-dingin/server.mjs`, dijalankan sebagai proses terpisah) dipanggil
// oleh klien sungguhan (`src/lib/arsip-asli/dingin.ts`).
//
// Kedua belahan itu ditulis terpisah dan hanya bertemu lewat empat kata
// sepakat: bentuk kunci, header `Authorization`, header `X-Content-SHA256`, dan
// arti tiap kode status. Kesepakatan yang tidak ada ujinya akan rusak diam-diam
// — dan rusaknya baru ketahuan saat berkas asli sudah dihapus dari R2.
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_test";

vi.mock("server-only", () => ({}));

const TOKEN = "rahasia-uji-yang-cukup-panjang-untuk-lolos";
const ISI = Buffer.from(`FOTO-ASLI-${"x".repeat(5000)}`);
const SHA = createHash("sha256").update(ISI).digest("hex");
const KUNCI = "photos/knmp-besole-tulungagung/2026-09-08/d38eb2d2.asli.jpg";

let anak: ChildProcess;
let dir: string;
let PORT = 0;

/*
 * Port dipilih SISTEM (`ARSIP_PORT=0`), bukan ditulis di sini.
 *
 * Versi pertama memakai 8791 dan langsung terbukti rapuh: satu proses uji yang
 * belum sempat mati membuat putaran berikutnya gagal tiga kali dengan sebab yang
 * tidak ada hubungannya dengan yang diuji. Di CI, berkas uji berjalan
 * berdampingan – nomor port tetap adalah tabrakan yang menunggu waktu.
 *
 * `ORIGINAL_ARCHIVE_URL` karena itu baru bisa disetel sesudah portnya diketahui,
 * dan `dingin.ts` membacanya lewat `env` yang dimuat sekali – jadi modulnya
 * diimpor DI DALAM `beforeAll`, sesudah portnya masuk ke `process.env`.
 */

type Klien = typeof import("@/lib/arsip-asli/dingin");
let dingin: Klien;

const setelan = () => {
  const s = dingin.setelanDingin();
  if (!s) throw new Error("setelan arsip dingin kosong");
  return s;
};
const periksaDingin: Klien["periksaDingin"] = (...a) => dingin.periksaDingin(...a);
const kirimDingin: Klien["kirimDingin"] = (...a) => dingin.kirimDingin(...a);
const ambilDingin: Klien["ambilDingin"] = (...a) => dingin.ambilDingin(...a);
const hapusDingin: Klien["hapusDingin"] = (...a) => dingin.hapusDingin(...a);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "arsip-uji-"));
  anak = spawn(process.execPath, [new URL("../../arsip-dingin/server.mjs", import.meta.url).pathname], {
    env: { ...process.env, ARSIP_DIR: dir, ARSIP_TOKEN: TOKEN, ARSIP_PORT: "0", ARSIP_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Portnya dibaca dari baris siap yang dicetak penerimanya sendiri.
  PORT = await new Promise<number>((selesai, gagal) => {
    const jam = setTimeout(() => gagal(new Error("penerima arsip tidak kunjung siap")), 20_000);
    anak.stdout!.on("data", (b: Buffer) => {
      const cocok = /http:\/\/127\.0\.0\.1:(\d+)/.exec(b.toString());
      if (cocok) {
        clearTimeout(jam);
        selesai(Number(cocok[1]));
      }
    });
    anak.on("exit", (kode) => {
      clearTimeout(jam);
      gagal(new Error(`penerima arsip berhenti (exit ${kode})`));
    });
  });

  process.env.ORIGINAL_ARCHIVE_URL = `http://127.0.0.1:${PORT}`;
  process.env.ORIGINAL_ARCHIVE_TOKEN = TOKEN;
  dingin = await import("@/lib/arsip-asli/dingin");

  // Benar-benar menjawab, bukan sekadar sudah mencetak barisnya.
  const r = await fetch(`http://127.0.0.1:${PORT}/sehat`);
  expect(r.ok).toBe(true);
}, 40_000);

afterAll(async () => {
  anak?.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("penerima arsip dingin menjawab klien MARLIN", () => {
  it("belum ada → 404 dibaca sebagai 'belum ada', bukan galat", async () => {
    await expect(periksaDingin(setelan(), KUNCI)).resolves.toEqual({ ada: false });
  });

  it("kirim → terbaca kembali dengan ukuran & sidik jari yang sama", async () => {
    await kirimDingin(setelan(), KUNCI, ISI);
    const cek = await periksaDingin(setelan(), KUNCI);
    expect(cek).toEqual({ ada: true, bytes: ISI.length, sha256: SHA });
  });

  it("byte yang kembali persis byte yang dikirim", async () => {
    const kembali = await ambilDingin(setelan(), KUNCI);
    expect(kembali.equals(ISI)).toBe(true);
  });

  it("berkas sementara tidak tertinggal di direktori arsip", async () => {
    // Kalau ada, berarti jalur ganti-nama tidak dipakai — dan berkas separuh
    // bisa terbaca "ada" oleh HEAD.
    const { readdir } = await import("node:fs/promises");
    const isi = await readdir(join(dir, "photos/knmp-besole-tulungagung/2026-09-08"));
    expect(isi.filter((n) => n.includes("sedang-ditulis"))).toEqual([]);
  });

  it("kirim ulang isi yang sama diterima diam-diam (proses mati sebelum mencatat)", async () => {
    await expect(kirimDingin(setelan(), KUNCI, ISI)).resolves.toBeUndefined();
    const disk = await readFile(join(dir, KUNCI));
    expect(disk.equals(ISI)).toBe(true);
  });

  it("kunci sama dengan isi BERBEDA ditolak, berkas lama utuh", async () => {
    await expect(kirimDingin(setelan(), KUNCI, Buffer.from("ISI-LAIN"))).rejects.toThrow(/409/);
    const disk = await readFile(join(dir, KUNCI));
    expect(disk.equals(ISI), "berkas arsip tertimpa").toBe(true);
  });

  it("token salah ditolak, dan penolakannya terbaca sebagai galat oleh klien", async () => {
    const palsu = { ...setelan(), token: "token-salah-yang-panjangnya-beda" };
    await expect(periksaDingin(palsu, KUNCI)).rejects.toThrow(/403/);
  });

  it("kunci di luar ruang foto tidak pernah sampai ke disk", async () => {
    // Klien menolaknya lebih dulu; penerima menolaknya lagi. Dua-duanya perlu:
    // yang menjaga disk mesin sendiri adalah pemeriksaan DI mesin itu.
    await expect(ambilDingin(setelan(), "../../etc/passwd")).rejects.toThrow(/tidak berbentuk sah/);
    const r = await fetch(`http://127.0.0.1:${PORT}/documents/rahasia.pdf`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(400);
  });

  it("hapus, lalu hapus lagi – keduanya berhasil", async () => {
    await expect(hapusDingin(setelan(), KUNCI)).resolves.toBeUndefined();
    await expect(periksaDingin(setelan(), KUNCI)).resolves.toEqual({ ada: false });
    await expect(hapusDingin(setelan(), KUNCI)).resolves.toBeUndefined();
  });
});
