import "server-only";
import { db } from "@/lib/db";
import { analisaAktifLokasi } from "@/lib/rab/rincian/sumber-backup";
import { tandaItem } from "./cocok";

/**
 * ANALISA KONTRAK RAB AKTIF per item (keputusan user 2026-10-06), termasuk
 * yang DIWARISI dari revisi sebelumnya bila harga satuannya sama (DECISIONS
 * baru 2026-10-07) – adendum lewat editor/template tidak membawa sheet analisa.
 *
 * Hanya analisa yang komponennya terurai (ada koefisien) yang dihitung:
 * analisa tanpa komponen tidak menutup jalan ke AHSP maupun AI.
 */
export type AnalisaKontrakItem = {
  kode: string | null;
  uraian: string | null;
  revisionNo: number;
  warisan: boolean;
  komponen: { kategori: string; nama: string; satuan: string | null; koefisien: number; harga: number | null }[];
};

export async function analisaKontrakLokasi(locationId: string): Promise<Map<string, AnalisaKontrakItem>> {
  const sumber = await analisaAktifLokasi(locationId);
  if (sumber.size === 0) return new Map();
  const ids = [...new Set([...sumber.values()].map((s) => s.analisaId))];
  const analisa = await db.rabAnalisa.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      kode: true,
      uraian: true,
      komponen: {
        where: { koefisien: { not: null } },
        orderBy: { urutan: "asc" },
        select: { kategori: true, nama: true, satuan: true, koefisien: true, harga: true },
      },
    },
  });
  const perId = new Map(analisa.filter((a) => a.komponen.length > 0).map((a) => [a.id, a]));
  const hasil = new Map<string, AnalisaKontrakItem>();
  for (const [lk, s] of sumber) {
    const a = perId.get(s.analisaId);
    if (!a) continue;
    hasil.set(lk, {
      kode: a.kode,
      uraian: a.uraian,
      revisionNo: s.revisionNo,
      warisan: s.warisan,
      komponen: a.komponen.map((k) => ({
        kategori: k.kategori,
        nama: k.nama,
        satuan: k.satuan,
        koefisien: Number(k.koefisien),
        harga: k.harga == null ? null : Number(k.harga),
      })),
    });
  }
  return hasil;
}

/**
 * Analisa usulan AI yang sudah DITERIMA orang, per item (DECISIONS baru
 * 2026-10-07). Bukan angka resmi: di layar dan Excel selalu disebut "usulan AI".
 */
export type AnalisaAiItem = {
  usulanId: string;
  komponen: { kategori: string; nama: string; satuan: string; koefisien: number }[];
};

export async function analisaAiDiterima(locationId: string): Promise<Map<string, AnalisaAiItem>> {
  const rows = await db.raplAnalisaAi.findMany({
    where: { locationId, status: "diterima" },
    orderBy: { diputuskanAt: "desc" },
    select: {
      id: true,
      lineageKey: true,
      komponen: { orderBy: { urutan: "asc" }, select: { kategori: true, nama: true, satuan: true, koefisien: true } },
    },
  });
  const hasil = new Map<string, AnalisaAiItem>();
  for (const r of rows) {
    if (hasil.has(r.lineageKey) || r.komponen.length === 0) continue;
    hasil.set(r.lineageKey, {
      usulanId: r.id,
      komponen: r.komponen.map((k) => ({ kategori: k.kategori, nama: k.nama, satuan: k.satuan, koefisien: Number(k.koefisien) })),
    });
  }
  return hasil;
}

/**
 * Analisa AI yang DITERIMA di lokasi mana pun dalam organisasi yang sama,
 * per TANDA uraian (DECISIONS 807). Satu uraian cukup diurai dan diperiksa
 * sekali; RAB berikutnya yang memuat pekerjaan yang sama memakainya.
 * Yang terbaru menang bila ada lebih dari satu.
 */
export type AnalisaAiUraian = AnalisaAiItem & { lokasi: string; locationId: string };

export async function analisaAiOrganisasi(locationId: string, tanda: readonly string[]): Promise<Map<string, AnalisaAiUraian>> {
  const hasil = new Map<string, AnalisaAiUraian>();
  if (tanda.length === 0) return hasil;
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { package: { select: { orgId: true } } } });
  if (!loc) return hasil;
  const orgId = loc.package.orgId;
  // Baris lama (sebelum 807) belum punya tanda: dilengkapi sekali di sini.
  const lama = await db.raplAnalisaAi.findMany({
    where: { tanda: null, status: "diterima", location: { package: { orgId } } },
    select: { id: true, uraian: true, satuan: true },
  });
  for (const r of lama) await db.raplAnalisaAi.update({ where: { id: r.id }, data: { tanda: tandaItem(r.uraian, r.satuan) } });

  const rows = await db.raplAnalisaAi.findMany({
    where: { tanda: { in: [...tanda] }, status: "diterima", location: { package: { orgId } } },
    orderBy: { diputuskanAt: "desc" },
    select: {
      id: true,
      tanda: true,
      locationId: true,
      location: { select: { name: true } },
      komponen: { orderBy: { urutan: "asc" }, select: { kategori: true, nama: true, satuan: true, koefisien: true } },
    },
  });
  for (const r of rows) {
    if (!r.tanda || hasil.has(r.tanda) || r.komponen.length === 0) continue;
    hasil.set(r.tanda, {
      usulanId: r.id,
      lokasi: r.location.name,
      locationId: r.locationId,
      komponen: r.komponen.map((k) => ({ kategori: k.kategori, nama: k.nama, satuan: k.satuan, koefisien: Number(k.koefisien) })),
    });
  }
  return hasil;
}
