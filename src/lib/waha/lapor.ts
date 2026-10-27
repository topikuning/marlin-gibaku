import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { accessibleLocationIds, hasLocationAccess, type SessionUser } from "@/lib/auth/session";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { Prisma } from "@/generated/prisma/client";
import type { ParsedWaMessage } from "./ingest-parse";
import { balasWa } from "./kirim";
import { tanyaWaAktif } from "./config";
import { cocokkanLokasi, type LokasiKatalog } from "./tanya-niat";
import { katalogLokasi } from "./tanya-data";
import {
  angkaSatuan,
  bacaPerintah,
  cariPekerjaanWa,
  MAKS_DAFTAR_LOKASI,
  kelompokPekerjaan,
  MAKS_PILIHAN,
  pisahVolume,
  satuanPerluDisebut,
  sesiBerlaku,
  tawaranBerlaku,
  teks,
  type IsianPekerjaan,
} from "./lapor-aturan";

/**
 * LAPOR LEWAT WHATSAPP PRIBADI (DECISIONS 706) – sisi basis data.
 *
 * PIC yang nomornya SUDAH DIVERIFIKASI (570) mengetik "lokasi X" ke nomor
 * MARLIN; foto berikutnya disimpan untuk lokasi itu. Menyebut nama pekerjaan
 * (dan volumenya) membuat USULAN (DECISIONS 707): volume dan foto pekerjaan
 * dari WA TIDAK PERNAH langsung masuk laporan harian. Orang yang boleh mengisi
 * laporan memeriksanya di halaman laporan harian lalu menekan Masukkan.
 *
 * Dipanggil dari antrean tanya-jawab, jadi idempotensi per pesan, coba ulang,
 * dan cron cadangannya ikut dari sana (DECISIONS 372). Yang TIDAK ditangani di
 * sini diteruskan ke Tanya MARLIN seperti biasa.
 *
 * Aturan yang tidak berubah karena datang lewat WhatsApp:
 *  - izin & akses lokasi sama dengan aplikasi (`photo.quick`, `daily_report.create`);
 *  - foto disimpan sebagai foto GALERI: GPS & jam dari EXIF bila ada (dikirim
 *    sebagai Dokumen), selain itu titik lokasi proyek BERTANDA dan tanggal saja
 *    (DECISIONS 197) – tidak pernah dihitung sebagai bukti GPS;
 *  - usulan dimasukkan lewat `upsertItem` yang sama: sisa RAB, status laporan, audit.
 */

export type HasilLapor = { ditangani: false } | { ditangani: true; alasan: string };
const TIDAK: HasilLapor = { ditangani: false };

type PilihanLokasi = { id: string; label: string };
type PilihanPekerjaan = { lineageKey: string; label: string };
type Tawaran =
  | { jenis: "lokasi"; pilihan: PilihanLokasi[] }
  | { jenis: "pekerjaan"; pilihan: PilihanPekerjaan[]; volume: number | null; satuan: string | null };

type Sesi = NonNullable<Awaited<ReturnType<typeof muatSesi>>>;

function muatSesi(userId: string) {
  return db.waLaporSesi.findUnique({
    where: { userId },
    include: { location: { select: { id: true, name: true, slug: true, gpsLat: true, gpsLng: true } } },
  });
}

/**
 * Waktu pesan. Payload tanpa `timestamp` dibaca parser sebagai 1970 – masa
 * sesi yang dihitung dari situ akan salah total, jadi jatuh ke jam sekarang.
 */
function waktu(m: ParsedWaMessage): Date {
  return m.timestamp.getTime() > 0 ? m.timestamp : new Date();
}

/** Media yang diterima sebagai foto: gambar, termasuk yang dikirim sebagai Dokumen. */
function fotoDariPesan(m: ParsedWaMessage): boolean {
  return m.hasMedia && /^image\//i.test(m.mediaType ?? "");
}

