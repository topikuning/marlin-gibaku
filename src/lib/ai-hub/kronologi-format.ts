import type { KronologiLokasi } from "@/lib/kronologi/queries";
import type { JenisPeristiwa, Peristiwa } from "@/lib/kronologi/susun";
import { potongKalimat } from "@/lib/kalimat";
import type { KronologiOutput } from "./schemas";
import type { SourceRef } from "./types";

/**
 * Bahan run `kronologi` untuk provider — dan sumber yang boleh dikutipnya.
 *
 * Dua hal yang dijaga berkas ini:
 *
 * 1. **Angka kondisi terkini disodorkan SUDAH JADI**, dengan kalimat yang
 *    menyatakan bahwa ia tidak boleh dihitung ulang. Model yang diberi daftar
 *    peristiwa lalu diminta "berapa kendala terbuka" akan menghitung sendiri,
 *    dan hitungannya tidak pernah bisa dipertanggungjawabkan ke PPK.
 * 2. **Tiap peristiwa punya id sumber granular**, sehingga babak cerita yang
 *    disusun model bisa menunjuk peristiwa yang mendasarinya — dan babak yang
 *    menunjuk sumber tak dikenal dibuang penyaring grounding, bukan dipercaya.
 */

const LABEL: Record<JenisPeristiwa, string> = {
  kendala_dibuka: "KENDALA MUNCUL",
  kendala_ditutup: "KENDALA SELESAI",
  kegiatan: "KEGIATAN",
};

/** Id sumber sebuah peristiwa — dipakai payload DAN daftar sumber run. */
export function idSumberPeristiwa(p: Peristiwa): string {
  return `kronologi:${p.kunci}`;
}

function tautan(slug: string, p: Peristiwa): string {
  // Kendala dicatat & ditutup di tab Progress lokasi; kegiatan punya tabnya
  // sendiri. Keduanya halaman yang memang memuat peristiwanya, bukan beranda.
  return p.jenis === "kegiatan" ? `/lokasi/${slug}/kegiatan` : `/lokasi/${slug}/progress`;
}

export function sumberKronologi(k: KronologiLokasi): SourceRef[] {
  return k.peristiwa.map((p) => ({
    id: idSumberPeristiwa(p),
    entityType: `kronologi_${p.jenis}`,
    entityId: k.lokasi.id,
    label: `${k.lokasi.nama} – ${p.tanggal} ${LABEL[p.jenis]}`,
    value: p.judul.length > 160 ? `${p.judul.slice(0, 160)}…` : p.judul,
    href: tautan(k.lokasi.slug, p),
  }));
}

export function buildKronologiPayload(k: KronologiLokasi): string {
  const c = k.kondisi;
  const baris: string[] = [
    `KRONOLOGI LOKASI: ${k.lokasi.nama} (${k.lokasi.wilayah}).`,
    `Jendela ${k.sejak} s.d. ${k.sampai}. Peristiwa diurutkan TERBARU DULU.`,
    "",
    "KONDISI TERKINI (sudah dihitung sistem – pakai apa adanya, JANGAN menghitung ulang):",
    `- kendala masih terbuka: ${c.kendalaTerbuka} (kritis ${c.kendalaKritis}, lewat tenggat ${c.kendalaLewatTenggat})`,
    `- umur kendala terbuka tertua: ${c.kendalaTertuaHari === null ? "tidak ada kendala terbuka" : `${c.kendalaTertuaHari} hari`}`,
    `- kendala selesai dalam jendela: ${c.kendalaSelesaiDalamJendela}`,
    `- kegiatan lapangan dalam jendela: ${c.kegiatanDalamJendela} (draf ${c.drafKegiatan})`,
    `- kegiatan lapangan terakhir: ${c.kegiatanTerakhir ?? "belum pernah ada"}${
      c.hariTanpaKegiatan === null ? "" : ` (${c.hariTanpaKegiatan} hari lalu)`
    }`,
    "",
  ];

  if (k.peristiwa.length === 0) {
    baris.push("PERISTIWA: tidak ada kendala maupun kegiatan lapangan tercatat pada jendela ini.");
    return baris.join("\n");
  }

  baris.push("PERISTIWA (id sumber di dalam kurung siku):");
  for (const p of k.peristiwa) {
    const penanda = [
      p.tingkat ? `tingkat ${p.tingkat}` : null,
      p.jenis === "kendala_dibuka" ? `status ${p.status}` : null,
      p.lewatTenggat ? "LEWAT TENGGAT" : null,
      p.jenis === "kegiatan" && p.status === "draft" ? "masih draf" : null,
    ].filter(Boolean);
    baris.push(
      `- [${idSumberPeristiwa(p)}] ${p.tanggal} ${LABEL[p.jenis]}: ${p.judul}` +
        (penanda.length ? ` (${penanda.join(", ")})` : ""),
    );
    for (const r of p.rincian) baris.push(`    ${r}`);
  }
  if (k.dipotong > 0) {
    baris.push(
      "",
      `Catatan: ${k.dipotong} peristiwa lebih lama tidak dilampirkan. Jangan menyimpulkan bahwa tidak ada apa-apa sebelum ${k.sejak}.`,
    );
  }
  return baris.join("\n");
}

