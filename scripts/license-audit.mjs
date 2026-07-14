#!/usr/bin/env node
// Audit lisensi dependency: gagal bila ada lisensi di luar allowlist.
// Dipakai CI + lokal. Kebijakan: docs/DEPENDENCY_POLICY.md
import { execSync } from "node:child_process";

const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "PostgreSQL",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
]);

ALLOWED.add("Zlib");

// Alias notasi lama → SPDX.
const ALIAS = { "MIT/X11": "MIT", X11: "MIT" };

// Pengecualian terdokumentasi (lihat docs/rebuild/OPEN_SOURCE_LICENSE_AUDIT.md):
// - @img/sharp-libvips-*: prebuilt libvips LGPL-3.0 — dynamic linking, dipakai server-side; kewajiban LGPL terpenuhi (source libvips publik, lib dapat diganti).
// - buffers: transitive exceljs (via unzipper→chainsaw), kode MIT de facto tapi metadata paket lama tidak memuat field license.
const PACKAGE_EXCEPTIONS = [/^@img\/sharp-libvips-/, /^buffers$/];

function singleAllowed(id) {
  const norm = ALIAS[id] ?? id;
  return ALLOWED.has(norm);
}

// SPDX sederhana: "A OR B" = salah satu cukup; "A AND B" = semua wajib.
function licenseAllowed(expr) {
  const clean = expr.replace(/[()]/g, " ").trim();
  if (singleAllowed(clean)) return true;
  if (/\sOR\s/i.test(clean)) {
    return clean.split(/\s+OR\s+/i).some((p) => licenseAllowed(p.trim()));
  }
  if (/\sAND\s/i.test(clean)) {
    return clean.split(/\s+AND\s+/i).every((p) => licenseAllowed(p.trim()));
  }
  return false;
}

const raw = execSync("pnpm licenses list --json --prod", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const data = JSON.parse(raw);

const violations = [];
for (const [license, pkgs] of Object.entries(data)) {
  if (!licenseAllowed(license)) {
    for (const p of pkgs) {
      if (PACKAGE_EXCEPTIONS.some((re) => re.test(p.name))) continue;
      violations.push(`${p.name}@${Array.isArray(p.versions) ? p.versions.join(",") : p.version}: ${license}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Lisensi di luar allowlist ditemukan:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("License audit OK — semua dependency production dalam allowlist.");
