"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, auditIn } from "@/lib/audit";
import { ForbiddenError, requestIp, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { RingkasUsulanAi } from "./usulan-status";

/**
 * Aksi DRAF ANALISA AI (DECISIONS baru 2026-10-07).
 *
 * Syaratnya sama dengan draf harga AI (DECISIONS 441/475): MEMINTA dan
 * MENERIMA menuntut `ai.generate` DAN `rapl.manage`; menolak dan mencabut
 * cukup `rapl.manage`. Yang dikirim peramban selalu ID draf – komponen dan
 * koefisiennya dibaca ulang dari baris draf milik lokasi ini.
 */

const mintaSkema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1).max(200),
  dipilih: z.array(z.string().max(500)).max(50).optional(),
});

export async function mintaAnalisaAiAction(args: {
  locationId: string;
  slug: string;
  dipilih?: string[];
}): Promise<{ ok: true; diminta: number; totalTanpa: number; tidakDiminta: number } | { ok: false; error: string }> {
  const parsed = mintaSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await requireCapability("ai.generate");
    await requireCapability("rapl.manage");
    await requireLocationAccess(user, d.locationId);

    const { getAiGuardConfig, checkAiGuard, AiGuardError } = await import("@/lib/ai-hub/guard");
    const { batasJawabanMs } = await import("@/lib/ai-hub/guard-rules");
    const cfg = await getAiGuardConfig();
    const ambang = new Date(Date.now() - batasJawabanMs(cfg));
    const berjalan = await db.raplAnalisaAiRun.findFirst({
      where: { locationId: d.locationId, pendingSince: { not: null, gt: ambang } },
      select: { id: true },
    });
    if (berjalan) return { ok: false, error: "Permintaan draf analisa untuk lokasi ini masih berjalan." };

    const { siapkanTargetAnalisa, promptAnalisa } = await import("./analisa-ai");
    const dipilih = d.dipilih && d.dipilih.length > 0 ? new Set(d.dipilih) : undefined;
    const siap = await siapkanTargetAnalisa(d.locationId, dipilih);
    if ("error" in siap) return { ok: false, error: siap.error };

    try {
      await checkAiGuard(user, { kind: "rapl.usulan_analisa", locationCount: 1, inputChars: promptAnalisa(siap).length });
    } catch (err) {
      if (err instanceof AiGuardError) return { ok: false, error: err.message };
      throw err;
    }

    const penanda = new Date();
    const run = await db.raplAnalisaAiRun.create({
      data: {
        locationId: d.locationId,
        status: "menunggu",
        pendingSince: penanda,
        diminta: siap.target.length,
        totalTanpa: siap.totalTanpa,
        requestedById: user.id,
      },
      select: { id: true },
    });
    await audit(user.id, "rapl.analisa_ai.minta", "location", d.locationId, {
      runId: run.id,
      diminta: siap.target.length,
      totalTanpa: siap.totalTanpa,
      item: siap.target.map((t) => t.lineageKey),
    });

    const { mulaiAnalisaAiLatar } = await import("./analisa-ai-latar");
    mulaiAnalisaAiLatar(user, { runId: run.id, penanda, locationId: d.locationId, dipilih: d.dipilih });

    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, diminta: siap.target.length, totalTanpa: siap.totalTanpa, tidakDiminta: siap.tidakDiminta };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal meminta draf analisa AI." };
  }
}

const putusanSkema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1).max(200),
  ids: z.array(z.uuid()).min(1).max(100),
});

/**
 * TERIMA draf: analisa ini mulai dipakai RAPL untuk itemnya. Analisa AI yang
 * sebelumnya diterima untuk item yang sama DICABUT – satu item, satu analisa.
 */
