import { db } from "@/lib/db";
import { cariDuplikat, type KandidatDuplikat } from "@/lib/kendala/duplikat";

/**
 * KENDALA TERBUKA YANG MIRIP — SATU PENCARIAN UNTUK SEMUA PINTU (DECISIONS 407).
 *
 * Keberatan user 2026-08-21: *"saat laporan nihil/kosong, kamu membuat desain
 * masukkan ke kendala. tapi saat kirim laporan ada pilihan lagi ada kendala atau
 * tidak, ini terlalu rancu dan beresiko input kendala ganda, apakah kendalanya
 * itu sudah menjadi satu, atau double entry."*
 *
 * Double entry – dan lebih buruk daripada dugaannya. Sebelum ini ada EMPAT pintu
 * yang bisa melahirkan kendala untuk satu hari yang sama, dan penjaga duplikatnya
 * hanya terpasang di dua:
 *
 * | Pintu                                   | Penjaga duplikat |
 * |-----------------------------------------|------------------|
 * | Papan kendala lokasi (`createIssue`)    | ada              |
 * | Kegiatan lapangan (`naikkanKendala…`)   | ada              |
 * | Lembar kirim laporan harian             | **tidak ada**    |
 * | Formulir kendala saat verifikasi        | **tidak ada**    |
 *
 * Penjaga yang dipasang PER PINTU akan selalu tertinggal di pintu berikutnya —
 * pelajaran yang sudah dibayar dua kali (DECISIONS 360, 400/401). Karena itu
 * pencariannya dipindah ke sini dan dipanggil semua pintu, termasuk yang belum
 * ditulis.
 */
export async function kendalaSerupaTerbuka(
  locationId: string,
  judul: string,
): Promise<KandidatDuplikat[]> {
  const terbuka = await db.issue.findMany({
    where: {
      locationId,
      status: { in: ["terbuka", "ditangani"] },
      // Kendala yang sudah digabungkan tidak boleh ditawarkan sebagai induk –
      // menggabungkan ke sana akan membentuk rantai.
      mergedIntoId: null,
    },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return cariDuplikat(judul, terbuka);
}