export async function tanganiLaporWa(m: ParsedWaMessage, user: SessionUser): Promise<HasilLapor> {
  // Media selain gambar (PDF, video, suara) bukan urusan lapor.
  if (m.hasMedia && !fotoDariPesan(m)) return TIDAK;
  const foto = m.hasMedia;
  const perintah = bacaPerintah(m.body);
  const sekarang = waktu(m);
  const sesi = await muatSesi(user.id);
  const berlaku = sesiBerlaku(sesi, sekarang);
  const adaTawaran = !!sesi?.tawaran && tawaranBerlaku(sesi.terakhirAt, sekarang);

  /*
   * Teks yang bukan urusan lapor diteruskan ke Tanya MARLIN TANPA menyentuh
   * sesi: pertanyaan di tengah sesi tidak boleh memperpanjang atau
   * mengakhirinya. Teks biasa hanya dibaca sebagai nama pekerjaan selama sesi
   * BERLAKU – di luar itu ia pertanyaan seperti sebelum fitur ini ada.
   */
  if (!foto) {
    const urusanLapor =
      perintah.jenis === "lokasi" ||
      perintah.jenis === "daftar_lokasi" ||
      perintah.jenis === "bantuan" ||
      (perintah.jenis === "selesai" && !!sesi) ||
      (perintah.jenis === "pilih" && (adaTawaran || berlaku)) ||
      (perintah.jenis === "teks" && berlaku);
    if (!urusanLapor) return TIDAK;
  }

  /*
   * Verifikasi dua arah (570) TIDAK disyaratkan di sini (DECISIONS 711).
   * `user` ditemukan dari nomor yang BENAR-BENAR mengirim pesan, dicocokkan ke
   * nomor yang tersimpan di akunnya, dan nomor yang tercatat di dua akun aktif
   * tidak dijawab sama sekali (`cariPengguna`). Pesan masuk itu sendiri bukti
   * bahwa pengirimnya memegang nomor yang tercatat. Sisa risikonya – nomor
   * salah ketik milik orang lain – dibatasi 707: semua kiriman WA hanya usulan
   * yang harus diterima orang di aplikasi. Status verifikasinya dicatat di audit.
   */

  if (!foto) {
    // Foto yang belum disebut di balasan dilaporkan DULU: rentetan foto yang
    // ditutup pesan teks menahan balasan rapelnya, dan tanpa ini ringkasannya
    // baru muncul di foto berikutnya – atau tidak sama sekali.
    if ((sesi?.rapelTersimpan ?? 0) > 0) await kirimRapel(m, user);
    switch (perintah.jenis) {
      case "bantuan":
        await balasWa(m.chatId, teks.bantuan(await tanyaWaAktif()));
        return { ditangani: true, alasan: "lapor: bantuan" };
      case "lokasi":
        return (await mulaiLokasi(m, user, perintah.nama)).hasil;
      case "daftar_lokasi":
        return (await daftarLokasi(m, user)).hasil;
      case "selesai":
        return akhiriSesi(m, user, sesi!, berlaku);
      case "pilih":
        if (adaTawaran) return jawabPilihan(m, user, sesi!, perintah.nomor);
        // Tanpa tawaran, angka polos = volume pekerjaan yang sedang aktif.
        if (!(await hasLocationAccess(user, sesi!.location!.id))) return cabutSesi(m, user, sesi!);
        await isiPekerjaan(m, user, sesi!, m.body.trim());
        return { ditangani: true, alasan: "lapor: volume pekerjaan aktif" };
      case "teks":
        if (!(await hasLocationAccess(user, sesi!.location!.id))) return cabutSesi(m, user, sesi!);
        await isiPekerjaan(m, user, sesi!, perintah.teks);
        return { ditangani: true, alasan: "lapor: pekerjaan" };
      default:
        return TIDAK;
    }
  }

  /* ── Foto ── */
  let s: Sesi | null = sesi;
  let aktif = berlaku;
  if (perintah.jenis === "daftar_lokasi") {
    // Foto berketerangan "lokasi" saja: daftarnya dulu; fotonya dikirim ulang sesudah memilih.
    const d = await daftarLokasi(m, user);
    if (d.ditawarkan) await balasWa(m.chatId, teks.fotoMenungguPilihan);
    return d.hasil;
  }
  if (perintah.jenis === "lokasi") {
    // Foto berketerangan "lokasi X": lokasinya dulu, lalu fotonya – asal
    // lokasinya langsung pasti. Selama masih memilih, foto TIDAK disimpan ke
    // lokasi sesi sebelumnya.
    const r = await mulaiLokasi(m, user, perintah.nama);
    if (!r.lokasiId) {
      await balasWa(m.chatId, r.hasil.ditangani ? teks.fotoMenungguPilihan : teks.fotoTanpaLokasi(false));
      return { ditangani: true, alasan: "lapor: foto menunggu lokasi" };
    }
    s = await muatSesi(user.id);
    aktif = true;
  }
  if (!aktif || !s?.location) {
    await balasWa(m.chatId, teks.fotoTanpaLokasi(!!s?.locationId && !s.selesaiAt));
    return { ditangani: true, alasan: "lapor: foto tanpa sesi lokasi" };
  }
  if (!can(user.role, "photo.quick")) {
    await balasWa(m.chatId, teks.tanpaIzinFoto);
    return { ditangani: true, alasan: "lapor: tanpa izin foto" };
  }
  if (!(await hasLocationAccess(user, s.location.id))) return cabutSesi(m, user, s);
  // Keterangan foto dibaca seperti pesan teks: pekerjaan (dan volumenya) untuk
  // foto ini. Fotonya tetap disimpan walau keterangannya perlu dijawab dulu.
  if (perintah.jenis === "teks" && perintah.teks) {
    await isiPekerjaan(m, user, s, perintah.teks);
    s = (await muatSesi(user.id)) ?? s;
  }
  return simpanFoto(m, user, s);
}

