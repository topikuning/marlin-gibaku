import "server-only";
import { db } from "@/lib/db";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { keadaanTunggu } from "@/lib/ai-hub/guard-rules";

/**
 * Keadaan permintaan draf harga AI untuk satu lokasi — dibaca server component.
 *
 * Layar menunggu di sini, bukan di dalam request (RAPL-01/RAPL-02): halaman
 * membaca `pendingSince` run terakhir dan menarik ulang dirinya tiap beberapa
 * detik, persis pola Ask MARLIN (DECISIONS 455).
 */

export type UsulanDraf = {
  id: string;
  kategori: string;
  nama: string;
  satuan: string;
  harga: bigint;
  keyakinan: string;
  alasan: string;
};

export type KeadaanUsulanAi = {
  runId: string | null;
  /** Jawaban sedang disusun; layar harus menunggu. */
  menunggu: boolean;
  /** Penanda tunggu lewat batas — prosesnya mati sebelum menjawab. */
  terputus: boolean;
  pendingSinceMs: number | null;
  batasMs: number;
  model: string | null;
  error: string | null;
  /** Berapa yang dimintakan pada run terakhir, dan berapa yang belum berharga. */
  diminta: number;
  totalKosong: number;
  /** Draf yang belum diterima maupun ditolak. */
  draf: UsulanDraf[];
};

export async function keadaanUsulanAi(locationId: string): Promise<KeadaanUsulanAi> {
  const [run, cfg] = await Promise.all([
    db.hsdUsulanRun.findFirst({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        pendingSince: true,
        model: true,
        errorMessage: true,
        diminta: true,
        totalKosong: true,
        usulan: {
          where: { status: "draf" },
          orderBy: { harga: "desc" },
          select: {
            id: true,
            kategori: true,
            nama: true,
            satuan: true,
            harga: true,
            keyakinan: true,
            alasan: true,
          },
        },
      },
    }),
    getAiGuardConfig(),
  ]);

  const tunggu = keadaanTunggu(run?.pendingSince ?? null, cfg, Date.now());
  return {
    runId: run?.id ?? null,
    menunggu: tunggu.menunggu,
    terputus: tunggu.terputus,
    pendingSinceMs: run?.pendingSince ? run.pendingSince.getTime() : null,
    batasMs: tunggu.batasMs,
    model: run?.model ?? null,
    error: run?.errorMessage ?? null,
    diminta: run?.diminta ?? 0,
    totalKosong: run?.totalKosong ?? 0,
    draf: run?.usulan ?? [],
  };
}
