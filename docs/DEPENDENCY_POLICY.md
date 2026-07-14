# DEPENDENCY POLICY — MARLIN

## Prinsip

1. **Pin exact** — semua direct dependency di `package.json` ditulis versi exact (tanpa `^`, `~`, `*`, `latest`, `next`). Lockfile (`pnpm-lock.yaml`) wajib di-commit. Install selalu `pnpm install --frozen-lockfile`.
2. **Open-source only** — lisensi yang diterima tanpa analisis: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, PostgreSQL, 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0. Lisensi lain (AGPL, SSPL, BUSL, proprietary, unknown) wajib analisis tertulis di `docs/rebuild/OPEN_SOURCE_LICENSE_AUDIT.md` sebelum dipakai; default = tolak.
3. **Tidak ada** beta/alpha/rc/canary/nightly di production. Tidak ada package deprecated/abandoned (cek advisory + release activity sebelum menambah).
4. **Satu package manager** — pnpm via Corepack (`packageManager` di package.json). Lockfile npm/yarn/bun dilarang.

## Kapan update

- **Patch/minor**: batch bulanan atau saat security advisory. Baca release notes resmi (GitHub Releases / changelog proyek — bukan blog pihak ketiga).
- **Major**: hanya dengan: (a) baca migration guide resmi, (b) jalankan codemod resmi bila ada, (c) `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build`, (d) E2E kritis, (e) `docker build` verification. Update `docs/rebuild/TECHNOLOGY_AUDIT.md`.
- **Security critical**: segera, jalur yang sama dipercepat.

## Cara memeriksa

```bash
pnpm outdated          # kandidat update
pnpm audit             # vulnerability
pnpm licenses list     # lisensi (diaudit di CI)
```

## Test wajib sebelum merge update dependency

`pnpm install --frozen-lockfile` → `db:generate` → `typecheck` → `lint` → `test --run` → `build` → `docker build`. CI menjalankan semuanya; PR gagal = tidak merge.

## Rollback

Dependency update selalu commit terpisah → rollback = revert commit + `pnpm install --frozen-lockfile`. Jangan campur update dependency dengan perubahan fitur.

## Runtime

Node = Active LTS terbaru, dipin identik di: `package.json engines`, `.nvmrc`, base image Dockerfile. Saat Node LTS baru masuk Active: update ketiganya dalam satu PR + Docker verification.
