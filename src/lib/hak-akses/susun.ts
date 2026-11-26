import { CAPABILITIES, type Capability, type PenggantiHakAkses } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

const KENAL = new Set<string>(CAPABILITIES);

/** Baris tabel → peta pengganti. Kewenangan yang sudah tidak ada di kode dilewati. MURNI. */
export function susunPengganti(
  rows: readonly { role: UserRole; capability: string; boleh: boolean }[],
): PenggantiHakAkses {
  const m = new Map<UserRole, Map<Capability, boolean>>();
  for (const r of rows) {
    if (!KENAL.has(r.capability)) continue;
    const per = m.get(r.role) ?? new Map<Capability, boolean>();
    per.set(r.capability as Capability, r.boleh);
    m.set(r.role, per);
  }
  return m;
}
