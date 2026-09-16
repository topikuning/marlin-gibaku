import "server-only";
import { db } from "@/lib/db";
import { kunciDesaLonggar } from "@/lib/master-location/queries";
import { kelompokNamaKembar } from "@/lib/package/nama-kembar";

/**
 * PENDETEKSI LOKASI GANDA YANG TERLANJUR ADA.
 *
 * Guard di `addTargetLocation` dan `pindahkanLokasi` hanya menutup pintu ke
 * depan; yang sudah berada di dalam basis data tidak akan hilang sendiri.
 * Modul ini menjawab pertanyaan lanjutan user 2026-09-16: *"masalah ini
 * terlanjur ada bagaimana memperbaikinya"* — dengan lebih dulu menjawab yang
 * lebih mendasar: **yang mana**.
 *
 * Dua golongan, sengaja dipisah karena perbaikannya berbeda:
 *
 * - **`sePaket`** — dua lokasi bernama sama DI SATU PAKET. Ini yang merusak
 *   mesin: `matchLocation` memilah berkas Drive lewat nama dari daftar lokasi
 *   satu paket. Perbaikannya murah dan aman: beri nama pembeda pada salah
 *   satunya (Lokasi › ubah nama). Tidak ada angka yang bergerak — nama tampilan
 *   bukan kunci apa pun.
 * - **`desaGanda`** — dua lokasi untuk SATU desa yang sama (kunci alaminya
 *   kembar), di paket mana pun. Ini yang memecah angka: satu desa dilaporkan
 *   sebagai dua proyek, dan tidak ada satu layar pun yang menjumlahkannya.
 *   Perbaikannya TIDAK otomatis dan tidak boleh otomatis — menggabungkan dua
 *   lokasi berarti memindahkan RAB, laporan final, dan foto ber-cap, masing
 *   dengan riwayatnya sendiri. Karena itu yang disajikan di sini adalah
 *   BUKTINYA: berapa banyak data yang menempel di tiap sisi, supaya orang bisa
 *   memutuskan mana yang dipertahankan dan mana yang dilepas.
 *
 * Yang TIDAK dilaporkan: nama sama di paket berbeda dengan desa yang berbeda.
 * Desa senama di kabupaten lain itu lumrah di Indonesia dan tidak merusak apa
 * pun — melaporkannya cuma menenggelamkan dua golongan di atas.
 */

export type AnggotaKembar = {
  id: string;
  slug: string;
  name: string;
  packageId: string;
  packageName: string;
  province: string;
  regency: string;
  district: string | null;
  village: string;
  /** Punya RAB aktif — pertanda lokasi ini yang "hidup". */
  punyaRab: boolean;
  /** Laporan harian yang sudah terhitung (dikirim/disetujui/final). */
  laporan: number;
  /** Foto lapangan ber-cap. */
  foto: number;
  /** Tidak satu pun data menempel – paling aman dilepas. */
  kosong: boolean;
};

export type KelompokLokasiKembar = {
  kunci: string;
  anggota: AnggotaKembar[];
};

export type LaporanLokasiKembar = {
  sePaket: KelompokLokasiKembar[];
  desaGanda: KelompokLokasiKembar[];
};

export async function laporanLokasiKembar(orgId: string): Promise<LaporanLokasiKembar> {
  const lokasi = await db.location.findMany({
    where: { package: { orgId } },
    select: {
      id: true,
      slug: true,
      name: true,
      packageId: true,
      province: true,
      regency: true,
      district: true,
      village: true,
      package: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  // Kelompokkan dulu, hitung belakangan: yang dihitung cuma lokasi yang memang
  // masuk salah satu kelompok, bukan seluruh lokasi organisasi.
  const perPaket = new Map<string, typeof lokasi>();
  for (const l of lokasi) {
    const arr = perPaket.get(l.packageId);
    if (arr) arr.push(l);
    else perPaket.set(l.packageId, [l]);
  }

  type Mentah = { kunci: string; anggota: typeof lokasi };
  const sePaketMentah: Mentah[] = [];
  for (const anggotaPaket of perPaket.values()) {
    for (const k of kelompokNamaKembar(anggotaPaket)) {
      sePaketMentah.push({ kunci: k.kunci, anggota: k.anggota });
    }
  }

  const perDesa = new Map<string, typeof lokasi>();
  for (const l of lokasi) {
    const k = kunciDesaLonggar(l);
    const arr = perDesa.get(k);
    if (arr) arr.push(l);
    else perDesa.set(k, [l]);
  }
  const desaGandaMentah: Mentah[] = [...perDesa.entries()]
    .filter(([, a]) => a.length > 1)
    .map(([kunci, anggota]) => ({ kunci, anggota }));

  const terlibat = [
    ...new Set([...sePaketMentah, ...desaGandaMentah].flatMap((g) => g.anggota.map((a) => a.id))),
  ];
  if (terlibat.length === 0) return { sePaket: [], desaGanda: [] };

  const [rab, laporan, foto] = await Promise.all([
    db.rabRevision.groupBy({
      by: ["locationId"],
      where: { locationId: { in: terlibat }, status: "aktif" },
      _count: { _all: true },
    }),
    db.dailyReport.groupBy({
      by: ["locationId"],
      where: { locationId: { in: terlibat }, status: { in: ["dikirim", "disetujui", "final"] } },
      _count: { _all: true },
    }),
    db.photo.groupBy({
      by: ["locationId"],
      where: { locationId: { in: terlibat } },
      _count: { _all: true },
    }),
  ]);
  const punyaRab = new Set(rab.map((r) => r.locationId));
  const jumlahLaporan = new Map(laporan.map((r) => [r.locationId, r._count._all]));
  const jumlahFoto = new Map(foto.map((r) => [r.locationId, r._count._all]));

  const lengkapi = (l: (typeof lokasi)[number]): AnggotaKembar => {
    const lap = jumlahLaporan.get(l.id) ?? 0;
    const fot = jumlahFoto.get(l.id) ?? 0;
    const rabAktif = punyaRab.has(l.id);
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      packageId: l.packageId,
      packageName: l.package.name,
      province: l.province,
      regency: l.regency,
      district: l.district,
      village: l.village,
      punyaRab: rabAktif,
      laporan: lap,
      foto: fot,
      kosong: !rabAktif && lap === 0 && fot === 0,
    };
  };

  const rapikan = (g: Mentah[]): KelompokLokasiKembar[] =>
    g
      .map((x) => ({ kunci: x.kunci, anggota: x.anggota.map(lengkapi) }))
      .sort((a, b) => a.kunci.localeCompare(b.kunci));

  return { sePaket: rapikan(sePaketMentah), desaGanda: rapikan(desaGandaMentah) };
}

/** Nama yang sudah dipakai di satu paket – untuk menyarankan nama pembeda. */
export function usulNamaPembeda(a: AnggotaKembar): string {
  const pembeda = a.district?.trim() || a.regency.trim();
  return pembeda ? `${a.name} (${pembeda})` : a.name;
}
