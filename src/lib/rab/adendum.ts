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

/**
 * Draft milik lokasi + masih draft — semua mutasi editor lewat sini.
 *
 * `locationId` WAJIB, dan itu bukan formalitas. Aksi server mengambil lokasi
 * dari SLUG di URL lalu memeriksa akses atas lokasi itu, sementara yang diubah
 * ditentukan oleh `revisionId`/`nodeId` dari FormData. Selama dua hal itu tidak
 * pernah diadu, siapa pun yang berhak atas SATU lokasi bisa menyunting draft
 * adendum lokasi mana pun asal ia tahu id revisinya — dan id revisi bocor lewat
 * setiap halaman adendum yang pernah ia buka secara sah. UUID menaikkan biaya
 * menebak; ia bukan kontrol otorisasi.
 */
async function requireDraft(tx: Tx, revisionId: string, locationId: string) {
  const rev = await tx.rabRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, locationId: true, status: true, revisionNo: true },
  });
  if (!rev) throw new AdendumError("Revisi tidak ditemukan.");
  // Disamakan dengan "tidak ditemukan": menyebut "revisi ini milik lokasi lain"
  // sudah membocorkan bahwa id-nya benar dan drafnya ada.
  if (rev.locationId !== locationId) throw new AdendumError("Revisi tidak ditemukan.");
  if (rev.status !== "draft") {
    throw new AdendumError(`Revisi #${rev.revisionNo} bukan draft – editan hanya untuk draft.`);
  }
  return rev;
}

/**
 * Hitung ulang SEMUA amount agregat dari daun (bottom-up) + totalValue revisi.
 * Item: amount = round(volume × hargaSatuan). Non-item: Σ amount anak.
 */
/**
 * Hitung ulang agregat draft.
 *
 * ### Item yang TIDAK disentuh tidak boleh ikut dihitung ulang (DECISIONS 423)
 *
 * Versi lama menghitung ulang `amount` SETIAP item sebagai
 * `round(volume × harga)`. Nilai yang tersimpan berasal dari berkas RAB/HPS
 * yang diunggah user, dan berkas itu punya pembulatannya sendiri — pada basis
 * uji 2.197 dari 11.540 item berbeda dari hasil hitung ulang, dengan selisih
 * TENGAH hanya **4 rupiah**. Akibatnya: menambah SATU item baru menulis ulang
 * ribuan baris lain, dan `diffRevisions` — yang menandai perubahan lewat
 * `o.amount !== n.amount` — melaporkan ribuan "perubahan" yang volumenya sama
 * persis dan nilainya bergeser puluhan rupiah. Peninjau adendum lalu diminta
 * memeriksa daftar yang seluruhnya derau.
 *
 * Itu juga melanggar aturan pokok: angka yang DIUNGGAH user dipakai apa adanya,
 * tidak dibetulkan diam-diam ke versi sistem (DECISIONS 203).
 *
 * Jadi `amount` item hanya dihitung ulang bila item itu memang baru saja
 * diubah/ditambah — `hitungUlangItem`. Agregat kategori TETAP selalu diturunkan
 * dari anaknya (aturan "angka agregat selalu derived"); itu aman karena
 * kategori memang sudah sama dengan Σ anaknya (diperiksa: 0 dari 122 kategori
 * menyimpang), sehingga total revisi tidak bergeser oleh perubahan ini.
 */
