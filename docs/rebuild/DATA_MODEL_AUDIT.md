# DATA MODEL AUDIT — schema & logic lama (per b6e77af)

Referensi lengkap hasil pembacaan `prisma/schema.prisma`, seluruh `src/lib/*.ts`, seed, dan scripts. Verdict final ada di `CURRENT_STATE_AUDIT.md`; target ada di `DOMAIN_MODEL.md`.

## Empat taksonomi lifecycle paralel (masalah inti #1)

1. **ProspekStage** (7): identifikasi→undangan→penawaran→negosiasi→penetapan→jadi_kontrak|batal. Derived dari dokumen via `deriveStageFromDocs` (prospek.ts); kolom `Prospek.stage` efektif display cache.
2. **ProcurementStage** (8): kolom `Location.procurementStage` — MATI: seed hardcode `spmk`, `procurement.ts` mengabaikannya dan menghitung dari dokumen.
3. **DocumentStage** (9): pemilihan→…→pembayaran. Sistem stage post-kontrak yang riil: `floorStage(deriveDocStage(docs), "kontrak")`.
4. **LocationStatus** (6): status fisik manual + history — orthogonal, layak dipertahankan.

## Formula yang WAJIB dipertahankan (dikutip dari kode lama)

```ts
// Nilai realisasi item (lapor/actions.ts)
valueDone = BigInt(Math.round(volumeDone * unitPrice))
cumulative = priorSent + volumeDone            // priorSent = Σ volumeDone state sent|approved
// guard: cumulative <= plannedVolume + 1e-6

// Progress lokasi (progress.ts)
grandTotal   = Σ rabCategory.totalValue (revisi aktif)   // BUKAN revision.totalValue (bisa basi)
realizedValue= Σ valueDone WHERE state='sent' AND lineageId IN activeLineages
pct(part, whole) = whole<=0 ? 0 : Number(part)/Number(whole)*100
deviationPct = realizedPct - planPct
weeksElapsed = floor(msSinceStart/(7*24*3600*1000)) + 1    // clamp [1, totalWeeks]

// Bobot/prestasi KKP (periodic-report.ts)
value    = volume * unitPrice
bobot    = value / rabTotal * 100
prestasi(v) = vk>0 ? min(100, v/vk*100) : 0
bobotLalu/Ini/Sd = prestasiX/100 * bobot
// bucketing tanggal = (approvedAt ?? suggestedAt ?? createdAt) di Asia/Jakarta

// Kurva-S rencana (scurve.ts ≡ scripts/scurve.py)
totalWeeks = ceil(contractDays/7)
smoothstep(t) = t<=0?0 : t>=1?1 : 3t²-2t³
weeklyDelta[wk] += (smoothstep((w+1)/dur) - smoothstep(w/dur)) * catWeightPct
// CATEGORY_PHASE keyword→[phaseStart,phaseEnd], default [0.25,0.80]
// varian per-item: TradeKey classification (persiapan→…→landscape), scheduling.ts

// Kurva-S aktual (scurve-data.ts)
wk = clamp(floor((keyDate-start)/WEEK_MS)+1, 1, totalWeeks); perWeek[wk-1] += valueDone

// PPN (lokasi page — dijadikan standar untuk SEMUA modul di rebuild)
ppnAmount = grandTotal * PPN / 100 (BigInt)   // RAB pre-PPN; kontrak incl-PPN
mismatch jika |contractValue - (grandTotal+ppn)| > (grandTotal+ppn)/1000   // 0.1%

// Finance lama (finance.ts) — CATATAN BUG: tanpa PPN, understate ~11% vs kontrak
terpasang = realizedValue; belumDitagih = max(0, terpasang - invoiced)
need30d = (plan[now+4-1] - plan[now-1])/100 * grandTotal
```

## Alur laporan harian lama

- Track volume: `DailyReportItem` dgn state draft_mandor/draft_sm→approved→sent|rejected; item draf `dailyReportId=null`; approve = find-or-create `DailyReport` (loc, **SM approver**, **tanggal approval** ← bug) lalu attach.
- Track KKP: `DailyLog` + Worker/Material/Equipment, uniq(loc,tanggal), upsert wholesale.
- Digabung hanya di `daily-report-view.ts` saat render/cetak.
- Lock #56: findFirst state in (draft_mandor,draft_sm,approved) per rabItem → tolak; app-level only, race-prone.
- `DailyReport.supersedesId` correction chain: SCHEMA-ONLY, tidak pernah ditulis.

## RAB lama

- `RabRevision` snapshot (draft→active→superseded) + carry-over lineage via map `roman#code` → lineageId. Insert tree non-transaksional saat draft (aman krn tersembunyi), finalize transaksional. Semantik ini DIPERTAHANKAN di rebuild.
- Struktur triple-parent `RabItem` (categoryId|subcategoryId|parentItemId, CHECK ≥1) — canggung; FK asimetris (SetNull vs Cascade). Diganti `RabNode` single-table.
- Parser: ExcelJS sheet "RAB", kolom A/B/E/F/G/H/I; kategori = roman + ^PEKERJAAN; total = ΣsumLeaves (bukan Resume); duplikat kode sub → `code#2`.

## Masalah data terukur

- N+1: finance rows ±40 query/7 lokasi; BFS tree per-level; `getRabItemLocationId` 1 query/hop; `getActiveLineages` diulang per modul.
- BigInt: `serializeBigInt` = JSON.parse(JSON.stringify(…)) round-trip; `valueDone` dihitung float lalu dibulatkan.
- FK menggantung (tanpa relasi): Contract.prospekId, Prospek.contractId, Document.prospekId, ProspekLokasi.createdLocationId, RabRevision.hpsFileDocId, DailyReport.deviceId, CostEntry.receiptPhotoId, DeviationNote.locationId.
- Constraint hilang: tidak ada uniq DB untuk anti-double-input; Document diklaim append-only tanpa trigger; DailyReportItem mutable di bawah parent append-only.
- Derived data disimpan & basi: RabRevision.totalValue (kode mendistrust-nya), ScheduledMilestone.targetValue, WeeklyReport/MonthlyReport (mati — laporan dihitung live), Location.procurementStage, Location.deviationCause/recoveryPlan.
- 3 model uang tak rekonsiliasi: snapshot Location vs BudgetLine vs CostEntry.
- Seed: upsert idempotent utk master, tapi RAB tree delete+recreate → UUID item/lineage regenerate tiap run.

## Seed data (dipertahankan)

7 file `seed-data/*.json` (parsed dari HPS riil oleh `scripts/parse_hps.py`): meta (slug, desa/kab/prov, gps, nomor kontrak, kontraktor, tanggal) + categories→subcategories→items (code, name, volume, unit, unit_price, total_price, tkdn_ratio, children). 3 kontraktor, ±11k item. `manifest.json` = daftar slug.
