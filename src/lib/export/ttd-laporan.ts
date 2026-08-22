import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { isR2Configured, r2PresignGet } from "@/lib/r2";
import {
  pihakPenyedia,
  pilihPelaksana,
  type JenisDokumen,
  type SumberPelaksana,
} from "@/lib/laporan/penandatangan";

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
 *
 * ---
 *
 * ### `jenis` WAJIB disebut (DECISIONS 402)
 *
 * Pihak penyedia yang meneken BERBEDA menurut dokumennya: harian dan mingguan
 * diteken Pelaksana Lapangan, bulanan/MC/CCO diteken Direktur. Karena itu
 * {@link muatTtdLaporan} menuntut jenis dokumennya — kompiler yang menanyakan,
 * bukan ingatan penulisnya. Sebelum ini tidak ada satu pun tempat yang pernah
 * menanyakannya, dan akibatnya SEMUA dokumen memakai nama direktur.
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
  /** Pihak penyedia mana yang meneken dokumen ini. */
  penyedia: "pelaksana" | "direktur";
  /** Coretan pelaksana yang SUDAH dipilih (lokasi menimpa paket). */
  pelaksanaTtdKey: string | null;
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
 *
 * ### SATU perusahaan, SATU stempel (DECISIONS 408)
 *
 * Stempel penyedia TIDAK bergantung pada siapa yang meneken. Versi sebelumnya
 * memilih stempel milik pelaksana untuk laporan harian/mingguan dan stempel
 * kontrak untuk bulanan/MC/CCO — dua kotak unggah untuk satu benda yang sama,
 * persis yang dikeluhkan user 2026-08-22: *"kenapa pelaksana dan direktur yang
 * jelas 1 perusahaan stempelnya muncul 2x?"*
 *
 * Akibatnya bukan cuma layar yang penuh: dua salinan stempel yang sama bisa
 * menyimpang (yang satu diperbarui, yang lain tidak), dan dokumen dari lokasi
 * yang SAMA akan membawa stempel berbeda menurut jenis laporannya.
 */
export function pilihKunciTtd(s: SumberKunciTtd): KunciTtd {
  const pelaksana = s.penyedia === "pelaksana";
  return {
    ppk: { ttd: s.ppkTtdKey, stempel: s.ppkStempelKey },
    pengawas: { ttd: s.supervisorTtdKey, stempel: s.supervisorStempelKey },
    penyedia: {
      // Tanda tangan TIDAK pernah dipinjam antar orang: laporan harian yang
      // ditandatangani pelaksana tetapi memakai coretan direktur adalah
      // pernyataan yang tidak benar, bukan sekadar gambar yang keliru.
      ttd: pelaksana ? s.pelaksanaTtdKey : s.contractorTtdKey,
      // Stempel beda urusan — ia benda milik PERUSAHAAN, bukan milik orang.
      // Karena itu SAMA untuk Pelaksana maupun Direktur: kontrak dulu, lalu
      // master vendor. Tidak ada stempel "milik pelaksana".
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

/**
 * Siapkan tanda tangan + stempel tiga pihak untuk satu lokasi.
 *
 * `jenis` menentukan SIAPA yang mengisi slot penyedia — lihat
 * `lib/laporan/penandatangan.ts`. Wajib, supaya tiap pemanggil menyatakan
 * dokumen apa yang sedang ia cetak.
 */
export async function muatTtdLaporan(
  locationId: string,
  jenis: JenisDokumen,
): Promise<TtdLaporan> {
  const lokasi = await db.location.findUnique({
    where: { id: locationId },
    select: {
      pelaksanaName: true,
      pelaksanaTitle: true,
      pelaksanaTtdKey: true,
      package: {
        select: {
          pelaksanaName: true,
          pelaksanaTitle: true,
          pelaksanaTtdKey: true,
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

  const penyedia = pihakPenyedia(jenis);
  const pelaksana = pilihPelaksana(
    lokasi as SumberPelaksana,
    lokasi.package as SumberPelaksana,
  );
  const kunci = pilihKunciTtd({
    ...k,
    penyedia,
    pelaksanaTtdKey: pelaksana.ttdKey,
    vendorStempelKey: k.vendor.stempelKey,
  });
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
    penyedia:
      penyedia === "pelaksana"
        ? // Nama boleh null: yang belum diisi tercetak sebagai baris kosong
          // untuk ditandatangani tangan. Yang TIDAK boleh adalah jatuh ke nama
          // direktur — dokumennya akan selalu tampak lengkap sambil menyatakan
          // orang yang tidak membuatnya (DECISIONS 402).
          { nama: pelaksana.nama, sub: pelaksana.jabatan, ttd: pnyTtd, stempel: pnyStempel }
        : {
            nama: k.contractorSignerName,
            sub: k.contractorSignerTitle ?? k.vendor.name,
            ttd: pnyTtd,
            stempel: pnyStempel,
          },
  };
}
