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
// ### Dialeknya mengikuti gateway yang sudah lebih dulu berjalan
//
// User memasang `marlin-original-storage` (susunan ChatGPT, Docker) di mesinnya
// sebelum berkas ini ada. Berkas ini karena itu bicara dengan dialek YANG SAMA,
// bukan dialek sendiri — supaya di dunia ini cuma ada satu protokol arsip
// dingin, dan MARLIN tidak perlu tahu yang mana yang sedang berjalan:
//
//   GET    /health                       {"ok":true} – tanpa token, untuk pengenalan
//   HEAD   /v1/objects/<kunci base64url> sudah ada? berapa besar? sidik jarinya?
//   PUT    /v1/objects/<...>             simpan (idempoten)
//   GET    /v1/objects/<...>             ambil kembali
//   DELETE /v1/objects/<...>             hapus – wajib `X-Delete-SHA256`
//
// Token salah dijawab 401 (bukan 403): 403 disediakan untuk Cloudflare Access,
// yang menghadang lebih dulu di depan. Dua lapis, dua kode – supaya yang membaca
// galatnya tahu lapis mana yang menolaknya.
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
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const DIR = process.env.ARSIP_DIR;
const TOKEN = process.env.ARSIP_TOKEN;
const PORT = Number(process.env.ARSIP_PORT ?? 8787);
// Bawaannya HANYA mesin sendiri. Yang membuatnya bisa dihubungi MARLIN adalah
// Cloudflare Tunnel, yang berjalan di mesin ini juga dan menyambung ke
// 127.0.0.1 — jadi port ini tidak pernah perlu terbuka ke internet, dan tidak
// ada aturan firewall maupun IP publik yang perlu diurus.
const HOST = process.env.ARSIP_HOST ?? "127.0.0.1";
/** 32 MiB – di atas batas MARLIN 25 MB per foto, jadi tidak pernah menolak yang sah. */
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 33_554_432);
/** Berhenti menerima objek baru sebelum disknya benar-benar habis. */
const MIN_FREE_BYTES = Number(process.env.MIN_FREE_BYTES ?? 21_474_836_480);

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

