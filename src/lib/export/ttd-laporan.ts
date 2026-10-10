import "server-only";
import { db } from "@/lib/db";
import { isR2Configured } from "@/lib/r2";
import {
  penandatanganDokumen,
  pihakKkp,
  pihakKonsultan,
  pihakPenyedia,
  pilihKoordinatorTl,
  pilihPelaksana,
  pilihPengawas,
  pilihWakilSah,
  type NamaPenandatangan,
  type JenisDokumen,
  type PihakKkp,
  type PihakKonsultan,
  type PihakPenyedia,
} from "@/lib/laporan/penandatangan";
import type { Prisma } from "@/generated/prisma/client";
import { alamatBerkas } from "@/lib/penyimpanan/berkas";

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
  penyedia: PihakPenyedia;
  /** Pihak KKP slot "MENGETAHUI". */
  kkp: PihakKkp;
  /** Pihak konsultan slot "DIPERIKSA" (DECISIONS 662). */
  konsultan: PihakKonsultan;
  /** Coretan Wakil Sah yang SUDAH dipilih (lokasi menimpa kontrak). */
  wakilSahTtdKey: string | null;
  /** Coretan pelaksana yang SUDAH dipilih (lokasi menimpa paket). */
  pelaksanaTtdKey: string | null;
  ppkTtdKey: string | null;
  ppkStempelKey: string | null;
  /** Blok Pengawas Lapangan yang SUDAH dipilih (lokasi menimpa kontrak) – DECISIONS 409. */
  supervisorTtdKey: string | null;
  supervisorStempelKey: string | null;
  /** Stempel firma di KONTRAK – untuk Team Leader & Koordinator TL. */
  supervisorStempelKontrakKey: string | null;
  /** Coretan Koordinator TL yang SUDAH dipilih (lokasi menimpa kontrak). */
  coTeamLeaderTtdKey: string | null;
  teamLeaderTtdKey: string | null;
  projectManagerTtdKey: string | null;
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
 * Stempel penyedia TIDAK bergantung pada siapa yang meneken – pelaksana,
 * Manajer Proyek, atau direktur bekerja di perusahaan yang sama. Begitu juga
 * konsultan: Team Leader dan Koordinator TL memakai stempel firma kontrak.
 * Hanya Pengawas Lapangan lokasi yang menyebut firma LAIN yang stempelnya
 * dikosongkan (lihat `pilihPengawas`).
 */
export function pilihKunciTtd(s: SumberKunciTtd): KunciTtd {
  return {
    // Slot KKP: coretan mengikuti ORANGNYA (PPK / Wakil Sah); stempel milik
    // INSTANSI, jadi tetap satu — ppkStempelKey (DECISIONS 408).
    ppk: { ttd: s.kkp === "wakil_sah" ? s.wakilSahTtdKey : s.ppkTtdKey, stempel: s.ppkStempelKey },
    pengawas:
      s.konsultan === "pengawas_lapangan"
        ? { ttd: s.supervisorTtdKey, stempel: s.supervisorStempelKey }
        : {
            ttd: s.konsultan === "koordinator_tl" ? s.coTeamLeaderTtdKey : s.teamLeaderTtdKey,
            stempel: s.supervisorStempelKontrakKey,
          },
    penyedia: {
      // Tanda tangan TIDAK pernah dipinjam antar orang: laporan harian yang
      // ditandatangani pelaksana tetapi memakai coretan direktur adalah
      // pernyataan yang tidak benar, bukan sekadar gambar yang keliru.
      ttd:
        s.penyedia === "pelaksana"
          ? s.pelaksanaTtdKey
          : s.penyedia === "manajer_proyek"
            ? s.projectManagerTtdKey
            : s.contractorTtdKey,
      // Stempel beda urusan — ia benda milik PERUSAHAAN, bukan milik orang.
      stempel: s.contractorStempelKey ?? s.vendorStempelKey,
    },
  };
}