async function katalogUntuk(user: SessionUser): Promise<LokasiKatalog[]> {
  return katalogLokasi(user, await accessibleLocationIds(user));
}

function labelLokasi(l: LokasiKatalog): string {
  return `${l.nama} – ${[l.desa, l.kabupaten].filter(Boolean).join(", ")}`;
}

/**
 * "lokasi X" → sesi baru (cocok satu), tawaran (cocok beberapa), atau
 * diteruskan ke Tanya MARLIN (tidak cocok apa pun). `lokasiId` terisi hanya
 * bila lokasi aktifnya sudah pasti.
 */
async function mulaiLokasi(
  m: ParsedWaMessage,
  user: SessionUser,
  diketik: string,
): Promise<{ hasil: HasilLapor; lokasiId?: string }> {
  // Katalog = lokasi yang BOLEH diakses orang ini; lokasi lain tidak pernah bisa cocok.
  const h = cocokkanLokasi(diketik, await katalogUntuk(user));
  if (h.jenis === "tidak_ada") return { hasil: TIDAK };
  if (h.jenis === "tepat") {
    return { hasil: await aktifkanLokasi(m, user, h.lokasi.id, h.lokasi.nama), lokasiId: h.lokasi.id };
  }

  const kandidat =
    h.jenis === "ambigu"
      ? h.kandidat
      : h.jenis === "wilayah"
        ? h.wilayah.lokasi
        : [...new Map(h.pilihan.flatMap((p) => p.lokasi).map((l) => [l.id, l])).values()];
  if (kandidat.length > MAKS_DAFTAR_LOKASI) {
    await balasWa(m.chatId, teks.terlaluBanyakLokasi(diketik, kandidat.length));
    return { hasil: { ditangani: true, alasan: "lapor: lokasi terlalu banyak cocok" } };
  }
  await tawarkanLokasi(m, user, kandidat);
  await balasWa(m.chatId, teks.pilihLokasi(diketik, kandidat.map(labelLokasi)));
  return { hasil: { ditangani: true, alasan: "lapor: pilih lokasi" } };
}

/**
 * "lokasi" saja / "daftar lokasi" → daftar bernomor lokasi yang BOLEH diakses
 * orang ini, urut nama; balasan angka mengaktifkan lokasi itu (DECISIONS 710).
 */
async function daftarLokasi(
  m: ParsedWaMessage,
  user: SessionUser,
): Promise<{ hasil: HasilLapor; ditawarkan: boolean }> {
  const katalog = (await katalogUntuk(user)).sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  if (katalog.length === 0) {
    await balasWa(m.chatId, teks.daftarLokasiKosong);
    return { hasil: { ditangani: true, alasan: "lapor: daftar lokasi kosong" }, ditawarkan: false };
  }
  if (katalog.length > MAKS_DAFTAR_LOKASI) {
    await balasWa(m.chatId, teks.daftarLokasiPanjang(katalog.length));
    return { hasil: { ditangani: true, alasan: "lapor: daftar lokasi terlalu panjang" }, ditawarkan: false };
  }
  await tawarkanLokasi(m, user, katalog);
  await balasWa(m.chatId, teks.daftarLokasi(katalog.map(labelLokasi)));
  return { hasil: { ditangani: true, alasan: "lapor: pilih lokasi" }, ditawarkan: true };
}