/** Kesimpulan satu lokasi: 2–3 kalimat. Angka 3 adalah batas, bukan target. */
export const MAKS_KALIMAT_KESIMPULAN = 3;

export type HasilRapi = { output: KronologiOutput; dibuang: string[] };

/**
 * Menegakkan dua janji kronologi pada keluaran model.
 *
 * 1. **Kesimpulan tidak lebih dari tiga kalimat.** Diminta lewat prompt DAN
 *    dipangkas di sini: DECISIONS 453/454 sudah mencatat bahwa model tetap
 *    mengirim lebih, dan yang membaca di WhatsApp menerima paragraf pada tempat
 *    yang dijanjikan ringkas.
 * 2. **Babak wajib bisa ditelusuri ke peristiwanya.** Babak adalah kalimat yang
 *    dirapikan DARI peristiwa; yang tidak menunjuk peristiwa yang dikenal bukan
 *    rapi, ia karangan.
 *
 * Sumber kesimpulan yang tak dikenal DIBUANG, tetapi kesimpulannya tidak —
 * sama seperti `executiveSummary` laporan. Menghapus satu-satunya jawaban
 * karena sitasinya meleset meninggalkan pembaca tanpa apa pun, padahal
 * kalimatnya sendiri masih bisa diperiksa lewat garis waktu di sebelahnya.
 * Yang terjadi DIKATAKAN, tidak didiamkan.
 *
 * Keyakinan dihitung ulang dari bagian yang selamat — angka yang diakui model
 * tentang dirinya sendiri tidak pernah dipakai (pola yang sama dengan
 * `executeAiRun`).
 */
export function rapikanKeluaranKronologi(
  output: KronologiOutput,
  idSah: ReadonlySet<string>,
): HasilRapi {
  const dibuang: string[] = [];

  const kesimpulan = potongKalimat(output.kesimpulan, MAKS_KALIMAT_KESIMPULAN);
  if (kesimpulan !== output.kesimpulan.replace(/\s+/g, " ").trim()) {
    dibuang.push(`kesimpulan dipangkas ke ${MAKS_KALIMAT_KESIMPULAN} kalimat`);
  }

  const kesimpulanSourceRefIds = output.kesimpulanSourceRefIds.filter((r) => idSah.has(r));
  if (kesimpulanSourceRefIds.length === 0) {
    dibuang.push("kesimpulan tidak menyebut sumber yang dikenal – periksa lewat garis waktu");
  }

  const babak = output.babak.filter((b) => b.sourceRefIds.every((r) => idSah.has(r)));
  if (babak.length < output.babak.length) {
    dibuang.push(`${output.babak.length - babak.length} babak dibuang: sumbernya tidak dikenal`);
  }

  const kandidat = output.babak.length + 1;
  const selamat = babak.length + (kesimpulanSourceRefIds.length > 0 ? 1 : 0);

  return {
    output: {
      ...output,
      kesimpulan,
      kesimpulanSourceRefIds,
      babak,
      confidence: kandidat > 0 ? Math.round((selamat / kandidat) * 100) : 0,
    },
    dibuang,
  };
}
