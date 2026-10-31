import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import type { DocumentType, JenisSuratPenyedia } from "@/generated/prisma/enums";
import { getLocationsProgress } from "@/lib/progress";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { muatTerminSurat } from "@/lib/surat-penyedia/data";
import {
  KATALOG_BERKAS_TERMIN,
  LANGKAH_PENAGIHAN,
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
export type SumberBerkasAda = { dokumenId: string } | { suratId: string } | null;

export type BarisPenagihan = {
  butir: ButirBerkas;
  status: StatusButir;
  /** Berkas yang memenuhi butir ini (dokumen atau surat), untuk tombol "Lihat". */
  rujukan: RujukanBerkas;
  /** Berkas yang sama sebagai id – dipakai "Siapkan berkas termin" (DECISIONS 721). */
  sumber: SumberBerkasAda;
};

export async function muatPenagihan(packageId: string, user: SessionUser, terminDiminta?: number) {
  const d = await muatTerminSurat(packageId, user);
  if (!d) return null;
  const k = d.kontrak;
  const terminKe = d.termin.some((t) => t.terminKe === terminDiminta) ? terminDiminta! : pilihTerminAktif(d);

  const [dokumenPaket, dokumenPerusahaan] = await Promise.all([
    db.document.findMany({
      where: { packageId, status: "aktif" },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, type: true, title: true, terminKe: true, butirTermin: true },
    }),
    // NIB & NPWP milik PERUSAHAAN: diunggah sekali, berlaku di semua paketnya.
    db.document.findMany({
      where: { orgId: user.orgId, status: "aktif", butirTermin: { in: BUTIR_PERUSAHAAN }, contract: { vendorId: k.vendor.id } },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, type: true, title: true, terminKe: true, butirTermin: true },
    }),
  ]);
  const semuaDokumen = [...dokumenPaket, ...dokumenPerusahaan.filter((x) => !dokumenPaket.some((y) => y.id === x.id))];

  const suratTermin = d.surat.filter((s) => s.terminKe === terminKe);
  const keadaan: KeadaanBerkas = {
    surat: new Set<JenisSuratPenyedia>(suratTermin.map((s) => s.jenis)),
    dokumenPaket: new Set<DocumentType>(dokumenPaket.filter((x) => !x.butirTermin).map((x) => x.type)),
    butirTermin: new Set(semuaDokumen.filter((x) => x.terminKe === terminKe && x.butirTermin).map((x) => x.butirTermin!)),
    butirTetap: new Set(semuaDokumen.filter((x) => x.terminKe === null && x.butirTermin).map((x) => x.butirTermin!)),
  };

  const rujukanDokumen = (doc: { id: string; title: string } | undefined): RujukanBerkas =>
    doc ? { judul: doc.title, href: `/api/documents/${doc.id}` } : null;

  const baris: BarisPenagihan[] = KATALOG_BERKAS_TERMIN.map((butir) => {
    const status = statusButir(butir, keadaan);
    let rujukan: RujukanBerkas = null;
    let sumber: SumberBerkasAda = null;
    if (status === "ada") {
      const kode = [butir.kode, ...(butir.juga ?? [])];
      const unggahan = semuaDokumen.find(
        (x) => x.butirTermin && kode.includes(x.butirTermin) && (x.terminKe === terminKe || x.terminKe === null),
      );
      const surat = butir.surat ? suratTermin.find((s) => s.jenis === butir.surat) : undefined;
      const paket = butir.dokumenPaket ? dokumenPaket.find((x) => !x.butirTermin && butir.dokumenPaket!.includes(x.type)) : undefined;
      rujukan = unggahan
        ? rujukanDokumen(unggahan)
        : surat
          ? { judul: `Nomor ${surat.nomor}`, href: `/api/surat-penyedia/${surat.id}/pdf` }
          : rujukanDokumen(paket);
      const doc = unggahan ?? (surat ? undefined : paket);
      sumber = doc ? { dokumenId: doc.id } : surat ? { suratId: surat.id } : null;
    }
    return { butir, status, rujukan, sumber };
  });

  const statusPerKode = new Map(baris.map((b) => [b.butir.kode, b.status]));
  const langkah = LANGKAH_PENAGIHAN.map((l) => ({
    ...l,
    status: l.ke === 8 ? ("belum" as const) : statusLangkah(l.ke, statusPerKode),
    baris: baris.filter((b) => b.butir.langkah === l.ke),
  }));

  // Progres MARLIN paket sekarang (tertimbang RAB) – pembanding angka konsultan.
  const lokasiAktif = k.package.locations.filter((l) => l.isActive).map((l) => l.id);
  const progresMarlin = lokasiAktif.length
    ? weightedRealizedPct([...(await getLocationsProgress(lokasiAktif)).values()])
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
    lokasiAktif,
    langkah,
    ringkas: {
      ada: baris.filter((b) => b.status === "ada").length,
      disiapkan: baris.filter((b) => b.status === "disiapkan_marlin").length,
      menunggu: baris.filter((b) => b.status === "menunggu").length,
      kurang: baris.filter((b) => b.status === "belum_dibuat" || b.status === "belum_diunggah").length,
      total: baris.length,
    },
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
