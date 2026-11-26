import {
  ALL_ROLES,
  ROLE_CAPABILITIES,
  TANGGA_PERAN,
  hakAksesBerlaku,
  kunciHakAkses,
  type Capability,
  type PenggantiHakAkses,
} from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * PERENCANA PERUBAHAN HAK AKSES (DECISIONS 793) – murni, tanpa DB.
 *
 * Satu centang di layar = satu (peran, kewenangan, boleh). Jenjang dijaga di
 * sini supaya hasilnya selalu konsisten dengan `hakAksesBerlaku`:
 * - MEMBERI hak ke satu peran: cukup peran itu – atasannya ikut lewat jenjang;
 * - MENCABUT hak dari satu peran: peran itu DAN semua bawahannya di tangga,
 *   karena hak bawahan selalu berlaku juga untuk atasannya.
 *
 * Yang sama dengan bawaan kode tidak disimpan (barisnya dibuang).
 */

export type BarisHakAkses = { role: UserRole; boleh: boolean | null };

export type RencanaHakAkses = {
  /** Isi baru tabel untuk kewenangan ini, per peran: true/false = disimpan, null = dibuang (bawaan). */
  baris: BarisHakAkses[];
  /** Peran yang hak BERLAKU-nya berubah – untuk pesan dan jejak audit. */
  berubah: { role: UserRole; dari: boolean; ke: boolean }[];
};

export class HakAksesTerkunci extends Error {}

export function rencanaUbahHakAkses(
  p: PenggantiHakAkses,
  role: UserRole,
  capability: Capability,
  boleh: boolean,
): RencanaHakAkses {
  const kunci = kunciHakAkses(role, capability);
  if (kunci) throw new HakAksesTerkunci(kunci);

  const baru = new Map<UserRole, Map<Capability, boolean>>();
  for (const [r, per] of p) baru.set(r, new Map(per));
  const atur = (r: UserRole, v: boolean) => {
    const per = baru.get(r) ?? new Map<Capability, boolean>();
    if (v === ROLE_CAPABILITIES[r].has(capability)) per.delete(capability);
    else per.set(capability, v);
    baru.set(r, per);
  };

  if (boleh) {
    atur(role, true);
  } else {
    const i = TANGGA_PERAN.indexOf(role);
    const sasaran = i < 0 ? [role] : TANGGA_PERAN.slice(0, i + 1);
    for (const r of sasaran) if (!kunciHakAkses(r, capability)) atur(r, false);
  }

  const baris: BarisHakAkses[] = ALL_ROLES.map((r) => ({ role: r, boleh: baru.get(r)?.get(capability) ?? null }));
  const berubah = ALL_ROLES.map((r) => ({
    role: r,
    dari: hakAksesBerlaku(r, capability, p),
    ke: hakAksesBerlaku(r, capability, baru),
  })).filter((x) => x.dari !== x.ke);
  return { baris, berubah };
}