/** Simpan tawaran lokasi bernomor; jawabannya ditangani `jawabPilihan`. */
async function tawarkanLokasi(m: ParsedWaMessage, user: SessionUser, kandidat: LokasiKatalog[]): Promise<void> {
  const tawaran: Tawaran = { jenis: "lokasi", pilihan: kandidat.map((l) => ({ id: l.id, label: labelLokasi(l) })) };
  // Lokasi sesi sebelumnya DILEPAS selama memilih: orang yang baru saja
  // menyebut lokasi lain tidak sedang memotret lokasi lama.
  const data = {
    chatId: m.chatId,
    locationId: null,
    lineageKey: null,
    tawaran: tawaran as unknown as Prisma.InputJsonValue,
    terakhirAt: waktu(m),
  };
  await db.waLaporSesi.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data, mulaiAt: waktu(m) },
    update: data,
  });
}

async function aktifkanLokasi(
  m: ParsedWaMessage,
  user: SessionUser,
  locationId: string,
  nama: string,
): Promise<HasilLapor> {
  // Sesi baru menimpa yang lama: penghitung, pekerjaan aktif, dan foto menunggu
  // ikut bersih – semuanya milik lokasi sebelumnya.
  const awal = {
    chatId: m.chatId,
    locationId,
    lineageKey: null,
    tawaran: Prisma.DbNull,
    rapelTersimpan: 0,
    rapelDiusulkan: 0,
    rapelTanpaGps: 0,
    fotoTersimpan: 0,
    catatanGpsDikirim: false,
    mulaiAt: waktu(m),
    terakhirAt: waktu(m),
    selesaiAt: null,
  };
  await db.waLaporSesi.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...awal },
    update: awal,
  });
  const akun = await db.user.findUnique({ where: { id: user.id }, select: { waVerifiedAt: true } });
  await audit(user.id, "wa.lapor.lokasi", "location", locationId, {
    chatId: m.chatId,
    nomorTerverifikasi: !!akun?.waVerifiedAt,
  });
  await balasWa(m.chatId, teks.lokasiAktif(nama));
  return { ditangani: true, alasan: "lapor: lokasi aktif" };
}

async function akhiriSesi(m: ParsedWaMessage, user: SessionUser, sesi: Sesi, berlaku: boolean): Promise<HasilLapor> {
  if (!berlaku) {
    await balasWa(m.chatId, teks.tanpaSesi);
    return { ditangani: true, alasan: "lapor: selesai tanpa sesi" };
  }
  await db.waLaporSesi.update({
    where: { userId: user.id },
    data: { selesaiAt: waktu(m), tawaran: Prisma.DbNull, lineageKey: null },
  });
  await audit(user.id, "wa.lapor.selesai", "location", sesi.locationId, { foto: sesi.fotoTersimpan });
  await balasWa(m.chatId, teks.selesai(sesi.location?.name ?? "lokasi", sesi.fotoTersimpan));
  return { ditangani: true, alasan: "lapor: sesi diakhiri" };
}

async function cabutSesi(m: ParsedWaMessage, user: SessionUser, sesi: Sesi): Promise<HasilLapor> {
  await db.waLaporSesi.update({ where: { userId: user.id }, data: { selesaiAt: waktu(m) } });
  await balasWa(m.chatId, teks.tanpaAksesLokasi(sesi.location?.name ?? "lokasi itu"));
  return { ditangani: true, alasan: "lapor: akses lokasi dicabut" };
}

