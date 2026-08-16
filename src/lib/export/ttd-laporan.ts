import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { isR2Configured, r2PresignGet } from "@/lib/r2";

/**
 * TANDA TANGAN & STEMPEL untuk laporan yang DICETAK (DECISIONS 328).
 *
 * Alasannya bukan estetika. Permintaan user: *"orang lapangan kuno dan
 * konservatif, tetap minta untuk laporan di tanda tangan manual dan dicetak…
 * orang lapangan dari pengawas dan kkp"*. Laporan harian & mingguan KKP memang
 * beredar sebagai kertas yang dibubuhi tanda tangan dan stempel basah; yang
 * dibutuhkan sistem adalah menempelkan gambar tanda tangan + stempel yang SUDAH
 * disepakati, supaya kertasnya keluar sudah siap — bukan menggantikan tanda
 * tangan basah.
 *
 * Sumbernya berlapis, dari yang paling khusus ke yang paling umum:
 *
 *   1. `Contract.*TtdKey` / `*StempelKey` — melekat pada kontrak, karena nama
 *      penanda tangannya juga di situ.
 *   2. `Vendor.stempelKey` — cadangan stempel penyedia, supaya stempel
 *      perusahaan yang sama tidak perlu diunggah ulang tiap kontrak.
 *
 * Yang TIDAK dilakukan: menaruh tanda tangan pada dokumen yang belum disetujui.
 * Pemanggilnya yang menentukan; berkas ini hanya menyediakan gambarnya.
 */

export type GambarTtd = {
  /** URL bertanda tangan waktu — dipakai <img> di halaman cetak. */
  url: string;
};

export type TtdPihak = {
  nama: string | null;
  /** NIP untuk PPK, nama firma untuk pengawas, jabatan untuk penyedia. */
  sub: string | null;
  ttd: GambarTtd | null;
  stempel: GambarTtd | null;
};

export type TtdLaporan = {
  /** Pemberi kerja (PPK / KKP). */
  ppk: TtdPihak;
  /** Konsultan pengawas. */
  pengawas: TtdPihak;
  /** Penyedia jasa / kontraktor pelaksana. */
  penyedia: TtdPihak;
};

export const TANPA_TTD: TtdLaporan = {
  ppk: { nama: null, sub: null, ttd: null, stempel: null },
  pengawas: { nama: null, sub: null, ttd: null, stempel: null },
  penyedia: { nama: null, sub: null, ttd: null, stempel: null },
};

/** Berlaku 10 menit — cukup untuk membuka & mencetak, tidak untuk disebar. */
const UMUR_TAUTAN = 600;

/** Medan kontrak + stempel vendor yang dibutuhkan pemilihan kunci. */
export type SumberKunciTtd = {
  ppkTtdKey: string | null;
  ppkStempelKey: string | null;
  supervisorTtdKey: string | null;
  supervisorStempelKey: string | null;
  contractorTtdKey: string | null;
  contractorStempelKey: string | null;
  vendorStempelKey: string | null;
};

export type KunciTtd = {
  ppk: { ttd: string | null; stempel: string | null };
  pengawas: { ttd: string | null; stempel: string | null };
  penyedia: { ttd: string | null; stempel: string | null };
};

/**
 * Tentukan kunci R2 mana yang dipakai tiap pihak — MURNI, tanpa I/O, supaya
 * bisa diuji tanpa R2.
 *
 * Satu-satunya aturan yang tidak kentara: stempel penyedia jatuh ke
 * `Vendor.stempelKey`. Stempel perusahaan itu benda fisik yang sama di semua
 * kontrak; memaksa mengunggahnya ulang tiap kontrak berarti 83 lokasi × unggah
 * berkas yang identik, dan yang pertama terlewat adalah yang paling sering
 * dicetak. Cadangan ini TIDAK berlaku untuk tanda tangan: coretan tanda tangan
 * milik ORANG, dan orangnya ditunjuk per kontrak.
 */
export function pilihKunciTtd(s: SumberKunciTtd): KunciTtd {
  return {
    ppk: { ttd: s.ppkTtdKey, stempel: s.ppkStempelKey },
    pengawas: { ttd: s.supervisorTtdKey, stempel: s.supervisorStempelKey },
    penyedia: {
      ttd: s.contractorTtdKey,
      stempel: s.contractorStempelKey ?? s.vendorStempelKey,
    },
  };
}

async function gambar(key: string | null | undefined): Promise<GambarTtd | null> {
  if (!key || !isR2Configured()) return null;
  try {
    return { url: await r2PresignGet(key, UMUR_TAUTAN) };
  } catch (err) {
    // Kegagalan apa pun menghasilkan null, tidak pernah melempar: laporan tanpa
    // tanda tangan masih bisa dicetak lalu ditandatangani manual — laporan yang
    // gagal terbit tidak berguna sama sekali.
    console.error("[cetak] gambar tanda tangan/stempel gagal disiapkan:", err);
    return null;
  }
}

/** Siapkan tanda tangan + stempel tiga pihak untuk satu lokasi. */
export async function muatTtdLaporan(locationId: string): Promise<TtdLaporan> {
  const lokasi = await db.location.findUnique({
    where: { id: locationId },
    select: {
      package: {
        select: {
          contract: {
            select: {
              ppkName: true,
              ppkNip: true,
              supervisorName: true,
              supervisorFirm: true,
              contractorSignerName: true,
              contractorSignerTitle: true,
              ppkTtdKey: true,
              ppkStempelKey: true,
              supervisorTtdKey: true,
              supervisorStempelKey: true,
              contractorTtdKey: true,
              contractorStempelKey: true,
              vendor: { select: { name: true, stempelKey: true } },
            },
          },
        },
      },
    },
  });
  const k = lokasi?.package.contract;
  if (!k) return TANPA_TTD;

  const brand = await getBranding().catch(() => null);

  const kunci = pilihKunciTtd({ ...k, vendorStempelKey: k.vendor.stempelKey });
  const [ppkTtd, ppkStempel, pgwTtd, pgwStempel, pnyTtd, pnyStempel] = await Promise.all([
    gambar(kunci.ppk.ttd),
    gambar(kunci.ppk.stempel),
    gambar(kunci.pengawas.ttd),
    gambar(kunci.pengawas.stempel),
    gambar(kunci.penyedia.ttd),
    gambar(kunci.penyedia.stempel),
  ]);

  return {
    ppk: {
      nama: k.ppkName,
      sub: k.ppkNip ? `NIP. ${k.ppkNip}` : (brand?.ownerName ?? null),
      ttd: ppkTtd,
      stempel: ppkStempel,
    },
    pengawas: {
      nama: k.supervisorName,
      sub: k.supervisorFirm,
      ttd: pgwTtd,
      stempel: pgwStempel,
    },
    penyedia: {
      nama: k.contractorSignerName,
      sub: k.contractorSignerTitle ?? k.vendor.name,
      ttd: pnyTtd,
      stempel: pnyStempel,
    },
  };
}
