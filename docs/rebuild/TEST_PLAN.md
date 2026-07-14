# TEST PLAN — MARLIN Rebuild

## Perintah

```bash
pnpm install --frozen-lockfile
pnpm db:generate && pnpm db:reset      # dev/test only, guard APP_ENV
pnpm typecheck && pnpm lint
pnpm test --run                        # unit + integration (Vitest; integration butuh Postgres)
pnpm build
pnpm test:e2e                          # Playwright (Chromium)
docker build --no-cache -t marlin:test .
```

## Unit (Vitest)
- Parser HPS: hierarchy inference, sumLeaves, duplikat kode, skip JUMLAH/TOTAL.
- Money: rupiah format, BigInt serializer, PPN, mismatch tolerance.
- Progress: valueDone, kumulatif, bobot/prestasi, deviasi, clamp minggu.
- Kurva-S: smoothstep, phase window, running-sum, per-trade classification (paritas fixture Python).
- Lifecycle: transisi PackageStage/LocationStatus/DailyReport (invalid transition ditolak).
- Authz: capability matrix per role, scope.
- R2 env: normalisasi endpoint (trim, protokol ganda, r2.dev ditolak).
- Finance calc: availableBudget, outstanding, unbilled, cashRequirement.

## Integration (Postgres nyata)
- Constraint: uniq (loc,date) DailyReport, uniq (report,rabNode) item, uniq contractNumber, uniq packageId di Contract (konversi idempotent), FK nyata.
- Transaksi: konversi prospek→kontrak (ulang 2× = 1 kontrak), aktivasi revisi RAB (supersede atomik), finalisasi laporan (snapshot).
- Authz di action: role tanpa capability ditolak; cross-location ditolak.
- Audit log tertulis pada mutasi.
- Laporan periodik = agregasi item (paritas formula).

## E2E kritis (Playwright)
1. Prospek→kontrak: buat paket → lokasi target → dokumen tender → penetapan → konversi → 1 kontrak + lokasi aktif + histori.
2. RAB: import xlsx → preview → commit → aktif → baseline → weekly plan.
3. Laporan lapangan: Hari Ini → pilih item → volume+foto → kirim → SM verifikasi + lengkapi KKP → setujui → progress berubah → cetak final.
4. Koreksi: kembalikan dgn alasan → perbaiki → kirim ulang → histori utuh → angka tidak dobel.
5. Adendum: buat adendum → revisi RAB → baseline baru → histori lama utuh.
6. Keuangan: budget → commitment → invoice → pembayaran parsial → outstanding benar.
7. Kepatuhan: milestone + PIC + due date + evidence + verifikasi.
8. Permission: tiap role — akses menu, aksi ditolak, cross-location ditolak.
9. R2 (diagnostik): endpoint benar/salah, credential salah (pesan error terbedakan).

## CI
Semua di atas jalan di GitHub Actions (Postgres service container); gagal = merah.
