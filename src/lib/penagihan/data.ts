import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import { getLocationsProgress } from "@/lib/progress";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { muatTerminSurat } from "@/lib/surat-penyedia/data";
import {
  KATALOG_BERKAS_TERMIN,
  LANGKAH_PENAGIHAN,
  gabungStatusLokasi,
  statusButir,
  statusLangkah,
  type ButirBerkas,
  type KeadaanBerkas,
  type StatusButir,
} from "./katalog";

/**
 * HALAMAN PENAGIHAN – sisi database (DECISIONS 720). Semua status DITURUNKAN
 * dari dokumen, surat, dan jadwal termin yang ada; tidak ada status penagihan
 * yang disimpan dan bisa basi.
 */

const BUTIR_PERUSAHAAN = KATALOG_BERKAS_TERMIN.filter((b) => b.tetapDi === "perusahaan").map((b) => b.kode);

export type RujukanBerkas = { judul: string; href: string } | null;

/** Asal berkas yang memenuhi butir: dokumen MARLIN atau surat penyedia. */
export type SumberBerkasAda = { dokumenId: string; locationId: string | null } | { suratId: string };

/** Satu berkas yang memenuhi butir, untuk tombol "Lihat" (DECISIONS 725). */
export type BerkasAda = {
  judul: string;
  href: string;
  /** Lokasi pemilik berkas; null = berlaku untuk seluruh paket. */
  locationId: string | null;
  sumber: SumberBerkasAda;
};

/** Keadaan satu butir per lokasi untuk butir `perLokasi`. */
export type LokasiButir = { locationId: string; nama: string; status: StatusButir; berkas: BerkasAda[] };

export type BarisPenagihan = {
  butir: ButirBerkas;
  status: StatusButir;
  /** Berkas pertama – dipertahankan untuk tampilan ringkas. */
  rujukan: RujukanBerkas;
  /** SEMUA berkas yang memenuhi butir ini (seluruh lokasi). */
  berkas: BerkasAda[];
  /** Per lokasi aktif, untuk butir yang satu per lokasi; null untuk butir paket. */
  lokasi: LokasiButir[] | null;
  /**
   * Semua berkas sebagai id – dipakai "Siapkan berkas termin" (DECISIONS
   * 721/722/725). Unggahan sendiri didahulukan dari surat & dokumen paket.
   */
  sumber: SumberBerkasAda[];
};

/** Status bawaan butir yang belum punya berkas (menurut asalnya). */
const KOSONG: KeadaanBerkas = { surat: new Set(), dokumenPaket: new Set(), butirTermin: new Set(), butirTetap: new Set() };

