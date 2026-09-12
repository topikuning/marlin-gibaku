#!/usr/bin/env node
/**
 * BERAPA MB HEAP YANG BOLEH DIPAKAI V8 — dihitung dari ukuran kontainer.
 *
 * Kenapa ini ada. Produksi berjalan di kontainer 512 MB, dan V8 memilih sendiri
 * batas old-space dari situ: sekitar 256 MB. Angka itu bukan terkaan — ia
 * tercetak di log crash yang sudah tercatat (DECISIONS 297):
 *
 *     FATAL ERROR: Reached heap limit — Allocation failed
 *     Mark-Compact 252.1 (257.2) -> 252.0 (258.2) MB
 *
 * Satu kali pratinjau impor RAB KKP memakan +44…57 MB heap (diukur 2026-09-12
 * atas berkas MC-0 2,8 MB). Dengan server Next yang sudah memegang ratusan MB,
 * lonjakan sebesar itu kadang muat dan kadang tidak — dan ketika tidak, yang
 * mati adalah PROSESNYA. Balasan POST-nya lalu bukan balasan server action, dan
 * yang terbaca user cuma *"An unexpected response was received from the
 * server"*. Servernya sudah hidup lagi sebelum sempat dicek. Itulah kenapa
 * kegagalannya terasa acak dan "sering terjadi".
 *
 * Bawaan V8 menyisakan kira-kira separuh RAM kontainer tidak terpakai. Yang
 * dihitung di sini memakainya, dengan menyisakan ruang untuk yang TIDAK ada di
 * heap: memori native sharp/libvips, buffer soket, dan runtime Node sendiri.
 *
 * Dicetak ke stdout sebagai angka MB, dipakai `docker-entrypoint.sh`. Dipisah
 * jadi berkas sendiri supaya hitungannya bisa diuji — batas yang salah hitung
 * lebih buruk daripada tidak ada batas: terlalu besar berarti kontainer dibunuh
 * OOM-killer tanpa satu baris log pun.
 */
import { readFileSync } from "node:fs";

/** Sisa untuk yang tidak dihitung heap: native sharp, Node sendiri, soket. */
const PORSI = 0.7;
/** Di bawah ini jangan diutak-atik — biarkan V8 memakai bawaannya. */
const MIN_KONTAINER_MB = 384;
/** Batas atas kewarasan; di atas ini V8 sendiri sudah tidak diuntungkan. */
const MAKS_MB = 4096;

/**
 * Batas memori kontainer dalam MB, atau `null` bila tidak diketahui.
 *
 * @param {(p: string) => string} [baca] pembaca berkas – disuntik saat diuji.
 * @returns {number | null}
 *
 * cgroup v2 memakai `memory.max` (berisi "max" bila tanpa batas); v1 memakai
 * `memory.limit_in_bytes`, yang pada mesin tanpa batas berisi angka raksasa —
 * keduanya harus dibaca sebagai "tidak ada batas", bukan sebagai kontainer
 * berukuran petabyte.
 */
export function batasKontainerMb(baca = (p) => readFileSync(p, "utf8")) {
  for (const p of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    let isi;
    try {
      isi = baca(p).trim();
    } catch {
      continue;
    }
    if (!isi || isi === "max") continue;
    const byte = Number(isi);
    if (!Number.isFinite(byte) || byte <= 0) continue;
    const mb = Math.floor(byte / 1048576);
    // > 1 TB = pasti bukan batas sungguhan, melainkan "tak terbatas".
    if (mb > 1024 * 1024) continue;
    return mb;
  }
  return null;
}

/**
 * MB heap yang dipakai, atau `null` bila lebih baik menyerahkannya ke V8.
 *
 * @param {number | null} kontainerMb
 * @returns {number | null}
 *
 * `null` untuk kontainer kecil/tak diketahui adalah jawaban yang benar, bukan
 * jalan pintas: pada kontainer 256 MB, memaksa heap 179 MB justru mempersempit
 * ruang native dan memindahkan kematian dari V8 (yang masih menulis log) ke
 * OOM-killer (yang tidak menulis apa pun).
 */
export function hitungBatasHeapMb(kontainerMb) {
  if (kontainerMb == null || kontainerMb < MIN_KONTAINER_MB) return null;
  return Math.min(MAKS_MB, Math.floor((kontainerMb * PORSI) / 16) * 16);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mb = hitungBatasHeapMb(batasKontainerMb());
  if (mb != null) process.stdout.write(String(mb));
}
