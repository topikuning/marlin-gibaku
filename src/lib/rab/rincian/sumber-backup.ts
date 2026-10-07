import "server-only";
import { db } from "@/lib/db";
import {
  ringkasBackup,
  selesaikanAnalisa,
  selesaikanBackup,
  type RevisiAnalisa,
  type RevisiBackup,
  type RingkasBackup,
  type SumberAnalisa,
  type SumberBackup,
} from "./warisan";

/**
 * Sumber backup volume & analisa tiap item satu revisi, lewat rantai revisi
 * lokasinya (aturannya di `warisan.ts`). Rantai = revisi yang pernah BERLAKU
 * (aktif / digantikan) bernomor lebih kecil, ditambah revisi yang diminta
 * (boleh draft).
 */
async function rantaiRevisi(revisionId: string) {
  const target = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { id: true, locationId: true, revisionNo: true },
  });
  const rantai = await db.rabRevision.findMany({
    where: {
      locationId: target.locationId,
      OR: [{ id: target.id }, { revisionNo: { lt: target.revisionNo }, status: { in: ["aktif", "digantikan"] } }],
    },
    select: { id: true, revisionNo: true, sourceDocumentId: true, rincian: { select: { revisionId: true } } },
  });
  return { target, rantai, ids: rantai.map((r) => r.id) };
}

const kunci = (r: string, l: string) => `${r} ${l}`;

export async function sumberBackupRevisi(revisionId: string): Promise<{
  peta: Map<string, SumberBackup>;
  ringkas: RingkasBackup;
}> {
  const { target, rantai, ids } = await rantaiRevisi(revisionId);
  const [nodes, berkas, isian] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: { in: ids }, kind: "item" },
      select: { revisionId: true, lineageKey: true, volume: true },
    }),
    db.rabBackupVolume.findMany({
      where: { revisionId: { in: ids } },
      select: { revisionId: true, lineageKey: true, status: true },
    }),
    db.rabBackupIsian.findMany({
      where: { revisionId: { in: ids } },
      select: { revisionId: true, lineageKey: true },
      distinct: ["revisionId", "lineageKey"],
    }),
  ]);
  const statusBerkas = new Map(berkas.map((b) => [kunci(b.revisionId, b.lineageKey), b.status]));
  const adaIsian = new Set(isian.map((i) => kunci(i.revisionId, i.lineageKey)));
  const perRevisi = new Map<string, RevisiBackup>(
    rantai.map((r) => [
      r.id,
      { id: r.id, revisionNo: r.revisionNo, punyaRincian: r.rincian != null, punyaBerkas: r.sourceDocumentId != null, items: new Map() },
    ]),
  );
  for (const n of nodes) {
    perRevisi.get(n.revisionId)!.items.set(n.lineageKey, {
      volume: n.volume == null ? null : n.volume.toString(),
      berkas: statusBerkas.get(kunci(n.revisionId, n.lineageKey)) ?? null,
      isian: adaIsian.has(kunci(n.revisionId, n.lineageKey)),
    });
  }
  const peta = selesaikanBackup([...perRevisi.values()]).get(target.id) ?? new Map();
  return { peta, ringkas: ringkasBackup(peta) };
}

/** Analisa tiap item revisi ini – miliknya sendiri, atau diwarisi bila harga satuannya sama. */
export async function analisaRevisi(revisionId: string): Promise<Map<string, SumberAnalisa>> {
  const { target, rantai, ids } = await rantaiRevisi(revisionId);
  const [nodes, punya] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: { in: ids }, kind: "item" },
      select: { revisionId: true, lineageKey: true, unitPrice: true },
    }),
    db.rabItemAnalisa.findMany({
      where: { revisionId: { in: ids } },
      select: { revisionId: true, lineageKey: true, analisaId: true, cara: true },
    }),
  ]);
  const milik = new Map(punya.map((p) => [kunci(p.revisionId, p.lineageKey), p]));
  const perRevisi = new Map<string, RevisiAnalisa>(rantai.map((r) => [r.id, { id: r.id, revisionNo: r.revisionNo, items: new Map() }]));
  for (const n of nodes) {
    const m = milik.get(kunci(n.revisionId, n.lineageKey));
    perRevisi.get(n.revisionId)!.items.set(n.lineageKey, {
      harga: n.unitPrice == null ? null : n.unitPrice.toString(),
      analisaId: m?.analisaId ?? null,
      cara: m?.cara ?? null,
    });
  }
  return selesaikanAnalisa([...perRevisi.values()]).get(target.id) ?? new Map();
}

/** Analisa kontrak RAB AKTIF satu lokasi (dengan pewarisan). Kosong bila belum ada RAB aktif. */
export async function analisaAktifLokasi(locationId: string): Promise<Map<string, SumberAnalisa>> {
  const aktif = await db.rabRevision.findFirst({ where: { locationId, status: "aktif" }, select: { id: true } });
  return aktif ? analisaRevisi(aktif.id) : new Map();
}
