import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { jalankanDiLatar } from "@/lib/auth/latar";
import type { UsulanAnalisaAi } from "./analisa-ai-parse";
import { siapkanTargetAnalisa, usulkanAnalisaDenganAi } from "./analisa-ai";

/**
 * Meminta draf ANALISA kepada AI DI LATAR (DECISIONS baru 2026-10-07) – pola
 * yang sama persis dengan draf harga (`hsd-ai-latar.ts`, DECISIONS 475):
 * request hanya mencatat, pekerja latar menulis selama penandanya masih
 * miliknya, dan setiap jalur keluar menutup `pendingSince`.
 *
 * MODUL INI TIDAK BOLEH MELEMPAR KE PEMANGGIL: ia dipanggil tanpa `await`.
 */

export type AnalisaLatarInput = {
  runId: string;
  penanda: Date;
  locationId: string;
  /** lineageKey item yang dipilih orang; kosong = nilai RAB terbesar. */
  dipilih?: string[];
};

type Hasil = { ok: true; model: string; usulan: UsulanAnalisaAi[] } | { ok: false; error: string };

async function tutupBilaMasihMilik(input: AnalisaLatarInput, hasil: Hasil): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const klaim = await tx.raplAnalisaAiRun.updateMany({
      where: { id: input.runId, pendingSince: input.penanda },
      data: {
        pendingSince: null,
        selesaiAt: new Date(),
        status: hasil.ok ? "selesai" : "gagal",
        model: hasil.ok ? hasil.model : null,
        errorMessage: hasil.ok ? null : hasil.error,
      },
    });
    if (klaim.count === 0) return false;
    if (hasil.ok) {
      // Draf lama untuk item yang sama digantikan, bukan ditumpuk: satu item
      // hanya punya satu draf yang menunggu keputusan.
      await tx.raplAnalisaAi.updateMany({
        where: {
          locationId: input.locationId,
          status: "draf",
          lineageKey: { in: hasil.usulan.map((u) => u.lineageKey) },
        },
        data: { status: "diganti" },
      });
      for (const u of hasil.usulan) {
        await tx.raplAnalisaAi.create({
          data: {
            runId: input.runId,
            locationId: input.locationId,
            lineageKey: u.lineageKey,
            code: u.code,
            uraian: u.uraian,
            satuan: u.satuan,
            keyakinan: u.keyakinan,
            alasan: u.alasan,
            komponen: {
              create: u.komponen.map((k, i) => ({
                urutan: i + 1,
                kategori: k.kategori,
                nama: k.nama,
                satuan: k.satuan,
                koefisien: k.koefisien,
              })),
            },
          },
        });
      }
    }
    return true;
  });
}

export function mulaiAnalisaAiLatar(user: SessionUser, input: AnalisaLatarInput): void {
  void jalankanDiLatar(async () => {
    try {
      const siap = await siapkanTargetAnalisa(
        input.locationId,
        input.dipilih && input.dipilih.length > 0 ? new Set(input.dipilih) : undefined,
      );
      if ("error" in siap) {
        await tutupBilaMasihMilik(input, { ok: false, error: siap.error });
        return;
      }
      // Tenggat total di bawah batas tunggu layar, supaya jawaban yang lambat
      // berakhir sebagai galat yang terbaca, bukan sebagai "terputus".
      const { getAiGuardConfig } = await import("@/lib/ai-hub/guard");
      const { batasJawabanMs } = await import("@/lib/ai-hub/guard-rules");
      const batas = batasJawabanMs(await getAiGuardConfig());
      const hasil = await usulkanAnalisaDenganAi(user, siap, { tenggatTotalMs: Math.max(60_000, batas - 20_000) });
      const jadi = await tutupBilaMasihMilik(input, hasil);
      if (!jadi) console.warn(`[ahsp/analisa-ai-latar] hasil run ${input.runId} dibuang – penandanya sudah berganti`);
    } catch (err) {
      console.error("[ahsp/analisa-ai-latar] pekerjaan latar gagal:", err);
      await tutupBilaMasihMilik(input, {
        ok: false,
        error: err instanceof Error ? err.message : "Permintaan draf analisa gagal.",
      }).catch(() => {});
    } finally {
      await db.raplAnalisaAiRun
        .updateMany({
          where: { id: input.runId, pendingSince: input.penanda },
          data: { pendingSince: null, status: "gagal", selesaiAt: new Date() },
        })
        .catch(() => {});
    }
  });
}
