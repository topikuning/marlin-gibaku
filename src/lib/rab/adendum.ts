import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { valueDone } from "@/lib/money";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { VOLUME_EPSILON } from "@/lib/daily-report/constants";
import type { Prisma } from "@/generated/prisma/client";

/**
 * EDITOR DRAFT ADENDUM RAB — ubah RAB dari aplikasi, bukan hanya lewat Excel.
 *
 * Model proses (Perpres 16/2018 Pasal 54; keputusan user 29 Juli 2026):
 * - Semua editan terjadi pada REVISI DRAFT salinan dari revisi aktif. Angka
 *   live (progres, kurva, laporan) tidak tersentuh sampai draft diaktifkan
 *   lewat mesin yang sudah ada (`activateRevision` → regenerate baseline).
 * - Item LAMA: harga satuan TERKUNCI (harga kontrak tetap); hanya volume yang
 *   boleh berubah, dan tidak boleh di bawah volume yang SUDAH terealisasi.
 * - Item BARU / kategori BARU (bangunan baru): bebas ditambah; lineageKey baru.
 * - HAPUS: hanya node tanpa realisasi. Jejaknya tidak hilang — revisi lama
 *   tetap utuh (append-only) dan `diffRevisions` menampilkan item yang dibuang.
 * - Setiap mutasi ditulis SEATURAN dengan auditnya (auditIn, AUDIT-01).
 *
 * Semua total (amount item, agregat kategori/sub/grup, totalValue revisi)
 * SELALU dihitung ulang penuh dari daun — tidak pernah diedit langsung
 * (prinsip #4 CLAUDE.md). RAB terbesar korpus ~2.200 node; recompute penuh
 * per mutasi murah dan bebas drift.
 */

export class AdendumError extends Error {}

const EPS = VOLUME_EPSILON;

type Tx = Prisma.TransactionClient;

/** Draft milik lokasi + masih draft — semua mutasi editor lewat sini. */
async function requireDraft(tx: Tx, revisionId: string) {
  const rev = await tx.rabRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, locationId: true, status: true, revisionNo: true },
  });
  if (!rev) throw new AdendumError("Revisi tidak ditemukan.");
  if (rev.status !== "draft") {
    throw new AdendumError(`Revisi #${rev.revisionNo} bukan draft — editan hanya untuk draft.`);
  }
  return rev;
}

/**
 * Hitung ulang SEMUA amount agregat dari daun (bottom-up) + totalValue revisi.
 * Item: amount = round(volume × hargaSatuan). Non-item: Σ amount anak.
 */
async function recomputeTotals(tx: Tx, revisionId: string): Promise<bigint> {
  const nodes = await tx.rabNode.findMany({
    where: { revisionId },
    select: { id: true, parentId: true, kind: true, volume: true, unitPrice: true, amount: true },
  });
  const children = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const arr = children.get(n.parentId) ?? [];
    arr.push(n);
    children.set(n.parentId, arr);
  }
  const computed = new Map<string, bigint>();
  const compute = (n: (typeof nodes)[number]): bigint => {
    if (n.kind === "item") {
      const v = n.volume != null ? Number(n.volume) : 0;
      const p = n.unitPrice != null ? Number(n.unitPrice) : 0;
      const a = valueDone(v, p);
      computed.set(n.id, a);
      return a;
    }
    const sum = (children.get(n.id) ?? []).reduce((s, c) => s + compute(c), 0n);
    computed.set(n.id, sum);
    return sum;
  };
  const roots = children.get(null) ?? [];
  const total = roots.reduce((s, r) => s + compute(r), 0n);

  const changed = nodes.filter((n) => computed.get(n.id)! !== n.amount);
  for (const n of changed) {
    await tx.rabNode.update({ where: { id: n.id }, data: { amount: computed.get(n.id)! } });
  }
  await tx.rabRevision.update({ where: { id: revisionId }, data: { totalValue: total } });
  return total;
}

/**
 * Buat REVISI DRAFT baru sebagai salinan penuh revisi aktif (lineageKey ikut
 * disalin → identitas item nyambung). Satu lokasi hanya boleh punya satu draft.
 */
