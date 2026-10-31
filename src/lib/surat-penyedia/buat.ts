import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import {
  LABEL_JENIS_SURAT,
  TEMPAT_LENGKAPI,
  kekuranganTertaut,
  susunNomor,
  tautanLengkapi,
  teksKekurangan,
} from "./aturan";
import { dataDariKontrak, kunciNomorPerusahaan, nomorUrutBerikut, type KontrakSurat } from "./data";

/**
 * Membuat SATU surat berkop penyedia (DECISIONS 716/717) – dipakai formulir
 * "Buat surat" dan tombol "Siapkan berkas Termin n" (DECISIONS 724), supaya
 * keduanya memeriksa kelengkapan dan menomori dengan cara yang sama persis.
 * Pemanggil yang memastikan kapabilitas `contract.manage` dan kepemilikan kontrak.
 */

export type IsianSurat = {
  kepada: string[];
  lampiran: string[];
  pimpinan?: string;
  peserta?: string[];
  cara?: string;
};

export type KurangTertaut = { teks: string; tempat: string; href: string };

export type HasilBuatSurat =
  | { ok: true; id: string; nomor: string }
  | { ok: false; error: string; judul?: string; kurang?: KurangTertaut[] };

export async function buatSuratPenyedia(
  userId: string,
  kontrak: KontrakSurat,
  input: { jenis: JenisSuratPenyedia; terminKe: number; tanggal: Date; kota: string; nomor: string; isian: IsianSurat },
): Promise<HasilBuatSurat> {
  const { jenis, terminKe, tanggal, kota, isian } = input;
  // Nomor kosong = otomatis dari pola perusahaan; diketik = dipakai apa adanya.
  const pola = kontrak.vendor.polaNomorSurat;
  if (!input.nomor && !pola) {
    return {
      ok: false,
      error: "Isi nomor surat, atau atur pola nomor perusahaan di Data surat supaya nomornya otomatis.",
      kurang: [
        {
          teks: "pola nomor surat perusahaan",
          tempat: TEMPAT_LENGKAPI.rekening,
          href: tautanLengkapi("rekening", { packageId: kontrak.package.id, vendorId: kontrak.vendor.id, terminKe }),
        },
      ],
    };
  }

  // Yang belum lengkap DISEBUT sekarang, bukan baru ketahuan saat diunduh –
  // lengkap dengan tautan langsung ke tempat mengisinya.
  const kurang = kekuranganTertaut(dataDariKontrak(kontrak, { jenis, terminKe, nomor: input.nomor, tanggal, kota, isian }));
  if (kurang.length > 0) {
    return {
      ok: false,
      error: `${LABEL_JENIS_SURAT[jenis]} belum bisa disusun. Lengkapi dulu: ${kurang.map(teksKekurangan).join("; ")}.`,
      judul: `${LABEL_JENIS_SURAT[jenis]} belum bisa disusun. Lengkapi dulu:`,
      kurang: kurang.map((k) => ({
        teks: k.teks,
        tempat: TEMPAT_LENGKAPI[k.tujuan],
        href: tautanLengkapi(k.tujuan, { packageId: kontrak.package.id, vendorId: kontrak.vendor.id, terminKe }),
      })),
    };
  }

  const { s, nomor, nomorUrut } = await db.$transaction(async (tx) => {
    let nomor = input.nomor;
    let nomorUrut: number | null = null;
    if (!nomor) {
      await kunciNomorPerusahaan(tx, kontrak.vendor.id);
      nomorUrut = await nomorUrutBerikut(kontrak.vendor.id, tanggal, tx);
      nomor = susunNomor(pola!, nomorUrut, tanggal);
    }
    const s = await tx.suratPenyedia.create({
      data: { contractId: kontrak.id, jenis, terminKe, nomor, nomorUrut, tanggal, kota, isian, dibuatOlehId: userId },
      select: { id: true },
    });
    return { s, nomor, nomorUrut };
  });

  await audit(userId, "surat_penyedia.buat", "surat_penyedia", s.id, {
    contractId: kontrak.id,
    jenis,
    terminKe,
    nomor,
    otomatis: nomorUrut !== null,
  });
  return { ok: true, id: s.id, nomor };
}
