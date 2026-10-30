import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { nilaiTagihanTermin } from "@/lib/finance/calc";
import { runningContractValue } from "@/lib/package/queries";
import type { KopSurat } from "@/lib/pdf/surat-penyedia";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import { KEPADA_BAWAAN, susunNomor, tahunSurat, type DataSurat } from "./aturan";
import { isianSuratSchema } from "./skema";

/**
 * SURAT BERKOP PENYEDIA – sisi database (DECISIONS 716). Uang selalu dihitung
 * ulang dari kontrak berjalan & jadwal termin (`nilaiTagihanTermin`), tidak
 * pernah dibaca dari isian surat.
 */

const pilihKontrak = {
  id: true,
  contractNumber: true,
  workTitle: true,
  contractValue: true,
  signedDate: true,
  advancePercent: true,
  retentionPercent: true,
  contractorSignerName: true,
  contractorSignerTitle: true,
  bankNama: true,
  bankRekening: true,
  bankAtasNama: true,
  amendments: { select: { valueDelta: true } },
  termin: { orderBy: { terminKe: "asc" }, select: { terminKe: true, ambangPct: true, bayarPct: true } },
  package: { select: { id: true, name: true, orgId: true } },
  vendor: {
    select: {
      id: true,
      name: true,
      npwp: true,
      address: true,
      phone: true,
      email: true,
      logoKey: true,
      kopKey: true,
      polaNomorSurat: true,
      kotaSurat: true,
    },
  },
} as const;

/** Jumlah persen bayar termin-termin SEBELUM `terminKe` – dasar pembulatan kumulatif. */
function pctSebelum(termin: readonly { terminKe: number; bayarPct: unknown }[], terminKe: number): number {
  return termin.filter((t) => t.terminKe < terminKe).reduce((s, t) => s + Number(t.bayarPct), 0);
}