async function jawabPilihan(m: ParsedWaMessage, user: SessionUser, sesi: Sesi, nomor: number): Promise<HasilLapor> {
  const tawaran = sesi.tawaran as unknown as Tawaran;
  const p = tawaran.pilihan[nomor - 1];
  if (!p) {
    await balasWa(m.chatId, teks.pilihanDiLuar(tawaran.pilihan.length));
    return { ditangani: true, alasan: "lapor: pilihan di luar rentang" };
  }
  if (tawaran.jenis === "lokasi") {
    const pl = p as PilihanLokasi;
    if (!(await hasLocationAccess(user, pl.id))) {
      await balasWa(m.chatId, teks.tanpaAksesLokasi(pl.label));
      return { ditangani: true, alasan: "lapor: pilihan lokasi tanpa akses" };
    }
    return aktifkanLokasi(m, user, pl.id, pl.label.replace(/ – .*$/, ""));
  }
  if (!sesi.location || !sesiBerlaku(sesi, waktu(m))) {
    await balasWa(m.chatId, teks.pilihanKedaluwarsa);
    return { ditangani: true, alasan: "lapor: pilihan pekerjaan sesudah sesi habis" };
  }
  const pk = p as PilihanPekerjaan;
  const node = (await pilihanPekerjaanLokasi(sesi.location.id)).find((o) => o.lineageKey === pk.lineageKey);
  if (!node) {
    await balasWa(m.chatId, teks.pekerjaanTidakAda(pk.label, sesi.location.name, await tanyaWaAktif()));
    return { ditangani: true, alasan: "lapor: pilihan pekerjaan hilang dari RAB" };
  }
  await tetapkanPekerjaan(m, user, sesi, node, { volume: tawaran.volume, satuan: tawaran.satuan });
  return { ditangani: true, alasan: "lapor: pilih pekerjaan" };
}

/* ── Pekerjaan & volume ─────────────────────────────────────────────────── */

type OpsiPekerjaan = Awaited<ReturnType<typeof pilihanPekerjaanLokasi>>[number];

async function pilihanPekerjaanLokasi(locationId: string) {
  const { getLeafNodeOptions } = await import("@/lib/daily-report/queries");
  return getLeafNodeOptions(locationId);
}

function labelPekerjaan(o: OpsiPekerjaan): string {
  // Kategori DAN sub-kategori: "Dolken" ada di banyak bangunan, dan sub-kategori
  // bernama sama ("1. Pondasi") ada di tiap bangunan (DECISIONS 713).
  const konteks = [o.category, o.subPath].filter(Boolean).join(" › ");
  return `${[o.code, o.name].filter(Boolean).join(" ")}${o.unit ? ` (${o.unit})` : ""}${konteks ? ` – ${konteks}` : ""}`;
}

/**
 * Teks di tengah sesi → pekerjaan (dan volume).
 *
 * Teks UTUH dicari lebih dulu: angka yang ternyata bagian nama ("beton k 225")
 * tidak boleh terbaca sebagai volume 225. Baru kalau teks utuh tidak cocok
 * apa pun, ekor angkanya dibaca sebagai volume.
 *
 * @returns "berhenti" bila MARLIN sedang menunggu jawaban (pilihan, satuan beda,
 *   tidak ketemu) – foto yang membawa keterangan itu tetap disimpan pemanggil,
 *   tapi tanpa pekerjaan.
 */
async function isiPekerjaan(
  m: ParsedWaMessage,
  user: SessionUser,
  sesi: Sesi,
  teksMasuk: string,
): Promise<"lanjut" | "berhenti"> {
  const lokasi = sesi.location!;
  const opsi = await pilihanPekerjaanLokasi(lokasi.id);

  // Teks UTUH dulu, baru ekor angkanya sebagai volume (lihat di atas).
  let isian: IsianPekerjaan = { nama: teksMasuk, volume: null, satuan: null };
  let hasil = cariPekerjaanWa(opsi, teksMasuk);
  if (hasil.semua.length === 0) {
    const dipisah = pisahVolume(teksMasuk);
    if (dipisah.volume != null && !dipisah.nama) {
      // Hanya volume → untuk pekerjaan yang sedang aktif.
      const aktif = sesi.lineageKey ? opsi.find((o) => o.lineageKey === sesi.lineageKey) : undefined;
      if (!aktif) {
        await balasWa(m.chatId, teks.volumeTanpaPekerjaan);
        return "berhenti";
      }
      return tetapkanPekerjaan(m, user, sesi, aktif, dipisah);
    }
    if (dipisah.volume != null) {
      isian = dipisah;
      hasil = cariPekerjaanWa(opsi, dipisah.nama);
    }
  }

  const diketik = isian.nama || teksMasuk;
  const tawarkan = async (pilihan: OpsiPekerjaan[], mendekati: boolean): Promise<"berhenti"> => {
    if (pilihan.length > MAKS_PILIHAN) {
      await balasWa(m.chatId, teks.terlaluBanyakPekerjaan(diketik, pilihan.length, kelompokPekerjaan(pilihan)));
      return "berhenti";
    }
    const tawaran: Tawaran = {
      jenis: "pekerjaan",
      pilihan: pilihan.map((o) => ({ lineageKey: o.lineageKey, label: labelPekerjaan(o) })),
      volume: isian.volume,
      satuan: isian.satuan,
    };
    await db.waLaporSesi.update({
      where: { userId: user.id },
      data: { tawaran: tawaran as unknown as Prisma.InputJsonValue, terakhirAt: waktu(m) },
    });
    const label = tawaran.pilihan.map((p) => p.label);
    await balasWa(m.chatId, mendekati ? teks.mendekatiPekerjaan(diketik, label) : teks.pilihPekerjaan(diketik, label));
    return "berhenti";
  };

  if (hasil.semua.length > 0) {
    // Nama yang PERSIS sama menang atas yang sekadar memuat kata-katanya.
    const persis = hasil.semua.filter((o) => o.name.trim().toLowerCase() === diketik.trim().toLowerCase());
    const pilihan = persis.length === 1 ? persis : hasil.semua;
    if (pilihan.length === 1) return tetapkanPekerjaan(m, user, sesi, pilihan[0], isian);
    return tawarkan(pilihan, false);
  }
  // Tebakan selalu ditawarkan, tidak pernah langsung dipakai – walau cuma satu.
  if (hasil.mendekati.length > 0) return tawarkan(hasil.mendekati, true);

  await balasWa(m.chatId, teks.pekerjaanTidakAda(diketik, lokasi.name, await tanyaWaAktif()));
  return "berhenti";
}

