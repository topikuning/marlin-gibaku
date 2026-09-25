import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { jakartaDateKey, jakartaToday } from "@/lib/format";
import { bolehMenyetujui, nilaiPersetujuan, suaraMasihBerlaku } from "@/lib/rab/persetujuan-aturan";
import type { LocationScopeKind } from "@/generated/prisma/enums";

/**
 * LINGKUP LOKASI SEBUAH KONTRAK — bertambah atau berkurang lewat adendum.
 *
 * Kebutuhan user 2026-09-05: *"ada kebutuhan dimana, adendum mengurangi lokasi
 * atau bahkan menambah lokasi. saat ini di kamu belum ada."*
 *
 * Tiga ketetapan user pada hari yang sama menentukan bentuk modul ini:
 *
 * 1. **Lokasi yang dicabut DITANDAI, bukan dihapus** — "angka lampau tetap".
 *    Laporan, foto, dan realisasinya utuh; yang berubah cuma keikutsertaannya
 *    dalam angka paket sejak tanggal berlaku CCO. Karena itu keikutsertaan
 *    DITURUNKAN dari tabel perubahan ini (`lingkupLokasi`), tidak pernah
 *    disalin jadi kolom di `locations` — dua sumber kebenaran untuk hal yang
 *    sama adalah cacat yang paling mahal di sistem ini.
 * 2. **Lokasi baru mulai dari tanggal berlaku adendum** — baselinenya dibuat
 *    di jendela minggu sisa, bukan sejak minggu-1 kontrak (lihat
 *    `regenerateBaseline`). Menyamakannya dengan lokasi lain akan membuatnya
 *    terlihat telat sejak minggu pertama padahal belum ada dalam kontrak.
 * 3. **Empat mata**, sama seperti aktivasi adendum RAB (DECISIONS 234):
 *    Program Director + satu peran penugasan; berlaku begitu lengkap, nomor
 *    CCO dicatat menyusul di Kontrak & Adendum paket (DECISIONS 614). Mengubah
 *    lingkup kontrak menggeser nilai kontrak, progres, kurva-S, dan laporan
 *    KKP sekaligus — itu bukan kelas keputusan satu orang.
 */

export class LingkupError extends Error {}

export type PerubahanLingkup = {
  id: string;
  locationId: string;
  locationName: string;
  locationSlug: string;
  kind: LocationScopeKind;
  /** Kosong selama draft — lahir bersama CCO saat diaktifkan (DECISIONS 613). */
  effectiveDate: Date | null;
  status: "draft" | "aktif" | "dibatalkan";
  reason: string;
  /** Kosong sampai nomor CCO-nya dicatat di Kontrak & Adendum (DECISIONS 614). */
  ccoNumber: string | null;
  appliedAt: Date | null;
  diubahPada: Date;
  setuju: { direktur: boolean; penugasan: boolean; lengkap: boolean; kurang: string[] };
  suaraGugur: number;
  /** Diarsipkan super admin — hanya super admin yang melihat baris ini. */
  diarsipkanPada: Date | null;
};

const pilih = {
  id: true,
  locationId: true,
  kind: true,
  effectiveDate: true,
  status: true,
  reason: true,
  appliedAt: true,
  updatedAt: true,
  archivedAt: true,
  amendment: { select: { ccoNumber: true } },
  location: { select: { name: true, slug: true } },
  approvals: { select: { userId: true, role: true, approvedAt: true } },
} as const;

function keBentuk(r: {
  id: string;
  locationId: string;
  kind: LocationScopeKind;
  effectiveDate: Date | null;
  status: "draft" | "aktif" | "dibatalkan";
  reason: string;
  appliedAt: Date | null;
  updatedAt: Date;
  archivedAt: Date | null;
  amendment: { ccoNumber: string } | null;
  location: { name: string; slug: string };
  approvals: { userId: string; role: Parameters<typeof nilaiPersetujuan>[0][number]["role"]; approvedAt: Date }[];
}): PerubahanLingkup {
  const berlaku = suaraMasihBerlaku(r.approvals, r.updatedAt);
  const status = nilaiPersetujuan(berlaku);
  return {
    id: r.id,
    locationId: r.locationId,
    locationName: r.location.name,
    locationSlug: r.location.slug,
    kind: r.kind,
    effectiveDate: r.effectiveDate,
    status: r.status,
    reason: r.reason,
    ccoNumber: r.amendment?.ccoNumber ?? null,
    appliedAt: r.appliedAt,
    diubahPada: r.updatedAt,
    setuju: {
      direktur: status.adaDirektur,
      penugasan: status.adaPenugasan,
      lengkap: status.lengkap,
      kurang: status.kurang,
    },
    suaraGugur: r.approvals.length - berlaku.length,
    diarsipkanPada: r.archivedAt,
  };
}

