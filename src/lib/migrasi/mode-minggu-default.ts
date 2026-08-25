import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { weekEndFractions } from "@/lib/progress-calc";
import { konversiBaselineModeMinggu } from "@/lib/baseline";
import { regenerateBaseline } from "@/lib/rab/import";
import { jakartaToday } from "@/lib/format";

/**
 * Migrasi data SATU KALI (DECISIONS 429): kesepakatan user 2026-08-25 —
 * default mode periode minggu adalah SENIN–MINGGU (M1 menyesuaikan), dan
 * SEMUA kontrak yang masih `tujuh_hari` dikonversi otomatis supaya user
 * tidak perlu mengubah satu-satu.
 *
 * Dijalankan otomatis saat boot server (instrumentation-node) — pipeline
 * deploy harus menyelesaikan semuanya sendiri, tanpa langkah manual.
 * Konversinya JALUR YANG SAMA dengan tombol ganti mode di form kontrak
 * (DECISIONS 427d): baseline/jadwal lama di-bucket ulang ke grid baru dengan
 * bentuk kalender & provenance dipertahankan — bukan impor ulang, bukan
 * generator (generator hanya fallback bila baseline tak cocok grid lamanya).
 *
 * Idempoten lewat penanda AppSetting: sekali tuntas tidak pernah diulang,
 * jadi kontrak yang KELAK sengaja disetel kembali ke `tujuh_hari` oleh user
 * tidak akan dipaksa balik. Bila boot terpotong di tengah, penanda belum
 * tertulis dan boot berikutnya melanjutkan sisa kontrak yang masih
 * `tujuh_hari` (yang sudah terkonversi otomatis terlewati).
 */

const MARKER_KEY = "migrasi.mode_minggu_default_senin";

export type HasilMigrasiModeMinggu = {
  status: "sudah" | "ditunda" | "selesai";
  kontrak: number;
  dikonversi: number;
  digenerate: number;
};

export async function terapkanDefaultSeninMinggu(): Promise<HasilMigrasiModeMinggu> {
  const sudah = await db.appSetting.findFirst({ where: { key: MARKER_KEY }, select: { id: true } });
  if (sudah) return { status: "sudah", kontrak: 0, dikonversi: 0, digenerate: 0 };

  const contracts = await db.contract.findMany({
    where: { weekMode: "tujuh_hari" },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      package: { select: { id: true, locations: { select: { id: true } } } },
    },
  });

  // Aktor sistem untuk jejak versi baseline & audit. Bila ada kontrak tapi
  // belum ada user (mustahil pada data nyata), tunda — coba lagi boot depan.
  let actorId: string | null = null;
  if (contracts.length > 0) {
    const actor =
      (await db.user.findFirst({ where: { role: "super_admin" }, select: { id: true } })) ??
      (await db.user.findFirst({ select: { id: true } }));
    if (!actor) return { status: "ditunda", kontrak: contracts.length, dikonversi: 0, digenerate: 0 };
    actorId = actor.id;
  }

  let dikonversi = 0;
  let digenerate = 0;
  for (const c of contracts) {
    // Urutan sama dengan editContractAction: kontrak dulu, baru baselinenya.
    await db.contract.update({ where: { id: c.id }, data: { weekMode: "senin_minggu" } });
    if (c.startDate && c.endDate) {
      // Kedua grid dihitung dari HARI nyata (weekEndFractions) — juga sisi
      // tujuh_hari, supaya durasi yang tidak habis dibagi 7 terpetakan tepat.
      const frLama = weekEndFractions(c.startDate, c.endDate, "tujuh_hari");
      const frBaru = weekEndFractions(c.startDate, c.endDate, "senin_minggu");
      for (const loc of c.package.locations) {
        try {
          const hasil = await konversiBaselineModeMinggu(loc.id, {
            oldEndFracs: frLama as number[],
            oldTotalWeeks: frLama.length,
            newEndFracs: frBaru as number[],
            newTotalWeeks: frBaru.length,
            userId: actorId!,
            note: "Konversi mode periode minggu (tujuh_hari → senin_minggu) – default sistem, DECISIONS 429",
          });
          if (hasil === "dikonversi") {
            dikonversi++;
            continue;
          }
          await regenerateBaseline(loc.id, {
            source: "auto",
            note: "Default mode minggu Senin–Minggu – baseline lama tidak cocok grid, dihitung ulang",
            userId: actorId!,
          });
          digenerate++;
        } catch {
          /* lokasi tanpa RAB/baseline aktif → tidak ada yang perlu dikonversi */
        }
      }
    }
    await audit(actorId, "contract.week_mode_default", "package", c.package.id, {
      contractId: c.id,
      dari: "tujuh_hari",
      ke: "senin_minggu",
    });
  }

  await db.appSetting.create({
    data: {
      key: MARKER_KEY,
      value: JSON.stringify({ kontrak: contracts.length, dikonversi, digenerate }),
      effectiveFrom: jakartaToday(),
    },
  });
  return { status: "selesai", kontrak: contracts.length, dikonversi, digenerate };
}