export async function createAdendumDraft(
  locationId: string,
  userId: string,
  opts: { amendmentId?: string | null; note?: string | null } = {},
): Promise<{ revisionId: string; revisionNo: number }> {
  return db.$transaction(async (tx) => {
    const existingDraft = await tx.rabRevision.findFirst({
      where: { locationId, status: "draft" },
      select: { revisionNo: true },
    });
    if (existingDraft) {
      throw new AdendumError(
        `Masih ada draft revisi #${existingDraft.revisionNo} — aktifkan atau buang dulu sebelum membuat draft baru.`,
      );
    }
    const active = await tx.rabRevision.findFirst({
      where: { locationId, status: "aktif" },
      select: { id: true, totalValue: true },
    });
    if (!active) throw new AdendumError("Belum ada revisi RAB aktif untuk disalin.");

    const maxRev = await tx.rabRevision.aggregate({ where: { locationId }, _max: { revisionNo: true } });
    const revisionNo = (maxRev._max.revisionNo ?? 0) + 1;
    const draft = await tx.rabRevision.create({
      data: {
        locationId,
        revisionNo,
        source: "adendum",
        amendmentId: opts.amendmentId ?? null,
        status: "draft",
        totalValue: active.totalValue,
        note: opts.note ?? null,
        createdById: userId,
      },
    });

    // Salin node per-level supaya parentId baru terpetakan.
    const nodes = await tx.rabNode.findMany({
      where: { revisionId: active.id },
      orderBy: { sortOrder: "asc" },
    });
    const newIdByOldId = new Map<string, string>();
    const pending = [...nodes];
    while (pending.length > 0) {
      const batch = pending.filter((n) => n.parentId === null || newIdByOldId.has(n.parentId));
      if (batch.length === 0) throw new AdendumError("Struktur RAB aktif tidak konsisten (orphan node).");
      const created = await tx.rabNode.createManyAndReturn({
        data: batch.map((n) => ({
          revisionId: draft.id,
          parentId: n.parentId ? newIdByOldId.get(n.parentId)! : null,
          kind: n.kind,
          code: n.code,
          name: n.name,
          volume: n.volume,
          unit: n.unit,
          unitPrice: n.unitPrice,
          amount: n.amount,
          lineageKey: n.lineageKey,
          sortOrder: n.sortOrder,
        })),
        select: { id: true, lineageKey: true },
      });
      const byLineage = new Map(created.map((c) => [c.lineageKey, c.id]));
      for (const b of batch) {
        newIdByOldId.set(b.id, byLineage.get(b.lineageKey)!);
        pending.splice(pending.indexOf(b), 1);
      }
    }

    await auditIn(tx, userId, "rab.adendum_draft_create", "rab_revision", draft.id, {
      locationId,
      revisionNo,
      copiedFrom: active.id,
      amendmentId: opts.amendmentId ?? null,
      nodeCount: nodes.length,
    });
    return { revisionId: draft.id, revisionNo };
  });
}

/**
 * Ubah VOLUME satu item draft. Harga satuan item lama TIDAK bisa diubah dari
 * sini — memang tidak ada jalurnya (harga kontrak tetap, Perpres 16/2018).
 * Volume baru minimal = volume yang sudah terealisasi di lapangan.
 */
export async function updateDraftItemVolume(
  revisionId: string,
  nodeId: string,
  volume: number,
  userId: string,
): Promise<{ totalValue: bigint }> {
  if (!Number.isFinite(volume) || volume < 0) throw new AdendumError("Volume tidak valid.");
  const v = Math.round(volume * 1000) / 1000; // presisi Decimal(15,3)

  return db.$transaction(async (tx) => {
    const rev = await requireDraft(tx, revisionId);
    const node = await tx.rabNode.findUnique({
      where: { id: nodeId },
      select: { id: true, revisionId: true, kind: true, name: true, volume: true, lineageKey: true },
    });
    if (!node || node.revisionId !== revisionId) throw new AdendumError("Item tidak ditemukan di draft ini.");
    if (node.kind !== "item") throw new AdendumError("Hanya item pekerjaan yang volumenya bisa diubah.");

    const realized = (await cumulativeVolumeByLineage(rev.locationId)).get(node.lineageKey) ?? 0;
    if (v + EPS < realized) {
      throw new AdendumError(
        `Volume ${node.name} tidak boleh di bawah realisasi tercatat (${realized}). ` +
          `Pekerjaan-kurang atas item berjalan maksimal sampai volume terealisasi.`,
      );
    }

    const volumeLama = node.volume != null ? Number(node.volume) : 0;
    await tx.rabNode.update({ where: { id: nodeId }, data: { volume: v } });
    const totalValue = await recomputeTotals(tx, revisionId);
    await auditIn(tx, userId, "rab.adendum_volume_update", "rab_node", nodeId, {
      revisionId,
      lineageKey: node.lineageKey,
      volumeLama,
      volumeBaru: v,
    });
    return { totalValue };
  });
}

