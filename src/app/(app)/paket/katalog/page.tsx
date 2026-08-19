import { permanentRedirect } from "next/navigation";

/**
 * Rute lama katalog lokasi → Master Data (DECISIONS 368).
 *
 * Dialihkan, tidak dihapus: alamat ini sudah beredar di tautan, riwayat
 * peramban, dan catatan orang. Halaman 404 untuk alamat yang kemarin masih
 * bekerja terbaca sebagai "fiturnya dihilangkan".
 */
export default function KatalogLamaPage() {
  permanentRedirect("/master/lokasi");
}
