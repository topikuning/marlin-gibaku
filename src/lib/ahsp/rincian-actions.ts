"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditIn } from "@/lib/audit";
import {
  ForbiddenError,
  requestIp,
  requireCapability,
  requireLocationAccess,
} from "@/lib/auth/session";
import { db } from "@/lib/db";
import { BATAS_HARGA_RUPIAH, bacaRupiah } from "./hsd-price";

/**
 * Menyusun RINCIAN PELAKSANAAN satu item RAB (RAPL-08, DECISIONS 475).
 *
 * Kapabilitasnya `finance.input`, sama dengan HSD: yang disusun di sini
 * langsung menjadi BIAYA dan MARGIN per item — bobotnya sama dengan
 * memasukkan angka uang, bukan sekadar mengelola RAB.
 *
 * Tiga batas yang ditegakkan di sini, dan ketiganya keputusan user 2026-08-29:
 *
 * 1. **Koefisien AHSP tidak bisa disunting.** Yang boleh hanya MENAMBAH
 *    komponen. Angka resmi yang bisa digeser diam-diam berhenti bisa
 *    dipertahankan saat diperiksa.
 * 2. **Faktor konversi wajib berkatatan.** Dijaga di sini DAN oleh CHECK
 *    constraint — form bisa diakali, constraint tidak.
 * 3. **Borongan mengalahkan rincian komponen.** Satu item satu cara hitung.
 */

export type RincianActionState = { error?: string; success?: string } | undefined;

const dasar = {
  locationId: z.uuid(),
  slug: z.string().min(1).max(200),
  lineageKey: z.string().min(1).max(500),
};

async function pastikanIzin(locationId: string) {
  const user = await requireCapability("finance.input");
  await requireLocationAccess(user, locationId);
  return user;
}

/** Ambil (atau buat) baris rincian item — hanya saat orang memang mengisinya. */
async function rincianUntuk(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  locationId: string,
  lineageKey: string,
  userId: string,
): Promise<string> {
  const ada = await tx.raplRincian.findUnique({
    where: { locationId_lineageKey: { locationId, lineageKey } },
    select: { id: true },
  });
  if (ada) return ada.id;
  const baru = await tx.raplRincian.create({
    data: { locationId, lineageKey, updatedById: userId },
    select: { id: true },
  });
  return baru.id;
}

const konversiSkema = z.object({
  ...dasar,
  /** "" = hapus faktornya (kembali menuntut satuan sepadan). */
  faktor: z.string().max(40),
  catatan: z.string().max(500),
});

/**
 * Tetapkan faktor konversi satuan item → satuan analisa.
 *
 * Angkanya TIDAK boleh dihitung sistem. Ia keterangan teknis yang harus
 * dinyatakan dan dipertahankan orang — 0,15 untuk dinding setebal 15 cm bukan
 * sesuatu yang bisa disimpulkan dari kata "m2" dan "m3".
 */
