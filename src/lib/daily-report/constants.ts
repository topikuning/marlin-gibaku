import type { WeatherCode, WorkerRole } from "@/generated/prisma/enums";

/**
 * Konstanta laporan harian terpadu — dipakai server (snapshot/print) & client (form).
 * Urutan + label 14 peran mengikuti FORMAT LAPORAN HARIAN KKP (port dari modul lama).
 */

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

/** Kategori cuaca pada form KKP cetak (3 baris ceklis per jam). */
export const WEATHER_KKP_CATEGORY: Record<WeatherCode, "Cerah" | "Mendung" | "Hujan"> = {
  cerah: "Cerah",
  berawan: "Mendung",
  hujan_ringan: "Hujan",
  hujan_deras: "Hujan",
  angin_kencang: "Hujan",
  banjir: "Hujan",
};

export const ISSUE_SEVERITY_LABEL: Record<"rendah" | "sedang" | "tinggi" | "kritis", string> = {
  rendah: "Rendah",
  sedang: "Sedang",
  tinggi: "Tinggi",
  kritis: "Kritis",
};

/** Toleransi pembulatan guard volume kumulatif. */
export const VOLUME_EPSILON = 1e-6;
