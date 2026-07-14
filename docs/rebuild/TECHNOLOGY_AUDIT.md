# TECHNOLOGY AUDIT — MARLIN Rebuild

Tanggal audit: 2026-07-14. Sumber versi: registry npm resmi (`npm view`), `nodejs.org/dist/index.json`.
Kebijakan: versi stable/LTS terbaru, open-source, pinned exact. Lihat `docs/DEPENDENCY_POLICY.md`.

## Runtime & Toolchain

| Technology | Current | Latest Stable/LTS | Target | Channel | License | Official Source | Compatibility | Decision | Reason |
|---|---|---|---|---|---|---|---|---|---|
| Node.js | 22 (>=22.0.0 range) | **24.18.0** (Active LTS "Krypton") | 24.18.0 | Active LTS | MIT-style (Node license) | nodejs.org/dist | Prisma 7 engines `>=24` OK; Next 16 OK | **UPGRADE** | Node 24 = Active LTS per Jul 2026; Node 22 sudah Maintenance |
| pnpm | 9.15.0 | 11.13.0 | 11.13.0 | stable | MIT | npm registry | Corepack 0.35 OK | **UPGRADE** | latest stable, aktifkan via Corepack, pin di `packageManager` |
| TypeScript | ^5.7.2 | 7.0.2 (native), 5.9.3 (JS line) | **5.9.3** | stable | Apache-2.0 | npm/microsoft | TS 7 (compiler native Go) belum diverifikasi kompatibel dengan plugin `next` tsserver, `eslint-config-next`, dan Prisma generated types | **UPGRADE ke 5.9.3, TAHAN dari 7.x** | 7.0.2 baru rilis; ekosistem (typescript-eslint, next plugin) belum menjaminnya. Didokumentasikan sebagai pengecualian sadar |
| PostgreSQL | 16 (lokal/Railway) | 18.x | **16+** (tested 16.13) | stable | PostgreSQL License | postgresql.org | Prisma 7 & Railway mendukung 16–17; fitur schema tidak butuh >16 | **KEEP 16+** | Tidak memaksakan major terbaru; schema kompatibel 16–18 |

## Framework & Library Production

| Technology | Current | Latest Stable | Target | License | Compatibility | Decision | Reason |
|---|---|---|---|---|---|---|---|
| Next.js | ^15.1.3 | 16.2.10 | 16.2.10 | MIT | React 19.2 OK; Node 24 OK | **UPGRADE major** | App Router tetap; `output: "standalone"` untuk Docker |
| React / react-dom | ^19.0.0 | 19.2.7 | 19.2.7 | MIT | peer Next 16 `^19` | **UPGRADE minor** | |
| Prisma / @prisma/client | ^6.1.0 | 7.8.0 | 7.8.0 | Apache-2.0 | Butuh generator `prisma-client` + driver adapter | **UPGRADE major** | Rust engine dihapus di v7 → pakai `@prisma/adapter-pg` 7.8.0 |
| @prisma/adapter-pg | — | 7.8.0 | 7.8.0 | Apache-2.0 | wajib Prisma 7 | **ADD** | Driver adapter Postgres |
| Tailwind CSS + @tailwindcss/postcss | 4.0.0-beta.8 (**beta!**) | 4.3.2 | 4.3.2 | MIT | PostCSS pipeline sama | **UPGRADE beta→stable** | Beta di production melanggar kebijakan |
| zod | ^3.24.1 | 4.4.3 | 4.4.3 | MIT | API v4 (`z.email()` dsb) | **UPGRADE major** | |
| next-auth | 5.0.0-**beta**.25 | 4.24.14 (v5 tidak pernah stable) | **HAPUS** | ISC | — | **REPLACE** | Beta permanen = melanggar kebijakan. Diganti auth custom: credentials + session DB (argon2id, revocable). Lihat DECISIONS 051 |
| @node-rs/argon2 | ^2.0.2 | 2.0.2 | 2.0.2 | MIT | Node 24 prebuilt OK | KEEP (pin) | |
| ag-grid-community / ag-grid-react | — | 36.0.0 | 36.0.0 | MIT | React 19 OK | **ADD** | Grid utama wajib (Community only, tanpa Enterprise) |
| @aws-sdk/client-s3 + s3-request-presigner | ^3.700.0 | 3.x latest saat install | pin exact hasil install | Apache-2.0 | — | UPGRADE+pin | R2 S3-compatible |
| sharp | ^0.35.3 | 0.35.3 | 0.35.3 | Apache-2.0 | Node 24 + bookworm-slim OK | KEEP (pin) | |
| exifreader | ^4.25.0 | 4.41.0 | 4.41.0 | MPL-2.0 | — | UPGRADE | EXIF/GPS foto |
| exceljs | ^4.4.0 | 4.4.0 | 4.4.0 | MIT | — | KEEP (pin) | Import RAB xlsx + export spreadsheet server-side (bukan AG Grid Enterprise) |
| date-fns | ^4.1.0 | 4.4.0 | 4.4.0 | MIT | — | UPGRADE | |
| @date-fns/tz | — | 1.5.0 | 1.5.0 | MIT | date-fns 4 | **ADD** | Asia/Jakarta first-class |
| lucide-react | ^0.469.0 | 1.24.0 | 1.24.0 | ISC | React 19 OK | UPGRADE | Satu library ikon |
| clsx / tailwind-merge | ada | latest | pin exact | MIT | — | KEEP | util `cn()` |
| @tanstack/react-table | ^8.21.3 | — | **HAPUS** | MIT | — | REMOVE | Digantikan AG Grid Community |
| @tanstack/react-query | ^5.62.7 | — | **HAPUS** | MIT | — | REMOVE | Tidak terpakai (server-first) |
| @react-pdf/renderer | ^4.1.6 | — | **HAPUS** | MIT | — | REMOVE | Tidak terpakai; PDF via halaman cetak print-CSS |
| recharts | ^2.15.0 | — | **HAPUS** | MIT | — | REMOVE | Tidak terpakai; kurva-S = SVG custom |
| leaflet / react-leaflet / @types/leaflet | ada | — | **HAPUS (defer)** | BSD-2 / MIT | — | REMOVE | Peta di luar scope rebuild inti; dicatat di REBUILD_PLAN sebagai defer |
| react-hook-form | ^7.54.2 | 7.81.0 | **HAPUS** | MIT | — | REMOVE | Form pakai Server Actions + FormData + zod; dependency tidak diperlukan |
| tsx | ^4.19.2 | 4.23.1 | 4.23.1 (dev) | MIT | — | UPGRADE, pindah devDeps | Seed runner |

