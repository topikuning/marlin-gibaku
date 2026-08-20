import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cariDuplikat } from "@/lib/kendala/duplikat";
import { isiKendalaDariKegiatan, layakJadiKendala } from "@/lib/kendala/dari-kegiatan";

/**
 * MENAIKKAN KENDALA KEGIATAN LAPANGAN JADI ISSUE (DECISIONS 392).
 *
 * Dipanggil dari server action finalisasi kegiatan – bukan modul "use server"
 * sendiri supaya bisa dipanggil sebagai fungsi biasa, dan supaya penjaganya
 * (capability + akses lokasi) tetap satu tempat di pemanggil.
 *
 * TIDAK melempar. Kegiatan yang sudah difinalkan tidak boleh gagal hanya karena
 * pencatatan kendalanya bermasalah – yang hilang kalau ini melempar bukan
 * kendalanya saja, melainkan seluruh finalisasi kegiatan beserta fotonya.
 */

export type HasilNaikkan =
  | { jadi: "dibuat"; issueId: string; title: string }
  | { jadi: "duplikat"; issueId: string; title: string }
  | { jadi: "sudah_ada"; issueId: string }
  | { jadi: "dilewati" };

/** Tingkat bawaan kendala dari kegiatan lapangan.
 *
 * Formulir kegiatan tidak menanyakan tingkat, jadi menebak "tinggi" atau
 * "rendah" dari teksnya sama saja mengarang. "sedang" dipilih karena netral:
 * ia tidak mendorong kendala naik ke puncak papan tanpa alasan, dan tidak
 * menguburnya di dasar. Siapa pun yang membuka kendalanya bisa menaikkan atau
 * menurunkan.
 */
const TINGKAT_BAWAAN = "sedang" as const;

export async function naikkanKendalaKegiatan(input: {
  activityId: string;
  locationId: string;
  kendala: string | null | undefined;
  solusi?: string | null;
  userId: string;
}): Promise<HasilNaikkan> {
  try {
    if (!layakJadiKendala(input.kendala)) return { jadi: "dilewati" };

    // Kegiatan bisa dibuka kembali lalu difinalkan lagi. Satu kegiatan = paling
    // banyak satu kendala. Kalau sudah ada, JANGAN ditimpa: mungkin sudah
    // diberi PIC, tenggat, atau aksi pemulihan oleh orang lain, dan menimpanya
    // menghapus pekerjaan itu diam-diam.
    const lama = await db.issue.findFirst({
      where: { fieldActivityId: input.activityId },
      select: { id: true },
    });
    if (lama) return { jadi: "sudah_ada", issueId: lama.id };

    const isi = isiKendalaDariKegiatan(input.kendala!, input.solusi);

    // Penjaga duplikat. Di jalur otomatis tidak ada orang yang bisa ditanya
    // "gabungkan atau buat baru?", jadi yang dipilih: TIDAK membuat baris
    // kedua. Kendala yang mirip dan masih terbuka di lokasi yang sama sudah
    // menagih orang yang sama; baris keduanya cuma mengencerkan hitungan.
    const terbuka = await db.issue.findMany({
      where: { locationId: input.locationId, status: { in: ["terbuka", "ditangani"] } },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const mirip = cariDuplikat(isi.title, terbuka);
    if (mirip.length) {
      await audit(input.userId, "issue.duplikat_dilewati", "issue", mirip[0].id, {
        locationId: input.locationId,
        fieldActivityId: input.activityId,
        judulBaru: isi.title,
        skor: Number(mirip[0].skor.toFixed(3)),
      });
      return { jadi: "duplikat", issueId: mirip[0].id, title: mirip[0].title };
    }

    const issue = await db.issue.create({
      data: {
        locationId: input.locationId,
        title: isi.title,
        description: isi.description,
        severity: TINGKAT_BAWAAN,
        raisedById: input.userId,
        source: "kegiatan_lapangan",
        fieldActivityId: input.activityId,
      },
      select: { id: true },
    });
    await audit(input.userId, "issue.create", "issue", issue.id, {
      locationId: input.locationId,
      severity: TINGKAT_BAWAAN,
      source: "kegiatan_lapangan",
      fieldActivityId: input.activityId,
    });
    return { jadi: "dibuat", issueId: issue.id, title: isi.title };
  } catch {
    return { jadi: "dilewati" };
  }
}

/** Kalimat tambahan untuk pesan sukses finalisasi. Kosong bila tak ada apa-apa. */
export function pesanNaikkan(h: HasilNaikkan): string {
  switch (h.jadi) {
    case "dibuat":
      return " Kendalanya dicatat di papan kendala.";
    case "duplikat":
      return ` Kendalanya mirip dengan yang sudah terbuka ("${h.title}") – tidak dicatat dua kali.`;
    default:
      return "";
  }
}
