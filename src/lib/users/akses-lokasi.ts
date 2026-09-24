import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { CROSS_LOCATION_ROLES, ROLE_LABEL, isCrossLocation } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * SIAPA SAJA YANG PUNYA AKSES KE SATU LOKASI — dan lewat jalan mana.
 *
 * Permintaan user 2026-09-13: *"di halaman lokasi, entah dimana, juga harus ada
 * informasi siapa saja pengguna yang punya akses dan sebagai apa."*
 *
 * Yang membuat daftar ini mudah salah: akses di MARLIN datang dari DUA jalan
 * yang berbeda sama sekali —
 *
 *   PENUGASAN  `LocationAssignment` per lokasi (SM, Pelaksana, PM, …)
 *   PERAN      peran lintas-lokasi (Super Admin, Program Director, …) yang
 *              melihat SEMUA lokasi tanpa pernah ditugaskan ke satu pun
 *
 * Menampilkan yang ditugaskan saja akan berbunyi "3 orang punya akses" pada
 * lokasi yang sebenarnya bisa dibuka belasan orang — dan daftar akses yang
 * kurang justru lebih berbahaya daripada tidak ada daftar sama sekali, karena
 * ia terbaca lengkap.
 */

export type BarisAkses = {
  userId: string;
  nama: string;
  role: UserRole;
  peran: string;
  aktif: boolean;
  /** `penugasan` = ditugaskan ke lokasi ini; `peran` = lintas-lokasi. */
  jalan: "penugasan" | "peran";
  /** Kapan ditugaskan – hanya untuk yang lewat penugasan. */
  sejak: Date | null;
  waNumber: string | null;
  waTerverifikasi: boolean;
};

/**
 * Pilihan penyaringan daftar akses.
 *
 * **Ketetapan user 2026-09-24**: *"hanya super admin dan PD yang boleh tahu
 * siapa saja yang ditugaskan di paket itu untuk login eksekutif."*
 *
 * Panel ini dilihat SIAPA PUN yang bisa membuka lokasinya — Site Manager,
 * Pelaksana, Wakil PPK — dan `user.manage` hanya membatasi tombol kelolanya,
 * bukan daftarnya. Sementara akun Executive View PASTI muncul di daftar bila ia
 * memantau lokasi itu: `exec_viewer` sengaja bukan peran lintas-lokasi
 * (DECISIONS 190), jadi satu-satunya cara ia melihat lokasi adalah DITUGASKAN.
 *
 * Disaring di sini, bukan di komponen: baris yang tidak boleh dilihat tidak
 * boleh ikut terkirim ke klien (CLAUDE.md — *"frontend hanya menyembunyikan
 * menu"*).
 *
 * Bawaannya TIDAK menyembunyikan. Pemanggil wajib menyatakan niatnya, supaya
 * layar Super Admin tidak pernah diam-diam memotong daftarnya sendiri.
 */
export type OpsiAkses = {
  /** Sembunyikan akun berperan `exec_viewer`. Untuk yang tidak `user.manage`. */
  sembunyikanEksekutif?: boolean;
};

export async function aksesLokasi(
  locationId: string,
  orgId: string,
  opsi: OpsiAkses = {},
): Promise<BarisAkses[]> {
  const [ditugaskan, lintas] = await Promise.all([
    db.locationAssignment.findMany({
      where: { locationId, unassignedAt: null, user: { orgId } },
      select: {
        assignedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            role: true,
            isActive: true,
            waNumber: true,
            waVerifiedAt: true,
          },
        },
      },
    }),
    db.user.findMany({
      where: { orgId, isActive: true, role: { in: [...CROSS_LOCATION_ROLES] } },
      select: { id: true, fullName: true, role: true, isActive: true, waNumber: true, waVerifiedAt: true },
    }),
  ]);

  const baris: BarisAkses[] = ditugaskan.map((a) => ({
    userId: a.user.id,
    nama: a.user.fullName,
    role: a.user.role,
    peran: ROLE_LABEL[a.user.role],
    aktif: a.user.isActive,
    jalan: "penugasan",
    sejak: a.assignedAt,
    waNumber: a.user.waNumber,
    waTerverifikasi: a.user.waVerifiedAt != null,
  }));

  // Orang yang ditugaskan DAN berperan lintas-lokasi disebut sekali saja, dan
  // yang disebut jalur penugasannya: itu yang bisa dicabut dari layar ini.
  const sudah = new Set(baris.map((b) => b.userId));
  for (const u of lintas) {
    if (sudah.has(u.id)) continue;
    baris.push({
      userId: u.id,
      nama: u.fullName,
      role: u.role,
      peran: ROLE_LABEL[u.role],
      aktif: u.isActive,
      jalan: "peran",
      sejak: null,
      waNumber: u.waNumber,
      waTerverifikasi: u.waVerifiedAt != null,
    });
  }

  const terlihat = opsi.sembunyikanEksekutif ? baris.filter((b) => b.role !== "exec_viewer") : baris;

  // Yang ditugaskan lebih dulu — merekalah yang mengerjakan lokasi ini.
  return terlihat.sort(
    (a, b) =>
      Number(b.jalan === "penugasan") - Number(a.jalan === "penugasan") ||
      a.nama.localeCompare(b.nama, "id"),
  );
}