/**
 * Pekerjaan terpilih: jadikan pekerjaan aktif, dan bila volumenya ikut
 * diketik, catat sebagai USULAN – tidak pernah langsung ke laporan.
 */
async function tetapkanPekerjaan(
  m: ParsedWaMessage,
  user: SessionUser,
  sesi: Sesi,
  node: OpsiPekerjaan,
  isian: { volume: number | null; satuan: string | null },
): Promise<"lanjut" | "berhenti"> {
  const lokasi = sesi.location!;
  await db.waLaporSesi.update({
    where: { userId: user.id },
    data: { lineageKey: node.lineageKey, tawaran: Prisma.DbNull, terakhirAt: waktu(m) },
  });
  const nama = node.name.trim();

  if (isian.volume == null) {
    await balasWa(m.chatId, teks.pekerjaanAktif(nama, node.unit));
    return "lanjut";
  }

  // Yang PASTI salah ditolak sekarang, selagi PIC masih memegang ponselnya –
  // bukan baru ketahuan saat seseorang menekan Masukkan di kantor. Satuan
  // BUKAN salah satunya: angkanya selalu dalam satuan RAB (DECISIONS 709).
  if (!can(user.role, "daily_report.create")) {
    await balasWa(m.chatId, teks.tanpaIzinVolume);
    return "berhenti";
  }
  if (node.remaining != null && isian.volume > node.remaining + 1e-6) {
    await balasWa(m.chatId, teks.volumeDitolak(teks.melebihiSisa(angkaSatuan(node.remaining, node.unit))));
    return "berhenti";
  }

  const { usulan, volumeLama } = await catatUsulan(user, lokasi.id, jakartaDateKey(waktu(m)), node, {
    volume: isian.volume,
  });
  await audit(user.id, "wa.lapor.usulan_volume", "wa_usulan", usulan.id, {
    locationId: lokasi.id,
    lineageKey: node.lineageKey,
    volume: isian.volume,
    volumeLama,
    satuanDiketik: isian.satuan,
    waMessageId: m.waMessageId,
  });
  const satuanRab = satuanPerluDisebut(isian.satuan, node.unit);
  await balasWa(
    m.chatId,
    teks.usulanVolume(
      nama,
      angkaSatuan(isian.volume, node.unit),
      volumeLama != null && volumeLama !== isian.volume ? angkaSatuan(volumeLama, node.unit) : null,
      usulan.photoIds.length,
    ) + (satuanRab ? teks.satuanIkutRab(satuanRab) : ""),
  );
  return "lanjut";
}

/**
 * Satu usulan MENUNGGU per (lokasi, hari, pekerjaan, pengirim): kiriman
 * berikutnya memperbaruinya – volume baru menggantikan yang lama, foto
 * ditambahkan. Kunci unik `kunciMenunggu` membuat dua foto yang diproses
 * bersamaan tidak membuat dua usulan; yang kalah balapan mengulang sebagai
 * pembaruan.
 */
