"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import {
  ForbiddenError,
  requireCapability,
  requireLocationAccess,
  accessibleLocationIds,
} from "@/lib/auth/session";
import { isR2Configured, r2Delete, r2GetBuffer, r2Put } from "@/lib/r2";
import { processWithSharpOrOriginal } from "@/lib/photos";
import { parseCoordinatePair } from "@/lib/geo";
import {
  filterArsipSchema,
  konteksFoto,
  photoIdCadangan,
  ringkasNilai,
  stampDariNilai,
  whereArsip,
  type NilaiCap,
} from "./service";
import type { PhotoGpsSource, PhotoMetadataSource } from "@/generated/prisma/enums";

export type RestampState = { error?: string; ok?: string } | undefined;

const kosongJadiNull = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

/**
 * Bedakan "field tidak dikirim" dari "field dikosongkan".
 *
 * Form sungguhan SELALU mengirim semua field, jadi kosong = sengaja dikosongkan
 * dan nilainya memang harus dibuang dari cap. Tapi pemanggil lain (skrip, tes,
 * request parsial) bisa mengirim sebagian saja — dan di situ "tidak dikirim"
 * TIDAK boleh diam-diam menghapus koordinat atau nama dari sebuah bukti.
 */
function bacaOpsional(fd: FormData, key: string, sekarang: string | null): string | null {
  return fd.has(key) ? kosongJadiNull(fd.get(key)) : sekarang;
}

/**
 * PERBAIKAN CAP (DECISIONS 198) — render ulang cap dari berkas ASLI yang
 * diarsipkan, lalu ganti versi ber-capnya.
 *
 * Kenapa dari berkas asli dan bukan dari gambar yang sekarang: cap DIBAKAR ke
 * piksel. Mengecap ulang di atas gambar ber-cap menumpuk dua cap, dan cap lama
 * tetap terbaca di bawahnya. Tanpa arsip asli, perbaikan tidak mungkin — itulah
 * kenapa arsipnya wajib (DECISIONS 197) dan kenapa penghapusannya dipisah.
 *
 * Semua nilai boleh diketik manusia (pilihan user 2026-08-01). Konsekuensinya
 * ditanggung dengan tiga hal, bukan dengan melarang:
 *   1. `reason` WAJIB — perbaikan tanpa alasan ditolak;
 *   2. tiap field yang diketik dicatat di `manualFields` dan nilai waktu/
 *      koordinat manual DITANDAI di capnya sendiri ("diisi manual");
 *   3. riwayat sebelum→sesudah masuk tabel append-only + audit log.
 */