export async function terimaAnalisaAiAction(args: {
  locationId: string;
  slug: string;
  ids: string[];
}): Promise<{ ok: true; diterima: number } | { ok: false; error: string }> {
  const parsed = putusanSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await requireCapability("ai.generate");
    await requireCapability("rapl.manage");
    await requireLocationAccess(user, d.locationId);
    const draf = await db.raplAnalisaAi.findMany({
      where: { id: { in: d.ids }, locationId: d.locationId, status: "draf" },
      select: { id: true, lineageKey: true },
    });
    if (draf.length === 0) return { ok: false, error: "Tidak ada draf yang bisa diterima. Mungkin sudah diputuskan." };
    const ip = await requestIp();
    const kini = new Date();
    await db.$transaction(async (tx) => {
      await tx.raplAnalisaAi.updateMany({
        where: { locationId: d.locationId, status: "diterima", lineageKey: { in: draf.map((x) => x.lineageKey) } },
        data: { status: "dicabut", diputuskanOlehId: user.id, diputuskanAt: kini },
      });
      await tx.raplAnalisaAi.updateMany({
        where: { id: { in: draf.map((x) => x.id) } },
        data: { status: "diterima", diputuskanOlehId: user.id, diputuskanAt: kini },
      });
      await auditIn(
        tx,
        user.id,
        "rapl.analisa_ai.terima",
        "location",
        d.locationId,
        { jumlah: draf.length, usulanId: draf.map((x) => x.id), item: draf.map((x) => x.lineageKey) },
        ip,
      );
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, diterima: draf.length };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menerima draf analisa." };
  }
}

/** TOLAK draf – dicatat sebagai keputusan, bukan sekadar dibuang dari layar. */
export async function tolakAnalisaAiAction(args: {
  locationId: string;
  slug: string;
  ids: string[];
}): Promise<{ ok: true; ditolak: number } | { ok: false; error: string }> {
  const parsed = putusanSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await requireCapability("rapl.manage");
    await requireLocationAccess(user, d.locationId);
    const ip = await requestIp();
    const n = await db.$transaction(async (tx) => {
      const r = await tx.raplAnalisaAi.updateMany({
        where: { id: { in: d.ids }, locationId: d.locationId, status: "draf" },
        data: { status: "ditolak", diputuskanOlehId: user.id, diputuskanAt: new Date() },
      });
      if (r.count > 0) {
        await auditIn(tx, user.id, "rapl.analisa_ai.tolak", "location", d.locationId, { jumlah: r.count, usulanId: d.ids }, ip);
      }
      return r.count;
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, ditolak: n };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menolak draf analisa." };
  }
}

/** CABUT analisa AI yang sudah diterima – item kembali tanpa analisa. */
export async function cabutAnalisaAiAction(args: {
  locationId: string;
  slug: string;
  ids: string[];
}): Promise<{ ok: true; dicabut: number } | { ok: false; error: string }> {
  const parsed = putusanSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await requireCapability("rapl.manage");
    await requireLocationAccess(user, d.locationId);
    const ip = await requestIp();
    const n = await db.$transaction(async (tx) => {
      const r = await tx.raplAnalisaAi.updateMany({
        where: { id: { in: d.ids }, locationId: d.locationId, status: "diterima" },
        data: { status: "dicabut", diputuskanOlehId: user.id, diputuskanAt: new Date() },
      });
      if (r.count > 0) {
        await auditIn(tx, user.id, "rapl.analisa_ai.cabut", "location", d.locationId, { jumlah: r.count, usulanId: d.ids }, ip);
      }
      return r.count;
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, dicabut: n };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal mencabut analisa AI." };
  }
}

/** Penengokan status selama menunggu. */
export async function statusAnalisaAiAction(args: {
  locationId: string;
}): Promise<{ ok: true; status: RingkasUsulanAi } | { ok: false; error: string }> {
  try {
    const user = await requireCapability("rapl.manage");
    await requireLocationAccess(user, args.locationId);
    const { statusAnalisaAi } = await import("./analisa-ai-keadaan");
    return { ok: true, status: await statusAnalisaAi(args.locationId) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Anda tidak punya akses untuk ini." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal memeriksa status." };
  }
}