/** Kunci lineage unik dalam draft: dasar `${parent}#${code}`, suffix bila tabrakan. */
async function uniqueLineage(tx: Tx, revisionId: string, base: string): Promise<string> {
  const existing = new Set(
    (
      await tx.rabNode.findMany({ where: { revisionId }, select: { lineageKey: true } })
    ).map((n) => n.lineageKey),
  );
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}~${i}`;
    if (!existing.has(cand)) return cand;
  }
  throw new AdendumError("Gagal membuat kunci lineage unik.");
}

/**
 * Tambah ITEM BARU di bawah kategori/sub/grup. Item baru = pekerjaan baru hasil
 * negosiasi (harga satuannya bebas — bukan harga kontrak lama).
 */
export async function addDraftItem(
  revisionId: string,
  parentId: string,
  input: { code: string; name: string; unit: string | null; volume: number; unitPrice: number },
  userId: string,
): Promise<{ nodeId: string; totalValue: bigint }> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw new AdendumError("Kode dan nama item wajib diisi.");
  if (!Number.isFinite(input.volume) || input.volume <= 0) throw new AdendumError("Volume harus lebih dari 0.");
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) throw new AdendumError("Harga satuan tidak valid.");
  const volume = Math.round(input.volume * 1000) / 1000;
  const unitPrice = Math.round(input.unitPrice * 100) / 100;

  return db.$transaction(async (tx) => {
    await requireDraft(tx, revisionId);
    const parent = await tx.rabNode.findUnique({
      where: { id: parentId },
      select: { id: true, revisionId: true, kind: true, lineageKey: true },
    });
    if (!parent || parent.revisionId !== revisionId) throw new AdendumError("Induk tidak ditemukan di draft ini.");
    if (parent.kind === "item") throw new AdendumError("Item tidak bisa menjadi induk item lain.");

    const maxSort = await tx.rabNode.aggregate({ where: { revisionId }, _max: { sortOrder: true } });
    const lineageKey = await uniqueLineage(tx, revisionId, `${parent.lineageKey}#${code}`);
    const node = await tx.rabNode.create({
      data: {
        revisionId,
        parentId,
        kind: "item",
        code,
        name,
        unit: input.unit?.trim() || null,
        volume,
        unitPrice,
        amount: valueDone(volume, unitPrice),
        lineageKey,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });
    const totalValue = await recomputeTotals(tx, revisionId);
    await auditIn(tx, userId, "rab.adendum_item_add", "rab_node", node.id, {
      revisionId,
      lineageKey,
      name,
      volume,
      unitPrice,
    });
    return { nodeId: node.id, totalValue };
  });
}

/** Tambah KATEGORI baru (bangunan/unit baru) di akar draft. */
export async function addDraftKategori(
  revisionId: string,
  input: { code: string; name: string },
  userId: string,
): Promise<{ nodeId: string }> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw new AdendumError("Kode dan nama kategori wajib diisi.");

  return db.$transaction(async (tx) => {
    await requireDraft(tx, revisionId);
    const maxSort = await tx.rabNode.aggregate({ where: { revisionId }, _max: { sortOrder: true } });
    const lineageKey = await uniqueLineage(tx, revisionId, code);
    const node = await tx.rabNode.create({
      data: {
        revisionId,
        parentId: null,
        kind: "kategori",
        code,
        name,
        amount: 0n,
        lineageKey,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });
    await auditIn(tx, userId, "rab.adendum_kategori_add", "rab_node", node.id, { revisionId, lineageKey, name });
    return { nodeId: node.id };
  });
}

/**
 * Hapus node draft (item, atau cabang beserta seluruh anaknya).
 * DITOLAK bila node — atau salah satu turunannya — punya realisasi tercatat:
 * bukti lapangan tidak boleh kehilangan induk RAB-nya. Pekerjaan-kurang atas
 * item berjalan = kecilkan volumenya sampai = realisasi, bukan hapus.
 * Jejak penghapusan: audit log + item tetap terlihat di diff vs revisi lama.
 */
