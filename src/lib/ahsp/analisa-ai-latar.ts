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
  /**
   * URAI SEMUA ITEM (DECISIONS 807): berputar per BATAS_ITEM_ANALISA_AI
   * uraian sampai seluruh uraian tanpa analisa punya draf, dalam SATU run.
   * Tiap putaran menyimpan drafnya dan memindahkan penanda.
   */
  semua?: boolean;
};

/** 40 × 12 = 480 uraian unik – di atas RAB terbesar sekarang. */
export const MAKS_PUTARAN_ANALISA = 40;

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
            tanda: u.tanda ?? null,
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
  if (input.semua) {
    void jalankanDiLatar(() => uraiSemua(user, input));
    return;
  }
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

/** Simpan draf satu putaran dan serahkan penanda ke putaran berikutnya. */
async function simpanPutaran(input: AnalisaLatarInput, penanda: Date, berikut: Date, usulan: UsulanAnalisaAi[], model: string): Promise<boolean> {
  return db.$transaction(
    async (tx) => {
      const klaim = await tx.raplAnalisaAiRun.updateMany({
        where: { id: input.runId, pendingSince: penanda },
        data: { pendingSince: berikut, model },
      });
      if (klaim.count === 0) return false;
      await tx.raplAnalisaAi.updateMany({
        where: { locationId: input.locationId, status: "draf", lineageKey: { in: usulan.map((u) => u.lineageKey) }, runId: { not: input.runId } },
        data: { status: "diganti" },
      });
      for (const u of usulan) {
        await tx.raplAnalisaAi.create({
          data: {
            runId: input.runId,
            locationId: input.locationId,
            lineageKey: u.lineageKey,
            code: u.code,
            uraian: u.uraian,
            satuan: u.satuan,
            tanda: u.tanda ?? null,
            keyakinan: u.keyakinan,
            alasan: u.alasan,
            komponen: {
              create: u.komponen.map((k, i) => ({ urutan: i + 1, kategori: k.kategori, nama: k.nama, satuan: k.satuan, koefisien: k.koefisien })),
            },
          },
        });
      }
      return true;
    },
    { timeout: 30_000 },
  );
}

async function tutupUraiSemua(input: AnalisaLatarInput, penanda: Date, hasil: { ok: true; model: string | null } | { ok: false; error: string }) {
  const tersimpan = await db.raplAnalisaAi.count({ where: { runId: input.runId } });
  await db.raplAnalisaAiRun.updateMany({
    where: { id: input.runId, pendingSince: penanda },
    data: {
      pendingSince: null,
      selesaiAt: new Date(),
      status: hasil.ok || tersimpan > 0 ? "selesai" : "gagal",
      ...(hasil.ok && hasil.model ? { model: hasil.model } : {}),
      errorMessage: hasil.ok ? null : tersimpan > 0 ? `Berhenti setelah ${tersimpan} uraian: ${hasil.error}` : hasil.error,
      diminta: tersimpan,
    },
  });
}

/**
 * URAI SEMUA ITEM (DECISIONS 807) – berputar sampai seluruh uraian tanpa
 * analisa punya draf. Tidak pernah melempar; selalu menutup run dengan
 * penanda TERAKHIR.
 */
async function uraiSemua(user: SessionUser, input: AnalisaLatarInput): Promise<void> {
  let penanda = input.penanda;
  try {
    const { getAiGuardConfig } = await import("@/lib/ai-hub/guard");
    const { batasJawabanMs } = await import("@/lib/ai-hub/guard-rules");
    const batas = batasJawabanMs(await getAiGuardConfig());
    const sudah = new Set<string>();
    let model: string | null = null;
    for (let i = 0; i < MAKS_PUTARAN_ANALISA; i++) {
      const siap = await siapkanTargetAnalisa(input.locationId, undefined, sudah);
      if ("error" in siap) {
        await tutupUraiSemua(input, penanda, i === 0 ? { ok: false, error: siap.error } : { ok: true, model });
        return;
      }
      for (const t of siap.target) sudah.add(t.tanda ?? t.lineageKey);
      const hasil = await usulkanAnalisaDenganAi(user, siap, { tenggatTotalMs: Math.max(60_000, batas - 20_000) });
      if (!hasil.ok) {
        // Satu putaran yang tidak menghasilkan apa pun tidak menghentikan
        // seluruh perputaran bila putaran itu sekadar "tidak bisa diurai";
        // galat penyedia (kuota, jaringan) menghentikannya.
        if (/tidak menghasilkan analisa/i.test(hasil.error)) continue;
        await tutupUraiSemua(input, penanda, hasil);
        return;
      }
      model = hasil.model;
      const berikut = new Date(Math.max(Date.now(), penanda.getTime() + 1));
      if (!(await simpanPutaran(input, penanda, berikut, hasil.usulan, hasil.model))) return;
      penanda = berikut;
    }
    await tutupUraiSemua(input, penanda, { ok: true, model });
  } catch (err) {
    console.error("[ahsp/analisa-ai-latar] urai semua gagal:", err);
    await tutupUraiSemua(input, penanda, { ok: false, error: err instanceof Error ? err.message : "Urai semua item gagal." }).catch(() => {});
  } finally {
    await db.raplAnalisaAiRun
      .updateMany({ where: { id: input.runId, pendingSince: penanda }, data: { pendingSince: null, status: "gagal", selesaiAt: new Date() } })
      .catch(() => {});
  }
}
