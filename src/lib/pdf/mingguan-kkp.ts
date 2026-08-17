import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { jakartaDateKey } from "@/lib/format";
import { createFormA4Doc, docToBuffer } from "./document";
import { gambarSampul } from "./harian-kkp-lampiran";
import {
  BATAS_FOTO_MINGGUAN,
  kakiHalaman,
  muatLampiranFoto,
  muatLogoPemilik,
  tulisBadanHarian,
} from "./harian-kkp";
import { muatTtdPdf, TANPA_TTD_PDF } from "./ttd-gambar";

/**
 * BERKAS MINGGUAN: satu sampul + tujuh laporan harian (DECISIONS 332).
 *
 * ### Kenapa ini ada
 *
 * Keterangan user 2026-08-16: *"sampul itu dibutuhkan untuk mengumpulkan
 * beberapa laporan harian dalam periode mingguan. jadi satu sampul untuk 7
 * laporan harian."*
 *
 * Sampul yang ada memang SUDAH bertuliskan "MINGGU KE-n" — ia sampul mingguan
 * sejak awal. Yang keliru adalah perilakunya: ia tercetak ulang pada setiap
 * laporan harian, tujuh kali untuk minggu yang sama.
 *
 * ### Kenapa badannya tidak ditulis ulang di sini
 *
 * Berkas ini TIDAK menggambar blanko sendiri. Ia memanggil `tulisBadanHarian`
 * yang sama persis dengan cetak harian. Kalau keduanya menyusun blankonya
 * masing-masing, cepat atau lambat keduanya menyimpang — aturan yang sama
 * dengan DECISIONS 241, dan yang ketahuan belakangan justru setelah dokumennya
 * dikirim ke PPK.
 *
 * ### Hari tanpa laporan
 *
 * Tetap dapat halamannya, berisi **blanko kosong tanpa isian pekerjaan**
 * (keputusan user). `getKkpDailyData` memang sudah mengembalikan blanko kosong
 * untuk tanggal yang belum punya laporan, jadi tidak ada cabang khusus di sini
 * — dan itu memang yang benar: satu jalur data, satu bentuk keluaran.
 *
 * ### Memori
 *
 * Foto dimuat **per hari, tepat sebelum digambar**, bukan tujuh hari sekaligus.
 * `createFormA4Doc` memakai `bufferPages: true` sehingga dokumennya sudah
 * menumpuk di RAM; menahan tujuh hari foto mentah di samping itu adalah cara
 * tercepat mengulang OOM impor AHSP di kontainer 512 MB.
 */

export type MingguanKkpPdfResult = {
  buffer: Buffer;
  locationId: string;
  /** Tanggal yang benar-benar masuk berkas, urut. */
  tanggal: string[];
  /** Berapa hari yang belum punya laporan (halamannya tetap ada, blanko kosong). */
  hariKosong: number;
  /** Foto yang tidak ikut karena batas memori. 0 = utuh. */
  fotoDipotong: number;
};

const HARI_MS = 86_400_000;

/**
 * Tujuh tanggal (Asia/Jakarta) yang membentuk minggu ke-`n` sebuah kontrak.
 *
 * MURNI supaya bisa diuji langsung. Rumusnya sengaja dibalik dari
 * `queries.getKkpDailyData`, yang menghitung `weekNo` sebuah tanggal sebagai
 * `floor((tanggal − mulai) / 7 hari) + 1`. Kalau keduanya tidak saling
 * membalik, sampul bisa menulis "MINGGU KE-3" di atas hari-hari minggu ke-4 —
 * salah yang tidak terlihat sampai orang mencocokkannya dengan kalender.
 */
export function tanggalMinggu(startDate: Date, n: number): string[] {
  const awal = startDate.getTime() + (n - 1) * 7 * HARI_MS;
  return Array.from({ length: 7 }, (_, i) => jakartaDateKey(new Date(awal + i * HARI_MS)));
}

/**
 * Baris status di kaki tiap halaman berkas mingguan — MURNI, supaya bisa diuji
 * langsung.
 *
 * Aturannya: status menggambarkan BERKASNYA, bukan satu hari di dalamnya.
 * Berkas yang memuat laporan belum final tidak boleh mengaku final hanya karena
 * sebagian harinya sudah, dan kekurangan apa pun (hari kosong, foto yang tidak
 * muat) harus TERCETAK — berkasnya hidup sendiri setelah keluar dari MARLIN,
 * dan nilai kembalian fungsi tidak ikut ke tangan PPK.
 */
