"use server";

import { db } from "@/lib/db";
import { can, ROLE_LABEL } from "@/lib/authz";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { locationScopeWhere, packageScopeWhere } from "@/lib/auth/scope";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import { MIN_HURUF_CARI, type HasilCari } from "@/lib/search";

/**
 * PENCARIAN GLOBAL — satu kotak untuk pindah objek dari halaman mana pun.
 *
 * Gap P0 di PRD: "Sidebar saat ini memaksa pengguna mengetahui modul dan
 * route." Sebelum ini satu-satunya pencarian ada di Dashboard Eksekutif dan
 * hanya mencari LOKASI — jadi untuk membuka satu paket dari halaman keuangan,
 * pengguna harus kembali ke beranda dulu, atau tahu sendiri URL-nya.
 *
 * Hasil DIBATASI hak akses, dua lapis:
 *   · scope lokasi/paket — `accessibleLocationIds` + `*ScopeWhere`, sama
 *     seperti halaman daftarnya, sehingga pencarian tidak pernah jadi celah
 *     yang membocorkan keberadaan objek yang tak boleh dilihat;
 *   · capability per jenis — yang tak punya `document.view` tidak mendapat
 *     baris dokumen sama sekali, bukan mendapat baris yang lalu ditolak saat
 *     diklik.
 *
 * Pencarian dijalankan di SERVER, bukan dengan mengirim indeks objek ke klien
 * lalu menyaringnya di memori (cara kotak cari lama di dashboard bekerja).
 * Indeks penuh di klien membocorkan nama objek di luar scope pengguna walaupun
 * tidak pernah ditampilkan.
 *
 * Ini murni BACA dan tidak mengubah apa pun, jadi tanpa `audit()`. Tetap
 * memakai `requireUser()` supaya tidak bisa dipanggil tanpa sesi.
 */

/** Batas per jenis — daftar panjang justru memperlambat memilih. */
const BATAS_PER_JENIS = 5;

export async function cariGlobal(kueri: string): Promise<HasilCari[]> {
  const user = await requireUser();
  const q = kueri.trim();
  if (q.length < MIN_HURUF_CARI) return [];

  const locIds = await accessibleLocationIds(user);
  const locWhere = locationScopeWhere(user, locIds);
  const cocok = { contains: q, mode: "insensitive" as const };

  const [lokasi, paket, dokumen, pengguna] = await Promise.all([
    can(user.role, "location.view")
      ? db.location.findMany({
          where: { ...locWhere, OR: [{ name: cocok }, { village: cocok }, { regency: cocok }] },
          select: { name: true, slug: true, regency: true, province: true },
          orderBy: { name: "asc" },
          take: BATAS_PER_JENIS,
        })
      : Promise.resolve([]),

    can(user.role, "package.view")
      ? db.package.findMany({
          where: {
            ...packageScopeWhere(user, locIds),
            OR: [{ name: cocok }, { packageNumber: cocok }],
          },
          select: { id: true, name: true, packageNumber: true, stage: true },
          orderBy: { updatedAt: "desc" },
          take: BATAS_PER_JENIS,
        })
      : Promise.resolve([]),

    can(user.role, "document.view")
      ? db.document.findMany({
          where: {
            status: "aktif",
            // `orgId` WAJIB: cabang `locationId: null` tidak menyebut lokasi,
            // jadi tanpa pagar organisasi ia cocok dengan dokumen tingkat-paket
            // milik tenant MANA PUN — dan pencarian adalah tempat paling mudah
            // untuk memancing keberadaan objek yang tak boleh dilihat.
            orgId: user.orgId,
            OR: [{ title: cocok }, { docNumber: cocok }],
            AND: [
              {
                OR: [
                  { location: locWhere },
                  { locationId: null, package: packageScopeWhere(user, locIds) },
                  { locationId: null, packageId: null },
                ],
              },
            ],
          },
          select: {
            id: true,
            title: true,
            docNumber: true,
            location: { select: { name: true } },
          },
          orderBy: { uploadedAt: "desc" },
          take: BATAS_PER_JENIS,
        })
      : Promise.resolve([]),

    can(user.role, "user.manage")
      ? db.user.findMany({
          where: { isActive: true, OR: [{ fullName: cocok }, { username: cocok }] },
          select: { id: true, fullName: true, username: true, role: true },
          orderBy: { fullName: "asc" },
          take: BATAS_PER_JENIS,
        })
      : Promise.resolve([]),
  ]);

  const hasil: HasilCari[] = [];
  const gabung = (...bagian: (string | null | undefined)[]) =>
    bagian.filter((s): s is string => !!s).join(" · ");

  for (const l of lokasi) {
    hasil.push({
      key: `lokasi:${l.slug}`,
      jenis: "lokasi",
      judul: l.name,
      detail: gabung(l.regency, l.province),
      href: `/lokasi/${l.slug}`,
    });
  }

  for (const p of paket) {
    hasil.push({
      key: `paket:${p.id}`,
      jenis: "paket",
      judul: p.name,
      detail: gabung(p.packageNumber, PACKAGE_STAGE_LABEL[p.stage]),
      href: `/paket/${p.id}`,
    });
  }

  for (const d of dokumen) {
    hasil.push({
      key: `dokumen:${d.id}`,
      jenis: "dokumen",
      judul: d.title,
      detail: gabung(d.docNumber, d.location?.name) || "Dokumen",
      href: `/dokumen/${d.id}`,
    });
  }

  for (const u of pengguna) {
    hasil.push({
      key: `pengguna:${u.id}`,
      jenis: "pengguna",
      // Username boleh kosong (akun dibuat lewat email); jangan biarkan baris
      // detailnya jadi "null" di layar.
      judul: u.fullName,
      detail: gabung(u.username, ROLE_LABEL[u.role]),
      href: `/master/pengguna`,
    });
  }

  return hasil;
}
