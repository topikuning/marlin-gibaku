import { redirect } from "next/navigation";

/**
 * Menu "Laporan → WA" DILEBUR ke AI Report Studio (DECISIONS 193/194): tidak
 * boleh ada jalur generate-lalu-kirim tanpa review. Route lama dipertahankan
 * sebagai pengalihan supaya bookmark/kebiasaan pengguna tidak putus.
 */
export default function LaporanWaPage() {
  redirect("/ai/reports?template=wa_update");
}
