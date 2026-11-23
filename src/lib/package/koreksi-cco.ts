import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { formatRupiah, formatTanggal, parseDateKey } from "@/lib/format";
import { akhirSebelumAdendum, selisihHari, tambahHari } from "@/lib/progress-calc";

/**
 * KOREKSI CCO (DECISIONS 771). Permintaan user 2026-11-23: *"bagaimana jika aku
 * mencatat cco, tapi kemudian aku salah info, bagaimana mengeditnya?"*
 *
 * Yang bisa dikoreksi hanya ISIAN DOKUMEN: nomor, tanggal berlaku, nilai resmi,
 * perubahan waktu, alasan. Draft RAB/lokasi yang ikut diberlakukan CCO itu
 * TIDAK bisa dilepas lewat sini – itu sudah mengubah RAB, realisasi, dan
 * kurva-S. Versi lama tiap isian disalin trigger basis data ke
 * `contract_amendment_history`; siapa dan alasannya ke audit log.
 */

export class KoreksiCcoError extends Error {}

/** Perubahan waktu: jumlah hari, ATAU tanggal selesai sesudah CCO (DECISIONS 771). */
export type IsianWaktu = { mode: "hari"; hari: number } | { mode: "tanggal"; akhir: Date };

const BATAS_HARI = 3650;

/** Baca isian waktu dari formulir: `waktuMode` + `endDateDelta` atau `akhirBaru`. */
export function bacaIsianWaktu(fd: FormData): IsianWaktu | { error: string } {
  if (fd.get("waktuMode") === "tanggal") {
    const akhir = parseDateKey(String(fd.get("akhirBaru") ?? ""));
    return akhir ? { mode: "tanggal", akhir } : { error: "Isi tanggal selesai pekerjaan sesudah CCO ini." };
  }
  const teks = String(fd.get("endDateDelta") ?? "").trim();
  const hari = teks === "" ? 0 : Number(teks);
  if (!Number.isInteger(hari)) return { error: "Perubahan waktu harus bilangan bulat (hari)." };
  if (Math.abs(hari) > BATAS_HARI) return { error: `Perubahan waktu paling banyak ${BATAS_HARI} hari.` };
  return { mode: "hari", hari };
}

/**
 * Isian waktu → jumlah hari yang disimpan. Tanggal selesai dihitung terhadap
 * akhir kontrak tepat sebelum CCO itu (akhir awal + CCO yang dicatat lebih dulu).
 */
export function hariDariIsian(
  isian: IsianWaktu,
  akhirAwal: Date | null,
  adendum: { endDateDelta: number; createdAt: Date }[],
  dicatatSebelum: Date | null,
): number {
  if (isian.mode === "hari") return isian.hari;
  if (!akhirAwal)
    throw new KoreksiCcoError("Tanggal selesai belum bisa dipakai karena SPMK belum terbit. Isi jumlah harinya saja.");
  const sebelum = akhirSebelumAdendum(akhirAwal, adendum, dicatatSebelum);
  const hari = selisihHari(sebelum, isian.akhir);
  if (Math.abs(hari) > BATAS_HARI) throw new KoreksiCcoError(`Perubahan waktu paling banyak ${BATAS_HARI} hari.`);
  return hari;
}

export type InputKoreksiCco = {
  amendmentId: string;
  ccoNumber: string;
  effectiveDate: Date;
  waktu: IsianWaktu;
  /** null = nilai resmi tidak diubah. */
  valueDelta: bigint | null;
  reason: string;
  alasanKoreksi: string;
};

export type HasilKoreksiCco = { packageId: string; ccoNumber: string; perubahan: string[]; ccoSesudahnya: number };

