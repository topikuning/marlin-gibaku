"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { ambangSah, formatAmbangPp } from "./compare";
import { getAmbangKawal, setAmbangKawal } from "./setelan";
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

const skemaSarana = z.discriminatedUnion("aksi", [
  z.object({
    aksi: z.literal("pasangkan"),
    locationId: z.uuid(),
    kawalItemId: z.coerce.number().int(),
    lineageKey: z.string().min(1),
  }),
  z.object({ aksi: z.literal("tidak_ada"), locationId: z.uuid(), kawalItemId: z.coerce.number().int() }),
  z.object({ aksi: z.literal("kembalikan"), locationId: z.uuid(), kawalItemId: z.coerce.number().int() }),
]);

/**
 * Pasangan sarana Kawal ↔ kelompok RAB MARLIN di satu lokasi (DECISIONS 694).
 * `kembalikan` menghapus keputusan orang – sarananya kembali ke usulan otomatis.
 */
export async function petaSaranaKawalAction(_prev: KawalAksiState, formData: FormData): Promise<KawalAksiState> {
  const p = skemaSarana.safeParse({
    aksi: formData.get("aksi"),
    locationId: formData.get("locationId"),
    kawalItemId: formData.get("kawalItemId"),
    lineageKey: formData.get("lineageKey") || undefined,
  });
  if (!p.success) {
    return {
      error:
        formData.get("aksi") === "pasangkan" && !formData.get("lineageKey")
          ? "Pilih kelompok RAB-nya dulu."
          : "Isian tidak dikenali. Muat ulang halaman, lalu coba lagi.",
    };
  }
  const d = p.data;
  try {
    const user = await requireCapability("kawal.manage");
    const lokasi = await db.location.findFirst({
      where: { id: d.locationId, package: { orgId: user.orgId } },
      select: { id: true, slug: true, kawalMap: { select: { kawalId: true, status: true } } },
    });
    if (!lokasi) return { error: "Lokasi tidak ditemukan." };
    await requireLocationAccess(user, lokasi.id);
    if (!lokasi.kawalMap || lokasi.kawalMap.status === "bukan_marlin") {
      return { error: "Lokasi ini belum berpasangan dengan Kawal." };
    }

    // Sarana harus ada di tarikan TERBARU lokasi Kawal pasangannya.
    const terbaru = await db.kawalLocationSnapshot.findFirst({
      where: { kawalId: lokasi.kawalMap.kawalId },
      orderBy: { snapshot: { capturedAt: "desc" } },
      select: { sarana: { where: { kawalItemId: d.kawalItemId }, select: { nama: true }, take: 1 } },
    });
    const sarana = terbaru?.sarana[0];
    if (!sarana) return { error: "Sarana ini tidak ada lagi di data Kawal terbaru. Muat ulang halaman." };

    const kunci = { locationId_kawalItemId: { locationId: lokasi.id, kawalItemId: d.kawalItemId } };
    const sebelum = await db.kawalSaranaMap.findUnique({ where: kunci, select: { status: true, lineageKey: true } });
    const selesai = async (pesan: string) => {
      await audit(user.id, "kawal.peta_sarana", "location", lokasi.id, {
        aksi: d.aksi,
        kawalItemId: d.kawalItemId,
        lineageKey: d.aksi === "pasangkan" ? d.lineageKey : null,
        sebelum,
      });
      revalidatePath(`/lokasi/${lokasi.slug}/kawal`);
      return { success: pesan };
    };

    if (d.aksi === "pasangkan") {
      const kelompok = await db.rabNode.findFirst({
        where: { lineageKey: d.lineageKey, parentId: null, revision: { locationId: lokasi.id, status: "aktif" } },
        select: { name: true },
      });
      if (!kelompok) return { error: "Kelompok itu tidak ada di RAB aktif lokasi ini." };
      await db.kawalSaranaMap.upsert({
        where: kunci,
        create: {
          locationId: lokasi.id,
          kawalItemId: d.kawalItemId,
          status: "dikonfirmasi",
          lineageKey: d.lineageKey,
          decidedById: user.id,
        },
        update: { status: "dikonfirmasi", lineageKey: d.lineageKey, decidedById: user.id },
      });
      return selesai(`${sarana.nama} dipasangkan dengan ${kelompok.name}.`);
    }

    if (d.aksi === "tidak_ada") {
      await db.kawalSaranaMap.upsert({
        where: kunci,
        create: { locationId: lokasi.id, kawalItemId: d.kawalItemId, status: "tidak_ada", decidedById: user.id },
        update: { status: "tidak_ada", lineageKey: null, decidedById: user.id },
      });
      return selesai(`${sarana.nama} ditandai tidak ada padanannya di RAB.`);
    }

    if (!sebelum) return { error: "Sarana ini belum pernah diputuskan." };
    await db.kawalSaranaMap.delete({ where: kunci });
    return selesai(`Keputusan untuk ${sarana.nama} dihapus. Kembali ke usulan otomatis.`);
  } catch (err) {
    return galat(err);
  }
}

/** "7,5" dan "7.5" sama-sama dibaca 7,5 – orang Indonesia menulis koma. */
const angkaPp = z.preprocess(
  (v) => (typeof v === "string" ? Number(v.trim().replace(",", ".")) : v),
  z.number(),
);

/** Ambang selisih MARLIN vs Kawal – dipakai layar Kawal DAN aturan EWS `selisih_kawal` (DECISIONS 694). */
export async function ambangKawalAction(_prev: KawalAksiState, formData: FormData): Promise<KawalAksiState> {
  const p = z
    .object({ tinggiPp: angkaPp, kritisPp: angkaPp })
    .safeParse({ tinggiPp: formData.get("tinggiPp"), kritisPp: formData.get("kritisPp") });
  if (!p.success || !ambangSah(p.data)) {
    return { error: "Isi dua angka: ambang tinggi lebih dari 0, ambang kritis lebih besar dari ambang tinggi, paling besar 100." };
  }
  try {
    const user = await requireCapability("kawal.manage");
    const sebelum = await getAmbangKawal();
    await setAmbangKawal(p.data);
    await audit(user.id, "kawal.ambang", "system", null, { sebelum, sesudah: p.data });
    revalidatePath("/kawal");
    revalidatePath("/kawal/pencocokan");
    revalidatePath("/perlu-tindakan");
    return {
      success: `Ambang disimpan: tinggi ${formatAmbangPp(p.data.tinggiPp)}, kritis ${formatAmbangPp(p.data.kritisPp)}.`,
    };
  } catch (err) {
    return galat(err);
  }
}
