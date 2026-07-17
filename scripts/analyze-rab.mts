/**
 * Korpus RAB untuk kalibrasi klasifikasi trade (kurva-S) — AKUMULATIF lintas batch.
 *
 *   Ingest:  pnpm exec tsx scripts/analyze-rab.mts <file1.xlsx> ...
 *   Laporan: pnpm exec tsx scripts/analyze-rab.mts --report
 *
 * Korpus menyimpan ITEM MENTAH unik (nama→{count,value,cat}), BUKAN hasil
 * klasifikasi — jadi setiap kali keyword `classifyTrade` diubah, laporan bisa
 * dihitung ulang atas SELURUH korpus tanpa perlu file asli lagi (file upload
 * bersifat sementara per sesi). Idempotent per nama file.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";
import { flattenParsedRab } from "@/lib/rab/flatten";
import { classifyTrade } from "@/lib/scurve/generate";

const CORPUS = "docs/rab-analysis/corpus.json";
type Item = { count: number; value: number; cat: string };
type Corpus = { files: string[]; items: Record<string, Item> };
const corpus: Corpus = existsSync(CORPUS)
  ? JSON.parse(readFileSync(CORPUS, "utf8"))
  : { files: [], items: {} };

const fmt = (n: number) => Math.round(n).toLocaleString("id-ID");
const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ").slice(0, 70);

const args = process.argv.slice(2);
const reportOnly = args.includes("--report");
const files = args.filter((a) => !a.startsWith("--"));

for (const f of files) {
  const name = basename(f);
  if (corpus.files.includes(name)) {
    console.log(`(skip, sudah di korpus) ${name}`);
    continue;
  }
  const { parsed, warnings } = await parseHpsBuffer(readFileSync(f));
  const nodes = flattenParsedRab(parsed);
  const cats = nodes
    .filter((n) => n.kind === "kategori")
    .map((n) => ({ key: n.lineageKey, name: n.name }))
    .sort((a, b) => b.key.length - a.key.length);
  const catOf = (lk: string) => cats.find((c) => lk === c.key || lk.startsWith(`${c.key}#`))?.name ?? "";
  const items = nodes.filter((n) => n.kind === "item" && n.amount > 0n);
  let fileVal = 0;
  for (const it of items) {
    const key = norm(it.name);
    const v = Number(it.amount);
    fileVal += v;
    corpus.items[key] ??= { count: 0, value: 0, cat: catOf(it.lineageKey) };
    corpus.items[key].count++;
    corpus.items[key].value += v;
  }
  corpus.files.push(name);
  const warn = warnings.filter((w) => /NEGOSIASI|judul/i.test(w)).length;
  console.log(`## ${name}\n   items=${items.length}  nilai=${fmt(fileVal)}  kategori=${cats.length}  warn=${warn}`);
}

if (files.length) {
  mkdirSync("docs/rab-analysis", { recursive: true });
  writeFileSync(CORPUS, JSON.stringify(corpus, null, 1));
}

// ── Laporan: klasifikasi ulang SELURUH korpus dengan keyword saat ini ──────────
const perTrade: Record<string, { count: number; value: number }> = {};
const lainnya: [string, Item][] = [];
let totalV = 0;
let totalCount = 0;
for (const [nm, d] of Object.entries(corpus.items)) {
  const trade = classifyTrade(nm, d.cat);
  perTrade[trade] ??= { count: 0, value: 0 };
  perTrade[trade].count += d.count;
  perTrade[trade].value += d.value;
  totalV += d.value;
  totalCount += d.count;
  if (trade === "lainnya") lainnya.push([nm, d]);
}
if (reportOnly || files.length) {
  console.log(`\n=== KORPUS (${corpus.files.length} file · ${Object.keys(corpus.items).length} item unik · ${totalCount} okurensi · Rp ${fmt(totalV)}) ===`);
  const lainnyaV = perTrade["lainnya"]?.value ?? 0;
  console.log(`LAINNYA (belum terklasifikasi): ${((100 * lainnyaV) / (totalV || 1)).toFixed(2)}% nilai\n`);
  for (const [t, d] of Object.entries(perTrade).sort((a, b) => b[1].value - a[1].value))
    console.log(`  ${t.padEnd(12)} ${((100 * d.value) / totalV).toFixed(1).padStart(5)}%  ${String(d.count).padStart(5)} okurensi`);
  console.log("\ntop 35 'lainnya' by nilai (target keyword baru):");
  lainnya
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 35)
    .forEach(([nm, d]) => console.log(`  ${fmt(d.value).padStart(13)} ×${String(d.count).padStart(3)}  ${nm}  ⟨${d.cat.slice(0, 20)}⟩`));
}