async function recomputeTotals(
  tx: Tx,
  revisionId: string,
  hitungUlangItem: Iterable<string> = [],
): Promise<bigint> {
  const perluHitung = new Set(hitungUlangItem);
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
      // Tidak disentuh → pakai nilai tersimpan apa adanya.
      if (!perluHitung.has(n.id)) {
        computed.set(n.id, n.amount);
        return n.amount;
      }
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
        `Masih ada draft revisi #${existingDraft.revisionNo} – aktifkan atau buang dulu sebelum membuat draft baru.`,
      );
    }
    const active = await tx.rabRevision.findFirst({
      where: { locationId, status: "aktif" },
      select: { id: true, totalValue: true },
    });
    if (!active) throw new AdendumError("Belum ada revisi RAB aktif untuk disalin.");

    if (opts.amendmentId) {
      const loc = await tx.location.findUniqueOrThrow({
        where: { id: locationId },
        select: { packageId: true },
      });
      const amendment = await tx.contractAmendment.findUnique({
        where: { id: opts.amendmentId },
        select: { contract: { select: { packageId: true } } },
      });
      if (!amendment || amendment.contract.packageId !== loc.packageId) {
        throw new AdendumError("Adendum kontrak (CCO) itu bukan milik paket lokasi ini.");
      }
    }

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
  locationId: string,
  revisionId: string,
  nodeId: string,
  volume: number,
  userId: string,
): Promise<{ totalValue: bigint }> {
  if (!Number.isFinite(volume) || volume < 0) throw new AdendumError("Volume tidak valid.");
  const v = Math.round(volume * 1000) / 1000; // presisi Decimal(15,3)

  return db.$transaction(async (tx) => {
    const rev = await requireDraft(tx, revisionId, locationId);
    const node = await tx.rabNode.findUnique({
      where: { id: nodeId },
      select: { id: true, revisionId: true, kind: true, name: true, volume: true, lineageKey: true },
    });
    if (!node || node.revisionId !== revisionId) throw new AdendumError("Item tidak ditemukan di draft ini.");
    if (node.kind !== "item") throw new AdendumError("Hanya item pekerjaan yang volumenya bisa diubah.");

    // Cakupan "semua": laporan atas item draft adendum ber-`basis=draft_adendum`
    // (DECISIONS 210 — pekerjaan dikerjakan dulu, adendumnya menyusul). Dengan
    // cakupan "aktif" pagar ini membaca 0 untuk justru item yang paling mungkin
    // sudah dikerjakan, lalu meloloskan volume di bawah realisasinya.
    const realized =
      (await cumulativeVolumeByLineage(rev.locationId, undefined, "semua")).get(node.lineageKey) ?? 0;
    if (v + EPS < realized) {
      throw new AdendumError(
        `Volume ${node.name} tidak boleh di bawah realisasi tercatat (${realized}). ` +
          `Pekerjaan-kurang atas item berjalan maksimal sampai volume terealisasi.`,
      );
    }

    const volumeLama = node.volume != null ? Number(node.volume) : 0;
    await tx.rabNode.update({ where: { id: nodeId }, data: { volume: v } });
    // Hanya item INI yang nilainya ikut berubah — sisanya tidak disentuh.
    const totalValue = await recomputeTotals(tx, revisionId, [nodeId]);
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
  locationId: string,
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
    await requireDraft(tx, revisionId, locationId);
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
    const totalValue = await recomputeTotals(tx, revisionId, [node.id]);
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

/**
 * Edit field ITEM BARU (kode/nama/satuan/harga satuan). HANYA untuk item yang
 * belum ada di revisi aktif — item lama harga & identitasnya terkunci (harga
 * kontrak tetap). lineageKey TIDAK ikut berubah ketika kode diedit: identitas
 * node dalam draft sudah terbentuk dan tidak boleh goyah.
 */
export async function updateDraftNewItemFields(
  locationId: string,
  revisionId: string,
  nodeId: string,
  patch: { code?: string; name?: string; unit?: string | null; unitPrice?: number },
  userId: string,
): Promise<{ totalValue: bigint }> {
  return db.$transaction(async (tx) => {
    const rev = await requireDraft(tx, revisionId, locationId);
    const node = await tx.rabNode.findUnique({
      where: { id: nodeId },
      select: { id: true, revisionId: true, kind: true, name: true, lineageKey: true },
    });
    if (!node || node.revisionId !== revisionId) throw new AdendumError("Item tidak ditemukan di draft ini.");
    if (node.kind !== "item") throw new AdendumError("Hanya item pekerjaan yang bisa diedit di sini.");

    const active = await tx.rabRevision.findFirst({
      where: { locationId: rev.locationId, status: "aktif" },
      select: { id: true },
    });
    if (active) {
      const lama = await tx.rabNode.findFirst({
        where: { revisionId: active.id, lineageKey: node.lineageKey },
        select: { id: true },
      });
      if (lama) {
        throw new AdendumError(
          `"${node.name}" adalah item kontrak lama – harga satuan dan identitasnya terkunci. Hanya volume yang boleh diubah.`,
        );
      }
    }

    const data: { code?: string; name?: string; unit?: string | null; unitPrice?: number } = {};
    if (patch.code !== undefined) {
      const code = patch.code.trim();
      if (!code) throw new AdendumError("Kode tidak boleh kosong.");
      data.code = code;
    }
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new AdendumError("Nama tidak boleh kosong.");
      data.name = name;
    }
    if (patch.unit !== undefined) data.unit = patch.unit?.trim() || null;
    if (patch.unitPrice !== undefined) {
      if (!Number.isFinite(patch.unitPrice) || patch.unitPrice < 0) {
        throw new AdendumError("Harga satuan tidak valid.");
      }
      data.unitPrice = Math.round(patch.unitPrice * 100) / 100;
    }
    if (Object.keys(data).length === 0) throw new AdendumError("Tidak ada perubahan.");

    await tx.rabNode.update({ where: { id: nodeId }, data });
    // Harga item BARU boleh berubah → nilainya memang harus dihitung ulang.
    const totalValue = await recomputeTotals(tx, revisionId, [nodeId]);
    await auditIn(tx, userId, "rab.adendum_new_item_update", "rab_node", nodeId, {
      revisionId,
      lineageKey: node.lineageKey,
      patch: data,
    });
    return { totalValue };
  });
}

/** Tambah KATEGORI baru (bangunan/unit baru) di akar draft. */
export async function addDraftKategori(
  locationId: string,
  revisionId: string,
  input: { code: string; name: string },
  userId: string,
): Promise<{ nodeId: string }> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw new AdendumError("Kode dan nama kategori wajib diisi.");

  return db.$transaction(async (tx) => {
    await requireDraft(tx, revisionId, locationId);
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
    // Menggerakkan `updatedAt` revisi. Tanda tangan persetujuan gugur dengan
    // membandingkan `approvedAt >= updatedAt` (persetujuan-aturan.ts), dan
    // satu-satunya yang menggerakkan cap itu di mutasi lain adalah
    // `recomputeTotals`. Kategori kosong bernilai 0 sehingga total tidak
    // bergerak — tanpa baris ini, menyisipkan kategori ke draft yang SUDAH
    // ditandatangani tidak menggugurkan satu pun tanda tangan, dan yang
    // diaktifkan bukan lagi persis yang disetujui.
    // `recomputeTotals` SELALU menulis `totalValue` ke baris revisi, dan itulah
    // yang menggerakkan `@updatedAt`. Dipakai di sini bukan karena totalnya
    // berubah (kategori kosong = 0), melainkan supaya cap waktunya bergerak
    // lewat jalur yang sama persis dengan mutasi editor lainnya.
    await recomputeTotals(tx, revisionId);
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
  locationId: string,
  revisionId: string,
  nodeId: string,
  userId: string,
): Promise<{ totalValue: bigint; removedItems: number }> {
  return db.$transaction(async (tx) => {
    const rev = await requireDraft(tx, revisionId, locationId);
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

    // Cakupan "semua" — lihat alasan di updateDraftItemVolume. Dengan "aktif",
    // item draft yang sudah dilaporkan terbaca "tanpa realisasi", pagar ini
    // lolos, lalu `rabNode.delete` ditolak FK RESTRICT dan user hanya melihat
    // "kesalahan tak terduga" pada item yang tidak akan pernah bisa dihapus.
    const realized = await cumulativeVolumeByLineage(rev.locationId, undefined, "semua");
    const items = subtree.map((id) => byId.get(id)!).filter((n) => n.kind === "item");
    const blocked = items.find((n) => (realized.get(n.lineageKey) ?? 0) > EPS);
    if (blocked) {
      throw new AdendumError(
        `"${blocked.name}" punya realisasi tercatat – tidak bisa dihapus. ` +
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
  /**
   * Jalur kategori/bangunan induk, mis. "II. STRUKTUR › Lantai 1"
   * (DECISIONS 423). Tanpa ini daftar perubahan cuma deretan kode dan nama —
   * peninjau tahu APA yang berubah tapi tidak tahu DI MANA, padahal satu RAB
   * bisa punya belasan bangunan dengan nama pekerjaan yang berulang persis.
   */
  jalur: string;
  volumeLama: number | null;
  volumeBaru: number | null;
  hargaSatuan: number | null;
  /**
   * Harga satuan di revisi LAMA — null untuk item baru (memang belum ada).
   * Ada supaya peninjau bisa melihat harga item kontrak lama bergeser, bukan
   * hanya melihat "Jumlah berubah" tanpa tahu sebabnya (DECISIONS 213).
   */
  hargaSatuanLama: number | null;
  /** Item lama yang harga satuannya bergeser — seharusnya tidak terjadi. */
  hargaBergeser: boolean;
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
  /**
   * Σ kenaikan nilai per item (pekerjaan tambah), KOTOR.
   *
   * BUKAN basis batas 10% Perpres 16/2018 Pasal 54 — yang dibatasi di sana
   * kenaikan NILAI KONTRAK (`delta`), bukan jumlah kotor pekerjaan tambah.
   * Angka ini dipakai untuk menggambarkan besar pergeseran lingkup, dan untuk
   * mengisi dokumen adendum. DECISIONS 233.
   */
  totalTambah: bigint;
  /** Σ penurunan nilai per item (pekerjaan kurang), ≤ 0. */
  totalKurang: bigint;
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
  const fetchNodes = (revisionId: string) =>
    db.rabNode.findMany({
      where: { revisionId },
      select: {
        id: true,
        parentId: true,
        kind: true,
        lineageKey: true,
        code: true,
        name: true,
        unit: true,
        volume: true,
        unitPrice: true,
        amount: true,
      },
      orderBy: { sortOrder: "asc" },
    });
  const [oldAll, newAll] = await Promise.all([fetchNodes(oldRevisionId), fetchNodes(newRevisionId)]);
  /** Jalur induk per node: "KATEGORI › Sub › Grup". Kosong bila di akar. */
  const jalurMap = (all: typeof oldAll) => {
    const byId = new Map(all.map((n) => [n.id, n]));
    const cache = new Map<string, string>();
    const jalur = (id: string | null): string => {
      if (!id) return "";
      const ada = cache.get(id);
      if (ada != null) return ada;
      const n = byId.get(id);
      if (!n) return "";
      const atas = jalur(n.parentId);
      const nama = [n.code, n.name].filter(Boolean).join(". ");
      const hasil = atas ? `${atas} › ${nama}` : nama;
      cache.set(id, hasil);
      return hasil;
    };
    return new Map(all.filter((n) => n.kind === "item").map((n) => [n.lineageKey, jalur(n.parentId)]));
  };
  const jalurBaru = jalurMap(newAll);
  const jalurLama = jalurMap(oldAll);
  const oldItems = oldAll.filter((n) => n.kind === "item");
  const newItems = newAll.filter((n) => n.kind === "item");
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
        jalur: jalurBaru.get(n.lineageKey) ?? "",
        volumeLama: null,
        volumeBaru,
        hargaSatuan: harga,
        hargaSatuanLama: null,
        hargaBergeser: false,
        amountLama: 0n,
        amountBaru: n.amount,
      });
    } else {
      const volumeLama = o.volume != null ? Number(o.volume) : null;
      const hargaLama = o.unitPrice != null ? Number(o.unitPrice) : null;
      // Toleransi 0,005 = setengah rupiah-sen; di bawah itu beda pembulatan
      // tulis, bukan perubahan harga.
      const hargaBergeser =
        hargaLama == null && harga == null
          ? false
          : hargaLama == null || harga == null || Math.abs(hargaLama - harga) >= 0.005;
      if (
        Math.abs((volumeLama ?? 0) - (volumeBaru ?? 0)) > EPS ||
        o.amount !== n.amount ||
        hargaBergeser
      ) {
        diubah.push({
          lineageKey: n.lineageKey,
          code: n.code,
          name: n.name,
          unit: n.unit,
          jalur: jalurBaru.get(n.lineageKey) ?? "",
          volumeLama,
          volumeBaru,
          hargaSatuan: harga,
          hargaSatuanLama: hargaLama,
          hargaBergeser,
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
        jalur: jalurLama.get(o.lineageKey) ?? "",
        volumeLama: o.volume != null ? Number(o.volume) : null,
        volumeBaru: null,
        hargaSatuan: o.unitPrice != null ? Number(o.unitPrice) : null,
        hargaSatuanLama: o.unitPrice != null ? Number(o.unitPrice) : null,
        hargaBergeser: false,
        amountLama: o.amount,
        amountBaru: 0n,
      });
    }
  }

  let totalTambah = 0n;
  let totalKurang = 0n;
  for (const it of [...ditambah, ...dihapus, ...diubah]) {
    const d = it.amountBaru - it.amountLama;
    if (d > 0n) totalTambah += d;
    else totalKurang += d;
  }

  return {
    ditambah,
    dihapus,
    diubah,
    totalLama: oldRev.totalValue,
    totalBaru: newRev.totalValue,
    delta: newRev.totalValue - oldRev.totalValue,
    totalTambah,
    totalKurang,
  };
}
