#!/usr/bin/env node
// PENERIMA ARSIP DINGIN MARLIN — berjalan di mesin sendiri (Lenovo), bukan di Railway.
//
// Tugasnya satu: menyimpan BERKAS ASLI foto yang dikirim MARLIN, dan
// mengembalikannya kalau diminta. Tidak ada basis data, tidak ada dependensi,
// tidak ada yang perlu dipasang — satu berkas Node polos.
//
// Kenapa tanpa satu pun dependensi: mesin ini akan berjalan bertahun-tahun di
// pojok ruangan tanpa ada yang menengok. Tiap paket npm di dalamnya adalah
// sesuatu yang suatu hari harus di-update karena advisory keamanan, di mesin
// yang justru paling jarang disentuh. Node sendiri sudah punya semua yang
// dibutuhkan.
//
//   ARSIP_DIR=/srv/marlin-arsip ARSIP_TOKEN=<rahasia> node server.mjs
//
// Yang dijawabnya persis empat, sama dengan yang dipakai `src/lib/arsip-asli/dingin.ts`:
//
//   HEAD /photos/<lokasi>/<tanggal>/<berkas>   sudah ada? berapa besar? sidik jarinya?
//   PUT  /photos/...                           simpan (idempoten)
//   GET  /photos/...                           ambil kembali
//   DELETE /photos/...                         hapus (404 = sudah tidak ada = berhasil)
//
// ### Tiga hal yang dijaga, dan alasannya
//
// 1. **Tulis ke berkas sementara, baru ganti nama.** Kalau listrik mati di
//    tengah penulisan, yang tertinggal adalah berkas `.sedang-ditulis`, bukan
//    berkas asli yang terpotong separuh. Yang terpotong jauh lebih berbahaya:
//    ia terbaca "ada" oleh HEAD, dan MARLIN akan menghapus salinan R2-nya.
//
// 2. **Sidik jari dicocokkan sebelum ganti nama.** Yang dikirim MARLIN membawa
//    `X-Content-SHA256`. Kalau yang sampai di sini tidak cocok, berkasnya
//    dibuang dan dijawab 400 — MARLIN akan mencatat gagal dan mencoba lagi.
//
// 3. **Isi berbeda dengan kunci sama DITOLAK, bukan ditimpa** (409). Arsip yang
//    boleh ditimpa bukan arsip.
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const DIR = process.env.ARSIP_DIR;
const TOKEN = process.env.ARSIP_TOKEN;
const PORT = Number(process.env.ARSIP_PORT ?? 8787);
// Bawaannya HANYA mesin sendiri. Yang membuatnya bisa dihubungi MARLIN adalah
// Cloudflare Tunnel, yang berjalan di mesin ini juga dan menyambung ke
// 127.0.0.1 — jadi port ini tidak pernah perlu terbuka ke internet, dan tidak
// ada aturan firewall maupun IP publik yang perlu diurus.
const HOST = process.env.ARSIP_HOST ?? "127.0.0.1";

if (!DIR || !TOKEN) {
  console.error("ARSIP_DIR dan ARSIP_TOKEN wajib diisi.");
  console.error("Contoh: ARSIP_DIR=/srv/marlin-arsip ARSIP_TOKEN=xxxx node server.mjs");
  process.exit(1);
}
if (TOKEN.length < 24) {
  // Token ini satu-satunya yang menjaga isi arsip. Kalau bisa ditebak, semuanya
  // bisa diunduh siapa pun yang menemukan alamatnya.
  console.error("ARSIP_TOKEN terlalu pendek (minimal 24 karakter).");
  console.error("Buat dengan: openssl rand -hex 32");
  process.exit(1);
}

/** Bentuk kunci yang sah — SAMA PERSIS dengan `BENTUK_KUNCI` di src/lib/arsip-asli/dingin.ts. */
const BENTUK_KUNCI = /^photos\/[A-Za-z0-9._-]+\/[0-9-]+\/[A-Za-z0-9._-]+$/;

const AKAR = resolve(DIR);

/**
 * Kunci dari URL → jalur berkas di disk.
 *
 * Dua lapis, dan keduanya perlu: bentuknya dicocokkan dulu (yang tidak berbentuk
 * kunci foto ditolak mentah-mentah), lalu hasil resolve-nya diperiksa masih di
 * dalam AKAR. Lapis kedua bukan pengulangan — ia yang menangkap hal-hal yang
 * lolos regex lewat penyandian URL yang tidak terduga.
 */
