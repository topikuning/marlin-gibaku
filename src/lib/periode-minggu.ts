import { WEEK_PERIOD_MODES, type WeekPeriodMode } from "@/lib/progress-calc";

/**
 * Nama periode minggu untuk dibaca orang (DECISIONS 708). Rumusnya di
 * `progress-calc.ts`; di sini hanya kata-katanya, supaya form kontrak, form
 * Sistem, dan teks lain menyebut periode yang sama dengan kata yang sama.
 */
export const LABEL_MODE_MINGGU: Record<WeekPeriodMode, string> = {
  senin_minggu: "Senin–Minggu",
  selasa_senin: "Selasa–Senin",
  rabu_selasa: "Rabu–Selasa",
  kamis_rabu: "Kamis–Rabu",
  jumat_kamis: "Jumat–Kamis",
  sabtu_jumat: "Sabtu–Jumat",
  minggu_sabtu: "Minggu–Sabtu",
  tujuh_hari: "7 hari sejak SPMK",
};

/** Pilihan untuk Combobox: minggu kalender dulu (urut Senin … Minggu), lalu 7 hari sejak SPMK. */
export function opsiModeMinggu(bawaan?: WeekPeriodMode): { value: WeekPeriodMode; label: string }[] {
  return WEEK_PERIOD_MODES.map((m) => ({
    value: m,
    label: `${LABEL_MODE_MINGGU[m]}${m === "tujuh_hari" ? "" : ", M1 bisa pendek"}${m === bawaan ? " (bawaan)" : ""}`,
  }));
}

export function isWeekPeriodMode(v: unknown): v is WeekPeriodMode {
  return typeof v === "string" && (WEEK_PERIOD_MODES as readonly string[]).includes(v);
}