export async function setFaktorKonversiAction(args: {
  locationId: string;
  slug: string;
  lineageKey: string;
  faktor: string;
  catatan: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = konversiSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const kosong = d.faktor.trim() === "";
  const angka = kosong ? null : Number(d.faktor.replace(",", "."));
  if (!kosong && (!Number.isFinite(angka) || (angka as number) <= 0)) {
    return { ok: false, error: `"${d.faktor}" bukan faktor konversi yang sah – harus lebih besar dari nol.` };
  }
  if (!kosong && d.catatan.trim().length < 3) {
    return {
      ok: false,
      error:
        "Faktor konversi wajib disertai alasannya (mis. “tebal dinding 15 cm”). Angka konversi tanpa alasan tidak bisa dipertahankan saat diperiksa.",
    };
  }

  try {
    const user = await pastikanIzin(d.locationId);
    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      const id = await rincianUntuk(tx, d.locationId, d.lineageKey, user.id);
      await tx.raplRincian.update({
        where: { id },
        data: {
          faktorKonversi: angka,
          catatanKonversi: kosong ? null : d.catatan.trim(),
          updatedById: user.id,
        },
      });
      await auditIn(
        tx,
        user.id,
        kosong ? "rapl.konversi.hapus" : "rapl.konversi.set",
        "location",
        d.locationId,
        { lineageKey: d.lineageKey, faktor: angka, catatan: kosong ? null : d.catatan.trim() },
        ip,
      );
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan faktor konversi." };
  }
}

const boronganSkema = z.object({
  ...dasar,
  /** "" = batalkan borongan; item kembali dihitung dari komponen. */
  harga: z.string().max(40),
  catatan: z.string().max(500),
});

export async function setBoronganAction(args: {
  locationId: string;
  slug: string;
  lineageKey: string;
  harga: string;
  catatan: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = boronganSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const harga = bacaRupiah(d.harga);
  if (harga === "salah") {
    return { ok: false, error: `"${d.harga}" tidak terbaca sebagai angka rupiah.` };
  }
  if (harga !== null && harga > BATAS_HARGA_RUPIAH) {
    return { ok: false, error: "Harga borongan di luar batas yang wajar." };
  }

  try {
    const user = await pastikanIzin(d.locationId);
    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      const id = await rincianUntuk(tx, d.locationId, d.lineageKey, user.id);
      await tx.raplRincian.update({
        where: { id },
        data: {
          hargaBorongan: harga,
          catatanBorongan: harga === null ? null : d.catatan.trim() || null,
          updatedById: user.id,
        },
      });
      await auditIn(
        tx,
        user.id,
        harga === null ? "rapl.borongan.hapus" : "rapl.borongan.set",
        "location",
        d.locationId,
        { lineageKey: d.lineageKey, harga: harga?.toString() ?? null },
        ip,
      );
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan harga borongan." };
  }
}

const komponenSkema = z.object({
  ...dasar,
  kategori: z.enum(["bahan", "upah", "alat", "fasilitas"]),
  nama: z.string().min(2).max(500),
  satuan: z.string().min(1).max(80),
  koefisien: z.string().max(40),
  catatan: z.string().max(500).optional(),
});

/**
 * Tambah satu komponen pada rincian item.
 *
 * Koefisiennya PER SATUAN ITEM RAB. Itu satuan yang dipikirkan orang saat
 * menambah sendiri; menyamakannya dengan koefisien AHSP akan membuat faktor
 * konversi terpakai dua kali (lihat `RincianItem` di rapl-calc.ts).
 */
export async function tambahKomponenAction(args: {
  locationId: string;
  slug: string;
  lineageKey: string;
  kategori: string;
  nama: string;
  satuan: string;
  koefisien: string;
  catatan?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = komponenSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const koef = Number(d.koefisien.replace(",", "."));
  if (!Number.isFinite(koef) || koef <= 0) {
    return { ok: false, error: `"${d.koefisien}" bukan koefisien yang sah – harus lebih besar dari nol.` };
  }

  try {
    const user = await pastikanIzin(d.locationId);
    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      const id = await rincianUntuk(tx, d.locationId, d.lineageKey, user.id);
      await tx.raplKomponenTambahan.upsert({
        where: {
          rincianId_kategori_nama_satuan: {
            rincianId: id,
            kategori: d.kategori,
            nama: d.nama.trim(),
            satuan: d.satuan.trim(),
          },
        },
        create: {
          rincianId: id,
          kategori: d.kategori,
          nama: d.nama.trim(),
          satuan: d.satuan.trim(),
          koefisien: koef,
          catatan: d.catatan?.trim() || null,
        },
        update: { koefisien: koef, catatan: d.catatan?.trim() || null },
      });
      await tx.raplRincian.update({ where: { id }, data: { updatedById: user.id } });
      await auditIn(
        tx,
        user.id,
        "rapl.komponen.tambah",
        "location",
        d.locationId,
        { lineageKey: d.lineageKey, kategori: d.kategori, nama: d.nama.trim(), satuan: d.satuan.trim(), koefisien: koef },
        ip,
      );
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menambah komponen." };
  }
}

const hapusSkema = z.object({
  ...dasar,
  kategori: z.string().min(1).max(80),
  nama: z.string().min(1).max(500),
  satuan: z.string().max(80),
});

export async function hapusKomponenAction(args: {
  locationId: string;
  slug: string;
  lineageKey: string;
  kategori: string;
  nama: string;
  satuan: string;
}): Promise<{ ok: true; terhapus: number } | { ok: false; error: string }> {
  const parsed = hapusSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await pastikanIzin(d.locationId);
    const ip = await requestIp();
    const n = await db.$transaction(async (tx) => {
      const rincian = await tx.raplRincian.findUnique({
        where: { locationId_lineageKey: { locationId: d.locationId, lineageKey: d.lineageKey } },
        select: { id: true },
      });
      // Tidak ada baris rincian berarti tidak ada komponen tambahan; komponen
      // AHSP memang tidak tersimpan di sini dan tidak bisa dihapus.
      if (!rincian) return 0;
      const hasil = await tx.raplKomponenTambahan.deleteMany({
        where: {
          rincianId: rincian.id,
          kategori: d.kategori,
          nama: d.nama,
          satuan: d.satuan,
        },
      });
      if (hasil.count > 0) {
        await auditIn(
          tx,
          user.id,
          "rapl.komponen.hapus",
          "location",
          d.locationId,
          { lineageKey: d.lineageKey, kategori: d.kategori, nama: d.nama, satuan: d.satuan },
          ip,
        );
      }
      return hasil.count;
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, terhapus: n };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menghapus komponen." };
  }
}
