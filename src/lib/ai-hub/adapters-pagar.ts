/**
 * PAGAR KAPABILITAS adapter sumber — MURNI (DECISIONS 379).
 *
 * Dipisah dari `adapters.ts` karena berkas itu menarik `db`, dan menarik `db`
 * berarti menarik validasi environment. Padahal justru tabel inilah bagian
 * paling penting untuk diuji: ia yang menentukan siapa boleh menerima angka
 * uang lewat pintu AI.
 */

/** Satu wilayah data tambahan beserta pagar kapabilitasnya. */
export type WilayahAdapter = "kontrak" | "keuangan" | "rab" | "milestone" | "temuan";

import type { Capability } from "@/lib/authz";

/**
 * Pagar tiap wilayah — SENGAJA sama dengan kapabilitas halaman yang menampilkan
 * angka itu di layar. Kalau berbeda, AI menjadi jalur akses kedua dengan aturan
 * sendiri, dan keputusan izin yang sudah ditulis di `authz.ts` batal diam-diam.
 */
export const KAPABILITAS_ADAPTER: Record<WilayahAdapter, Capability> = {
  kontrak: "package.view",
  // Uang internal pelaksana. `site_manager` punya `ai.ask` tapi hanya
  // `finance.input`; `wakil_ppk` sengaja dijauhkan dengan alasan tertulis.
  keuangan: "finance.view",
  rab: "rab.view",
  milestone: "package.view",
  // Temuan pemeriksa (DECISIONS 426) — pagar sama dengan papan /temuan.
  temuan: "finding.view",
};

export const LABEL_WILAYAH: Record<WilayahAdapter, string> = {
  kontrak: "Kontrak",
  keuangan: "Keuangan",
  rab: "RAB",
  milestone: "Milestone administrasi (KKP)",
  temuan: "Temuan pemeriksa",
};

/**
 * Rupiah → angka pembanding klaim.
 *
 * Uang disimpan `BigInt` dan TIDAK pernah dihitung sebagai `number`
 * (CLAUDE.md). Di sini tidak ada aritmetika sama sekali: nilainya cuma
 * dibandingkan sama-atau-tidak dengan klaim model. Selama besarnya di bawah
 * `Number.MAX_SAFE_INTEGER`, perbandingan itu eksak.
 *
 * Di atas batas itu `null` — faktanya TIDAK diterbitkan. Menerbitkan angka yang
 * sudah kehilangan presisi berarti memvalidasi klaim terhadap nilai yang bukan
 * nilai sebenarnya; lebih baik satu fakta hilang daripada satu fakta bohong.
 */
export function rupiahKeAngka(v: bigint): number | null {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(v);
}