async function catatUsulan(
  user: SessionUser,
  locationId: string,
  dateKey: string,
  node: OpsiPekerjaan,
  ubah: { volume?: number; fotoId?: string },
) {
  const kunci = `${locationId}|${dateKey}|${node.lineageKey}|${user.id}`;
  const lama = await db.waUsulan.findUnique({ where: { kunciMenunggu: kunci }, select: { volume: true } });
  const perbarui = {
    namaPekerjaan: node.name.trim(),
    satuan: node.unit,
    ...(ubah.volume != null ? { volume: ubah.volume } : {}),
    ...(ubah.fotoId ? { photoIds: { push: ubah.fotoId } } : {}),
  };
  let usulan;
  try {
    usulan = await db.waUsulan.upsert({
      where: { kunciMenunggu: kunci },
      create: {
        locationId,
        reportDate: parseDateKey(dateKey)!,
        lineageKey: node.lineageKey,
        namaPekerjaan: node.name.trim(),
        satuan: node.unit,
        volume: ubah.volume ?? null,
        photoIds: ubah.fotoId ? [ubah.fotoId] : [],
        kunciMenunggu: kunci,
        diusulkanOlehId: user.id,
      },
      update: perbarui,
    });
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
    usulan = await db.waUsulan.update({ where: { kunciMenunggu: kunci }, data: perbarui });
  }
  return { usulan, volumeLama: lama?.volume != null ? Number(lama.volume) : null };
}

/* ── Foto ───────────────────────────────────────────────────────────────── */

const EKSTENSI: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

async function simpanFoto(m: ParsedWaMessage, user: SessionUser, sesi: Sesi): Promise<HasilLapor> {
  const lokasi = sesi.location!;
  const dateKey = jakartaDateKey(waktu(m));
  const { savePhotoForItem, PhotoError } = await import("@/lib/photos");

  let fotoId: string;
  let gpsAsli: boolean;
  try {
    if (!m.mediaUrl) throw new PhotoError("berkasnya tidak ikut terkirim dari WhatsApp. Kirim ulang fotonya.");
    const { unduhBerkas } = await import("./lampiran-tangkap");
    const isi = await unduhBerkas(m.mediaUrl);
    const mime = (m.mediaType ?? "image/jpeg").toLowerCase();
    const nama = m.mediaFileName?.trim() || `wa-${m.waMessageId.replace(/[^A-Za-z0-9]/g, "").slice(-16)}${EKSTENSI[mime] ?? ".jpg"}`;
    const file = new File([new Uint8Array(isi)], nama, { type: mime });
    const foto = await savePhotoForItem({
      locationId: lokasi.id,
      // Tanpa induk – masuk kantong Foto Cepat lokasi ini. Ke laporan hanya
      // lewat usulan yang dimasukkan orang (DECISIONS 707).
      reportId: null,
      reportItemId: null,
      activityId: null,
      file,
      userId: user.id,
      locationSlug: lokasi.slug,
      dateKey,
      stamp: {
        // Foto WhatsApp = foto GALERI: EXIF dulu (dikirim sebagai Dokumen),
        // selain itu titik lokasi proyek BERTANDA – PIC sendiri yang menyebut
        // lokasinya. Jam yang tidak diketahui → tanggal saja (DECISIONS 197).
        source: "gallery",
        fallbackMode: "project",
        requireGps: false,
        locationLat: lokasi.gpsLat != null ? Number(lokasi.gpsLat) : null,
        locationLng: lokasi.gpsLng != null ? Number(lokasi.gpsLng) : null,
        workDate: parseDateKey(dateKey),
        reporterName: user.fullName,
        locationLabel: null,
        companyName: null,
        categoryName: null,
        workName: null,
      },
    });
    fotoId = foto.id;
    gpsAsli = foto.gpsSource === "exif";
  } catch (err) {
    // Pesan PhotoError dan penolakan unduhan ditulis untuk orang; galat lain
    // (basis data, jaringan) tidak dikirim mentah ke WhatsApp.
    const untukOrang =
      err instanceof PhotoError || (err instanceof Error && /^(Server berkas menolak|Berkas terlalu besar)/.test(err.message));
    if (!untukOrang) console.error("[wa/lapor] gagal menyimpan foto:", err);
    const sebab = untukOrang
      ? (err as Error).message
      : "fotonya gagal diambil dari WhatsApp. Kirim ulang fotonya sebentar lagi.";
    await db.waLaporSesi.update({ where: { userId: user.id }, data: { terakhirAt: waktu(m) } });
    await balasWa(m.chatId, teks.fotoGagal(sebab));
    return { ditangani: true, alasan: `lapor: foto gagal – ${sebab}`.slice(0, 300) };
  }

  // Penanda asal: tampil "Lewat WhatsApp" di kantong, galeri, dan usulan.
  await db.photo.update({ where: { id: fotoId }, data: { waMessageId: m.waMessageId } });

  // Pekerjaan aktif → foto ikut USULAN pekerjaan itu; tanpa pekerjaan aktif
  // cukup di kantong Foto Cepat.
  let diusulkan = false;
  if (sesi.lineageKey) {
    const node = (await pilihanPekerjaanLokasi(lokasi.id)).find((o) => o.lineageKey === sesi.lineageKey);
    if (node) {
      await catatUsulan(user, lokasi.id, dateKey, node, { fotoId });
      diusulkan = true;
    }
  }

  await db.waLaporSesi.update({
    where: { userId: user.id },
    data: {
      terakhirAt: waktu(m),
      fotoTersimpan: { increment: 1 },
      rapelTersimpan: { increment: 1 },
      rapelDiusulkan: { increment: diusulkan ? 1 : 0 },
      rapelTanpaGps: { increment: gpsAsli ? 0 : 1 },
    },
  });
  await audit(user.id, "wa.lapor.foto", "photo", fotoId, {
    locationId: lokasi.id,
    dateKey,
    lineageKey: sesi.lineageKey,
    diusulkan,
    gpsAsli,
    waMessageId: m.waMessageId,
  });

  await mungkinBalasRapel(m, user);
  return { ditangani: true, alasan: `lapor: foto tersimpan${diusulkan ? " + diusulkan" : ""}` };
}

