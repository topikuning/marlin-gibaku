import type { LinkTabItem } from "@/components/ui";

/**
 * Sub-tab untuk tab yang menaungi lebih dari satu route. Ditampilkan di dalam
 * halamannya supaya route saudara tetap terjangkau sesudah tab digabung —
 * menggabung tab tidak boleh berarti menyembunyikan halaman.
 */
export function subTabPelaksanaan(slug: string): LinkTabItem[] {
  const base = `/proyek/lokasi/${slug}`;
  return [
    { label: "Laporan Harian", href: `${base}/harian` },
    { label: "Kegiatan Lapangan", href: `${base}/kegiatan` },
  ];
}

export function subTabAdministrasi(slug: string): LinkTabItem[] {
  const base = `/proyek/lokasi/${slug}`;
  return [
    { label: "Dokumen & Kepatuhan", href: `${base}/dokumen` },
    { label: "Laporan Lokasi", href: `${base}/laporan-lokasi` },
  ];
}