/** Prefiks jalur objek; apa pun di luar ini bukan urusan berkas. */
const AWALAN_OBJEK = "/v1/objects/";

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
  if (!urlPath.startsWith(AWALAN_OBJEK)) return null;
  let kunci;
  try {
    // base64url tanpa padding; Buffer memaafkan padding yang ada maupun tidak.
    kunci = Buffer.from(urlPath.slice(AWALAN_OBJEK.length), "base64url").toString("utf8");
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

  /*
   * Dua pagar SEBELUM menulis, bukan sesudah.
   *
   * Keduanya diumumkan di `/v1/status`, dan angka yang diumumkan tapi tidak
   * ditegakkan lebih buruk daripada tidak ada: ia membuat orang mengira disknya
   * terjaga. `content-length` dipercaya di sini hanya untuk menolak lebih awal —
   * yang sebenarnya menjaga adalah hitungan byte saat mengalir di bawah.
   */
  const panjang = Number(req.headers["content-length"] ?? 0);
  if (panjang > MAX_BYTES) {
    return balas(res, 413, { error: `objek ${panjang} byte melewati MAX_BYTES ${MAX_BYTES}` });
  }
  const { statfs } = await import("node:fs/promises");
  const sisa = await statfs(AKAR).then((st) => st.bavail * st.bsize);
  if (sisa - panjang < MIN_FREE_BYTES) {
    return balas(res, 507, { error: `sisa disk ${sisa} sudah di bawah MIN_FREE_BYTES` });
  }

  await mkdir(dirname(p), { recursive: true });
  const sementara = `${p}.${process.pid}.sedang-ditulis`;
  const h = createHash("sha256");
  let bytes = 0;
  let kebesaran = false;
  req.on("data", (c) => {
    h.update(c);
    bytes += c.length;
    // Pengirim yang berbohong soal content-length tertangkap di sini.
    if (bytes > MAX_BYTES && !kebesaran) {
      kebesaran = true;
      req.destroy(new Error("melewati MAX_BYTES"));
    }
  });

  try {
    await pipeline(req, createWriteStream(sementara));
  } catch (err) {
    await rm(sementara, { force: true });
    // ENOSPC disebut apa adanya: "disk arsip penuh" bisa ditindaklanjuti,
    // "gagal menulis" tidak.
    const penuh = err?.code === "ENOSPC";
    const kode = kebesaran ? 413 : penuh ? 507 : 500;
    return balas(res, kode, {
      error: kebesaran ? `melewati MAX_BYTES ${MAX_BYTES}` : penuh ? "disk arsip penuh" : "gagal menulis",
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

/**
 * Penghapus wajib menunjukkan ia tahu apa yang dihapusnya.
 *
 * `X-Delete-SHA256` bukan formalitas: menghapus adalah satu-satunya operasi di
 * sini yang tidak bisa dibatalkan. Permintaan tanpa sidik jari, atau dengan
 * sidik jari yang tidak cocok, ditolak — karena keduanya berarti pengirimnya
 * sedang menghapus sesuatu yang bukan yang ia kira.
 */
async function tanganiDelete(req, res, p) {
  const lama = await sidikTersimpan(p);
  if (!lama) return balas(res, 404);

  const diminta = req.headers["x-delete-sha256"]?.toString().toLowerCase() ?? null;
  if (!diminta) return balas(res, 400, { error: "X-Delete-SHA256 wajib" });
  if (diminta !== lama) return balas(res, 409, { error: "sidik jari tidak cocok – tidak dihapus" });

  await rm(p, { force: true });
  await rm(jalurSidik(p), { force: true });
  console.log(`[arsip] hapus ${p.slice(AKAR.length + 1)}`);
  return balas(res, 204);
}

/** Sisa disk & batas — dipakai memastikan arsipnya menunjuk ke storage yang benar. */
async function tanganiStatus(res) {
  const { statfs } = await import("node:fs/promises");
  const st = await statfs(AKAR);
  return balas(res, 200, {
    ok: true,
    freeBytes: st.bavail * st.bsize,
    totalBytes: st.blocks * st.bsize,
    maxObjectBytes: MAX_BYTES,
    minFreeBytes: MIN_FREE_BYTES,
  });
}

const server = createServer(async (req, res) => {
  try {
    // Pemeriksaan kesehatan, tanpa token — supaya Cloudflare Tunnel dan siapa
    // pun yang memasang bisa tahu servisnya hidup tanpa memegang rahasianya.
    // Tidak membocorkan apa-apa: ia tidak menyentuh isi arsip.
    if (req.url === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      return balas(res, 200, { ok: true });
    }
    // 401, bukan 403: 403 milik Cloudflare Access yang menghadang di depan.
    if (!tokenCocok(req.headers.authorization)) return balas(res, 401);

    if (req.url === "/v1/status" && req.method === "GET") return await tanganiStatus(res);

    const p = jalurBerkas(req.url ?? "");
    if (!p) return balas(res, 400, { error: "kunci tidak berbentuk sah" });

    if (req.method === "HEAD") return await tanganiHead(res, p);
    if (req.method === "PUT") return await tanganiPut(req, res, p);
    if (req.method === "GET") return await tanganiGet(res, p);
    if (req.method === "DELETE") return await tanganiDelete(req, res, p);
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
  // Port yang SEBENARNYA dipakai, bukan yang diminta: dengan ARSIP_PORT=0
  // sistem yang memilihkan, dan yang perlu dibaca orang (atau uji) adalah
  // hasilnya.
  const { port } = server.address();
  console.log(`[arsip] siap di http://${HOST}:${port} → ${AKAR}`);
});