function jalurBerkas(urlPath) {
  let kunci;
  try {
    kunci = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (!BENTUK_KUNCI.test(kunci) || kunci.includes("..")) return null;
  const penuh = resolve(AKAR, kunci);
  if (penuh !== AKAR && !penuh.startsWith(AKAR + sep)) return null;
  return penuh;
}

/**
 * Sidik jari disimpan di berkas pendamping saat PUT.
 *
 * Tanpa ini, tiap HEAD harus membaca ulang seluruh berkas untuk menghitung
 * sha256-nya — dan HEAD justru yang paling sering dipanggil (tiap putaran, untuk
 * tiap berkas yang menunggu). Sidik jarinya sudah dihitung sekali saat menerima;
 * menyimpannya berarti tidak perlu menghitung lagi selamanya.
 */
const jalurSidik = (p) => `${p}.sha256`;

async function sidikTersimpan(p) {
  try {
    return (await readFile(jalurSidik(p), "utf8")).trim().toLowerCase();
  } catch {
    return null;
  }
}

function tokenCocok(header) {
  const diberikan = /^Bearer (.+)$/.exec(header ?? "")?.[1];
  if (!diberikan) return false;
  const a = Buffer.from(diberikan);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function balas(res, kode, isi) {
  res.writeHead(kode, isi ? { "content-type": "application/json" } : undefined);
  res.end(isi ? JSON.stringify(isi) : undefined);
}

async function tanganiHead(res, p) {
  let st;
  try {
    st = await stat(p);
  } catch {
    return balas(res, 404);
  }
  const kepala = { "content-length": String(st.size) };
  const sha = (await sidikTersimpan(p)) ?? (await hitungSha(p));
  if (sha) kepala["x-content-sha256"] = sha;
  res.writeHead(200, kepala);
  res.end();
}

async function hitungSha(p) {
  try {
    const h = createHash("sha256");
    await pipeline(createReadStream(p), h);
    return h.digest("hex");
  } catch {
    return null;
  }
}

async function tanganiPut(req, res, p) {
  const diminta = req.headers["x-content-sha256"]?.toString().toLowerCase() ?? null;

  // Sudah ada? Jangan tulis ulang. Kalau isinya sama, ini cuma pengiriman ulang
  // sesudah proses MARLIN mati sebelum sempat mencatat — jawab berhasil dan
  // selesai. Kalau isinya BEDA, berhenti: arsip yang boleh ditimpa bukan arsip.
  const lama = await sidikTersimpan(p);
  if (lama) {
    if (!diminta || lama === diminta) return balas(res, 200, { sudahAda: true });
    return balas(res, 409, { error: "kunci sama, isi berbeda – tidak ditimpa" });
  }

  await mkdir(dirname(p), { recursive: true });
  const sementara = `${p}.${process.pid}.sedang-ditulis`;
  const h = createHash("sha256");
  let bytes = 0;
  req.on("data", (c) => {
    h.update(c);
    bytes += c.length;
  });

  try {
    await pipeline(req, createWriteStream(sementara));
  } catch (err) {
    await rm(sementara, { force: true });
    // ENOSPC disebut apa adanya: "disk arsip penuh" bisa ditindaklanjuti,
    // "gagal menulis" tidak.
    const penuh = err?.code === "ENOSPC";
    return balas(res, penuh ? 507 : 500, {
      error: penuh ? "disk arsip penuh" : "gagal menulis",
    });
  }

  const sha = h.digest("hex");
  if (diminta && sha !== diminta) {
    await rm(sementara, { force: true });
    return balas(res, 400, { error: "sidik jari tidak cocok – berkas berubah di jalan" });
  }

  // Ganti nama terakhir, sesudah isinya terbukti benar. Sampai detik ini,
  // HEAD masih menjawab 404 dan MARLIN masih menahan salinan R2-nya.
  await rename(sementara, p);
  await writeFile(jalurSidik(p), sha);
  console.log(`[arsip] simpan ${p.slice(AKAR.length + 1)} (${bytes} bytes)`);
  return balas(res, 201, { sha256: sha, bytes });
}

async function tanganiGet(res, p) {
  let st;
  try {
    st = await stat(p);
  } catch {
    return balas(res, 404);
  }
  res.writeHead(200, {
    "content-length": String(st.size),
    "content-type": "application/octet-stream",
  });
  await pipeline(createReadStream(p), res);
}

async function tanganiDelete(res, p) {
  await rm(p, { force: true });
  await rm(jalurSidik(p), { force: true });
  return balas(res, 204);
}

const server = createServer(async (req, res) => {
  try {
    // Pemeriksaan kesehatan, tanpa token — supaya Cloudflare Tunnel dan siapa
    // pun yang memasang bisa tahu servisnya hidup tanpa memegang rahasianya.
    // Tidak membocorkan apa-apa: ia tidak menyentuh isi arsip.
    if (req.url === "/sehat" && (req.method === "GET" || req.method === "HEAD")) {
      return balas(res, 200, { siap: true });
    }
    if (!tokenCocok(req.headers.authorization)) return balas(res, 403);

    const p = jalurBerkas(req.url ?? "");
    if (!p) return balas(res, 400, { error: "kunci tidak berbentuk sah" });

    if (req.method === "HEAD") return await tanganiHead(res, p);
    if (req.method === "PUT") return await tanganiPut(req, res, p);
    if (req.method === "GET") return await tanganiGet(res, p);
    if (req.method === "DELETE") return await tanganiDelete(res, p);
    return balas(res, 405, { error: "metode tidak dilayani" });
  } catch (err) {
    console.error("[arsip] galat:", err);
    if (!res.headersSent) balas(res, 500, { error: "galat internal" });
    else res.destroy();
  }
});

// Unggahan foto asli lewat uplink rumah bisa lama. Batas bawaan Node (2 menit
// untuk headers, 0 untuk request) tidak cukup ramah; MARLIN sendiri sudah
// menyerah di 90 detik, jadi di sini dilebihkan sedikit supaya yang memutus
// selalu MARLIN — pihak yang tahu apa yang harus dilakukan sesudahnya.
server.requestTimeout = 0;
server.headersTimeout = 120_000;

await mkdir(AKAR, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`[arsip] siap di http://${HOST}:${PORT} → ${AKAR}`);
});
