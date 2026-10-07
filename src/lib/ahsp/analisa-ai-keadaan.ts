import "server-only";
import { db } from "@/lib/db";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { keadaanTunggu } from "@/lib/ai-hub/guard-rules";
import { normalisasiSatuan } from "./cocok";
import { itemTanpaAnalisa } from "./analisa-ai";
import { gabungHarga, hargaDariKontrak } from "./rapl";
import { hitungItemRapl, type HargaSatuan } from "./rapl-calc";
import type { RingkasUsulanAi } from "./usulan-status";

/**
 * Keadaan draf analisa AI satu lokasi untuk layar RAPL (DECISIONS baru
 * 2026-10-07). Perkiraan biaya tiap draf dihitung di `rapl-calc.ts` – fungsi
 * yang sama dengan item yang sudah dihitung – bukan di sini.
 */

export type DrafAnalisaView = {
  id: string;
  lineageKey: string;
  code: string;
  uraian: string;
  satuan: string;
  keyakinan: string;
  alasan: string;
  volume: number | null;
  nilaiRab: bigint;
  komponen: { kategori: string; nama: string; satuan: string; koefisien: number; harga: bigint | null; biaya: bigint | null }[];
  /** Σ biaya komponen berharga untuk volume item. */
  biaya: bigint;
  komponenBelumBerharga: number;
  margin: bigint | null;
  marginPersen: number | null;
};

export type KeadaanAnalisaAi = {
  menunggu: boolean;
  terputus: boolean;
  pendingSinceMs: number | null;
  model: string | null;
  error: string | null;
  diminta: number;
  /** Item yang belum punya cara hitung apa pun, dan nilai RAB-nya. */
  jumlahTanpa: number;
  nilaiTanpa: bigint;
  draf: DrafAnalisaView[];
  diterima: { id: string; lineageKey: string; code: string; uraian: string; komponen: number; pada: Date; oleh: string | null }[];
};

export async function keadaanAnalisaAi(locationId: string): Promise<KeadaanAnalisaAi> {
  const [run, cfg, { tanpa }, draf, diterima, hsd, kontrak] = await Promise.all([
    db.raplAnalisaAiRun.findFirst({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      select: { pendingSince: true, model: true, errorMessage: true, diminta: true },
    }),
    getAiGuardConfig(),
    itemTanpaAnalisa(locationId),
    db.raplAnalisaAi.findMany({
      where: { locationId, status: "draf" },
      orderBy: { createdAt: "desc" },
      include: { komponen: { orderBy: { urutan: "asc" } } },
    }),
    db.raplAnalisaAi.findMany({
      where: { locationId, status: "diterima" },
      orderBy: { diputuskanAt: "desc" },
      select: {
        id: true,
        lineageKey: true,
        code: true,
        uraian: true,
        diputuskanAt: true,
        diputuskanOleh: { select: { fullName: true } },
        _count: { select: { komponen: true } },
      },
    }),
    db.hargaSatuanDasar.findMany({ where: { locationId }, select: { kategori: true, nama: true, satuan: true, harga: true } }),
    hargaDariKontrak(locationId),
  ]);
  const tunggu = keadaanTunggu(run?.pendingSince ?? null, cfg, Date.now());

  // Item RAB aktif untuk draf (volume, nilai) – draf untuk item yang sudah
  // tidak ada di RAB aktif tetap tampil, tanpa angka.
  const aktif = await db.rabRevision.findFirst({ where: { locationId, status: "aktif" }, select: { id: true } });
  const nodes = aktif && draf.length > 0
    ? await db.rabNode.findMany({
        where: { revisionId: aktif.id, lineageKey: { in: draf.map((d) => d.lineageKey) } },
        select: { lineageKey: true, volume: true, amount: true, unit: true },
      })
    : [];
  const perLk = new Map(nodes.map((n) => [n.lineageKey, n]));
  const harga = gabungHarga(hsd as HargaSatuan[], kontrak);
  const biaya = hitungItemRapl(
    draf.flatMap((d) => {
      const n = perLk.get(d.lineageKey);
      if (!n) return [];
      return [
        {
          lineageKey: d.id, // kunci draf, bukan item: satu item bisa punya draf dari dua run
          code: d.code,
          uraian: d.uraian,
          satuanNorm: normalisasiSatuan(n.unit),
          volume: n.volume == null ? null : Number(n.volume),
          amount: n.amount,
          adaUsulan: false,
          analisa: {
            sumber: "ai" as const,
            kode: "Usulan AI",
            uraian: d.uraian,
            satuanNorm: normalisasiSatuan(n.unit),
            komponen: d.komponen.map((k) => ({ kategori: k.kategori, nama: k.nama, satuan: k.satuan, koefisien: Number(k.koefisien) })),
          },
        },
      ];
    }),
    harga,
  );
  const biayaPer = new Map(biaya.map((b) => [b.lineageKey, b]));

  return {
    menunggu: tunggu.menunggu,
    terputus: tunggu.terputus,
    pendingSinceMs: run?.pendingSince ? run.pendingSince.getTime() : null,
    model: run?.model ?? null,
    error: run?.errorMessage ?? null,
    diminta: run?.diminta ?? 0,
    jumlahTanpa: tanpa.length,
    nilaiTanpa: tanpa.reduce((a, t) => a + t.amount, 0n),
    draf: draf.map((d) => {
      const n = perLk.get(d.lineageKey);
      const b = biayaPer.get(d.id);
      const perKomponen = new Map((b?.komponen ?? []).map((k) => [`${k.kategori}|${k.nama}|${k.satuan}`, k]));
      return {
        id: d.id,
        lineageKey: d.lineageKey,
        code: d.code,
        uraian: d.uraian,
        satuan: d.satuan,
        keyakinan: d.keyakinan,
        alasan: d.alasan,
        volume: n?.volume == null ? null : Number(n.volume),
        nilaiRab: n?.amount ?? 0n,
        komponen: d.komponen.map((k) => {
          const kb = perKomponen.get(`${k.kategori}|${k.nama}|${k.satuan}`);
          return {
            kategori: k.kategori,
            nama: k.nama,
            satuan: k.satuan,
            koefisien: Number(k.koefisien),
            harga: kb?.harga ?? null,
            biaya: kb?.biaya ?? null,
          };
        }),
        biaya: b?.biaya ?? 0n,
        komponenBelumBerharga: b?.komponenBelumBerharga ?? d.komponen.length,
        margin: b?.margin ?? null,
        marginPersen: b?.marginPersen ?? null,
      };
    }),
    diterima: diterima.map((d) => ({
      id: d.id,
      lineageKey: d.lineageKey,
      code: d.code,
      uraian: d.uraian,
      komponen: d._count.komponen,
      pada: d.diputuskanAt ?? new Date(0),
      oleh: d.diputuskanOleh?.fullName ?? null,
    })),
  };
}

/** Penengokan MURAH selama menunggu – satu baris run + hitungan draf. */
export async function statusAnalisaAi(locationId: string): Promise<RingkasUsulanAi> {
  const [run, cfg, jumlahDraf] = await Promise.all([
    db.raplAnalisaAiRun.findFirst({ where: { locationId }, orderBy: { createdAt: "desc" }, select: { pendingSince: true } }),
    getAiGuardConfig(),
    db.raplAnalisaAi.count({ where: { locationId, status: "draf" } }),
  ]);
  const tunggu = keadaanTunggu(run?.pendingSince ?? null, cfg, Date.now());
  return { menunggu: tunggu.menunggu, terputus: tunggu.terputus, jumlahDraf };
}
