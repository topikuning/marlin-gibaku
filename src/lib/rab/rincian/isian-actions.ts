"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditIn } from "@/lib/audit";
import { ForbiddenError, requestIp, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * BACKUP VOLUME YANG DIISI DI MARLIN (DECISIONS baru 2026-10-07).
 *
 * Untuk item yang tidak punya backup di berkasnya dan tidak bisa mewarisi dari
 * revisi sebelumnya (item baru, volume berubah lewat editor/template adendum,
 * atau berkas yang volumenya diketik langsung). Angka resmi tetap volume RAB;
 * isian ini rujukan perhitungannya, dan selisihnya disebut di layar.
 *
 * Kapabilitas `rab.manage` + akses lokasi: yang menyusun RAB/adendum yang
 * menuliskan dari mana volumenya.
 */

export type IsianState = { error?: string; success?: string } | undefined;

/** "1,5" / "1.5" / "" → angka | null | "salah". Titik ribuan tidak dipakai di isian ukuran. */
function bacaUkuran(v: FormDataEntryValue | null): number | null | "salah" {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : "salah";
}

async function itemMilik(revisionId: string, lineageKey: string, orgId: string) {
  return db.rabNode.findFirst({
    where: { revisionId, lineageKey, kind: "item", revision: { location: { package: { orgId } } } },
    select: {
      code: true,
      name: true,
      revision: { select: { id: true, revisionNo: true, locationId: true, location: { select: { slug: true } } } },
    },
  });
}

const dasar = z.object({ revisionId: z.uuid(), lineageKey: z.string().min(1).max(500) });

export async function tambahBarisBackupAction(_p: IsianState, fd: FormData): Promise<IsianState> {
  try {
    const user = await requireCapability("rab.manage");
    const d = dasar.safeParse({ revisionId: fd.get("revisionId"), lineageKey: fd.get("lineageKey") });
    if (!d.success) return { error: "Item tidak valid." };
    const uraian = String(fd.get("uraian") ?? "").trim();
    if (uraian.length < 2 || uraian.length > 300) return { error: "Tulis uraian barisnya (2–300 huruf)." };
    const ukuran = {
      jumlah: bacaUkuran(fd.get("jumlah")),
      panjang: bacaUkuran(fd.get("panjang")),
      lebar: bacaUkuran(fd.get("lebar")),
      tinggi: bacaUkuran(fd.get("tinggi")),
    };
    const salah = Object.entries(ukuran).find(([, v]) => v === "salah");
    if (salah) return { error: `Isi ${salah[0]} dengan angka, mis. 2,5.` };
    if (Object.values(ukuran).every((v) => v == null)) {
      return { error: "Isi paling tidak satu angka: jumlah, panjang, lebar, atau tinggi." };
    }
    const item = await itemMilik(d.data.revisionId, d.data.lineageKey, user.orgId);
    if (!item) return { error: "Item tidak ditemukan." };
    await requireLocationAccess(user, item.revision.locationId);
    const keterangan = String(fd.get("keterangan") ?? "").trim().slice(0, 300) || null;
    const kurang = fd.get("kurang") === "1";

    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      const akhir = await tx.rabBackupIsian.aggregate({
        where: { revisionId: d.data.revisionId, lineageKey: d.data.lineageKey },
        _max: { urutan: true },
      });
      const baris = await tx.rabBackupIsian.create({
        data: {
          revisionId: d.data.revisionId,
          lineageKey: d.data.lineageKey,
          urutan: (akhir._max.urutan ?? 0) + 1,
          uraian,
          jumlah: ukuran.jumlah as number | null,
          panjang: ukuran.panjang as number | null,
          lebar: ukuran.lebar as number | null,
          tinggi: ukuran.tinggi as number | null,
          kurang,
          keterangan,
          dibuatOlehId: user.id,
        },
        select: { id: true },
      });
      await auditIn(
        tx,
        user.id,
        "rab.backup_isian.tambah",
        "rab_revision",
        d.data.revisionId,
        { lineageKey: d.data.lineageKey, barisId: baris.id, uraian, ...ukuran, kurang },
        ip,
      );
    });
    revalidatePath(`/lokasi/${item.revision.location.slug}/rab`, "layout");
    return { success: "Baris backup ditambahkan." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Gagal menyimpan baris backup." };
  }
}

export async function hapusBarisBackupAction(_p: IsianState, fd: FormData): Promise<IsianState> {
  try {
    const user = await requireCapability("rab.manage");
    const id = z.uuid().safeParse(fd.get("id"));
    if (!id.success) return { error: "Baris tidak valid." };
    const baris = await db.rabBackupIsian.findFirst({
      where: { id: id.data, revision: { location: { package: { orgId: user.orgId } } } },
      select: {
        id: true,
        revisionId: true,
        lineageKey: true,
        uraian: true,
        revision: { select: { locationId: true, location: { select: { slug: true } } } },
      },
    });
    if (!baris) return { error: "Baris tidak ditemukan." };
    await requireLocationAccess(user, baris.revision.locationId);
    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      await tx.rabBackupIsian.delete({ where: { id: baris.id } });
      await auditIn(
        tx,
        user.id,
        "rab.backup_isian.hapus",
        "rab_revision",
        baris.revisionId,
        { lineageKey: baris.lineageKey, barisId: baris.id, uraian: baris.uraian },
        ip,
      );
    });
    revalidatePath(`/lokasi/${baris.revision.location.slug}/rab`, "layout");
    return { success: "Baris backup dihapus." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Gagal menghapus baris backup." };
  }
}