export async function koreksiCco(input: InputKoreksiCco): Promise<HasilKoreksiCco> {
  const user = await requireCapability("amendment.manage");
  const ccoNumber = input.ccoNumber.trim();
  const reason = input.reason.trim();
  const alasanKoreksi = input.alasanKoreksi.trim();
  if (!ccoNumber) throw new KoreksiCcoError("Nomor CCO wajib diisi.");
  if (reason.length < 5) throw new KoreksiCcoError("Alasan adendum wajib diisi (min 5 karakter).");
  if (alasanKoreksi.length < 5) throw new KoreksiCcoError("Tulis kenapa CCO ini dikoreksi (min 5 karakter).");

  const a = await db.contractAmendment.findFirst({
    where: { id: input.amendmentId, contract: { package: { orgId: user.orgId } } },
    select: {
      id: true,
      ccoNumber: true,
      valueDelta: true,
      endDateDelta: true,
      effectiveDate: true,
      reason: true,
      createdAt: true,
      _count: { select: { scopeChanges: true } },
      contract: {
        select: {
          id: true,
          packageId: true,
          endDate: true,
          amendments: { select: { id: true, endDateDelta: true, createdAt: true } },
        },
      },
    },
  });
  if (!a) throw new KoreksiCcoError("CCO tidak ditemukan.");

  if (ccoNumber !== a.ccoNumber) {
    const kembar = await db.contractAmendment.findFirst({
      where: { contractId: a.contract.id, ccoNumber, id: { not: a.id } },
      select: { id: true },
    });
    if (kembar) throw new KoreksiCcoError(`Nomor "${ccoNumber}" sudah dipakai CCO lain di kontrak ini.`);
  }

  /*
   * Lokasi yang masuk/dicabut lewat CCO ini mengambil tanggal berlakunya saat
   * dicatat – begitu juga kurva-S lokasi yang masuk. Menggeser tanggal CCO saja
   * membuat keduanya berselisih, jadi ditolak dengan sebabnya.
   */
  const tanggalBerubah = input.effectiveDate.getTime() !== a.effectiveDate.getTime();
  if (tanggalBerubah && a._count.scopeChanges > 0)
    throw new KoreksiCcoError(
      "Tanggal berlaku CCO ini tidak bisa diubah: ada lokasi yang masuk atau dicabut lewat CCO ini, dan tanggalnya sudah dipakai lokasi itu.",
    );

  const lain = a.contract.amendments.filter((x) => x.id !== a.id);
  const endDateDelta = hariDariIsian(input.waktu, a.contract.endDate, lain, a.createdAt);
  const valueDelta = input.valueDelta ?? a.valueDelta;

  const perubahan: string[] = [];
  if (ccoNumber !== a.ccoNumber) perubahan.push(`nomor ${a.ccoNumber} → ${ccoNumber}`);
  if (tanggalBerubah)
    perubahan.push(`tanggal berlaku ${formatTanggal(a.effectiveDate)} → ${formatTanggal(input.effectiveDate)}`);
  if (valueDelta !== a.valueDelta) perubahan.push(`nilai ${formatRupiah(a.valueDelta)} → ${formatRupiah(valueDelta)}`);
  if (endDateDelta !== a.endDateDelta) {
    const teks = (n: number) => `${n > 0 ? "+" : ""}${n} hari`;
    let p = `waktu ${teks(a.endDateDelta)} → ${teks(endDateDelta)}`;
    if (a.contract.endDate) {
      const sebelum = akhirSebelumAdendum(a.contract.endDate, lain, a.createdAt);
      p += ` (selesai ${formatTanggal(tambahHari(sebelum, a.endDateDelta))} → ${formatTanggal(tambahHari(sebelum, endDateDelta))})`;
    }
    perubahan.push(p);
  }
  if (reason !== a.reason) perubahan.push("alasan");
  if (perubahan.length === 0) throw new KoreksiCcoError("Tidak ada yang berubah.");

  await db.contractAmendment.update({
    where: { id: a.id },
    data: { ccoNumber, effectiveDate: input.effectiveDate, valueDelta, endDateDelta, reason },
  });
  await audit(user.id, "amendment.koreksi", "package", a.contract.packageId, {
    amendmentId: a.id,
    alasan: alasanKoreksi,
    sebelum: {
      ccoNumber: a.ccoNumber,
      effectiveDate: a.effectiveDate.toISOString().slice(0, 10),
      valueDelta: a.valueDelta.toString(),
      endDateDelta: a.endDateDelta,
      reason: a.reason,
    },
    sesudah: {
      ccoNumber,
      effectiveDate: input.effectiveDate.toISOString().slice(0, 10),
      valueDelta: valueDelta.toString(),
      endDateDelta,
      reason,
    },
  });

  // Hari bersifat menjumlah: CCO yang dicatat sesudahnya ikut bergeser.
  const ccoSesudahnya =
    endDateDelta !== a.endDateDelta ? lain.filter((x) => x.createdAt.getTime() > a.createdAt.getTime()).length : 0;
  return { packageId: a.contract.packageId, ccoNumber, perubahan, ccoSesudahnya };
}
