/**
 * Bangkitkan docs/rebuild/PERMISSION_MATRIX.md dari `src/lib/authz.ts`.
 *
 * Matriks permission adalah dokumen yang paling gampang basi: setiap capability
 * baru harus disalin manual ke tabel, dan tidak ada yang menyadari kalau lupa.
 * Karena itu dokumennya DIBANGKITKAN, bukan ditulis tangan — dan
 * `tests/unit/permission-matrix-doc.test.ts` gagal kalau isinya tertinggal.
 *
 * Pakai: pnpm docs:permission
 */
import { writeFileSync } from "node:fs";
import { ALL_ROLES, CAPABILITIES, CROSS_LOCATION_ROLES, ROLE_CAPABILITIES } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Daftar role DITURUNKAN dari `ALL_ROLES`, bukan ditulis ulang di sini —
 * dokumen ini ada justru karena daftar manual selalu ketinggalan. Sebelumnya
 * daftarnya hardcode, jadi role baru (`wakil_ppk`) tidak muncul di matriks
 * meskipun skripnya dijalankan.
 */
const ROLES: UserRole[] = ALL_ROLES;

export function renderMatrix(): string {
  const head = `| Capability | ${ROLES.join(" | ")} |`;
  const sep = `|---|${ROLES.map(() => ":-:").join("|")}|`;
  const rows = CAPABILITIES.map(
    (cap) => `| \`${cap}\` | ${ROLES.map((r) => (ROLE_CAPABILITIES[r].has(cap) ? "✓" : "—")).join(" | ")} |`,
  );
  return [head, sep, ...rows].join("\n");
}

const doc = `# PERMISSION MATRIX

> **DIBANGKITKAN OTOMATIS dari \`src/lib/authz.ts\` — jangan diedit tangan.**
> Perbarui dengan \`pnpm docs:permission\`.
> \`tests/unit/permission-matrix-doc.test.ts\` gagal bila file ini tertinggal.

Model: **capability-based**. Role → set capability (konstanta di \`src/lib/authz.ts\`).
Frontend hanya menyembunyikan menu; **setiap Server Action / Route Handler wajib
otorisasi ulang** via \`requireCapability()\` + scope check (\`requireLocationAccess()\`).

Scope lokasi: ${[...CROSS_LOCATION_ROLES].map((r) => `\`${r}\``).join(", ")} = lintas lokasi
(semua lokasi ORGANISASI-nya, tanpa penugasan). Role lain — termasuk
\`exec_viewer\` sejak DECISIONS 190 — dibatasi \`LocationAssignment\` (dan paket yang
memuat lokasi tersebut); tanpa penugasan berarti NOL lokasi, bukan semuanya.

Jumlah capability: **${CAPABILITIES.length}**.

${renderMatrix()}

## Capability yang HANYA super_admin

${CAPABILITIES.filter((c) => ROLES.filter((r) => ROLE_CAPABILITIES[r].has(c)).length === 1 && ROLE_CAPABILITIES.super_admin.has(c))
  .map((c) => `- \`${c}\``)
  .join("\n")}

Alasan pembatasannya ditulis sebagai komentar di \`src/lib/authz.ts\`.

## Hierarki pembuatan akun

\`user.create\` dibatasi lagi oleh \`creatableRoles(role)\` — seorang user hanya
boleh membuat akun dengan peran DI BAWAHnya. Lihat \`src/lib/authz.ts\`.
`;

const out = new URL("../docs/rebuild/PERMISSION_MATRIX.md", import.meta.url);
writeFileSync(out, doc);
console.log(`PERMISSION_MATRIX.md diperbarui — ${CAPABILITIES.length} capability, ${ROLES.length} role.`);
