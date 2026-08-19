/**
 * MOCK R2 lokal — hanya untuk membangkitkan foto pada seed buku manual.
 *
 * Cloudflare R2 tidak dikonfigurasi di lingkungan pengembangan/sandbox (lihat
 * `.env.example` — opsional). Tanpa objek storage yang BENAR-BENAR bisa
 * di-GET oleh peramban, galeri foto menyaring habis foto tanpa `thumbUrl`
 * (lihat `PhotoGallery`) — jadi seed yang menulis baris `Photo` tanpa objek
 * nyata menghasilkan galeri KOSONG, bukan galeri berisi kotak rusak. Baik-baik
 * saja untuk sebagian besar layar, tapi bab lapangan buku manual justru
 * PERLU menunjukkan foto sungguhan di Foto Cepat & laporan harian.
 *
 * Skrip ini menjalankan server S3-compatible MINIMAL: PUT menyimpan berkas ke
 * disk, GET membacanya balik — TANPA memeriksa signature Sig V4 (permintaan
 * apa pun yang path-nya cocok dilayani). Ini bukan pengganti R2 yang aman;
 * jangan pernah dipakai di luar loopback / lingkungan sandbox sekali pakai.
 *
 * `R2_ENDPOINT` WAJIB https (`src/lib/env.ts` menolak http) — jadi server ini
 * TLS sungguhan dengan sertifikat self-signed. Proses yang bicara padanya
 * (skrip seed & Playwright) harus mempercayai CA itu secara eksplisit
 * (`NODE_EXTRA_CA_CERTS` / `ignoreHTTPSErrors`) — bukan mematikan verifikasi
 * TLS secara umum.
 *
 *   tsx scripts/manual/mock-r2.ts <port> <direktori-data> <cert.pem> <key.pem>
 */
import { createServer } from "node:https";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const [port, dataDir, certPath, keyPath] = process.argv.slice(2);
if (!port || !dataDir || !certPath || !keyPath) {
  console.error("Pakai: tsx mock-r2.ts <port> <dataDir> <cert.pem> <key.pem>");
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });

function pathFor(urlPath: string): string {
  // urlPath = /<bucket>/<key...> — bucket diabaikan (satu direktori data saja),
  // supaya penjepret & skrip seed tidak perlu sepakat soal bucket sungguhan.
  const parts = decodeURIComponent(urlPath).split("/").filter(Boolean).slice(1);
  const rel = normalize(join(...parts));
  if (rel.startsWith("..")) throw new Error("path traversal ditolak");
  return join(dataDir, rel);
}

const server = createServer(
  { cert: readFileSync(certPath), key: readFileSync(keyPath) },
  (req, res) => {
    const url = req.url ?? "/";
    const p = pathFor(url.split("?")[0]!);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"mock"' });
        res.end();
      });
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      if (!existsSync(p)) {
        res.writeHead(404);
        res.end("NoSuchKey");
        return;
      }
      const body = req.method === "GET" ? readFileSync(p) : Buffer.alloc(0);
      res.writeHead(200, {
        "content-type": p.endsWith(".webp") ? "image/webp" : "application/octet-stream",
        "content-length": existsSync(p) ? require("node:fs").statSync(p).size : 0,
      });
      res.end(body);
      return;
    }
    if (req.method === "DELETE") {
      if (existsSync(p)) unlinkSync(p);
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(405);
    res.end();
  },
);

server.listen(Number(port), "127.0.0.1", () => {
  console.log(`mock-r2: https://127.0.0.1:${port} → ${dataDir}`);
});
