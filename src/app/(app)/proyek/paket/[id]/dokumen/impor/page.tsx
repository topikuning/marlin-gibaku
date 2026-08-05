import { redirect } from "next/navigation";

/**
 * Rute lama impor Drive per-paket. Halaman aslinya sekarang hidup di menu
 * Dokumen (`/dokumen-laporan/dokumen/impor`) supaya bisa ditemukan; tautan lama diteruskan
 * dengan paket sudah terpilih. DECISIONS 184.
 */
export default async function ImporPaketRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dokumen-laporan/dokumen/impor?paket=${encodeURIComponent(id)}`);
}
