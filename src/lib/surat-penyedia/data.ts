import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { rincianTagihanTermin } from "@/lib/finance/calc";
import { parseDateKey } from "@/lib/format";
import { getLocationsProgress } from "@/lib/progress";
import { weightedPct } from "@/lib/progress-calc";
import { runningContractValue } from "@/lib/package/queries";
import type { KopSurat } from "@/lib/pdf/surat-penyedia";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import {
  KEPADA_BAWAAN,
  jadwalBerlaku,
  pctSebelum,
  susunNomor,
  tahunSurat,
  type BarisJadwal,
  type DataSurat,
} from "./aturan";
import { bacaProgresLokasi, isianSuratSchema } from "./skema";

/**
 * SURAT BERKOP PENYEDIA – sisi database (DECISIONS 716/717). Uang selalu
 * dihitung ulang dari kontrak berjalan & jadwal termin yang berlaku
 * (`rincianTagihanTermin`), tidak pernah dibaca dari isian surat.
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
  supervisorFirm: true,
  teamLeaderName: true,
  coTeamLeaderName: true,
  bankNama: true,
  bankRekening: true,
  bankAtasNama: true,
  amendments: {
    orderBy: { effectiveDate: "asc" },
    select: { valueDelta: true, ccoNumber: true, effectiveDate: true },
  },
  termin: {
    orderBy: { terminKe: "asc" },
    select: { terminKe: true, ambangPct: true, bayarPct: true, retensiPct: true },
  },
  terminProgres: { select: { terminKe: true, progresPct: true, mingguKe: true, lokasi: true, updatedAt: true } },
  package: {
    select: {
      id: true,
      name: true,
      orgId: true,
      locations: { orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } },
    },
  },
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

export type KontrakSurat = NonNullable<Awaited<ReturnType<typeof muatKontrakSurat>>>;

/** Jadwal termin tersimpan → baris murni (Decimal → number). */
function barisTersimpan(c: Pick<KontrakSurat, "termin">): BarisJadwal[] {
  return c.termin.map((t) => ({
    terminKe: t.terminKe,
    ambangPct: Number(t.ambangPct),
    bayarPct: Number(t.bayarPct),
    retensiPct: Number(t.retensiPct),
  }));
}

/**
 * Konsultan di BA pembahasan kemajuan: firma dari kontrak; yang meneken
 * Co-Team Leader (contoh TERMIN 1: "Ir. Sujoko, Co-Team Leader"), atau Team
 * Leader bila Co-TL kosong. Pengawas lapangan TIDAK dipakai sebagai cadangan –
 * menuliskan dia sebagai penanda tangan BA menyatakan hal yang tidak benar.
 */
function konsultanBa(c: Pick<KontrakSurat, "supervisorFirm" | "coTeamLeaderName" | "teamLeaderName">) {
  const co = c.coTeamLeaderName?.trim();
  const tl = c.teamLeaderName?.trim();
  return {
    firma: c.supervisorFirm?.trim() || null,
    nama: co || tl || null,
    jabatan: co ? "Co-Team Leader" : "Team Leader",
  };
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
  const jadwal = jadwalBerlaku(barisTersimpan(c));
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
    jadwalBawaan: jadwal.bawaan,
    termin: jadwal.baris.map((t) => ({
      ...t,
      ...rincianTagihanTermin(nilaiKontrak, t.bayarPct, pctSebelum(jadwal.baris, t.terminKe), t.retensiPct),
    })),
    konsultan: konsultanBa(c),
    progres: await progresTermin(c, jadwal.baris),
    surat,
    usulanNomor: c.vendor.polaNomorSurat
      ? susunNomor(c.vendor.polaNomorSurat, await nomorUrutBerikut(c.vendor.id, new Date()), new Date())
      : null,
  };
}

/**
 * Progres laporan konsultan per termin + angka MARLIN di sebelahnya. Angka
 * MARLIN tiap lokasi dihitung PER TANGGAL laporan konsultannya (laporan harian
 * yang dikirim s.d. tanggal itu), supaya yang dibandingkan sama hari; lokasi
 * yang belum diisi memakai hari ini.
 */
