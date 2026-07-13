import type { WorkerRole, WeatherCode } from "@prisma/client";

/** Urutan & label 14 peran tenaga kerja (FORMAT LAPORAN HARIAN KKP). */
export const WORKER_ROLE_ORDER: WorkerRole[] = [
  "site_manager",
  "pelaksana",
  "mandor",
  "kepala_tukang",
  "tukang_bongkar",
  "tukang_batu",
  "tukang_besi",
  "tukang_kayu",
  "tukang_pipa",
  "tukang_listrik",
  "tukang_cat",
  "tenaga",
  "logistik",
  "operator",
];

export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = {
  site_manager: "Site Manager",
  pelaksana: "Pelaksana",
  mandor: "Mandor",
  kepala_tukang: "Kepala Tukang",
  tukang_bongkar: "Tukang Bongkar",
  tukang_batu: "Tukang Batu",
  tukang_besi: "Tukang Besi",
  tukang_kayu: "Tukang Kayu",
  tukang_pipa: "Tukang Pipa",
  tukang_listrik: "Tukang Listrik",
  tukang_cat: "Tukang Cat",
  tenaga: "Tenaga",
  logistik: "Logistik",
  operator: "Operator",
};

export const WEATHER_ORDER: WeatherCode[] = [
  "cerah",
  "berawan",
  "hujan_ringan",
  "hujan_deras",
  "angin_kencang",
  "banjir",
];

export const WEATHER_LABEL: Record<WeatherCode, string> = {
  cerah: "Cerah",
  berawan: "Berawan",
  hujan_ringan: "Hujan Ringan",
  hujan_deras: "Hujan Deras",
  angin_kencang: "Angin Kencang",
  banjir: "Banjir",
};

/** YYYY-MM-DD → Date UTC midnight (kolom @db.Date). */
export function parseLogDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
