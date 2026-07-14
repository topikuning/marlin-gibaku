# OPEN SOURCE LICENSE AUDIT — MARLIN Rebuild

Dijalankan otomatis: `node scripts/license-audit.mjs` (juga di CI; gagal = pipeline merah).
Snapshot lengkap: `artifacts/rebuild/licenses/licenses.json` (dari `pnpm licenses list --prod --json`).

## Direct dependencies (production)

| Package | Versi | Lisensi |
|---|---|---|
| next / react / react-dom | 16.2.10 / 19.2.7 | MIT |
| @prisma/client, @prisma/adapter-pg, prisma | 7.8.0 | Apache-2.0 |
| pg | 8.22.0 | MIT |
| zod | 4.4.3 | MIT |
| ag-grid-community, ag-grid-react | 36.0.0 | MIT (Community; Enterprise TIDAK dipasang) |
| @aws-sdk/client-s3, s3-request-presigner | 3.1086.0 | Apache-2.0 |
| sharp | 0.35.3 | Apache-2.0 |
| exifreader | 4.41.0 | MPL-2.0 |
| exceljs | 4.4.0 | MIT |
| date-fns / @date-fns/tz | 4.4.0 / 1.5.0 | MIT |
| lucide-react | 1.24.0 | ISC |
| @node-rs/argon2 | 2.0.2 | MIT |
| clsx / tailwind-merge | 2.1.1 / 3.6.0 | MIT |
| leaflet | 1.9.4 | BSD-2-Clause |

Dev: tailwindcss (MIT), typescript (Apache-2.0), eslint (MIT), vitest (MIT), @playwright/test (Apache-2.0), tsx (MIT) — semua allowlist.

## Pengecualian terdokumentasi (transitive)

1. **@img/sharp-libvips-linux-x64 — LGPL-3.0-or-later.** Prebuilt libvips yang di-link dinamis oleh sharp. Dipakai server-side; source libvips tersedia publik dan library dapat diganti pengguna — kewajiban LGPL terpenuhi, tidak menulari kode aplikasi. Diterima.
2. **buffers@0.1.1 — metadata "Unknown".** Transitive exceljs → unzipper → chainsaw. Paket lama tanpa field `license` di package.json; source README menyatakan MIT-style. Risiko rendah, hanya dev-time parsing xlsx. Diterima dengan catatan; dievaluasi ulang bila exceljs diganti.
3. **jszip — (MIT OR GPL-3.0-or-later).** Dual license, kita pilih MIT. Diterima.
4. **pako — (MIT AND Zlib)**, **chainsaw/traverse — MIT/X11.** Zlib & notasi X11 masuk allowlist/alias. Diterima.

## Ditolak oleh gate lisensi (bukti kebijakan bekerja)

- **react-leaflet 5.0.0 (+@react-leaflet/core) — Hippocratic-2.1.** Tertangkap CI
  saat port peta: lisensi dengan pembatasan penggunaan etis, bukan open-source
  (melanggar freedom 0), di luar allowlist. Diganti implementasi leaflet murni
  (BSD-2-Clause) tanpa wrapper — fungsi identik.

## Kebijakan

Allowlist & aturan evaluasi (OR = salah satu cukup, AND = semua wajib) ada di `scripts/license-audit.mjs`; kebijakan umum di `docs/DEPENDENCY_POLICY.md`. Tidak ada dependency proprietary, SSPL, BUSL, AGPL, trial, atau ber-license-key. AG Grid Enterprise secara eksplisit dilarang (cek CI: package tidak ada di lockfile).