/** Data halaman Termin & Surat satu paket; null bila paket tak terlihat/ belum berkontrak. */
export async function muatTerminSurat(packageId: string, user: SessionUser) {
  const scoped = await accessibleLocationIds(user);
  const pkg = await db.package.findFirst({
    where: { id: packageId, ...packageScopeWhere(user, scoped) },
    select: { id: true, contract: { select: { ...pilihKontrak } } },
  });
  if (!pkg?.contract) return null;
  const c = pkg.contract;
  const nilaiKontrak = runningContractValue(c.contractValue, c.amendments);
  const surat = await db.suratPenyedia.findMany({
    where: { contractId: c.id },
    orderBy: [{ terminKe: "asc" }, { tanggal: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      jenis: true,
      terminKe: true,
      nomor: true,
      tanggal: true,
      kota: true,
      createdAt: true,
      dibuatOleh: { select: { fullName: true } },
    },
  });
  return {
    kontrak: c,
    nilaiKontrak,
    termin: c.termin.map((t) => ({
      terminKe: t.terminKe,
      ambangPct: Number(t.ambangPct),
      bayarPct: Number(t.bayarPct),
      nilai: nilaiTagihanTermin(nilaiKontrak, Number(t.bayarPct), pctSebelum(c.termin, t.terminKe)),
    })),
    surat,
    usulanNomor: c.vendor.polaNomorSurat
      ? susunNomor(c.vendor.polaNomorSurat, await nomorUrutBerikut(c.vendor.id, new Date()), new Date())
      : null,
  };
}

type Klien = Pick<typeof db, "suratPenyedia">;

/**
 * Nomor urut berikutnya di pola perusahaan untuk TAHUN surat itu (WIB). Yang
 * memberi nomor surat sungguhan memanggilnya di dalam transaksi berkunci
 * `kunciNomorPerusahaan`, supaya dua surat serentak tidak berbagi nomor.
 */
export async function nomorUrutBerikut(vendorId: string, tanggal: Date, klien: Klien = db): Promise<number> {
  const tahun = tahunSurat(tanggal);
  const awal = new Date(`${tahun}-01-01T00:00:00.000Z`);
  const akhir = new Date(`${tahun + 1}-01-01T00:00:00.000Z`);
  const r = await klien.suratPenyedia.aggregate({
    where: { contract: { vendorId }, nomorUrut: { not: null }, tanggal: { gte: awal, lt: akhir } },
    _max: { nomorUrut: true },
  });
  return (r._max.nomorUrut ?? 0) + 1;
}

/** Kunci transaksi per perusahaan untuk pemberian nomor surat otomatis. */
export async function kunciNomorPerusahaan(tx: Pick<typeof db, "$executeRaw">, vendorId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`surat-penyedia:${vendorId}`}::text, 0))`;
}

type KontrakSurat = NonNullable<Awaited<ReturnType<typeof muatKontrakSurat>>>;

/** Kontrak beserta semua yang dibutuhkan surat, milik organisasi `orgId`. */
export async function muatKontrakSurat(contractId: string, orgId: string) {
  return db.contract.findFirst({ where: { id: contractId, package: { orgId } }, select: pilihKontrak });
}

/**
 * Data surat dari kontrak + isian – dipakai SEBELUM surat disimpan (memeriksa
 * kelengkapan) dan saat surat tersimpan diunduh, supaya keduanya sama persis.
 */
export function dataDariKontrak(
  c: KontrakSurat,
  s: { jenis: JenisSuratPenyedia; terminKe: number; nomor: string; tanggal: Date; kota: string; isian: unknown },
): DataSurat {
  const isian = isianSuratSchema.parse(s.isian ?? {});
  const nilaiKontrak = runningContractValue(c.contractValue, c.amendments);
  const termin = c.termin.find((t) => t.terminKe === s.terminKe);
  const bayarPct = termin ? Number(termin.bayarPct) : 0;
  return {
    jenis: s.jenis,
    penyedia: { nama: c.vendor.name, npwp: c.vendor.npwp },
    penandaTangan: { nama: c.contractorSignerName ?? "", jabatan: c.contractorSignerTitle ?? "Direktur" },
    kontrak: {
      nomor: c.contractNumber,
      tanggal: c.signedDate,
      judul: c.workTitle?.trim() || c.package.name,
      nilai: nilaiKontrak,
    },
    bank:
      c.bankNama && c.bankRekening && c.bankAtasNama
        ? { nama: c.bankNama, rekening: c.bankRekening, atasNama: c.bankAtasNama }
        : null,
    termin: { ke: s.terminKe, bayarPct, nilai: nilaiTagihanTermin(nilaiKontrak, bayarPct, pctSebelum(c.termin, s.terminKe)) },
    surat: {
      nomor: s.nomor,
      tanggal: s.tanggal,
      kota: s.kota,
      kepada: isian.kepada.length > 0 ? isian.kepada : KEPADA_BAWAAN,
      lampiran: isian.lampiran,
    },
  };
}

/** Susun data satu surat tersimpan – siap digambar PDF/Word. */
export async function dataSuratTersimpan(suratId: string, orgId: string): Promise<{ data: DataSurat; kop: KopSurat } | null> {
  const s = await db.suratPenyedia.findFirst({
    where: { id: suratId, contract: { package: { orgId } } },
    select: { jenis: true, terminKe: true, nomor: true, tanggal: true, kota: true, isian: true, contract: { select: pilihKontrak } },
  });
  if (!s) return null;
  return { data: dataDariKontrak(s.contract, s), kop: await muatKop(s.contract.vendor) };
}

async function muatKop(v: {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoKey: string | null;
  kopKey: string | null;
}): Promise<KopSurat> {
  const { ambilBerkas } = await import("@/lib/penyimpanan/berkas");
  const ambil = async (key: string | null) => {
    if (!key) return null;
    try {
      return await ambilBerkas(key);
    } catch (err) {
      console.error("[surat-penyedia] gambar kop/logo tidak terbaca:", err);
      return null;
    }
  };
  return {
    gambar: await ambil(v.kopKey),
    logo: await ambil(v.logoKey),
    nama: v.name,
    alamat: v.address,
    telepon: v.phone,
    email: v.email,
  };
}
