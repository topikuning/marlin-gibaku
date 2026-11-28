import "server-only";
import { db } from "@/lib/db";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { keadaanTunggu } from "@/lib/ai-hub/guard-rules";

/**
 * Ringkasan estimasi harga satu paket (DECISIONS 806): run TERAKHIR tiap
 * lokasi dalam 3 hari terakhir. Cukup untuk menjawab "sudah sampai mana" di
 * halaman paket tanpa membuka lokasi satu per satu.
 */
export type RingkasEstimasiPaket = {
  berjalan: number;
  selesai: number;
  gagal: number;
  /** Usulan yang belum dipakai atau ditolak, seluruh lokasi. */
  drafMenunggu: number;
};

export async function ringkasEstimasiPaket(packageId: string): Promise<RingkasEstimasiPaket | null> {
  const [run, cfg] = await Promise.all([
    db.hsdUsulanRun.findMany({
      where: { location: { packageId }, createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      select: { locationId: true, status: true, pendingSince: true, _count: { select: { usulan: { where: { status: "draf" } } } } },
    }),
    getAiGuardConfig(),
  ]);
  if (run.length === 0) return null;
  const terakhir = new Map<string, (typeof run)[number]>();
  for (const r of run) if (!terakhir.has(r.locationId)) terakhir.set(r.locationId, r);
  const h: RingkasEstimasiPaket = { berjalan: 0, selesai: 0, gagal: 0, drafMenunggu: 0 };
  const kini = Date.now();
  for (const r of terakhir.values()) {
    if (keadaanTunggu(r.pendingSince, cfg, kini).menunggu) h.berjalan++;
    else if (r.status === "selesai") h.selesai++;
    else h.gagal++;
    h.drafMenunggu += r._count.usulan;
  }
  return h;
}
