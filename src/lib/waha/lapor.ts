import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { accessibleLocationIds, hasLocationAccess, type SessionUser } from "@/lib/auth/session";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { Prisma } from "@/generated/prisma/client";
import type { ParsedWaMessage } from "./ingest-parse";
import { balasWa } from "./kirim";
import { cocokkanLokasi, type LokasiKatalog } from "./tanya-niat";
import { katalogLokasi } from "./tanya-data";
import {
  angkaSatuan,
  bacaPerintah,
  cariPekerjaanWa,
  MAKS_PILIHAN,
  pisahVolume,
  satuanSepadan,
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
 * membuat foto berikutnya ditempel ke pekerjaan itu di laporan harian; volume
 * yang ikut diketik langsung menjadi volume hari itu (laporan tetap DRAFT dan
 * tidak dihitung sampai dikirim dan disetujui).
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
 *  - volume lewat `upsertItem` yang sama: sisa RAB, status laporan, audit.
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
      perintah.jenis === "bantuan" ||
      (perintah.jenis === "selesai" && !!sesi) ||
      (perintah.jenis === "pilih" && (adaTawaran || berlaku)) ||
      (perintah.jenis === "teks" && berlaku);
    if (!urusanLapor) return TIDAK;
  }

  // Menulis atas nama orang butuh identitas yang TERBUKTI, bukan sekadar nomor
  // yang diketik admin (DECISIONS 570).
  const terverifikasi = await db.user.findUnique({ where: { id: user.id }, select: { waVerifiedAt: true } });
  if (!terverifikasi?.waVerifiedAt) {
    // "lokasi …" yang tidak cocok lokasi mana pun mungkin pertanyaan biasa.
    if (perintah.jenis === "lokasi" && !foto) {
      if (cocokkanLokasi(perintah.nama, await katalogUntuk(user)).jenis === "tidak_ada") return TIDAK;
    }
    if (foto || perintah.jenis === "lokasi" || perintah.jenis === "bantuan") {
      await balasWa(m.chatId, teks.belumVerifikasi);
      return { ditangani: true, alasan: "lapor: nomor belum diverifikasi" };
    }
    return TIDAK;
  }

  if (!foto) {
    // Foto yang belum disebut di balasan dilaporkan DULU: rentetan foto yang
    // ditutup pesan teks menahan balasan rapelnya, dan tanpa ini ringkasannya
    // baru muncul di foto berikutnya – atau tidak sama sekali.
    if ((sesi?.rapelTersimpan ?? 0) > 0) await kirimRapel(m, user);
    switch (perintah.jenis) {
      case "bantuan":
        await balasWa(m.chatId, teks.bantuan);
        return { ditangani: true, alasan: "lapor: bantuan" };
      case "lokasi":
        return (await mulaiLokasi(m, user, perintah.nama)).hasil;
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
  if (kandidat.length > MAKS_PILIHAN) {
    await balasWa(m.chatId, teks.terlaluBanyakLokasi(diketik, kandidat.length));
    return { hasil: { ditangani: true, alasan: "lapor: lokasi terlalu banyak cocok" } };
  }
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
  await balasWa(m.chatId, teks.pilihLokasi(diketik, tawaran.pilihan.map((p) => p.label)));
  return { hasil: { ditangani: true, alasan: "lapor: pilih lokasi" } };
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
    fotoMenunggu: [],
    rapelTersimpan: 0,
    rapelDitempel: 0,
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
  await audit(user.id, "wa.lapor.lokasi", "location", locationId, { chatId: m.chatId });
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
    await balasWa(m.chatId, teks.pekerjaanTidakAda(pk.label, sesi.location.name));
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
  const konteks = o.subPath || o.category;
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
      await balasWa(m.chatId, teks.terlaluBanyakPekerjaan(diketik, pilihan.length));
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

  await balasWa(m.chatId, teks.pekerjaanTidakAda(diketik, lokasi.name));
  return "berhenti";
}

/**
 * Pekerjaan terpilih: jadikan pekerjaan aktif, catat volumenya bila ada, lalu
 * tempelkan foto sesi ini yang sudah menunggu pekerjaan tersebut.
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
  const dateKey = jakartaDateKey(waktu(m));
  const nama = node.name.trim();

  if (isian.volume == null) {
    const item = await itemHariIni(lokasi.id, dateKey, node.lineageKey);
    const ikut = item ? await tempelFotoMenunggu(user, node.lineageKey, item.id) : 0;
    await balasWa(
      m.chatId,
      teks.pekerjaanAktif(nama, node.unit, !!item) + (ikut > 0 ? ` ${ikut} foto yang tadi menunggu ikut ditempel.` : ""),
    );
    return "lanjut";
  }

  if (!satuanSepadan(isian.satuan, node.unit)) {
    await balasWa(m.chatId, teks.satuanBeda(nama, node.unit ?? "-", isian.satuan ?? "-"));
    return "berhenti";
  }
  if (!can(user.role, "daily_report.create")) {
    await balasWa(m.chatId, teks.tanpaIzinVolume);
    return "berhenti";
  }

  const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");
  let volumeLama: number | null = null;
  try {
    const report = await getOrCreateDraft(lokasi.id, dateKey, user.id);
    const lama = await db.dailyReportItem.findUnique({
      where: { reportId_lineageKey: { reportId: report.id, lineageKey: node.lineageKey } },
      select: { volumeDone: true, notes: true },
    });
    volumeLama = lama ? Number(lama.volumeDone) : null;
    const item = await upsertItem(
      report.id,
      // Catatan yang sudah ada DIBAWA: upsertItem menimpa catatan dengan apa pun yang dikirim.
      { rabNodeId: node.id, volumeDone: isian.volume, notes: lama?.notes ?? null },
      user.id,
    );
    await audit(user.id, "wa.lapor.volume", "daily_report_item", item.id, {
      locationId: lokasi.id,
      dateKey,
      lineageKey: node.lineageKey,
      volume: isian.volume,
      volumeLama,
      waMessageId: m.waMessageId,
    });
    const ikut = await tempelFotoMenunggu(user, node.lineageKey, item.id);
    await balasWa(
      m.chatId,
      teks.volumeTercatat(
        nama,
        angkaSatuan(isian.volume, node.unit),
        volumeLama != null && volumeLama !== isian.volume ? angkaSatuan(volumeLama, node.unit) : null,
        ikut,
      ),
    );
    return "lanjut";
  } catch (err) {
    // Galat ATURAN laporan (sisa RAB habis, laporan sudah dikirim, lokasi
    // dicabut) dikembalikan apa adanya – pesannya memang ditulis untuk orang.
    // Galat lain tidak dikirim mentah ke WhatsApp.
    const { DailyReportError } = await import("@/lib/daily-report/service");
    if (!(err instanceof DailyReportError)) console.error("[wa/lapor] gagal mencatat volume:", err);
    const pesan =
      err instanceof DailyReportError ? err.message : "sistem sedang bermasalah. Coba kirim lagi sebentar lagi.";
    await balasWa(m.chatId, teks.volumeDitolak(pesan));
    return "berhenti";
  }
}

async function itemHariIni(locationId: string, dateKey: string, lineageKey: string) {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return null;
  const report = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId, reportDate } },
    select: { id: true },
  });
  if (!report) return null;
  return db.dailyReportItem.findUnique({
    where: { reportId_lineageKey: { reportId: report.id, lineageKey } },
    select: { id: true },
  });
}

/** Tempelkan foto sesi yang menunggu pekerjaan ini. Mengembalikan jumlah yang tertempel. */
async function tempelFotoMenunggu(user: SessionUser, lineageKey: string, reportItemId: string): Promise<number> {
  const sesi = await db.waLaporSesi.findUnique({ where: { userId: user.id }, select: { fotoMenunggu: true } });
  const milik = (sesi?.fotoMenunggu ?? []).filter((e) => e.endsWith(`|${lineageKey}`));
  if (milik.length === 0) return 0;
  const ids = milik.map((e) => e.split("|")[0]);
  const { pakaiFotoKeTujuan } = await import("@/lib/foto-cepat/pakai");
  const hasil = await pakaiFotoKeTujuan(user, ids, { tujuan: "laporan", reportItemId }).catch(
    (err: unknown) => ({ error: err instanceof Error ? err.message : "gagal" }),
  );
  if ("error" in hasil) return 0;
  const sisa = (sesi?.fotoMenunggu ?? []).filter((e) => !milik.includes(e));
  await db.waLaporSesi.update({ where: { userId: user.id }, data: { fotoMenunggu: sisa } });
  return hasil.dipakai;
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
      // Tanpa induk dulu – masuk kantong Foto Cepat lokasi ini, lalu ditempel
      // ke pekerjaan bila pekerjaannya sudah ada di laporan hari ini.
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

  // Tempel ke pekerjaan aktif bila pekerjaan itu sudah ada di laporan hari ini;
  // kalau belum, catat sebagai menunggu – ikut masuk saat volumenya dikirim.
  let ditempel = false;
  if (sesi.lineageKey) {
    const item = await itemHariIni(lokasi.id, dateKey, sesi.lineageKey);
    if (item) {
      const { pakaiFotoKeTujuan } = await import("@/lib/foto-cepat/pakai");
      const h = await pakaiFotoKeTujuan(user, [fotoId], { tujuan: "laporan", reportItemId: item.id }).catch(
        (err: unknown) => ({ error: err instanceof Error ? err.message : "gagal" }),
      );
      ditempel = !("error" in h);
    }
  }

  await db.waLaporSesi.update({
    where: { userId: user.id },
    data: {
      terakhirAt: waktu(m),
      fotoTersimpan: { increment: 1 },
      rapelTersimpan: { increment: 1 },
      rapelDitempel: { increment: ditempel ? 1 : 0 },
      rapelTanpaGps: { increment: gpsAsli ? 0 : 1 },
      ...(sesi.lineageKey && !ditempel ? { fotoMenunggu: { push: `${fotoId}|${sesi.lineageKey}` } } : {}),
    },
  });
  await audit(user.id, "wa.lapor.foto", "photo", fotoId, {
    locationId: lokasi.id,
    dateKey,
    lineageKey: sesi.lineageKey,
    ditempel,
    gpsAsli,
    waMessageId: m.waMessageId,
  });

  await mungkinBalasRapel(m, user);
  return { ditangani: true, alasan: `lapor: foto tersimpan${ditempel ? " + ditempel" : ""}` };
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
      rapelDitempel: { decrement: s.rapelDitempel },
      rapelTanpaGps: { decrement: s.rapelTanpaGps },
      ...(catatanGps ? { catatanGpsDikirim: true } : {}),
    },
  });
  await balasWa(
    m.chatId,
    teks.fotoTersimpan({
      jumlah: s.rapelTersimpan,
      lokasi: s.location?.name ?? "lokasi",
      ditempel: s.rapelDitempel,
      pekerjaan: node?.name.trim() ?? null,
      kantong: s.rapelTersimpan - s.rapelDitempel,
      catatanGps,
    }),
  );
}