export async function removeDraftNode(
  revisionId: string,
  nodeId: string,
  userId: string,
): Promise<{ totalValue: bigint; removedItems: number }> {
  return db.$transaction(async (tx) => {
    const rev = await requireDraft(tx, revisionId);
    const all = await tx.rabNode.findMany({
      where: { revisionId },
      select: { id: true, parentId: true, kind: true, name: true, lineageKey: true },
    });
    const byId = new Map(all.map((n) => [n.id, n]));
    const target = byId.get(nodeId);
    if (!target) throw new AdendumError("Node tidak ditemukan di draft ini.");

    // Kumpulkan subtree.
    const childrenOf = new Map<string, string[]>();
    for (const n of all) {
      if (n.parentId) {
        const arr = childrenOf.get(n.parentId) ?? [];
        arr.push(n.id);
        childrenOf.set(n.parentId, arr);
      }
    }
    const subtree: string[] = [];
    const stack = [nodeId];
    while (stack.length) {
      const id = stack.pop()!;
      subtree.push(id);
      for (const c of childrenOf.get(id) ?? []) stack.push(c);
    }

    const realized = await cumulativeVolumeByLineage(rev.locationId);
    const items = subtree.map((id) => byId.get(id)!).filter((n) => n.kind === "item");
    const blocked = items.find((n) => (realized.get(n.lineageKey) ?? 0) > EPS);
    if (blocked) {
      throw new AdendumError(
        `"${blocked.name}" punya realisasi tercatat — tidak bisa dihapus. ` +
          `Kecilkan volumenya sampai sama dengan realisasi (pekerjaan-kurang).`,
      );
    }

    // Hapus daun → akar supaya FK parent tidak menghalangi.
    for (const id of [...subtree].reverse()) {
      await tx.rabNode.delete({ where: { id } });
    }
    const totalValue = await recomputeTotals(tx, revisionId);
    await auditIn(tx, userId, "rab.adendum_node_remove", "rab_node", nodeId, {
      revisionId,
      lineageKey: target.lineageKey,
      name: target.name,
      kind: target.kind,
      removedItems: items.length,
    });
    return { totalValue, removedItems: items.length };
  });
}

// ── Diff dua revisi (jejak perubahan; dipakai review & aktivasi) ─────────────

export type DiffItem = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volumeLama: number | null;
  volumeBaru: number | null;
  hargaSatuan: number | null;
  amountLama: bigint;
  amountBaru: bigint;
};

export type RevisionDiff = {
  ditambah: DiffItem[];
  dihapus: DiffItem[];
  diubah: DiffItem[];
  totalLama: bigint;
  totalBaru: bigint;
  delta: bigint;
};

/**
 * Bandingkan dua revisi PER ITEM lewat lineageKey. Item yang dihapus tetap
 * terlihat di sini — revisi lama append-only, jadi jejaknya permanen.
 */
export async function diffRevisions(oldRevisionId: string, newRevisionId: string): Promise<RevisionDiff> {
  const [oldRev, newRev] = await Promise.all([
    db.rabRevision.findUniqueOrThrow({ where: { id: oldRevisionId }, select: { totalValue: true } }),
    db.rabRevision.findUniqueOrThrow({ where: { id: newRevisionId }, select: { totalValue: true } }),
  ]);
  const fetchItems = (revisionId: string) =>
    db.rabNode.findMany({
      where: { revisionId, kind: "item" },
      select: { lineageKey: true, code: true, name: true, unit: true, volume: true, unitPrice: true, amount: true },
      orderBy: { sortOrder: "asc" },
    });
  const [oldItems, newItems] = await Promise.all([fetchItems(oldRevisionId), fetchItems(newRevisionId)]);
  const oldByKey = new Map(oldItems.map((n) => [n.lineageKey, n]));
  const newByKey = new Map(newItems.map((n) => [n.lineageKey, n]));

  const ditambah: DiffItem[] = [];
  const dihapus: DiffItem[] = [];
  const diubah: DiffItem[] = [];

  for (const n of newItems) {
    const o = oldByKey.get(n.lineageKey);
    const volumeBaru = n.volume != null ? Number(n.volume) : null;
    const harga = n.unitPrice != null ? Number(n.unitPrice) : null;
    if (!o) {
      ditambah.push({
        lineageKey: n.lineageKey,
        code: n.code,
        name: n.name,
        unit: n.unit,
        volumeLama: null,
        volumeBaru,
        hargaSatuan: harga,
        amountLama: 0n,
        amountBaru: n.amount,
      });
    } else {
      const volumeLama = o.volume != null ? Number(o.volume) : null;
      if (Math.abs((volumeLama ?? 0) - (volumeBaru ?? 0)) > EPS || o.amount !== n.amount) {
        diubah.push({
          lineageKey: n.lineageKey,
          code: n.code,
          name: n.name,
          unit: n.unit,
          volumeLama,
          volumeBaru,
          hargaSatuan: harga,
          amountLama: o.amount,
          amountBaru: n.amount,
        });
      }
    }
  }
  for (const o of oldItems) {
    if (!newByKey.has(o.lineageKey)) {
      dihapus.push({
        lineageKey: o.lineageKey,
        code: o.code,
        name: o.name,
        unit: o.unit,
        volumeLama: o.volume != null ? Number(o.volume) : null,
        volumeBaru: null,
        hargaSatuan: o.unitPrice != null ? Number(o.unitPrice) : null,
        amountLama: o.amount,
        amountBaru: 0n,
      });
    }
  }

  return {
    ditambah,
    dihapus,
    diubah,
    totalLama: oldRev.totalValue,
    totalBaru: newRev.totalValue,
    delta: newRev.totalValue - oldRev.totalValue,
  };
}
