"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { sinkronKawal } from "./sinkron";

/**
 * Aksi sinkron & pencocokan lokasi Kawal (DECISIONS 690). Semua lewat
 * `kawal.manage` (Super Admin + Program Director) dan ter-audit.
 */

export type KawalAksiState = { error?: string; success?: string } | undefined;

function galat(err: unknown): KawalAksiState {
  if (err instanceof ForbiddenError) return { error: "Anda tidak punya izin untuk tindakan ini." };
  console.error("[kawal] aksi gagal:", err);
  return { error: "Tindakan gagal. Coba lagi; bila berulang, laporkan ke admin." };
}

function segarkan() {
  revalidatePath("/kawal/pencocokan");
  revalidatePath("/sistem");
}

export async function sinkronKawalAction(_prev: KawalAksiState, _formData: FormData): Promise<KawalAksiState> {
  try {
    const user = await requireCapability("kawal.manage");
    const hasil = await sinkronKawal({ pemicu: "manual", olehId: user.id });
    await audit(user.id, "kawal.sinkron", "system", hasil.runId ?? null, {
      status: hasil.status,
      diterima: hasil.diterima ?? null,
      berpasangan: hasil.berpasangan ?? null,
      antre: hasil.antre ?? null,
      dibuang: hasil.dibuang ?? null,
    });
    segarkan();
    return hasil.status === "berhasil" || hasil.status === "tidak_berubah"
      ? { success: hasil.pesan }
      : { error: hasil.pesan };
  } catch (err) {
    return galat(err);
  }
}

/** Nama lokasi Kawal dari snapshot terbaru yang memuatnya – untuk pesan hasil. */
async function namaKawal(kawalId: number): Promise<string | null> {
  const b = await db.kawalLocationSnapshot.findFirst({
    where: { kawalId },
    orderBy: { snapshot: { capturedAt: "desc" } },
    select: { namaKnmp: true },
  });
  return b?.namaKnmp ?? null;
}

const skemaPeta = z.discriminatedUnion("aksi", [
  z.object({ aksi: z.literal("pasangkan"), kawalId: z.coerce.number().int().positive(), locationId: z.uuid() }),
  z.object({ aksi: z.literal("bukan_marlin"), kawalId: z.coerce.number().int().positive() }),
  z.object({ aksi: z.literal("kembalikan"), kawalId: z.coerce.number().int().positive() }),
]);

export async function petaKawalAction(_prev: KawalAksiState, formData: FormData): Promise<KawalAksiState> {
  const p = skemaPeta.safeParse({
    aksi: formData.get("aksi"),
    kawalId: formData.get("kawalId"),
    locationId: formData.get("locationId") || undefined,
  });
  if (!p.success) {
    return {
      error:
        formData.get("aksi") === "pasangkan" && !formData.get("locationId")
          ? "Pilih lokasi MARLIN-nya dulu."
          : "Isian tidak dikenali. Muat ulang halaman, lalu coba lagi.",
    };
  }
  const d = p.data;
  try {
    const user = await requireCapability("kawal.manage");
    const sebelum = await db.kawalLocationMap.findUnique({
      where: { kawalId: d.kawalId },
      select: { locationId: true, status: true },
    });

    if (d.aksi === "pasangkan") {
      const lokasi = await db.location.findFirst({
        where: { id: d.locationId, package: { orgId: user.orgId } },
        select: { id: true, name: true },
      });
      if (!lokasi) return { error: "Lokasi MARLIN tidak ditemukan." };
      await requireLocationAccess(user, lokasi.id);
      try {
        await db.kawalLocationMap.upsert({
          where: { kawalId: d.kawalId },
          create: { kawalId: d.kawalId, locationId: lokasi.id, status: "dikonfirmasi", decidedById: user.id },
          update: { locationId: lokasi.id, status: "dikonfirmasi", basis: null, decidedById: user.id },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { error: `${lokasi.name} sudah dipasangkan dengan lokasi Kawal lain. Ubah pasangan itu dulu.` };
        }
        throw err;
      }
      await audit(user.id, "kawal.peta", "location", lokasi.id, { aksi: d.aksi, kawalId: d.kawalId, sebelum });
      segarkan();
      const nama = await namaKawal(d.kawalId);
      return { success: `${nama ?? "Lokasi Kawal"} dipasangkan dengan ${lokasi.name}.` };
    }

    if (d.aksi === "bukan_marlin") {
      await db.kawalLocationMap.upsert({
        where: { kawalId: d.kawalId },
        create: { kawalId: d.kawalId, locationId: null, status: "bukan_marlin", decidedById: user.id },
        update: { locationId: null, status: "bukan_marlin", basis: null, decidedById: user.id },
      });
      await audit(user.id, "kawal.peta", "system", null, { aksi: d.aksi, kawalId: d.kawalId, sebelum });
      segarkan();
      const nama = await namaKawal(d.kawalId);
      return {
        success: `${nama ?? "Baris ini"} ditandai bukan lokasi MARLIN. Barisnya tidak disimpan lagi di tarikan berikutnya.`,
      };
    }

    // kembalikan: hanya untuk keputusan "bukan MARLIN" – pasangan yang salah
    // diperbaiki dengan memilih lokasi lain, bukan dilepas lalu dicocokkan
    // otomatis ulang ke tempat yang sama.
    if (sebelum?.status !== "bukan_marlin") return { error: "Baris ini tidak sedang ditandai bukan lokasi MARLIN." };
    await db.kawalLocationMap.delete({ where: { kawalId: d.kawalId } });
    await audit(user.id, "kawal.peta", "system", null, { aksi: d.aksi, kawalId: d.kawalId, sebelum });
    segarkan();
    return { success: "Dikembalikan. Baris ini dicocokkan ulang di sinkron berikutnya." };
  } catch (err) {
    return galat(err);
  }
}
