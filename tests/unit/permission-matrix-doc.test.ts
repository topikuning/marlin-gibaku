import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_ROLES, CAPABILITIES, ROLE_CAPABILITIES } from "@/lib/authz";

/**
 * Penjaga dokumen: `docs/rebuild/PERMISSION_MATRIX.md` dibangkitkan dari
 * `src/lib/authz.ts`. Test ini gagal begitu ada capability baru yang belum
 * masuk dokumen — supaya matriks permission tidak pernah lagi diam-diam basi
 * (audit 2026-07-27; STOP condition "dokumen dan kode berbeda").
 *
 * Perbaiki dengan: pnpm docs:permission
 */
const doc = readFileSync(new URL("../../docs/rebuild/PERMISSION_MATRIX.md", import.meta.url), "utf8");

describe("PERMISSION_MATRIX.md sinkron dengan authz.ts", () => {
  it("setiap capability ada di dokumen", () => {
    const hilang = CAPABILITIES.filter((c) => !doc.includes(`\`${c}\``));
    expect(hilang, `Jalankan: pnpm docs:permission – capability belum terdokumentasi`).toEqual([]);
  });

  it("dokumen tidak memuat capability yang sudah dihapus dari kode", () => {
    const known = new Set<string>(CAPABILITIES);
    const inDoc = [...doc.matchAll(/^\| `([a-z_]+\.[a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(inDoc.length).toBeGreaterThan(0);
    expect(inDoc.filter((c) => !known.has(c))).toEqual([]);
  });

  it("jumlah capability yang tertulis cocok", () => {
    expect(doc).toContain(`Jumlah capability: **${CAPABILITIES.length}**`);
  });

  it("tanda centang per role cocok dengan ROLE_CAPABILITIES", () => {
    // Diturunkan dari ALL_ROLES, BUKAN daftar tulis-tangan: daftar manual di
    // sini pernah membuat role baru (`wakil_ppk`) lolos tanpa diperiksa
    // sementara tesnya tetap hijau-palsu (DECISIONS 199).
    const roles = ALL_ROLES;
    for (const line of doc.split("\n")) {
      const m = /^\| `([a-z_]+\.[a-z_]+)` \| (.+) \|$/.exec(line);
      if (!m) continue;
      const cap = m[1] as (typeof CAPABILITIES)[number];
      const marks = m[2].split(" | ").map((x) => x.trim());
      expect(marks, cap).toHaveLength(roles.length);
      roles.forEach((role, i) => {
        const expected = ROLE_CAPABILITIES[role].has(cap) ? "✓" : "–";
        expect(marks[i], `${cap} · ${role}`).toBe(expected);
      });
    }
  });
});