/** Medan lokasi yang dibutuhkan pemilihan penanda tangan – satu untuk semua penyaji. */
export const LOKASI_TTD_SELECT = {
  pelaksanaName: true,
  pelaksanaTitle: true,
  pelaksanaTtdKey: true,
  supervisorName: true,
  supervisorFirm: true,
  supervisorTtdKey: true,
  wakilSahName: true,
  wakilSahNip: true,
  wakilSahTtdKey: true,
  coTeamLeaderName: true,
  coTeamLeaderTtdKey: true,
  package: {
    select: {
      pelaksanaName: true,
      pelaksanaTitle: true,
      pelaksanaTtdKey: true,
      contract: {
        select: {
          ppkName: true,
          ppkNip: true,
          wakilSahName: true,
          wakilSahNip: true,
          wakilSahTtdKey: true,
          supervisorName: true,
          supervisorFirm: true,
          contractorSignerName: true,
          contractorSignerTitle: true,
          teamLeaderName: true,
          teamLeaderTtdKey: true,
          coTeamLeaderName: true,
          coTeamLeaderTtdKey: true,
          projectManagerName: true,
          projectManagerTtdKey: true,
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
} satisfies Prisma.LocationSelect;

type LokasiTtd = Prisma.LocationGetPayload<{ select: typeof LOKASI_TTD_SELECT }>;

type KontrakTtd = NonNullable<LokasiTtd["package"]["contract"]>;

/** Siapa saja orangnya di lokasi ini – lokasi menimpa kontrak per BLOK. */
function namaDariLokasi(lokasi: LokasiTtd, k: KontrakTtd) {
  const pelaksana = pilihPelaksana(lokasi, lokasi.package);
  // Pengawas lokasi menimpa pengawas kontrak – SATU BLOK (DECISIONS 409).
  const pengawas = pilihPengawas(lokasi, k);
  // Wakil Sah & Koordinator TL lokasi menimpa kontrak – SATU BLOK.
  const wakilSah = pilihWakilSah(lokasi, k);
  const kortl = pilihKoordinatorTl(lokasi, k);
  const h: NamaPenandatangan = {
    ppkName: k.ppkName,
    ppkNip: k.ppkNip,
    wakilSahName: wakilSah.nama,
    wakilSahNip: wakilSah.nip,
    supervisorName: pengawas.nama,
    supervisorFirm: pengawas.firma,
    supervisorFirmKontrak: k.supervisorFirm,
    coTeamLeaderName: kortl.nama,
    teamLeaderName: k.teamLeaderName,
    vendorName: k.vendor.name,
    contractorSignerName: k.contractorSignerName,
    contractorSignerTitle: k.contractorSignerTitle,
    projectManagerName: k.projectManagerName,
    pelaksanaName: pelaksana.nama,
    pelaksanaTitle: pelaksana.jabatan,
  };
  return { h, pelaksana, pengawas, wakilSah, kortl };
}

/** Nama penanda tangan yang berlaku di lokasi ini; null bila belum berkontrak. */
export async function namaPenandatanganLokasi(locationId: string): Promise<NamaPenandatangan | null> {
  const lokasi: LokasiTtd | null = await db.location.findUnique({ where: { id: locationId }, select: LOKASI_TTD_SELECT });
  const k = lokasi?.package.contract;
  return lokasi && k ? namaDariLokasi(lokasi, k).h : null;
}

/**
 * Nama + kunci gambar satu dokumen satu lokasi. Dipakai `muatTtdLaporan`
 * (halaman cetak) dan `muatTtdPdf` (PDF) – keduanya tidak boleh memilih orang
 * dengan caranya sendiri-sendiri.
 */
export async function penandatanganLokasi(
  locationId: string,
  jenis: JenisDokumen,
): Promise<{ nama: ReturnType<typeof penandatanganDokumen>; kunci: KunciTtd } | null> {
  const lokasi: LokasiTtd | null = await db.location.findUnique({ where: { id: locationId }, select: LOKASI_TTD_SELECT });
  const k = lokasi?.package.contract;
  if (!lokasi || !k) return null;
  const { h, pelaksana, pengawas, wakilSah, kortl } = namaDariLokasi(lokasi, k);
  const nama = penandatanganDokumen(jenis, h);
  const kunci = pilihKunciTtd({
    ...k,
    penyedia: pihakPenyedia(jenis),
    kkp: pihakKkp(jenis),
    konsultan: pihakKonsultan(jenis),
    wakilSahTtdKey: wakilSah.ttdKey,
    pelaksanaTtdKey: pelaksana.ttdKey,
    supervisorTtdKey: pengawas.ttdKey,
    supervisorStempelKey: pengawas.stempelKey,
    supervisorStempelKontrakKey: k.supervisorStempelKey,
    coTeamLeaderTtdKey: kortl.ttdKey,
    vendorStempelKey: k.vendor.stempelKey,
  });
  return { nama, kunci };
}

async function gambar(key: string | null | undefined): Promise<GambarTtd | null> {
  if (!key || !isR2Configured()) return null;
  try {
    return { url: await alamatBerkas(key, UMUR_TAUTAN) };
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
export async function muatTtdLaporan(locationId: string, jenis: JenisDokumen): Promise<TtdLaporan> {
  const t = await penandatanganLokasi(locationId, jenis);
  if (!t) return TANPA_TTD;
  const { nama, kunci } = t;
  const [ppkTtd, ppkStempel, pgwTtd, pgwStempel, pnyTtd, pnyStempel] = await Promise.all([
    gambar(kunci.ppk.ttd),
    gambar(kunci.ppk.stempel),
    gambar(kunci.pengawas.ttd),
    gambar(kunci.pengawas.stempel),
    gambar(kunci.penyedia.ttd),
    gambar(kunci.penyedia.stempel),
  ]);
  return {
    ppk: { nama: nama.kkp.nama, sub: nama.kkp.sub, ttd: ppkTtd, stempel: ppkStempel },
    pengawas: { nama: nama.konsultan.nama, sub: nama.konsultan.sub, ttd: pgwTtd, stempel: pgwStempel },
    penyedia: { nama: nama.penyedia.nama, sub: nama.penyedia.sub, ttd: pnyTtd, stempel: pnyStempel },
  };
}