export function statusBerkasMingguan(r: {
  minggu: number;
  adaFinal: boolean;
  hariKosong: number;
  fotoDipotong: number;
}): string {
  return [
    `Minggu ke-${r.minggu}`,
    r.adaFinal ? null : "PRATINJAU — belum ada laporan final",
    r.hariKosong > 0 ? `${r.hariKosong} hari belum ada laporan` : null,
    r.fotoDipotong > 0 ? `${r.fotoDipotong} foto tidak dimuat (batas berkas)` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Susun berkas mingguan. Tanpa otorisasi — pemanggil yang menggerbangi, sama
 * seperti `renderHarianKkpPdf`.
 */
export async function renderMingguanKkpPdf(
  slug: string,
  minggu: number,
  opts?: { baseUrl?: string | null },
): Promise<MingguanKkpPdfResult | null> {
  const baseUrl = opts?.baseUrl?.replace(/\/+$/, "") || null;

  const lokasi = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      package: { select: { contract: { select: { startDate: true } } } },
    },
  });
  const mulai = lokasi?.package.contract?.startDate ?? null;
  // Tanpa SPMK, "minggu ke-n" tidak punya tanggal — dan menebaknya berarti
  // menerbitkan dokumen resmi atas tanggal karangan.
  if (!lokasi || !mulai) return null;

  const tanggal = tanggalMinggu(mulai, minggu);

  // Hari mana yang BENAR-BENAR punya laporan — ditanyakan ke basis data, bukan
  // disimpulkan dari isi blankonya. `getKkpDailyData` mengembalikan blanko
  // kosong baik untuk "belum ada laporan" maupun "laporan ada tapi kosong";
  // menebak dari `items.length` akan menyamakan dua hal yang berbeda.
  const adaLaporan = new Set(
    (
      await db.dailyReport.findMany({
        where: {
          locationId: lokasi.id,
          reportDate: { in: tanggal.map((t) => new Date(`${t}T00:00:00.000Z`)) },
        },
        select: { reportDate: true },
      })
    ).map((r) => jakartaDateKey(r.reportDate)),
  );

  const branding = await getBranding();
  const [logo, gambarTtd] = await Promise.all([
    muatLogoPemilik(branding.ownerLogoKey),
    muatTtdPdf(lokasi.id).catch(() => TANPA_TTD_PDF),
  ]);

  // Data hari pertama dipakai sampul: identitas kontrak & "MINGGU KE-n"-nya
  // sama untuk ketujuh hari.
  const hariPertama = await getKkpDailyData(slug, tanggal[0]);
  if (!hariPertama) return null;

  const doc = createFormA4Doc({
    title: `Laporan Harian KKP Minggu ke-${minggu} — ${hariPertama.locationName}`,
  });

  // Logo pelaksana untuk sampul: dimuat sekali, bukan tujuh kali.
  const { logoVendor } = await muatLampiranFoto(hariPertama, baseUrl, 0);

  doc.page.margins.bottom = 0;
  gambarSampul(doc, hariPertama, logo, logoVendor);

  let sisaFoto = BATAS_FOTO_MINGGUAN;
  let fotoDipotong = 0;
  let hariKosong = 0;
  let adaFinal = false;

  for (const [i, tgl] of tanggal.entries()) {
    const d: KkpDailyData | null = i === 0 ? hariPertama : await getKkpDailyData(slug, tgl);
    if (!d) {
      hariKosong += 1;
      continue;
    }
    if (d.isFinal) adaFinal = true;
    if (!adaLaporan.has(tgl)) hariKosong += 1;

    // Dimuat TEPAT sebelum digambar, lalu dilepas saat iterasi berikutnya —
    // lihat catatan memori di kepala berkas.
    const lampiran = await muatLampiranFoto(d, baseUrl, sisaFoto);
    sisaFoto -= lampiran.foto.length + lampiran.fotoMaterial.length + lampiran.fotoAlat.length;
    fotoDipotong += lampiran.dipotong;

    doc.addPage();
    tulisBadanHarian(doc, d, {
      logoPemilik: logo,
      logoVendor: lampiran.logoVendor,
      foto: lampiran.foto,
      fotoMaterial: lampiran.fotoMaterial,
      fotoAlat: lampiran.fotoAlat,
      ttd: gambarTtd,
    });
  }

  kakiHalaman(doc, branding.appName, statusBerkasMingguan({ minggu, adaFinal, hariKosong, fotoDipotong }));

  return {
    buffer: await docToBuffer(doc),
    locationId: lokasi.id,
    tanggal,
    hariKosong,
    fotoDipotong,
  };
}
