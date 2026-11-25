import { can } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Hak impor rekap harian menulis ke laporan yang sudah dikirim / final
 * (DECISIONS 782, diubah 784).
 *
 * Ketetapan user 2026-11-25: *"laporan finalpun harus ikut ini, mode timpa ini
 * menimpa semuanya, jangan ditahan meskipun laporan hari itu final"*. Jadi
 * laporan terkirim, disetujui, DAN final ikut ditulis – oleh peran yang memang
 * memverifikasi dan memfinalkan laporan (`daily_report.review`: Site Manager
 * ke atas). Pelaksana tetap hanya menulis laporan yang masih draft / perlu
 * koreksi; perubahannya pada laporan lain ditahan dengan sebabnya.
 */
export function izinImpor(role: UserRole): { ubahTerkirim: boolean; ubahFinal: boolean } {
  const verifikator = can(role, "daily_report.review");
  return { ubahTerkirim: verifikator, ubahFinal: verifikator };
}
