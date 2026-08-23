import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";

/**
 * AKSES PAKET UNTUK PAPARAN (DECISIONS 416 + 420).
 *
 * Dua lingkup, satu pintu:
 *
 *  - **Paket** — dokumen KONTRAK. Pembuat/pembaca wajib punya akses ke SELURUH
 *    lokasi aktif paket. Kalau satu saja tidak tercakup, ditolak: paparan
 *    parsial yang tampil lengkap adalah paparan yang berbohong tanpa terlihat.
 *  - **Lokasi** (DECISIONS 420) — deck SATU lokasi. Yang dituntut hanya akses
 *    ke lokasi itu. Ini bukan pelonggaran aturan di atas melainkan dokumen yang
 *    berbeda: ia tidak pernah mengaku mewakili seluruh kontrak, dan lingkupnya
 *    dicetak di sampul (`snapshot.lingkup`). Site Manager yang memegang dua
 *    dari sebelas lokasi karena itu bisa membuat deck lokasinya, tapi tetap
 *    TIDAK bisa membuat deck paketnya.
 *
 * Super Admin dan Program Director lintas lokasi (accessible === null) selalu
 * tercakup. Semua kegagalan mengembalikan alasan generik yang sama supaya
 * keberadaan paket organisasi lain tidak bocor lewat perbedaan pesan.
 */

export class PaparanAksesError extends Error {}

export type PaketPaparan = {
  id: string;
  name: string;
  packageNumber: string | null;
  ownerAgency: string;
  province: string | null;
  contract: {
    contractNumber: string;
    workTitle: string | null;
    contractValue: bigint;
    startDate: Date;
    endDate: Date | null;
    durationDays: number;
    ppkName: string | null;
    supervisorName: string | null;
    supervisorFirm: string | null;
    vendor: { name: string };
  };
  /**
   * Lokasi yang MASUK deck. Untuk lingkup lokasi isinya tepat satu — seluruh
   * pembangun snapshot bekerja dari daftar ini, jadi tidak ada cabang kedua
   * yang bisa menyimpang.
   */
  locations: { id: string; slug: string; name: string; regency: string; province: string }[];
  lingkup: { jenis: "paket" } | { jenis: "lokasi"; locationId: string; nama: string };
};

const TOLAK = "Paket tidak ditemukan atau di luar akses Anda.";

/**
 * Muat paket + kontrak + lokasi aktif, dan tegakkan seluruh syarat akses.
 * Dipakai generate, view, dan download — SATU pintu, tiga jalur.
 */
export async function muatPaketPaparan(
  user: SessionUser,
  packageId: string,
  /** Bila diisi: deck SATU lokasi paket ini (DECISIONS 420). */
  locationId?: string | null,
): Promise<PaketPaparan> {
  const pkg = await db.package.findFirst({
    // Organisasi disaring DI QUERY — bukan diperiksa sesudahnya.
    where: { id: packageId, orgId: user.orgId },
    select: {
      id: true,
      name: true,
      packageNumber: true,
      ownerAgency: true,
      province: true,
      contract: {
        select: {
          contractNumber: true,
          workTitle: true,
          contractValue: true,
          startDate: true,
          endDate: true,
          durationDays: true,
          ppkName: true,
          supervisorName: true,
          supervisorFirm: true,
          vendor: { select: { name: true } },
        },
      },
      locations: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, slug: true, name: true, regency: true, province: true },
      },
    },
  });
  if (!pkg) throw new PaparanAksesError(TOLAK);
  if (!pkg.contract) throw new PaparanAksesError("Paket ini belum punya kontrak.");
  if (!pkg.contract.startDate) {
    throw new PaparanAksesError("Paket ini belum punya tanggal SPMK, jadi minggu kontraknya belum ada.");
  }
  if (pkg.locations.length === 0) throw new PaparanAksesError("Paket ini belum punya lokasi aktif.");

  const boleh = await accessibleLocationIds(user);
  const set = boleh === null ? null : new Set(boleh);

  if (locationId) {
    const lok = pkg.locations.find((l) => l.id === locationId);
    // Lokasi tidak aktif / bukan milik paket ini → pesan generik yang sama.
    if (!lok) throw new PaparanAksesError(TOLAK);
    if (set !== null && !set.has(lok.id)) throw new PaparanAksesError(TOLAK);
    return {
      ...pkg,
      contract: { ...pkg.contract, startDate: pkg.contract.startDate },
      locations: [lok],
      lingkup: { jenis: "lokasi", locationId: lok.id, nama: lok.name },
    } as PaketPaparan;
  }

  if (set !== null && !pkg.locations.every((l) => set.has(l.id))) {
    /*
     * Akses SEBAGIAN lokasi = ditolak, bukan dipersempit. Paparan kontrak
     * yang diam-diam hanya memuat lokasi yang boleh dilihat pembuatnya akan
     * dibaca KKP sebagai paparan seluruh kontrak. Yang boleh dibuat orang
     * ber-akses sebagian adalah deck LOKASI, lewat `locationId` di atas.
     */
    throw new PaparanAksesError(TOLAK);
  }
  return {
    ...pkg,
    contract: { ...pkg.contract, startDate: pkg.contract.startDate },
    lingkup: { jenis: "paket" },
  } as PaketPaparan;
}