export async function restampPhotoAction(_prev: RestampState, formData: FormData): Promise<RestampState> {
  const parsed = z
    .object({
      photoId: z.uuid(),
      reason: z.string().trim().min(5, "Alasan perbaikan wajib diisi (minimal 5 karakter)").max(500),
    })
    .safeParse({ photoId: formData.get("photoId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { photoId, reason } = parsed.data;

  try {
    const actor = await requireCapability("photo.restamp");
    if (!isR2Configured()) return { error: "Penyimpanan foto belum dikonfigurasi." };

    const k = await konteksFoto(photoId);
    if (!k) return { error: "Foto tidak ditemukan." };
    if (!k.locationId) return { error: "Foto ini tidak terhubung ke lokasi mana pun." };
    await requireLocationAccess(actor, k.locationId);

    if (!k.originalKey) {
      return {
        error: k.originalPurgedAt
          ? "Arsip berkas asli foto ini sudah dihapus — capnya tidak bisa diperbaiki lagi."
          : "Foto ini diunggah sebelum arsip berkas asli aktif, jadi capnya tidak bisa diperbaiki.",
      };
    }

    // ── Nilai baru dari form; yang dibiarkan sama tidak dihitung manual ──
    const manualFields: string[] = [];
    const lama = k.saatIni;

    const jamDiketahui = formData.get("jamDiketahui") === "on";
    const waktuRaw = kosongJadiNull(formData.get("takenAt"));
    let takenAt = lama.takenAt;
    let timeSource: PhotoMetadataSource = lama.timeSource;
    if (waktuRaw) {
      // datetime-local ("2026-07-31T09:15") / date ("2026-07-31") — keduanya
      // diperlakukan sebagai jam dinding WIB, sama seperti pembacaan EXIF.
      const iso = waktuRaw.length <= 10 ? `${waktuRaw}T00:00:00+07:00` : `${waktuRaw}:00+07:00`;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return { error: "Format waktu tidak dikenali." };
      if (d.getTime() !== lama.takenAt.getTime()) {
        takenAt = d;
        timeSource = "manual";
        manualFields.push("waktu");
      }
    }
    if (jamDiketahui !== lama.jamDiketahui && !manualFields.includes("waktu")) {
      manualFields.push("waktu");
      if (jamDiketahui) timeSource = "manual";
    }

    const adaKoordinat = formData.has("lat") || formData.has("lng");
    const latRaw = kosongJadiNull(formData.get("lat"));
    const lngRaw = kosongJadiNull(formData.get("lng"));
    let lat = lama.lat;
    let lng = lama.lng;
    let gpsSource: PhotoGpsSource = lama.gpsSource;
    if (latRaw || lngRaw) {
      const koord = parseCoordinatePair(latRaw ?? "", lngRaw ?? "");
      if (!koord.ok) return { error: koord.error };
      if (koord.lat !== lama.lat || koord.lng !== lama.lng) {
        lat = koord.lat;
        lng = koord.lng;
        // Sama persis dgn titik proyek → memang cadangan, bukan klaim manusia.
        gpsSource = lat === k.projectLat && lng === k.projectLng ? "project" : "manual";
        manualFields.push("koordinat");
      }
    } else if (adaKoordinat && lama.lat != null) {
      // Dikosongkan → cap tidak lagi menampilkan koordinat.
      lat = null;
      lng = null;
      gpsSource = "none";
      manualFields.push("koordinat");
    }

    const teks = {
      locationLabel: bacaOpsional(formData, "locationLabel", lama.locationLabel),
      companyName: bacaOpsional(formData, "companyName", lama.companyName),
      reporterName: bacaOpsional(formData, "reporterName", lama.reporterName),
      categoryName: bacaOpsional(formData, "categoryName", lama.categoryName),
    };
    for (const [key, val] of Object.entries(teks)) {
      if (val !== lama[key as keyof typeof teks]) manualFields.push(key);
    }

    const baru: NilaiCap = {
      // Item pekerjaan tidak bisa diketik ulang di dialog cap: ia identitas
      // baris laporan, bukan teks bebas.
      workName: lama.workName,
      takenAt,
      jamDiketahui,
      lat,
      lng,
      gpsSource,
      timeSource,
      ...teks,
      // Photo ID SENGAJA tidak ikut berubah — identitas foto sudah beredar di
      // berkas yang diserahkan. Foto lama yang belum punya dibuatkan sekali.
      photoId: lama.photoId ?? photoIdCadangan(k, takenAt),
    };

    if (manualFields.length === 0) {
      return { error: "Tidak ada yang berubah — ubah minimal satu nilai sebelum menyimpan." };
    }

    // ── Render ulang dari berkas ASLI ──
    const original = await r2GetBuffer(k.originalKey);
    const processed = await processWithSharpOrOriginal(original, await stampDariNilai(baru), {
      name: k.originalKey,
      type: "",
    });

    // Objek BARU ditulis dulu; yang lama baru dihapus setelah DB berhasil —
    // supaya kegagalan di tengah tidak meninggalkan foto tanpa berkas.
    const uuid = randomUUID();
    const dasar = k.r2Key.replace(/[^/]+$/, "");
    const keyBaru = `${dasar}${uuid}.r${k.stampRevision + 1}.${processed.ext}`;
    await r2Put(keyBaru, processed.main, processed.contentType);
    let thumbBaru: string | null = null;
    if (processed.thumb) {
      thumbBaru = `${dasar}${uuid}.r${k.stampRevision + 1}.thumb.webp`;
      try {
        await r2Put(thumbBaru, processed.thumb, "image/webp");
      } catch {
        thumbBaru = null;
      }
    }

    const revisi = k.stampRevision + 1;
    try {
      await db.$transaction(async (tx) => {
        await tx.photo.update({
          where: { id: photoId },
          data: {
            r2Key: keyBaru,
            thumbnailKey: thumbBaru,
            bytes: processed.main.length,
            widthPx: processed.width,
            heightPx: processed.height,
            exifTakenAt: takenAt,
            exifGpsLat: lat != null ? lat.toFixed(7) : null,
            exifGpsLng: lng != null ? lng.toFixed(7) : null,
            gpsSource,
            metadataSource: timeSource,
            stampPhotoId: baru.photoId,
            stampRevision: revisi,
          },
        });
        await tx.photoStampRevision.create({
          data: {
            photoId,
            revision: revisi,
            reason,
            before: ringkasNilai(lama) as object,
            after: ringkasNilai(baru) as object,
            manualFields,
            changedById: actor.id,
          },
        });
        await auditIn(tx, actor.id, "photo.restamp", "photo", photoId, {
          revisi,
          manualFields,
          reason,
          locationId: k.locationId,
        });
      });
    } catch (err) {
      await r2Delete(keyBaru).catch(() => {});
      if (thumbBaru) await r2Delete(thumbBaru).catch(() => {});
      throw err;
    }

    // Versi ber-cap LAMA dibuang: isinya salah dan tidak boleh beredar lagi.
    // Buktinya tetap utuh — berkas aslinya diarsipkan, dan nilai cap lama
    // tercatat di riwayat revisi (append-only).
    await r2Delete(k.r2Key).catch(() => {});
    if (k.thumbnailKey) await r2Delete(k.thumbnailKey).catch(() => {});

    revalidatePath("/foto");
    if (k.locationSlug) revalidatePath(`/lokasi/${k.locationSlug}`);
    return { ok: `Cap diperbaiki (revisi ${revisi}). Nilai yang diketik manual ditandai di foto.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Perbaikan cap gagal." };
  }
}

/* ── Arsip berkas asli ───────────────────────────────────────────────────── */

/**
 * Hapus arsip berkas asli — HANYA atas permintaan eksplisit (DECISIONS 198).
 * Tidak ada penghapusan otomatis, tidak ada retensi diam-diam: arsip ini adalah
 * satu-satunya jalan memperbaiki cap, jadi hilangnya harus selalu keputusan
 * manusia yang tercatat.
 *
 * Barisnya TIDAK dihapus — `originalKey` dikosongkan dan `originalPurgedAt`
 * diisi, supaya "tidak pernah diarsipkan" tetap bisa dibedakan dari "dihapus
 * sengaja". Tanpa itu, pesan di UI akan berbohong pada kasus kedua.
 */
export async function purgeOriginalsAction(_prev: RestampState, formData: FormData): Promise<RestampState> {
  const konfirmasi = String(formData.get("konfirmasi") ?? "").trim();
  try {
    const actor = await requireCapability("photo.archive_purge");
    if (konfirmasi !== "HAPUS") {
      return { error: 'Ketik HAPUS pada kotak konfirmasi untuk melanjutkan.' };
    }
    const f = filterArsipSchema.safeParse({
      packageId: kosongJadiNull(formData.get("packageId")) ?? undefined,
      locationId: kosongJadiNull(formData.get("locationId")) ?? undefined,
      dariTanggal: kosongJadiNull(formData.get("dariTanggal")) ?? undefined,
      sampaiTanggal: kosongJadiNull(formData.get("sampaiTanggal")) ?? undefined,
    });
    if (!f.success) return { error: f.error.issues[0].message };

    const scope = await accessibleLocationIds(actor);
    const where = whereArsip(f.data, scope);
    const rows = await db.photo.findMany({
      where: where as never,
      select: { id: true, originalKey: true, originalBytes: true },
      take: 5000,
    });
    if (rows.length === 0) return { error: "Tidak ada arsip asli yang cocok dengan filter ini." };

    const bytes = rows.reduce((s, r) => s + (r.originalBytes ?? 0), 0);
    let terhapus = 0;
    for (const r of rows) {
      if (!r.originalKey) continue;
      // Objek dihapus dulu; baris DB baru ditandai bila objeknya benar-benar
      // hilang — supaya tidak ada baris yang mengaku "sudah dihapus" padahal
      // berkasnya masih memakan penyimpanan.
      try {
        await r2Delete(r.originalKey);
      } catch {
        continue;
      }
      await db.photo.update({
        where: { id: r.id },
        data: { originalKey: null, originalPurgedAt: new Date(), originalPurgedById: actor.id },
      });
      terhapus++;
    }
    await audit(actor.id, "photo.archive_purge", "photo", null, {
      filter: f.data,
      cocok: rows.length,
      terhapus,
      bytes,
    });
    revalidatePath("/sistem/arsip-foto");
    revalidatePath("/foto");
    const sisa = rows.length - terhapus;
    return {
      ok:
        `${terhapus} arsip asli dihapus (${(bytes / 1024 / 1024).toFixed(1)} MB).` +
        (sisa > 0 ? ` ${sisa} gagal dihapus dan dibiarkan utuh.` : "") +
        " Cap foto-foto itu tidak bisa diperbaiki lagi.",
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Penghapusan arsip gagal." };
  }
}

/** Hapus arsip asli SATU foto (dari galeri) — pagar sama dengan borongan. */
export async function purgeOneOriginalAction(_prev: RestampState, formData: FormData): Promise<RestampState> {
  const parsed = z.object({ photoId: z.uuid() }).safeParse({ photoId: formData.get("photoId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const actor = await requireCapability("photo.archive_purge");
    const p = await db.photo.findUnique({
      where: { id: parsed.data.photoId },
      select: { id: true, originalKey: true, originalBytes: true, locationId: true },
    });
    if (!p) return { error: "Foto tidak ditemukan." };
    if (!p.locationId) return { error: "Foto ini tidak terhubung ke lokasi mana pun." };
    await requireLocationAccess(actor, p.locationId);
    if (!p.originalKey) return { error: "Foto ini memang tidak punya arsip berkas asli." };

    await r2Delete(p.originalKey);
    await db.photo.update({
      where: { id: p.id },
      data: { originalKey: null, originalPurgedAt: new Date(), originalPurgedById: actor.id },
    });
    await audit(actor.id, "photo.archive_purge", "photo", p.id, {
      bytes: p.originalBytes ?? 0,
      locationId: p.locationId,
    });
    revalidatePath("/foto");
    return { ok: "Arsip asli dihapus. Cap foto ini tidak bisa diperbaiki lagi." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Penghapusan arsip gagal." };
  }
}
