"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireCapability, requireLocationAccess, requireUser } from "@/lib/auth/session";
import {
  ajukanPadananAktif,
  lepasPadananAktif,
  PadananAktifError,
  setujuiPadananAktif,
  tutupPadananAktif,
} from "@/lib/rab/padanan-aktif";

/**
 * Aksi menu "Pasangkan realisasi" (DECISIONS 777). Aturan, penulisan, dan
 * audit di `lib/rab/padanan-aktif` (di dalam transaksi yang sama); di sini
 * otorisasi, parsing, dan revalidate.
 *
 * KABAR BERHASIL LEWAT ALAMAT HALAMAN, bukan state formulir: tiap aksi yang
 * berhasil memindahkan barisnya ke bagian lain (belum → menunggu → berlaku →
 * riwayat), jadi formulir yang memegang pesan suksesnya ikut hilang dan orang
 * tidak melihat apa pun (render-cek 2026-11-25). Halaman menyusun kalimatnya
 * dari data usulan itu sendiri; alamat hanya membawa kode dan id. Galat tetap
 * di samping tombolnya – barisnya tidak pindah.
 *
 * - Ajukan, Batalkan, Lepas: `rab.manage` + akses lokasi.
 * - Setujui, Tolak: JABATAN (PD/AM/PM/SM) + akses lokasi, bukan capability –
 *   sama dengan persetujuan aktivasi adendum (DECISIONS 234). Super admin
 *   punya rab.manage penuh dan tetap tidak boleh menandatangani.
 */

export type PasangkanState = { error?: string; success?: string } | undefined;

function gagal(err: unknown): PasangkanState {
  if (err instanceof PadananAktifError || err instanceof ForbiddenError) return { error: err.message };
  console.error("[padanan-aktif] aksi gagal:", err);
  return { error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

function segarkan(slug: string) {
  for (const p of ["/rab/pasangkan", "/rab", "/rab/tidak-terbobot", "/progress", ""]) {
    revalidatePath(`/lokasi/${slug}${p}`);
  }
}

/** Ke menu dengan kabar hasil aksinya. Dipanggil DI LUAR try: `redirect` melempar. */
function keMenu(slug: string, kabar: string, id: string, blanko = 0): never {
  redirect(`/lokasi/${slug}/rab/pasangkan?kabar=${kabar}&id=${id}${blanko > 0 ? `&blanko=${blanko}` : ""}`);
}

async function lokasiDariSlug(slug: string) {
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!location) throw new PadananAktifError("Lokasi tidak ditemukan.");
  return location;
}

/** Usulan + lokasinya; lokasi diambil dari usulan, bukan dari isian form. */
async function usulanDanLokasi(padananId: string) {
  const p = await db.rabPadananAktif.findUnique({
    where: { id: padananId },
    select: { id: true, location: { select: { id: true, slug: true } } },
  });
  if (!p) throw new PadananAktifError("Usulan tidak ditemukan.");
  return p;
}

const alasan = z.string().trim().max(500, "Alasan terlalu panjang – maksimal 500 huruf.");

const skemaAjukan = z.object({
  slug: z.string().trim().min(1),
  lineageLama: z.string().trim().min(1, "Item tidak valid."),
  lineageBaru: z.string().trim().min(1, "Pilih dulu item tujuannya."),
  alasan,
});

export async function ajukanPadananAktifAction(_prev: PasangkanState, fd: FormData): Promise<PasangkanState> {
  const p = skemaAjukan.safeParse({
    slug: fd.get("slug"),
    lineageLama: fd.get("lineageLama"),
    lineageBaru: fd.get("lineageBaru"),
    alasan: fd.get("alasan") ?? "",
  });
  if (!p.success) return { error: p.error.issues[0].message };
  let hasil: { slug: string; id: string };
  try {
    const user = await requireCapability("rab.manage");
    const location = await lokasiDariSlug(p.data.slug);
    await requireLocationAccess(user, location.id);
    const h = await ajukanPadananAktif({
      locationId: location.id,
      lineageLama: p.data.lineageLama,
      lineageBaru: p.data.lineageBaru,
      alasan: p.data.alasan,
      userId: user.id,
    });
    segarkan(location.slug);
    hasil = { slug: location.slug, id: h.id };
  } catch (e) {
    return gagal(e);
  }
  keMenu(hasil.slug, "diajukan", hasil.id);
}

const skemaId = z.object({ padananId: z.uuid("Usulan tidak valid.") });

export async function setujuiPadananAktifAction(_prev: PasangkanState, fd: FormData): Promise<PasangkanState> {
  const p = skemaId.safeParse({ padananId: fd.get("padananId") });
  if (!p.success) return { error: p.error.issues[0].message };
  let hasil: { slug: string; id: string; berlaku: boolean; blanko: number };
  try {
    const user = await requireUser();
    const u = await usulanDanLokasi(p.data.padananId);
    await requireLocationAccess(user, u.location.id);
    const h = await setujuiPadananAktif({ padananId: u.id, user: { id: user.id, role: user.role } });
    segarkan(u.location.slug);
    hasil = { slug: u.location.slug, id: u.id, berlaku: h.berlaku, blanko: h.berlaku ? h.snapshotDibangunUlang : 0 };
  } catch (e) {
    return gagal(e);
  }
  keMenu(hasil.slug, hasil.berlaku ? "berlaku" : "setuju", hasil.id, hasil.blanko);
}

const skemaTutup = z.object({
  padananId: z.uuid("Usulan tidak valid."),
  cara: z.enum(["tolak", "batal"]),
  alasan,
});

export async function tutupPadananAktifAction(_prev: PasangkanState, fd: FormData): Promise<PasangkanState> {
  const p = skemaTutup.safeParse({ padananId: fd.get("padananId"), cara: fd.get("cara"), alasan: fd.get("alasan") ?? "" });
  if (!p.success) return { error: p.error.issues[0].message };
  let hasil: { slug: string; id: string };
  try {
    // Tolak = jabatan penyetuju (diperiksa layanannya); Batalkan = pengelola RAB.
    const user = p.data.cara === "batal" ? await requireCapability("rab.manage") : await requireUser();
    const u = await usulanDanLokasi(p.data.padananId);
    await requireLocationAccess(user, u.location.id);
    await tutupPadananAktif({ padananId: u.id, user: { id: user.id, role: user.role }, cara: p.data.cara, alasan: p.data.alasan });
    segarkan(u.location.slug);
    hasil = { slug: u.location.slug, id: u.id };
  } catch (e) {
    return gagal(e);
  }
  keMenu(hasil.slug, "ditutup", hasil.id);
}

const skemaLepas = z.object({ padananId: z.uuid("Pasangan tidak valid."), alasan });

export async function lepasPadananAktifAction(_prev: PasangkanState, fd: FormData): Promise<PasangkanState> {
  const p = skemaLepas.safeParse({ padananId: fd.get("padananId"), alasan: fd.get("alasan") ?? "" });
  if (!p.success) return { error: p.error.issues[0].message };
  let hasil: { slug: string; id: string; blanko: number };
  try {
    const user = await requireCapability("rab.manage");
    const u = await usulanDanLokasi(p.data.padananId);
    await requireLocationAccess(user, u.location.id);
    const h = await lepasPadananAktif({ padananId: u.id, userId: user.id, alasan: p.data.alasan });
    segarkan(u.location.slug);
    hasil = { slug: u.location.slug, id: u.id, blanko: h.snapshotDibangunUlang };
  } catch (e) {
    return gagal(e);
  }
  keMenu(hasil.slug, "dilepas", hasil.id, hasil.blanko);
}
