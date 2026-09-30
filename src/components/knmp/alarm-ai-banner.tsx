import { Banner } from "@/components/ui";
import { statusAlarmAi } from "@/lib/ai-hub/alarm";
import { formatTanggal } from "@/lib/format";

/**
 * Spanduk alarm kegagalan AI (DECISIONS 635) – Server Component. Tampil selama
 * alarm berlaku (6 jam) dan padam sendiri begitu ada jawaban AI yang berhasil.
 */
export async function AlarmAiBanner({ orgId }: { orgId: string }) {
  const alarm = await statusAlarmAi(orgId).catch(() => null);
  if (!alarm) return null;
  return (
    <Banner
      tone="error"
      title={`AI gagal beruntun sejak ${formatTanggal(alarm.sejak, "d MMM HH.mm")}`}
      description={
        `${alarm.gagal} dari ${alarm.total} permintaan AI dalam 60 menit gagal – kode galat terakhir: ${alarm.errorCode}. ` +
        "Buka Sistem → AI, tekan Tes koneksi pada provider aktif, lalu periksa Riwayat. " +
        "Spanduk ini padam sendiri begitu ada jawaban AI yang berhasil."
      }
    />
  );
}
