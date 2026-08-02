"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

/**
 * Catat keadaan izin browser (lokasi & kamera) milik user di perangkat ini.
 *
 * Permintaan user 2026-08-02: "apakah bisa dicatat bahwa user ini sudah
 * membolehkan izin gps dan kamera di sistem?"
 *
 * Disimpan APPEND-ONLY, bukan satu kolom "sudah izin" di `User`. Izin browser
 * melekat ke PERANGKAT + situs, bisa dicabut kapan saja lewat setelan HP, dan
 * mandor lazim berganti HP. Kolom tunggal akan berbohong begitu salah satu dari
 * itu terjadi — dan kebohongan yang paling mahal di sini adalah "sudah izin"
 * padahal fotonya sedang ditandai titik proyek. DECISIONS 219.
 *
 * Identitas SELALU dari sesi; klien hanya melaporkan keadaan izinnya sendiri.
 */

export type IzinKind = "geolocation" | "camera";
export type IzinState = "granted" | "denied" | "prompt" | "unsupported";

const KIND: IzinKind[] = ["geolocation", "camera"];
const STATE: IzinState[] = ["granted", "denied", "prompt", "unsupported"];

export async function catatIzinPerangkat(input: { kind: string; state: string }): Promise<void> {
  const user = await requireUser();
  if (!KIND.includes(input.kind as IzinKind)) return;
  if (!STATE.includes(input.state as IzinState)) return;

  const ua = (await headers()).get("user-agent")?.slice(0, 400) ?? null;

  // Tidak menulis ulang bila keadaan TERAKHIR di perangkat yang sama sudah
  // sama — kalau tidak, tiap buka halaman menambah satu baris dan riwayatnya
  // jadi tidak terbaca. Yang menarik justru PERUBAHANNYA.
  const terakhir = await db.devicePermission.findFirst({
    where: { userId: user.id, kind: input.kind, userAgent: ua },
    orderBy: { recordedAt: "desc" },
    select: { state: true },
  });
  if (terakhir?.state === input.state) return;

  await db.devicePermission.create({
    data: { userId: user.id, kind: input.kind, state: input.state, userAgent: ua },
  });
}

export type RingkasIzin = {
  kind: IzinKind;
  state: IzinState;
  recordedAt: Date;
  userAgent: string | null;
};

/** Keadaan izin TERBARU per jenis untuk seorang user (semua perangkat). */
export async function izinTerbaru(userId: string): Promise<RingkasIzin[]> {
  const rows = await db.devicePermission.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take: 50,
    select: { kind: true, state: true, recordedAt: true, userAgent: true },
  });
  const seen = new Set<string>();
  const out: RingkasIzin[] = [];
  for (const r of rows) {
    const key = `${r.kind}|${r.userAgent ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: r.kind as IzinKind,
      state: r.state as IzinState,
      recordedAt: r.recordedAt,
      userAgent: r.userAgent,
    });
  }
  return out;
}