async function progresTermin(c: KontrakSurat, jadwal: readonly BarisJadwal[]) {
  const lokasiAktif = c.package.locations.filter((l) => l.isActive);
  const ids = lokasiAktif.map((l) => l.id);
  const tersimpan = new Map(c.terminProgres.map((p) => [p.terminKe, p]));

  const tanggal = new Set<string>(["hari-ini"]);
  for (const p of c.terminProgres) for (const l of bacaProgresLokasi(p.lokasi)) tanggal.add(l.tanggal);
  const marlin = new Map<string, Awaited<ReturnType<typeof getLocationsProgress>>>();
  for (const tgl of tanggal) {
    marlin.set(tgl, await getLocationsProgress(ids, tgl === "hari-ini" ? {} : { asOf: parseDateKey(tgl)! }));
  }
  const marlinPada = (tgl: string | null, id: string) => marlin.get(tgl ?? "hari-ini")?.get(id) ?? null;

  return jadwal.map((t) => {
    const p = tersimpan.get(t.terminKe);
    const baris = p ? new Map(bacaProgresLokasi(p.lokasi).map((l) => [l.locationId, l])) : new Map();
    const lokasi = lokasiAktif.map((l) => {
      const b = baris.get(l.id) ?? null;
      const m = marlinPada(b?.tanggal ?? null, l.id);
      return {
        locationId: l.id,
        nama: l.name,
        nomor: b?.nomor ?? "",
        tanggal: b?.tanggal ?? null,
        mingguKe: b?.mingguKe ?? null,
        persen: b?.persen ?? null,
        marlinPct: m?.realizedPct ?? null,
        marlinMinggu: m?.weekNumberElapsed ?? null,
        grandTotal: m?.grandTotal ?? 0n,
      };
    });
    const terisi = lokasi.filter((l) => l.persen !== null);
    return {
      terminKe: t.terminKe,
      ambangPct: t.ambangPct,
      tersimpan: p ? { progresPct: Number(p.progresPct), mingguKe: p.mingguKe, diubah: p.updatedAt } : null,
      lokasi: lokasi.map(({ grandTotal: _g, ...l }) => l),
      // Rata-rata tertimbang (bobot RAB MARLIN) dari angka konsultan per lokasi –
      // pembanding untuk angka keseluruhan yang diketik, bukan penggantinya.
      // Tanpa bobot (lokasi belum ber-RAB) tidak ada rata-rata – bukan "0%".
      tertimbangKonsultan:
        terisi.length === lokasi.length && lokasi.length > 0 && lokasi.every((l) => l.grandTotal > 0n)
          ? weightedPct(terisi.map((l) => ({ grandTotal: l.grandTotal, pct: l.persen! })))
          : null,
    };
  });
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

/** Kontrak beserta semua yang dibutuhkan surat, milik organisasi `orgId`. */
export async function muatKontrakSurat(contractId: string, orgId: string) {
  return db.contract.findFirst({ where: { id: contractId, package: { orgId } }, select: pilihKontrak });
}

/** Ambang termin `terminKe` di jadwal yang berlaku; null bila terminnya tidak ada. */
export async function ambangTermin(contractId: string, terminKe: number): Promise<number | null> {
  const termin = await db.contractTermin.findMany({ where: { contractId }, ...pilihKontrak.termin });
  return jadwalBerlaku(barisTersimpan({ termin })).baris.find((t) => t.terminKe === terminKe)?.ambangPct ?? null;
}

/** Termin `terminKe` ada di jadwal yang berlaku (tersimpan atau bawaan KKP)? */
export function terminAda(c: KontrakSurat, terminKe: number): boolean {
  return jadwalBerlaku(barisTersimpan(c)).baris.some((t) => t.terminKe === terminKe);
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
  // Kontrak PER TANGGAL SURAT: adendum yang berlaku sesudahnya tidak ikut, supaya
  // surat lama yang diunduh ulang tetap sama isinya (DECISIONS 719). Nomor
  // adendum = urutannya di antara SEMUA adendum kontrak.
  const adendum = c.amendments
    .map((a, i) => ({ ...a, ke: i + 1 }))
    .filter((a) => a.effectiveDate.getTime() <= s.tanggal.getTime());
  const nilaiKontrak = runningContractValue(c.contractValue, adendum);
  const jadwal = jadwalBerlaku(barisTersimpan(c)).baris;
  const t = jadwal.find((x) => x.terminKe === s.terminKe);
  const rincian = t
    ? rincianTagihanTermin(nilaiKontrak, t.bayarPct, pctSebelum(jadwal, t.terminKe), t.retensiPct)
    : { bruto: 0n, retensi: 0n, dibayar: 0n };

  const p = c.terminProgres.find((x) => x.terminKe === s.terminKe);
  const namaLokasi = new Map(c.package.locations.map((l) => [l.id, l.name]));
  const progres = p
    ? {
        pct: Number(p.progresPct),
        mingguKe: p.mingguKe,
        lokasi: bacaProgresLokasi(p.lokasi).flatMap((l) => {
          const nama = namaLokasi.get(l.locationId);
          return nama
            ? [{ nama, nomor: l.nomor, tanggal: parseDateKey(l.tanggal)!, mingguKe: l.mingguKe, persen: l.persen }]
            : [];
        }),
      }
    : null;

  return {
    jenis: s.jenis,
    penyedia: { nama: c.vendor.name, npwp: c.vendor.npwp },
    penandaTangan: { nama: c.contractorSignerName ?? "", jabatan: c.contractorSignerTitle ?? "Direktur" },
    kontrak: {
      nomor: c.contractNumber,
      tanggal: c.signedDate,
      judul: c.workTitle?.trim() || c.package.name,
      nilai: nilaiKontrak,
      adendum: adendum.map((a) => ({ ke: a.ke, nomor: a.ccoNumber, tanggal: a.effectiveDate })),
    },
    bank:
      c.bankNama && c.bankRekening && c.bankAtasNama
        ? { nama: c.bankNama, rekening: c.bankRekening, atasNama: c.bankAtasNama }
        : null,
    termin: {
      ke: s.terminKe,
      ambangPct: t?.ambangPct ?? 0,
      bayarPct: t?.bayarPct ?? 0,
      retensiPct: t?.retensiPct ?? 0,
      bruto: rincian.bruto,
      retensi: rincian.retensi,
      nilai: rincian.dibayar,
    },
    progres,
    konsultan: konsultanBa(c),
    surat: {
      nomor: s.nomor,
      tanggal: s.tanggal,
      kota: s.kota,
      kepada: isian.kepada.length > 0 ? isian.kepada : KEPADA_BAWAAN,
      lampiran: isian.lampiran,
      rapat: { pimpinan: isian.pimpinan, peserta: isian.peserta, cara: isian.cara },
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