## Dev / Test / Lint

| Technology | Current | Latest | Target | License | Decision |
|---|---|---|---|---|---|
| vitest | ^2.1.8 (tanpa config, 0 test) | 4.1.10 | 4.1.10 | MIT | UPGRADE + config + test nyata |
| @playwright/test | ^1.49.1 (tanpa config) | 1.61.1 | 1.61.1 | Apache-2.0 | UPGRADE + config + E2E kritis (Chromium pre-installed `/opt/pw-browsers`) |
| eslint | ^9.17.0 | 10.7.0 | **9.39.5** | MIT | UPGRADE ke 9.x terbaru; ESLint 10 DITAHAN — eslint-plugin-react (dependency eslint-config-next 16) belum kompatibel dgn ESLint 10; dievaluasi ulang saat Next merilis dukungan |
| eslint-config-next | ^15.1.3 | 16.2.10 | 16.2.10 | MIT | UPGRADE |
| @types/node | ^22 | 26.x | 24.x (ikut runtime Node 24) | MIT | pin ke major runtime |
| @types/react, @types/react-dom | ^19.0.2 | latest 19.x | pin exact | MIT | UPGRADE |

## Keputusan lintas-kebijakan yang didokumentasikan

1. **TypeScript ditahan di 5.9.3** (bukan 7.0.2): TS7 = port native baru; `next` typescript plugin & typescript-eslint belum diverifikasi. Re-evaluasi saat ekosistem menyusul.
2. **PostgreSQL ditahan di 16+**: tidak ada kebutuhan fitur 17/18; Railway & Prisma matrix aman.
3. **next-auth diganti auth custom** karena satu-satunya jalur v5 adalah beta permanen; kebutuhan (credentials + revocation + capability) lebih sederhana diimplementasi langsung dengan session DB. Bukan NIH: tidak ada alternatif open-source stable yang cocok (better-auth dievaluasi — membawa model schema sendiri + surface besar untuk kebutuhan credentials-only; keputusan bisa ditinjau ulang).
4. **AG Grid Community 36** dipakai untuk semua tabel data; fitur Enterprise (tree data, row grouping, excel export) diganti implementasi sendiri: flattened-tree renderer untuk RAB, export xlsx server-side via exceljs, Infinite Row Model untuk daftar besar.
5. **Semua direct dependency dipin exact** (tanpa `^`/`~`) — lihat `package.json` + `docs/DEPENDENCY_POLICY.md`.