/** Calon yang BELUM punya akses ke lokasi ini — bahan daftar pilih. */
export async function calonDitugaskan(
  locationId: string,
  orgId: string,
): Promise<{ id: string; nama: string; peran: string }[]> {
  const users = await db.user.findMany({
    where: {
      orgId,
      isActive: true,
      // Peran lintas-lokasi sudah punya akses tanpa penugasan; menugaskannya
      // tidak menambah apa pun selain baris yang membingungkan.
      role: { notIn: [...CROSS_LOCATION_ROLES] },
      assignments: { none: { locationId, unassignedAt: null } },
    },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });
  return users.map((u) => ({ id: u.id, nama: u.fullName, peran: ROLE_LABEL[u.role] }));
}

export class AksesLokasiError extends Error {}

/**
 * Beri akses satu orang ke satu lokasi.
 *
 * Pemeriksaan organisasi dilakukan atas KEDUANYA — pengguna dan lokasi.
 * Memeriksa salah satunya saja membuka jalan menugaskan orang organisasi lain,
 * dan sesudah itu ia melihat seluruh isi lokasi ini (AUTH-03).
 */
export async function beriAkses(
  locationId: string,
  userId: string,
  aktor: { id: string; orgId: string },
): Promise<{ nama: string }> {
  const [lokasi, user] = await Promise.all([
    db.location.findFirst({
      where: { id: locationId, package: { orgId: aktor.orgId } },
      select: { id: true, name: true },
    }),
    db.user.findFirst({
      where: { id: userId, orgId: aktor.orgId },
      select: { id: true, fullName: true, role: true, isActive: true },
    }),
  ]);
  if (!lokasi) throw new AksesLokasiError("Lokasi tidak ditemukan.");
  if (!user) throw new AksesLokasiError("Pengguna tidak ditemukan di organisasi ini.");
  if (!user.isActive) throw new AksesLokasiError(`${user.fullName} sudah nonaktif.`);
  if (isCrossLocation(user.role)) {
    throw new AksesLokasiError(
      `${user.fullName} berperan ${ROLE_LABEL[user.role]} – sudah bisa membuka semua lokasi tanpa ditugaskan.`,
    );
  }

  await db.locationAssignment.upsert({
    where: { userId_locationId: { userId, locationId } },
    update: { unassignedAt: null },
    create: { userId, locationId },
  });
  await audit(aktor.id, "location.akses_beri", "location", locationId, {
    userId,
    nama: user.fullName,
    peran: user.role,
  });
  return { nama: user.fullName };
}

/**
 * Cabut akses. Barisnya TIDAK dihapus melainkan diberi `unassignedAt` —
 * riwayat siapa pernah memegang lokasi ini bagian dari jejak, bukan sampah.
 */
export async function cabutAkses(
  locationId: string,
  userId: string,
  aktor: { id: string; orgId: string },
): Promise<{ nama: string }> {
  const baris = await db.locationAssignment.findFirst({
    where: {
      locationId,
      userId,
      unassignedAt: null,
      user: { orgId: aktor.orgId },
      location: { package: { orgId: aktor.orgId } },
    },
    select: { id: true, user: { select: { fullName: true } } },
  });
  if (!baris) throw new AksesLokasiError("Penugasan itu tidak ditemukan.");
  await db.locationAssignment.update({ where: { id: baris.id }, data: { unassignedAt: new Date() } });
  await audit(aktor.id, "location.akses_cabut", "location", locationId, {
    userId,
    nama: baris.user.fullName,
  });
  return { nama: baris.user.fullName };
}
