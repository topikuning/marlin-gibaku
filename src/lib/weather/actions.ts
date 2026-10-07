"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/format";
import { KKP_WEATHER_HOURS, type KkpWeatherCategory } from "@/lib/weather/hourly";
import { fetchHourlyWeather } from "@/lib/weather/open-meteo";
import { fetchHourlySatelit } from "@/lib/weather/satelit";
import { jamSudahLewat } from "@/lib/weather/satelit-murni";
import {
  getAkunGsmap,
  getSumberCuaca,
  LABEL_SUMBER_CUACA,
  setAkunGsmap,
  setSumberCuaca,
  SUMBER_CUACA,
} from "@/lib/weather/setelan";
import { ujiAkunGsmap } from "@/lib/weather/gsmap";

/**
 * Aksi layar Sistem untuk sumber cuaca (DECISIONS baru 2026-10-07): memilih
 * sumber, dan MEMBANDINGKAN kedua sumber untuk satu lokasi & tanggal tanpa
 * menyimpan apa pun – supaya pilihan diputuskan dari hari yang kondisinya
 * diketahui, bukan dari klaim.
 */

export type SumberCuacaState = { error?: string; success?: string } | undefined;

export async function setSumberCuacaAction(_prev: SumberCuacaState, formData: FormData): Promise<SumberCuacaState> {
  const p = z.object({ sumber: z.enum(SUMBER_CUACA) }).safeParse({ sumber: formData.get("sumber") });
  if (!p.success) return { error: "Pilihan sumber cuaca tidak dikenali. Muat ulang halaman, lalu coba lagi." };
  try {
    const user = await requireCapability("system.manage");
    const sebelum = await getSumberCuaca();
    await setSumberCuaca(p.data.sumber);
    await audit(user.id, "system.sumber_cuaca", "system", null, { sebelum, sesudah: p.data.sumber });
    revalidatePath("/sistem");
    return {
      success: `Sumber cuaca otomatis sekarang: ${LABEL_SUMBER_CUACA[p.data.sumber]}. Berlaku untuk tombol ambil cuaca berikutnya; laporan yang sudah terisi tidak berubah.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan pengaturan." };
  }
}

export type AkunGsmapState = { error?: string; success?: string } | undefined;

/**
 * Simpan atau uji akun FTP GSMaP (tombol `aksi` = "simpan" | "uji" | "hapus").
 * Sandi kosong saat menyimpan = sandi lama dipertahankan. Sandi tidak pernah
 * masuk catatan audit.
 */
export async function akunGsmapAction(_prev: AkunGsmapState, formData: FormData): Promise<AkunGsmapState> {
  const p = z
    .object({
      aksi: z.enum(["simpan", "uji", "hapus"]),
      user: z.string().trim().max(100),
      pass: z.string().max(200),
    })
    .safeParse({ aksi: formData.get("aksi"), user: formData.get("user") ?? "", pass: formData.get("pass") ?? "" });
  if (!p.success) return { error: "Isian akun tidak dikenali. Muat ulang halaman, lalu coba lagi." };
  try {
    const user = await requireCapability("system.manage");
    const { aksi } = p.data;
    if (aksi === "hapus") {
      await setAkunGsmap({ user: "", pass: "" });
      await audit(user.id, "system.gsmap_akun", "system", null, { aksi });
      revalidatePath("/sistem");
      return { success: "Akun GSMaP dihapus. Sumber satelit kini hanya memakai data awan Himawari." };
    }
    const tersimpan = await getAkunGsmap();
    const akun = { user: p.data.user || tersimpan?.user || "", pass: p.data.pass || tersimpan?.pass || "" };
    if (!akun.user || !akun.pass) return { error: "Isi nama akun dan sandi GSMaP dulu." };
    if (aksi === "uji") {
      try {
        const versi = await ujiAkunGsmap(akun);
        return {
          success: versi.length
            ? `Tersambung ke server JAXA. Versi data yang tersedia: ${versi.join(", ")}.`
            : "Tersambung ke server JAXA, tapi folder versi data (realtime_ver/vN) tidak ditemukan.",
        };
      } catch (e) {
        return { error: `Tidak bisa masuk ke server JAXA: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    await setAkunGsmap({ user: akun.user, pass: p.data.pass ? p.data.pass : undefined });
    await audit(user.id, "system.gsmap_akun", "system", null, { aksi, akun: akun.user, sandiDiganti: !!p.data.pass });
    revalidatePath("/sistem");
    return { success: "Akun GSMaP tersimpan. Sandinya disimpan tersandi." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan akun GSMaP." };
  }
}

export type BarisBanding = {
  jam: number;
  belumTerjadi: boolean;
  openMeteo: { kategori: KkpWeatherCategory; mm: number } | null;
  satelit: { kategori: KkpWeatherCategory; mm: number; awan: number | null } | null;
};

export type BandingState =
  | {
      error?: string;
      lokasi?: string;
      tanggal?: string;
      baris?: BarisBanding[];
      galatOpenMeteo?: string;
      galatSatelit?: string;
      catatanSatelit?: string[];
    }
  | undefined;

export async function bandingkanCuacaAction(_prev: BandingState, formData: FormData): Promise<BandingState> {
  const p = z
    .object({ locationId: z.uuid(), tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse({ locationId: formData.get("locationId"), tanggal: formData.get("tanggal") });
  if (!p.success) return { error: "Pilih lokasi dan tanggal dulu." };
  try {
    const user = await requireCapability("system.manage");
    const lok = await db.location.findFirst({
      where: { id: p.data.locationId, package: { orgId: user.orgId } },
      select: { name: true, gpsLat: true, gpsLng: true },
    });
    if (!lok) return { error: "Lokasi tidak ditemukan." };
    if (lok.gpsLat == null || lok.gpsLng == null) return { error: `Lokasi "${lok.name}" belum punya koordinat GPS.` };
    const lat = Number(lok.gpsLat);
    const lng = Number(lok.gpsLng);
    const dateKey = p.data.tanggal;
    const sekarang = new Date();
    if (!jamSudahLewat(dateKey, 7, sekarang)) return { error: "Tanggal itu belum tiba." };

    const [om, sat] = await Promise.allSettled([
      fetchHourlyWeather({ lat, lng, dateKey, todayKey: jakartaDateKey(sekarang) }),
      fetchHourlySatelit({ lat, lng, dateKey, sekarang }),
    ]);
    const pesan = (r: PromiseSettledResult<unknown>) =>
      r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined;
    const jamOm = om.status === "fulfilled" ? om.value : [];
    const jamSat = sat.status === "fulfilled" ? sat.value.hours : [];

    return {
      lokasi: lok.name,
      tanggal: dateKey,
      baris: KKP_WEATHER_HOURS.map((jam) => {
        const o = jamOm.find((h) => h.hour === jam);
        const s = jamSat.find((h) => h.hour === jam);
        return {
          jam,
          belumTerjadi: !jamSudahLewat(dateKey, jam, sekarang),
          openMeteo: o ? { kategori: o.category, mm: o.precipMm } : null,
          satelit: s ? { kategori: s.category, mm: s.precipMm, awan: s.cloudPct ?? null } : null,
        };
      }),
      galatOpenMeteo: pesan(om),
      galatSatelit: pesan(sat),
      catatanSatelit: sat.status === "fulfilled" ? sat.value.catatan : undefined,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal membandingkan sumber cuaca." };
  }
}