export async function muatPenagihan(packageId: string, user: SessionUser, terminDiminta?: number) {
  const d = await muatTerminSurat(packageId, user);
  if (!d) return null;
  const k = d.kontrak;
  const terminKe = d.termin.some((t) => t.terminKe === terminDiminta) ? terminDiminta! : pilihTerminAktif(d);
  const lokasiAktif = k.package.locations.filter((l) => l.isActive);

  const pilihDok = { id: true, type: true, title: true, terminKe: true, butirTermin: true, locationId: true } as const;
  const [semuaDokumenPaket, dokumenPerusahaan, semuaRevisi] = await Promise.all([
    db.document.findMany({ where: { packageId, status: "aktif" }, orderBy: { uploadedAt: "desc" }, select: pilihDok }),
    // NIB & NPWP milik PERUSAHAAN: diunggah sekali, berlaku di semua paketnya.
    db.document.findMany({
      where: { orgId: user.orgId, status: "aktif", butirTermin: { in: BUTIR_PERUSAHAAN }, contract: { vendorId: k.vendor.id } },
      orderBy: { uploadedAt: "desc" },
      select: pilihDok,
    }),
    // RAB tiap lokasi = berkas Excel revisi RAB AKTIF lokasi itu (DECISIONS 725);
    // berkas lolos memuat "Lampiran NEGO <desa>.xlsx" per desa. Impor RAB
    // menyimpan Excel-nya bertipe "hps" untuk SETIAP revisi, jadi Excel revisi
    // draft & yang sudah digantikan disingkirkan di bawah.
    db.rabRevision.findMany({
      where: { location: { packageId }, sourceDocumentId: { not: null } },
      select: { status: true, sourceDocumentId: true },
    }),
  ]);
  const idLokasiAktif = new Set(lokasiAktif.map((l) => l.id));
  // Satu Excel = satu revisi (hanya impor RAB yang mengisi sourceDocumentId).
  const rabBukanAktif = new Set(semuaRevisi.filter((r) => r.status !== "aktif").map((r) => r.sourceDocumentId!));
  // Dokumen lokasi yang sudah dinonaktifkan tidak ikut berkas termin.
  const dokumenPaket = semuaDokumenPaket.filter((x) => x.locationId === null || idLokasiAktif.has(x.locationId));
  const semuaDokumen = [...dokumenPaket, ...dokumenPerusahaan.filter((x) => !dokumenPaket.some((y) => y.id === x.id))];
  const suratTermin = d.surat.filter((s) => s.terminKe === terminKe);

  const keDokumen = (x: { id: string; title: string; locationId: string | null }): BerkasAda => ({
    judul: x.title,
    href: `/api/documents/${x.id}`,
    locationId: x.locationId,
    sumber: { dokumenId: x.id, locationId: x.locationId },
  });

  /** Semua berkas yang memenuhi butir: unggahan, surat, dokumen paket/lokasi. */
  const berkasButir = (butir: ButirBerkas): BerkasAda[] => {
    const kode = [butir.kode, ...(butir.juga ?? [])];
    const unggahan = semuaDokumen
      .filter((x) => x.butirTermin && kode.includes(x.butirTermin) && (x.terminKe === terminKe || x.terminKe === null))
      .map(keDokumen);
    const surat = butir.surat
      ? suratTermin
          .filter((s) => s.jenis === butir.surat)
          .map((s): BerkasAda => ({
            judul: `Nomor ${s.nomor}`,
            href: `/api/surat-penyedia/${s.id}/pdf`,
            locationId: null,
            sumber: { suratId: s.id },
          }))
      : [];
    const paket = butir.dokumenPaket
      ? dokumenPaket
          .filter((x) => !x.butirTermin && butir.dokumenPaket!.includes(x.type) && !rabBukanAktif.has(x.id))
          .map(keDokumen)
      : [];
    // Unggahan sendiri lebih dulu; satu dokumen tidak dihitung dua kali.
    const semua = [...unggahan, ...surat, ...paket];
    return semua.filter((b, i) => semua.findIndex((x) => x.href === b.href) === i);
  };

  const baris: BarisPenagihan[] = KATALOG_BERKAS_TERMIN.map((butir) => {
    const dasar = statusButir(butir, KOSONG);
    if (butir.cukupDi) return { butir, status: dasar, rujukan: null, berkas: [], lokasi: null, sumber: [] };
    const berkas = berkasButir(butir);
    let status: StatusButir = berkas.length ? "ada" : dasar;
    let lokasi: LokasiButir[] | null = null;
    if (butir.perLokasi && lokasiAktif.length > 0) {
      // Berkas tanpa lokasi berlaku untuk seluruh paket (mis. satu gambar gabungan).
      const seluruhPaket = berkas.filter((b) => b.locationId === null);
      lokasi = lokasiAktif.map((l) => {
        const milik = berkas.filter((b) => b.locationId === l.id);
        return { locationId: l.id, nama: l.name, status: milik.length || seluruhPaket.length ? "ada" : dasar, berkas: milik };
      });
      status = gabungStatusLokasi(lokasi.map((x) => x.status)) ?? status;
    }
    const pertama = berkas[0];
    return {
      butir,
      status,
      rujukan: pertama ? { judul: pertama.judul, href: pertama.href } : null,
      berkas,
      lokasi,
      sumber: berkas.map((b) => b.sumber),
    };
  });
  // Butir duplikat mengikuti status butir utamanya.
  for (const b of baris) {
    if (b.butir.cukupDi) b.status = baris.find((x) => x.butir.kode === b.butir.cukupDi)?.status ?? b.status;
  }

  const statusPerKode = new Map(baris.map((b) => [b.butir.kode, b.status]));
  const langkah = LANGKAH_PENAGIHAN.map((l) => ({
    ...l,
    status: l.ke === 8 ? ("belum" as const) : statusLangkah(l.ke, statusPerKode),
    baris: baris.filter((b) => b.butir.langkah === l.ke),
  }));

  // Progres MARLIN paket sekarang (tertimbang RAB) – pembanding angka konsultan.
  const progresMarlin = lokasiAktif.length
    ? weightedRealizedPct([...(await getLocationsProgress(lokasiAktif.map((l) => l.id))).values()])
    : null;

  const termin = d.termin.find((t) => t.terminKe === terminKe)!;
  const progresKonsultan = d.progres.find((p) => p.terminKe === terminKe)?.tersimpan ?? null;

  return {
    kontrak: k,
    nilaiKontrak: d.nilaiKontrak,
    jadwalBawaan: d.jadwalBawaan,
    daftarTermin: d.termin.map((t) => ({
      terminKe: t.terminKe,
      ambangPct: t.ambangPct,
      jumlahSurat: d.surat.filter((s) => s.terminKe === t.terminKe).length,
    })),
    terminKe,
    termin,
    progresMarlin,
    progresKonsultan,
    /** Minggu prestasi tiap termin yang progres konsultannya sudah diisi. */
    mingguPrestasi: d.progres.flatMap((p) => (p.tersimpan ? [{ terminKe: p.terminKe, mingguKe: p.tersimpan.mingguKe }] : [])),
    lokasiAktif: lokasiAktif.map((l) => l.id),
    /** Tanggal surat penyedia termin ini yang sudah dibuat (DECISIONS 724). */
    tanggalSurat: Object.fromEntries(suratTermin.map((x) => [x.jenis, x.tanggal])) as Partial<Record<JenisSuratPenyedia, Date>>,
    langkah,
    // Butir duplikat (cukup di butir utama) tidak dihitung.
    ringkas: (() => {
      const inti = baris.filter((b) => !b.butir.cukupDi);
      return {
        ada: inti.filter((b) => b.status === "ada").length,
        disiapkan: inti.filter((b) => b.status === "disiapkan_marlin").length,
        menunggu: inti.filter((b) => b.status === "menunggu").length,
        kurang: inti.filter((b) => b.status === "belum_dibuat" || b.status === "belum_diunggah" || b.status === "sebagian").length,
        total: inti.length,
      };
    })(),
  };
}

/**
 * Termin yang sedang diurus: termin terendah yang belum lengkap suratnya.
 * Termin yang lima suratnya sudah dibuat dianggap sedang/sudah diajukan.
 */
function pilihTerminAktif(d: NonNullable<Awaited<ReturnType<typeof muatTerminSurat>>>): number {
  for (const t of d.termin) {
    if (d.surat.filter((s) => s.terminKe === t.terminKe).length < 5) return t.terminKe;
  }
  return d.termin[d.termin.length - 1]?.terminKe ?? 1;
}
