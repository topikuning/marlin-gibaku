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
 * tidak ada hubungannya dengan yang diuji.
 *
 * BERKAS INI TIDAK MENYENTUH `process.env` SAMA SEKALI, dan itu bukan kerapian.
 * `env.ts` membaca `process.env` SEKALI saat dimuat, sementara vitest memakai
 * satu proses untuk banyak berkas uji. Versi sebelumnya menyetel
 * `ORIGINAL_ARCHIVE_URL` di `beforeAll`, dan nilainya ikut terbawa ke berkas
 * BERIKUTNYA — `arsip-asli-putaran.test.ts` lalu gagal tiga kali karena
 * arsip tiruannya tidak pernah dihubungi, dengan pesan yang tidak menyinggung
 * env sedikit pun. Gagalnya bergantung urutan, jadi ia hilang-timbul.
 *
 * Setelannya karena itu dirakit langsung di sini. Yang diuji berkas ini adalah
 * protokolnya, bukan cara setelan itu dibaca dari lingkungan.
 */
const { periksaDingin, kirimDingin, ambilDingin, hapusDingin } = await import(
  "@/lib/arsip-asli/dingin"
);
type Setelan = Parameters<typeof periksaDingin>[0];

const setelan = (): Setelan => {
  if (!PORT) throw new Error("penerima arsip belum siap");
  return { url: `http://127.0.0.1:${PORT}`, token: TOKEN };
};

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

  // Benar-benar menjawab, bukan sekadar sudah mencetak barisnya.
  const r = await fetch(`http://127.0.0.1:${PORT}/health`);
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

  it("token salah ditolak 401 – 403 disediakan untuk Cloudflare Access", async () => {
    // Dua lapis, dua kode. Kalau keduanya menjawab hal yang sama, pesan galat di
    // layar tidak bisa memisahkan "token gateway salah" dari "Access menghadang",
    // dan yang memasang akan memperbaiki lapis yang salah.
    const palsu = { ...setelan(), token: "token-salah-yang-panjangnya-beda" };
    await expect(periksaDingin(palsu, KUNCI)).rejects.toThrow(/401/);
  });

  it("kunci di luar ruang foto tidak pernah sampai ke disk", async () => {
    // Klien menolaknya lebih dulu; penerima menolaknya lagi. Dua-duanya perlu:
    // yang menjaga disk mesin sendiri adalah pemeriksaan DI mesin itu.
    await expect(ambilDingin(setelan(), "../../etc/passwd")).rejects.toThrow(/tidak berbentuk sah/);
    const luar = Buffer.from("documents/rahasia.pdf", "utf8").toString("base64url");
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/objects/${luar}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(400);
  });

  it("/health menjawab tanpa token – itu yang dipakai mengenali gateway", () => {
    // Tombol "Uji sambungan" mengenali lawan bicaranya dari sini SEBELUM
    // mengirim apa pun, supaya 404 dari cloudflared tidak terbaca sebagai
    // "protokolmu salah". Kalau penanda ini hilang, pengenalannya buta.
    return fetch(`http://127.0.0.1:${PORT}/health`)
      .then((r) => r.json())
      .then((j) => expect(j).toEqual({ ok: true }));
  });

  it("/v1/status menyebut sisa disk & batasnya", async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const j = await r.json();
    for (const k of ["freeBytes", "totalBytes", "maxObjectBytes", "minFreeBytes"]) {
      expect(typeof j[k], `${k} hilang dari /v1/status`).toBe("number");
    }
  });

  it("hapus TANPA sidik jari ditolak – penghapus wajib tahu apa yang dihapusnya", async () => {
    await expect(hapusDingin(setelan(), KUNCI)).rejects.toThrow(/400/);
    // Berkasnya masih utuh sesudah penolakan itu.
    const disk = await readFile(join(dir, KUNCI));
    expect(disk.equals(ISI)).toBe(true);
  });

  it("hapus dengan sidik jari, lalu hapus lagi – keduanya berhasil", async () => {
    await expect(hapusDingin(setelan(), KUNCI, SHA)).resolves.toBeUndefined();
    await expect(periksaDingin(setelan(), KUNCI)).resolves.toEqual({ ada: false });
    // 404 = memang sudah tidak ada; itu hasil yang diinginkan, bukan kegagalan.
    await expect(hapusDingin(setelan(), KUNCI, SHA)).resolves.toBeUndefined();
  });
});
