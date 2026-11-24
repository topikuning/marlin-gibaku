// AKHIR KONTRAK YANG BERLAKU = AKHIR AWAL + HARI ADENDUM (DECISIONS 773).
//
// Keluhan user 2026-11-24 (tangkapan layar impor Kurva-S): *"sudah adendum
// waktu, tapi kenapa minggu masih sama?! ini efek ke update TS tidak bisa"*.
// Kontrak SPMK 15 Jul 2026 + 135 hari selesai 27 Nov (20 minggu Senin–Minggu);
// CCO waktu memperpanjang ke 18 Des (23 minggu). Penghitung minggu memakai
// `Contract.endDate` – akhir AWAL – jadi TS 23 minggu ditolak "tidak sama
// dengan durasi kontrak lokasi ini (20 minggu)".
//
// Uji ini menjaga dua hal:
// 1. rumusnya (satu tempat, progress-calc);
// 2. tidak ada penghitung minggu/sisa hari yang diberi `.endDate` mentah –
//    semua lewat akhir yang berlaku.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { akhirKontrakBerlaku, durasiKontrakBerlaku, totalWeeksBetween } from "@/lib/progress-calc";

const t = (k: string) => new Date(`${k}T00:00:00.000Z`);

describe("akhirKontrakBerlaku", () => {
  it("kasus user: 15 Jul + 135 hari (27 Nov) + CCO 21 hari = 18 Des; 20 → 23 minggu", () => {
    const awal = t("2026-11-27");
    const akhir = akhirKontrakBerlaku(awal, [{ endDateDelta: 21 }]);
    expect(akhir).toEqual(t("2026-12-18"));
    expect(totalWeeksBetween(t("2026-07-15"), awal, "senin_minggu")).toBe(20);
    expect(totalWeeksBetween(t("2026-07-15"), akhir!, "senin_minggu")).toBe(23);
  });

  it("beberapa CCO dijumlahkan, termasuk pengurangan", () => {
    expect(akhirKontrakBerlaku(t("2026-11-27"), [{ endDateDelta: 30 }, { endDateDelta: -9 }])).toEqual(t("2026-12-18"));
  });

  it("tanpa CCO = akhir awal; tanpa SPMK = null", () => {
    expect(akhirKontrakBerlaku(t("2026-11-27"), [])).toEqual(t("2026-11-27"));
    expect(akhirKontrakBerlaku(null, [{ endDateDelta: 21 }])).toBeNull();
  });

  it("durasi berlaku = durasi awal + hari CCO", () => {
    expect(durasiKontrakBerlaku(135, [{ endDateDelta: 21 }])).toBe(156);
    expect(durasiKontrakBerlaku(135, [])).toBe(135);
  });
});

/** Isi argumen panggilan `nama(` sampai kurung penutupnya (boleh lintas baris). */
function argumenPanggilan(teks: string, mulai: number): string {
  let kedalaman = 0;
  for (let i = mulai; i < teks.length; i++) {
    if (teks[i] === "(") kedalaman++;
    else if (teks[i] === ")" && --kedalaman === 0) return teks.slice(mulai, i + 1);
  }
  return teks.slice(mulai);
}

function semuaBerkas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "generated" ? [] : semuaBerkas(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("penjaga: penghitung minggu & sisa hari tidak diberi akhir kontrak AWAL", () => {
  it("tidak ada `.endDate` mentah di argumen weekEndFractions/totalWeeksBetween/weekDateRange/remainingDaysUntil", () => {
    const pelanggaran: string[] = [];
    for (const berkas of semuaBerkas("src")) {
      if (berkas.endsWith("progress-calc.ts")) continue; // definisi fungsinya sendiri
      const teks = readFileSync(berkas, "utf8");
      for (const m of teks.matchAll(/\b(weekEndFractions|totalWeeksBetween|weekDateRange|remainingDaysUntil)\(/g)) {
        let arg = argumenPanggilan(teks, m.index! + m[1]!.length);
        // `.endDate` DI DALAM akhirKontrakBerlaku(...) memang cara yang benar.
        for (let k = arg.indexOf("akhirKontrakBerlaku("); k >= 0; k = arg.indexOf("akhirKontrakBerlaku(")) {
          const dalam = argumenPanggilan(arg, k + "akhirKontrakBerlaku".length);
          arg = arg.slice(0, k) + arg.slice(k + "akhirKontrakBerlaku".length + dalam.length);
        }
        // `bounds.endDate` = PeriodBounds dari getPeriodBounds, sudah akhir BERLAKU.
        if (/(?<!bounds)\.endDate\b/.test(arg)) {
          const baris = teks.slice(0, m.index).split("\n").length;
          pelanggaran.push(`${berkas}:${baris} ${m[1]}${arg.replace(/\s+/g, " ").slice(0, 80)}`);
        }
      }
    }
    expect(pelanggaran).toEqual([]);
  });
});
