import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { sendText } from "@/lib/waha/kirim";
import { AMBANG_NIHIL_BERUNTUN, LABEL_ALASAN_NIHIL, nihilBeruntun } from "./nihil";
import type { NoActivityReason } from "@/generated/prisma/enums";

/**
 * PENAGIH HARI NIHIL BERUNTUN (DECISIONS 396).
 *
 * Satu-dua hari hujan itu biasa dan tidak perlu diributkan. **Tiga hari
 * berturut-turut tanpa kegiatan artinya pekerjaan berhenti** – dan itu tidak
 * boleh diam-diam lewat sebagai "sudah lapor kok", karena laporan nihil MEMANG
 * memuaskan pengingat laporan harian.
 *
 * Menumpang putaran cron harian yang sudah ada, sama seperti pengingat kendala
 * lewat tenggat, dan memakai peredam yang sama supaya grup tidak dikirimi
 * kalimat yang sama tiap 24 jam.
 */

const AKSI = "harian.pengingat_nihil";

/** Jeda minimum sebelum lokasi yang sama ditagih lagi dengan angka yang sama. */
export const JEDA_HARI_NIHIL = 3;

export type HasilPengingatNihil = {
  diperiksa: number;
  terkirim: number;
  gagal: number;
  diredam: number;
  rincian: { lokasi: string; hasil: string }[];
};

/** Jendela hari yang ditarik untuk menghitung beruntun. Cukup untuk ambang mana pun. */
const JENDELA_HARI = 30;

export async function kirimPengingatNihilTerjadwal(
  now = new Date(),
): Promise<HasilPengingatNihil> {
  const hasil: HasilPengingatNihil = {
    diperiksa: 0,
    terkirim: 0,
    gagal: 0,
    diredam: 0,
    rincian: [],
  };

  const hariIniKey = jakartaDateKey(now);
  const hariIni = parseDateKey(hariIniKey)!;
  const mulai = new Date(hariIni.getTime() - JENDELA_HARI * 86_400_000);

  /*
   * Hanya lokasi yang paketnya SEDANG BERJALAN dan punya grup WA. Lokasi yang
   * belum mulai memang tidak berkegiatan – menagihnya akan membuat peringatan
   * ini berbunyi untuk keadaan yang normal, dan peringatan yang berbunyi saat
   * normal berhenti dibaca.
   */
  const lokasi = await db.location.findMany({
    where: {
      status: "berjalan",
      package: { stage: "pelaksanaan", waGroupId: { not: null } },
    },
    select: {
      id: true,
      name: true,
      package: { select: { id: true, name: true, waGroupId: true } },
    },
  });

  for (const l of lokasi) {
    const laporan = await db.dailyReport.findMany({
      where: {
        locationId: l.id,
        reportDate: { gte: mulai, lte: hariIni },
        // Draft belum menyatakan apa pun; hanya laporan yang SUDAH DIKIRIM
        // yang boleh dihitung sebagai pernyataan.
        status: { not: "draft" },
      },
      select: { reportDate: true, noActivity: true, noActivityReason: true },
      orderBy: { reportDate: "desc" },
    });
    if (laporan.length === 0) continue;

    const beruntun = nihilBeruntun(
      laporan.map((r) => ({ dateKey: jakartaDateKey(r.reportDate), nihil: r.noActivity })),
      hariIniKey,
    );
    if (beruntun < AMBANG_NIHIL_BERUNTUN) continue;
    hasil.diperiksa += 1;

    const sebab = ringkasSebab(
      laporan.filter((r) => r.noActivity).slice(0, beruntun).map((r) => r.noActivityReason),
    );
    // Sidiknya memuat ANGKA beruntunnya: hari keempat berturut-turut adalah
    // kabar baru, bukan pengulangan kabar hari ketiga.
    const sidik = `${beruntun}|${sebab}`;
    const riwayat = await db.auditLog.findFirst({
      where: { action: AKSI, resourceType: "location", resourceId: l.id },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    });
    const p = riwayat?.payload as { sidik?: unknown } | null;
    const umurHari = riwayat ? (now.getTime() - riwayat.createdAt.getTime()) / 86_400_000 : Infinity;
    if (p && typeof p.sidik === "string" && p.sidik === sidik && umurHari < JEDA_HARI_NIHIL) {
      hasil.diredam += 1;
      hasil.rincian.push({ lokasi: l.name, hasil: "diredam – kabarnya belum berubah" });
      continue;
    }

    const teks = [
      `⚠️ *MARLIN – Pekerjaan berhenti ${beruntun} hari*`,
      l.package.name,
      "",
      `${l.name} sudah *${beruntun} hari berturut-turut* dilaporkan TIDAK ADA KEGIATAN.`,
      `Sebab yang dilaporkan: ${sebab}.`,
      "",
      "Mohon dipastikan penyebabnya sudah ditangani, dan bila menunggu sesuatu",
      "catat sebagai kendala lewat menu *Kendala* supaya ada yang menagihnya.",
      "",
      "_Pesan otomatis._",
    ].join("\n");

    try {
      const waMessageId = await sendText(l.package.waGroupId!, teks);
      hasil.terkirim += 1;
      hasil.rincian.push({ lokasi: l.name, hasil: `terkirim (${beruntun} hari)` });
      await audit(null, AKSI, "location", l.id, { sidik, beruntun, sebab, waMessageId });
    } catch (err) {
      hasil.gagal += 1;
      hasil.rincian.push({
        lokasi: l.name,
        hasil: err instanceof Error ? err.message : "gagal kirim",
      });
    }
  }

  return hasil;
}

/**
 * Sebab-sebab yang dilaporkan, digabung tanpa mengulang.
 *
 * Disebut APA ADANYA, tidak diringkas jadi satu sebab "terbanyak": tiga hari
 * berhenti karena hujan berbeda urusannya dengan tiga hari berhenti karena
 * menunggu lahan, dan campurannya juga informasi.
 */
function ringkasSebab(alasan: (NoActivityReason | null)[]): string {
  const unik = [...new Set(alasan.filter((a): a is NoActivityReason => !!a))];
  if (unik.length === 0) return "tidak disebutkan";
  return unik.map((a) => LABEL_ALASAN_NIHIL[a]).join(", ");
}