/**
 * Seluruh perubahan lingkup (draft + aktif) untuk lokasi-lokasi ini.
 *
 * `termasukArsip` HANYA boleh diisi true untuk pemegang `location_scope.archive`:
 * itulah seluruh isi ketetapan user 2026-09-06 — riwayat pencabutan yang
 * sudah diarsipkan tidak terlihat umum, tapi tidak pernah hilang bagi super
 * admin. Defaultnya false supaya pemanggil yang lupa memikirkannya jatuh ke
 * sisi yang aman.
 */
export async function daftarPerubahanLingkup(
  locationIds: string[],
  opts: { termasukArsip?: boolean } = {},
): Promise<PerubahanLingkup[]> {
  if (locationIds.length === 0) return [];
  const rows = await db.locationScopeChange.findMany({
    where: {
      locationId: { in: locationIds },
      status: { not: "dibatalkan" },
      ...(opts.termasukArsip ? {} : { archivedAt: null }),
    },
    select: pilih,
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(keBentuk);
}

/**
 * Lokasi yang pencabutannya SUDAH diarsipkan — daftar hitam tampilan.
 *
 * Dipakai layar dan guard halaman untuk menyembunyikan lokasi itu dari yang
 * bukan super admin. Sengaja TIDAK dipakai perhitungan apa pun: lokasi yang
 * dicabut sudah keluar dari agregat sejak tanggal berlaku CCO-nya, jadi
 * pengarsipan tidak boleh menggeser satu angka pun (lihat ujinya).
 */
export async function idLokasiDiarsipkan(locationIds: string[]): Promise<Set<string>> {
  if (locationIds.length === 0) return new Set();
  const rows = await db.locationScopeChange.findMany({
    where: {
      locationId: { in: locationIds },
      kind: "cabut",
      status: "aktif",
      archivedAt: { not: null },
    },
    select: { locationId: true },
  });
  const arsip = new Set(rows.map((r) => r.locationId));
  if (arsip.size === 0) return arsip;
  // Lokasi yang MASUK lagi lewat adendum berikutnya bukan lokasi terarsip: ia
  // kembali jadi bagian kontrak, dan menyembunyikannya akan menghilangkan
  // lokasi yang sedang berjalan dari layar orang. Keikutsertaan hari ini
  // ditanya ke `lingkupLokasi` — satu-satunya yang berwenang menjawabnya.
  const { dicabut } = await lingkupLokasi([...arsip]);
  for (const id of [...arsip]) if (!dicabut.has(id)) arsip.delete(id);
  return arsip;
}

export type LingkupLokasi = {
  /** Lokasi yang SUDAH dicabut dan tanggal berlakunya sudah lewat. */
  dicabut: Map<string, { ccoNumber: string | null; effectiveDate: Date }>;
  /** Lokasi yang masuk lewat adendum (aktif), dengan tanggal mulainya. */
  masuk: Map<string, { ccoNumber: string | null; effectiveDate: Date }>;
};

/**
 * Keikutsertaan lokasi PADA SUATU TANGGAL — dasar seluruh agregat paket.
 *
 * `pada` default hari ini. Yang dicabut BARU keluar dari agregat sejak tanggal
 * berlakunya: laporan sebelum tanggal itu tetap sah dan tetap terhitung, sesuai
 * ketetapan "angka lampau tetap".
 */
export async function lingkupLokasi(locationIds: string[], pada = new Date()): Promise<LingkupLokasi> {
  const dicabut = new Map<string, { ccoNumber: string | null; effectiveDate: Date }>();
  const masuk = new Map<string, { ccoNumber: string | null; effectiveDate: Date }>();
  if (locationIds.length === 0) return { dicabut, masuk };
  const rows = await db.locationScopeChange.findMany({
    where: { locationId: { in: locationIds }, status: "aktif" },
    select: {
      locationId: true,
      kind: true,
      effectiveDate: true,
      packageId: true,
      amendment: { select: { ccoNumber: true, contract: { select: { packageId: true } } } },
      /*
       * Paket lokasi SEKARANG. Sebuah perubahan lingkup lahir dari adendum SATU
       * kontrak, jadi ia hanya berbicara tentang lingkup PAKET ITU. Begitu
       * lokasinya dipindah ke paket lain (super admin, `location.correct`),
       * barisnya tetap ada sebagai riwayat paket lama — tetapi menerapkannya di
       * paket baru akan menandai lokasi yang baru datang itu "dicabut adendum"
       * atas CCO yang bukan miliknya, dan mengeluarkannya dari agregat paket
       * baru sejak tanggal berlaku CCO lama. Kebutuhan user 2026-09-15.
       */
      location: { select: { packageId: true } },
    },
    orderBy: { effectiveDate: "asc" },
  });
  /*
   * `effectiveDate` kolom TANGGAL (tengah malam UTC). Dibandingkan dengan
   * tanggal Jakarta dari `pada`, bukan jamnya: antara 00:00–07:00 WIB tanggal
   * hari ini masih "masa depan" bila dibandingkan dengan jam UTC, sehingga
   * lokasi yang dicabut hari itu tetap terhitung sampai jam 07:00.
   */
  const hariIni = new Date(`${jakartaDateKey(pada)}T00:00:00.000Z`);
  for (const r of rows) {
    // Baris aktif SELALU bertanggal; nomor CCO boleh menyusul (DECISIONS 614).
    if (!r.effectiveDate) continue;
    const paketUsulan = r.packageId ?? r.amendment?.contract.packageId;
    if (paketUsulan !== r.location.packageId) continue;
    const isi = { ccoNumber: r.amendment?.ccoNumber ?? null, effectiveDate: r.effectiveDate };
    const berlaku = r.effectiveDate;
    if (r.kind === "cabut") {
      if (berlaku.getTime() <= hariIni.getTime()) dicabut.set(r.locationId, isi);
    } else {
      masuk.set(r.locationId, isi);
      // Lokasi yang dicabut lalu dimasukkan lagi lewat adendum berikutnya ikut
      // kembali — urutan tanggal yang menentukan, bukan jenisnya.
      if ((dicabut.get(r.locationId)?.effectiveDate.getTime() ?? -Infinity) <= berlaku.getTime())
        dicabut.delete(r.locationId);
    }
  }
  return { dicabut, masuk };
}

/** Tanggal lokasi ini MASUK kontrak lewat adendum; null bila sejak awal. */
export async function tanggalMasukAdendum(locationId: string): Promise<Date | null> {
  const r = await db.locationScopeChange.findFirst({
    where: { locationId, kind: "tambah", status: "aktif" },
    select: { effectiveDate: true },
    orderBy: { effectiveDate: "desc" },
  });
  return r?.effectiveDate ?? null;
}

/**
 * Ajukan perubahan lingkup — DRAFT, TANPA nomor CCO (DECISIONS 613).
 *
 * Keluhan user 2026-09-24: *"kenapa cabut lokasi, harus ada pilihan adendum
 * cco? … jika ada draft rab adendum bisa langsung import, kenapa cabut lokasi
 * juga tidak ada draftnya dulu"*. Dulu usulan ini menuntut CCO yang SUDAH
 * tercatat, padahal draft RAB adendum tidak — dua aturan berbeda untuk satu
 * peristiwa hukum yang sama, dan urutannya terbalik dari kenyataan: nomor CCO
 * baru terbit SETELAH isi perubahannya disepakati.
 *
 * Sekarang keduanya sama: usulan hidup sebagai draft dan BERLAKU begitu empat
 * matanya lengkap; nomor CCO dicatat menyusul di Kontrak & Adendum paket
 * (DECISIONS 614).
 */
export async function ajukanPerubahanLingkup(input: {
  locationId: string;
  kind: LocationScopeKind;
  reason: string;
}): Promise<{ id: string }> {
  const user = await requireCapability("contract.manage");
  /*
   * CAPABILITY SAJA TIDAK CUKUP.
   *
   * `contract.manage` dipegang Area Manager dan Project Manager — dua peran yang
   * BUKAN lintas-lokasi. Versi pertama memuat lokasi hanya dengan id-nya, jadi
   * satu UUID yang terbaca dari dokumen mana pun sudah cukup untuk mengusulkan
   * pencabutan lokasi paket lain, bahkan organisasi lain. Audit 2026-09-15.
   */
  await requireLocationAccess(user, input.locationId);
  const lokasi = await db.location.findUnique({
    where: { id: input.locationId },
    select: { id: true, packageId: true, name: true },
  });
  if (!lokasi) throw new LingkupError("Lokasi tidak ditemukan.");
  if (!input.reason.trim()) throw new LingkupError("Alasan wajib diisi – ini dokumen perubahan kontrak.");

  const sudahAda = await db.locationScopeChange.findFirst({
    where: { locationId: input.locationId, status: "draft" },
    select: { id: true },
  });
  if (sudahAda)
    throw new LingkupError(
      "Lokasi ini sudah punya usulan perubahan lingkup yang belum diberlakukan – selesaikan dulu yang itu.",
    );

  const row = await db.locationScopeChange.create({
    data: {
      locationId: input.locationId,
      packageId: lokasi.packageId,
      kind: input.kind,
      reason: input.reason.trim(),
      createdById: user.id,
    },
    select: { id: true },
  });
  await audit(user.id, "location_scope.ajukan", "location", input.locationId, {
    changeId: row.id,
    kind: input.kind,
  });
  return row;
}

/**
 * Setujui usulan. Persetujuan kedua yang melengkapi empat mata LANGSUNG
 * MEMBERLAKUKANNYA sejak hari itu — lokasi keluar (atau masuk) angka paket.
 *
 * Koreksi user 2026-09-24 atas DECISIONS 613: *"jika sudah disetujui 2 orang,
 * maka atas lokasi itu sudah aktif, tinggal administrasi resminya perlu
 * pengaktifan, supaya kelihatan dan jelas bahwa lokasi itu sudah tidak
 * diikutkan laporan begitu sudah disetujui 2 orang"*. Menunggu CCO berarti
 * lokasi yang sudah disepakati keluar tetap tampil di laporan berminggu-minggu
 * sampai seluruh adendum tuntas. Nomor CCO dicatat menyusul (DECISIONS 614).
 */
export async function setujuiPerubahanLingkup(changeId: string): Promise<{ berlaku: boolean; kurang: string[] }> {
  const user = await requireCapability("contract.manage");
  if (!bolehMenyetujui(user.role))
    throw new LingkupError(
      "Peran Anda tidak berhak menyetujui perubahan lingkup – syaratnya Program Director + Area/Project/Site Manager.",
    );

  const row = await db.locationScopeChange.findUnique({
    where: { id: changeId },
    select: { id: true, locationId: true, kind: true, status: true, updatedAt: true },
  });
  if (!row) throw new LingkupError("Usulan tidak ditemukan.");
  // Pagar akses BERDIRI SEBELUM suara dicatat: menyetujui lokasi yang bukan
  // penugasannya berarti mengisi salah satu dari dua kursi empat mata.
  await requireLocationAccess(user, row.locationId);
  if (row.status !== "draft") throw new LingkupError("Usulan ini sudah tidak berstatus draft.");

  await db.locationScopeApproval.upsert({
    where: { changeId_userId: { changeId, userId: user.id } },
    create: { changeId, userId: user.id, role: user.role },
    update: { role: user.role, approvedAt: new Date() },
  });
  await audit(user.id, "location_scope.setujui", "location", row.locationId, { changeId, kind: row.kind });

  const semua = await db.locationScopeApproval.findMany({
    where: { changeId },
    select: { userId: true, role: true, approvedAt: true },
  });
  const status = nilaiPersetujuan(suaraMasihBerlaku(semua, row.updatedAt));
  if (!status.lengkap) return { berlaku: false, kurang: status.kurang };

  const effectiveDate = jakartaToday();
  await db.locationScopeChange.update({
    where: { id: changeId },
    data: { status: "aktif", appliedAt: new Date(), effectiveDate },
  });
  await audit(user.id, "location_scope.berlaku", "location", row.locationId, {
    changeId,
    kind: row.kind,
    effectiveDate: effectiveDate.toISOString().slice(0, 10),
  });
  // Lokasi yang MASUK dengan RAB yang sudah aktif: kurva-S-nya dibuat ulang
  // supaya mulai dari tanggal berlaku, bukan minggu-1 kontrak. Gagalnya tidak
  // membatalkan persetujuan yang sudah sah — tercatat, bisa diulang dari lokasi.
  if (row.kind === "tambah") {
    const adaRab = await db.rabRevision.count({ where: { locationId: row.locationId, status: "aktif" } });
    if (adaRab > 0) {
      const { regenerateBaseline } = await import("@/lib/rab/import");
      try {
        await regenerateBaseline(row.locationId, {
          source: "adendum",
          note: "Regenerate otomatis (lokasi masuk lewat adendum)",
          userId: user.id,
        });
      } catch (e) {
        console.error("[lingkup] regenerate baseline lokasi tambahan gagal:", e);
      }
    }
  }
  return { berlaku: true, kurang: [] };
}

/** Batalkan usulan yang belum berlaku. */
export async function batalkanPerubahanLingkup(changeId: string): Promise<void> {
  const user = await requireCapability("contract.manage");
  const row = await db.locationScopeChange.findUnique({
    where: { id: changeId },
    select: { id: true, locationId: true, status: true },
  });
  if (!row) throw new LingkupError("Usulan tidak ditemukan.");
  await requireLocationAccess(user, row.locationId);
  if (row.status === "aktif")
    throw new LingkupError(
      "Perubahan yang SUDAH berlaku tidak dibatalkan diam-diam – terbitkan adendum berikutnya yang mengembalikannya.",
    );
  await db.locationScopeChange.update({ where: { id: changeId }, data: { status: "dibatalkan" } });
  await audit(user.id, "location_scope.batal", "location", row.locationId, { changeId });
}

/* ------------------------------------------------------------------ */
/* PENGARSIPAN LOKASI YANG DIKELUARKAN — super admin saja (2026-09-06) */
/* ------------------------------------------------------------------ */

/**
 * Arsipkan SELURUH pencabutan lokasi yang sudah berlaku di paket ini.
 *
 * Ketetapan user 2026-09-06: *"ada fitur yang langsung mengarsipkan semua
 * lokasi yang dikeluarkan tapi hanya bisa dilakukan super admin, jadi di
 * kontrak tidak ada bekas history yang bisa dilihat umum tapi hanya oleh super
 * admin."*
 *
 * Tiga hal yang menentukan bentuknya:
 *
 * 1. **Tidak ada satu angka pun yang bergeser.** Lokasi yang dicabut sudah
 *    keluar dari agregat sejak tanggal berlaku CCO-nya; pengarsipan hanya
 *    mengubah siapa yang melihat riwayatnya. Kalau ia sampai menggerakkan
 *    nilai kontrak atau progres, ia bukan pengarsipan melainkan penghapusan
 *    diam-diam — dan itu dilarang keras di sistem ini.
 * 2. **Barisnya tidak dihapus.** Super admin tetap melihat seluruh riwayat,
 *    lengkap dengan alasan, nomor CCO, dan tanggal berlakunya. Yang hilang
 *    cuma pandangan umum.
 * 3. **Jejaknya sendiri tidak ikut diarsipkan.** Tindakan ini tercatat di
 *    audit log yang append-only: menyembunyikan sesuatu dari layar tidak boleh
 *    berarti menyembunyikan siapa yang menyembunyikannya.
 *
 * Hanya yang belum berlaku (draft) dan yang belum diarsipkan yang tersentuh:
 * usulan yang masih menunggu persetujuan bukan "lokasi yang dikeluarkan".
 */
export async function arsipkanLokasiDicabut(packageId: string): Promise<{ jumlah: number }> {
  const user = await requireCapability("location_scope.archive");
  const lokasi = await db.location.findMany({
    // Filter organisasi: `packageId` telanjang menerima paket organisasi lain.
    where: { packageId, package: { orgId: user.orgId } },
    select: { id: true, name: true },
  });
  if (lokasi.length === 0) return { jumlah: 0 };

  const { dicabut } = await lingkupLokasi(lokasi.map((l) => l.id));
  const sasaran = await db.locationScopeChange.findMany({
    where: {
      locationId: { in: [...dicabut.keys()] },
      kind: "cabut",
      status: "aktif",
      archivedAt: null,
    },
    select: { id: true, locationId: true, amendment: { select: { ccoNumber: true } } },
  });
  if (sasaran.length === 0) return { jumlah: 0 };

  await db.locationScopeChange.updateMany({
    where: { id: { in: sasaran.map((s) => s.id) } },
    data: { archivedAt: new Date(), archivedById: user.id },
  });

  const nama = new Map(lokasi.map((l) => [l.id, l.name]));
  await audit(user.id, "location_scope.arsip", "package", packageId, {
    jumlah: sasaran.length,
    lokasi: sasaran.map((s) => ({
      locationId: s.locationId,
      name: nama.get(s.locationId) ?? null,
      ccoNumber: s.amendment?.ccoNumber ?? null,
    })),
  });
  return { jumlah: sasaran.length };
}

/**
 * Kembalikan pencabutan yang diarsipkan ke pandangan umum — super admin saja.
 *
 * Ada karena pengarsipan tanpa jalan pulang adalah perangkap: satu klik yang
 * salah paket akan menghilangkan riwayat dari layar semua orang, dan
 * satu-satunya pemulihannya lewat SQL langsung ke produksi.
 */
export async function bukaArsipLokasiDicabut(packageId: string): Promise<{ jumlah: number }> {
  const user = await requireCapability("location_scope.archive");
  const lokasi = await db.location.findMany({
    where: { packageId, package: { orgId: user.orgId } },
    select: { id: true },
  });
  if (lokasi.length === 0) return { jumlah: 0 };

  const sasaran = await db.locationScopeChange.findMany({
    where: { locationId: { in: lokasi.map((l) => l.id) }, archivedAt: { not: null } },
    select: { id: true },
  });
  if (sasaran.length === 0) return { jumlah: 0 };

  await db.locationScopeChange.updateMany({
    where: { id: { in: sasaran.map((s) => s.id) } },
    data: { archivedAt: null, archivedById: null },
  });
  await audit(user.id, "location_scope.buka_arsip", "package", packageId, {
    jumlah: sasaran.length,
  });
  return { jumlah: sasaran.length };
}

/**
 * LOKASI YANG DICABUT TIDAK MENERIMA INPUT BARU (DECISIONS 616).
 *
 * Keluhan user 2026-09-25: *"lokasi sudah dicabut, kenapa masih bisa aktif
 * dipilih, kalaupun karena belum adendum resmi total … harusnya inputan baru
 * laporan harian atau apa pun itu, tidak bisa dilakukan. harus ada penandanya
 * juga"*. Pencabutan sampai sini hanya mengeluarkan lokasi dari ANGKA paket;
 * Mandor tetap bisa melapor, memotret, dan mencatat kendala di lokasi yang
 * sudah bukan bagian kontrak.
 *
 * Mengembalikan kalimat penolakan, atau null bila boleh. Yang ditolak input
 * bertanggal SEJAK tanggal berlaku pencabutan; yang tanpa tanggal (kendala)
 * dinilai dengan hari ini. Laporan untuk hari-hari SEBELUM pencabutan tetap
 * boleh dilengkapi — "angka lampau tetap", dan hari itu lokasinya memang
 * masih di dalam kontrak.
 *
 * Satu kalimat, dikembalikan (bukan dilempar), supaya tiap modul melemparnya
 * dengan kelas galatnya sendiri — kelas yang sudah diterjemahkan layar
 * masing-masing menjadi pesan, bukan "Terjadi kesalahan".
 */
export async function alasanLokasiTertutup(locationId: string, dateKey?: string): Promise<string | null> {
  // Tanggal jauh di depan: pencabutan yang tanggalnya belum tiba pun terbaca,
  // lalu dibandingkan dengan tanggal inputnya sendiri di bawah.
  const { dicabut } = await lingkupLokasi([locationId], new Date("9999-12-31T00:00:00.000Z"));
  const cabut = dicabut.get(locationId);
  if (!cabut) return null;
  const sejak = jakartaDateKey(cabut.effectiveDate);
  const tanggal = dateKey ?? jakartaDateKey(new Date());
  if (tanggal < sejak) return null;
  const lokasi = await db.location.findUnique({ where: { id: locationId }, select: { name: true } });
  const [y, m, d] = sejak.split("-");
  return (
    `${lokasi?.name ?? "Lokasi ini"} sudah DICABUT dari kontrak sejak ${d}/${m}/${y} – ` +
    `tidak menerima laporan atau input baru. Laporan sebelum tanggal itu tetap bisa dibuka.`
  );
}
