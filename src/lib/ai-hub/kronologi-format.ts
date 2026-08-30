import type { KronologiLokasi } from "@/lib/kronologi/queries";
import type { JenisPeristiwa, Peristiwa } from "@/lib/kronologi/susun";
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
