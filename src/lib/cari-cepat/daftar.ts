import "server-only";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationScopeWhere, packageScopeWhere } from "@/lib/auth/scope";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { LOCATION_STATUS_LABEL, PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import { idLokasiDiarsipkan } from "@/lib/package/lingkup-lokasi";

/**
 * Isi Cari Cepat (DECISIONS 684): lokasi & paket yang BOLEH dibuka user ini.
 *
 * Aturan aksesnya sama persis dengan halaman yang dituju – daftar Lokasi /
 * Paket dan `requireLocationPage` – supaya tidak ada hasil yang berujung 404:
 * penugasan lokasi, organisasi, capability, dan arsip pencabutan (lokasi yang
 * pencabutannya diarsipkan tidak muncul, kecuali bagi yang boleh melihat arsip).
 */
export type EntriCepat = {
  jenis: "lokasi" | "paket";
  /** Slug lokasi / id paket. */
  kunci: string;
  judul: string;
  /** Baris kedua: wilayah · paket, atau nomor · provinsi. */
  keterangan: string;
  status: string;
  /** Teks tambahan yang ikut dicari, tidak ditampilkan. */
  cari: string;
};

export type DaftarCepat = {
  lokasi: EntriCepat[];
  paket: EntriCepat[];
  /** Akun ter-scope: hanya lokasi penugasan yang dicari – disebut di layar. */
  terbatas: boolean;
};

export async function daftarCariCepat(user: SessionUser): Promise<DaftarCepat> {
  const lihatLokasi = can(user.role, "location.view");
  const lihatPaket = can(user.role, "package.view");
  const locIds = await accessibleLocationIds(user);

  const [lokasi, paket] = await Promise.all([
    lihatLokasi
      ? db.location.findMany({
          where: locationScopeWhere(user, locIds),
          select: {
            id: true,
            slug: true,
            name: true,
            village: true,
            district: true,
            regency: true,
            province: true,
            status: true,
            package: {
              select: { name: true, packageNumber: true, contract: { select: { vendor: { select: { name: true } } } } },
            },
          },
          orderBy: { name: "asc" },
        })
      : [],
    lihatPaket
      ? db.package.findMany({
          where: packageScopeWhere(user, locIds),
          select: {
            id: true,
            name: true,
            packageNumber: true,
            province: true,
            stage: true,
            contract: { select: { vendor: { select: { name: true } } } },
          },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  const arsip = can(user.role, "location_scope.archive")
    ? new Set<string>()
    : await idLokasiDiarsipkan(lokasi.map((l) => l.id));

  return {
    terbatas: locIds !== null,
    lokasi: lokasi
      .filter((l) => !arsip.has(l.id))
      .map((l) => ({
        jenis: "lokasi",
        kunci: l.slug,
        judul: l.name,
        keterangan: [`${l.regency}, ${l.province}`, l.package.name].join(" · "),
        status: LOCATION_STATUS_LABEL[l.status],
        cari: [
          l.village,
          l.district,
          l.package.packageNumber,
          l.package.contract?.vendor.name,
        ]
          .filter(Boolean)
          .join(" "),
      })),
    paket: paket.map((p) => ({
      jenis: "paket",
      kunci: p.id,
      judul: p.name,
      keterangan: [p.packageNumber, p.province, p.contract?.vendor.name].filter(Boolean).join(" · "),
      status: PACKAGE_STAGE_LABEL[p.stage],
      cari: "",
    })),
  };
}