/**
 * Balasan foto DIRAPEL: selama masih ada foto dari chat ini yang antre di
 * belakang pesan ini, MARLIN diam; foto terakhir dari rentetan itu yang
 * menjawab untuk semuanya. Sepuluh foto = satu balasan, bukan sepuluh – tiap
 * pesan keluar tetap pesan keluar di mata WhatsApp (DECISIONS 433).
 */
async function mungkinBalasRapel(m: ParsedWaMessage, user: SessionUser): Promise<void> {
  const job = await db.waReplyJob.findUnique({ where: { waMessageId: m.waMessageId }, select: { createdAt: true } });
  if (job) {
    const diBelakang = await db.waReplyJob.count({
      where: { chatId: m.chatId, status: { in: ["antre", "berjalan"] }, createdAt: { gt: job.createdAt } },
    });
    if (diBelakang > 0) return;
  }
  await kirimRapel(m, user);
}

/** Satu balasan untuk semua foto yang belum disebut. */
async function kirimRapel(m: ParsedWaMessage, user: SessionUser): Promise<void> {
  const s = await db.waLaporSesi.findUnique({
    where: { userId: user.id },
    include: { location: { select: { name: true } } },
  });
  if (!s || s.rapelTersimpan === 0) return;
  const node = s.lineageKey && s.locationId
    ? (await pilihanPekerjaanLokasi(s.locationId)).find((o) => o.lineageKey === s.lineageKey)
    : undefined;
  const catatanGps = s.rapelTanpaGps > 0 && !s.catatanGpsDikirim;
  // Penghitung dikurangi sebesar yang DILAPORKAN, bukan dinolkan: foto yang
  // selesai di antara pembacaan dan penulisan ini tetap tersisa untuk balasan berikutnya.
  await db.waLaporSesi.update({
    where: { userId: user.id },
    data: {
      rapelTersimpan: { decrement: s.rapelTersimpan },
      rapelDiusulkan: { decrement: s.rapelDiusulkan },
      rapelTanpaGps: { decrement: s.rapelTanpaGps },
      ...(catatanGps ? { catatanGpsDikirim: true } : {}),
    },
  });
  await balasWa(
    m.chatId,
    teks.fotoTersimpan({
      jumlah: s.rapelTersimpan,
      lokasi: s.location?.name ?? "lokasi",
      diusulkan: s.rapelDiusulkan,
      pekerjaan: node?.name.trim() ?? null,
      kantong: s.rapelTersimpan - s.rapelDiusulkan,
      catatanGps,
    }),
  );
}
