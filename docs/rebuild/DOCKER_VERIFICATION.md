# DOCKER VERIFICATION — MARLIN

## Status per 2026-07-14

| Langkah | Hasil | Bukti |
|---|---|---|
| `docker build --no-cache -t marlin:test .` | ✅ **TERVERIFIKASI** — CI run [29350531186](https://github.com/topikuning/marlin-gibaku/actions/runs/29350531186) job "Docker build" sukses (56 dtk). Catatan: sandbox pengembangan tidak bisa menarik base image (gateway egress 403), sehingga verifikasi build dilakukan di CI |
| Runtime standalone (perintah persis CMD container: `node server.js` dari `.next/standalone` + `.next/static` + `public` + `assets`, `NODE_ENV=production`) | ✅ lulus di host | `/api/health` `{"status":"ok","db":"up"}` · `/masuk` 200 · static chunk 200 · proses berhenti bersih pada SIGTERM |
| Kompatibilitas native deps (Prisma engine WASM compiler + adapter-pg, sharp/libvips, argon2) di Node 24 bookworm-slim | ✅ prebuilt binari linux-x64 gnu terpasang & teruji lokal (uji unit foto/parser + runtime) | pnpm rebuild + smoke test |
| Healthcheck Railway | `/api/health` = proses + DB; R2 BUKAN hard-dependency (diagnostik di `/api/ready` + menu Sistem) | kode `src/app/api/{health,ready}` |
| Migrasi deploy | `prisma migrate deploy` (CLI dipasang global di runner, pinned 7.8.0); TIDAK pernah `migrate dev`/reset di deploy | Dockerfile + railway.json `preDeployCommand` |
| Non-root + signal | user `marlin` uid 1001, `tini` PID 1 | Dockerfile |

## Cara verifikasi penuh (lingkungan dgn akses registry)

```bash
docker build --no-cache -t marlin:test .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://... -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e APP_ENV=production marlin:test
curl localhost:3000/api/health     # {"status":"ok","db":"up"}
# login admin/marlin123 (seed dev), unggah dokumen (R2 env terisi), SIGTERM: docker stop -t 10
```

## Catatan

- Base image dipin `node:24.18.0-bookworm-slim` (bukan alpine — Prisma/OpenSSL/sharp).
- Image reproducible: lockfile frozen, versi exact, tanpa tag `latest`.
- Bila CI docker job merah, perbaiki sebelum menganggap deploy siap.
