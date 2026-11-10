import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatTanggal } from "@/lib/format";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import { jalurNodeById } from "@/lib/rab/jalur";
import { periksaPadananDraft, type NodePadanan } from "@/lib/rab/padanan-draft-aturan";
import type { Prisma } from "@/generated/prisma/client";

/**
 * PEMETAAN ITEM TERLAPOR KE ITEM DRAFT ADENDUM SEBELUM AKTIVASI (DECISIONS 754).
 *
 * Item kontrak yang SUDAH dilaporkan tapi tidak ada lagi di draft akan lepas
 * dari progres begitu draftnya aktif (halaman "Tidak terbobot", DECISIONS 649).
 * Sampai sini satu-satunya cara memasangkannya adalah layar pratinjau impor.
 * Modul ini memberi jalan kedua di halaman draft adendum, kapan saja sampai
 * aktivasi, dan bisa dilepas lagi.
 *
 * Memasangkan = node draft MEWARISI `lineageKey` item lama (cara yang sama
 * dengan pratinjau impor). Yang ikut pindah kunci:
 * - baris laporan yang dilaporkan TERHADAP node draft itu (basis draft);
 * - rincian backup/analisa node draft – lewat FK `ON UPDATE CASCADE`;
 * - usulan WA, sesi lapor WA, temuan, dan draf RAPL yang menyebut kunci draft.
 * Yang TIDAK disentuh: baris laporan atas item lama dan fotonya – volume,
 * tanggal, nilai, status. Justru karena kuncinya diwariskan, mereka tidak
 * perlu ditulis ulang.
 *
 * `updatedAt` draft disentuh: pemetaan menentukan ke mana realisasi resmi
 * pergi sesudah aktivasi, jadi persetujuan empat mata yang diberikan sebelum
 * pemetaan gugur dan harus diberikan ulang (DECISIONS 234).
 */

export class PadananDraftError extends Error {}

type Tx = Prisma.TransactionClient;

export type CalonDraft = {
  nodeId: string;
  code: string;
  name: string;
  unit: string | null;
  /** Rantai kode, mis. "I · 3". */
  jalur: string;
  volume: number | null;
};

export type ItemBelumDipetakan = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  jalur: string;
  /** Σ volume terhitung (laporan dikirim/disetujui/final). */
  realisasi: number;
  /** Laporan (status apa pun) yang memuat item ini. */
  jumlahLaporan: number;
  pertama: Date | null;
  terakhir: Date | null;
  /** Item draft yang SAH menjadi pasangannya. Kosong = tidak ada calon. */
  calon: CalonDraft[];
  /** Laporan atas item draft lama yang menunggu sebagai catatan di luar RAB (DECISIONS 755). */
  catatan: boolean;
};

export type PasanganDraft = {
  nodeId: string;
  code: string;
  name: string;
  jalur: string;
  unit: string | null;
  volume: number | null;
  /** Item kontrak yang kuncinya diwarisi. */
  lineageLama: string;
  namaLama: string;
  realisasi: number;
};

const terhitung = { in: [...COUNTED_REPORT_STATUSES] };

type NodeRingkas = {
  id: string;
  parentId: string | null;
  kind: string;
  code: string;
  name: string;
  unit: string | null;
  volume: Prisma.Decimal | null;
  lineageKey: string;
  lineageSemula: string | null;
};

const PILIH_NODE = {
  id: true,
  parentId: true,
  kind: true,
  code: true,
  name: true,
  unit: true,
  volume: true,
  lineageKey: true,
  lineageSemula: true,
} as const;

function sebagaiPadanan(n: NodeRingkas, beranak: ReadonlySet<string>): NodePadanan {
  return {
    lineageKey: n.lineageKey,
    kind: n.kind,
    name: n.name,
    unit: n.unit,
    punyaAnak: beranak.has(n.id),
    lineageSemula: n.lineageSemula,
  };
}

/** Revisi aktif + draft lokasi, dengan seluruh nodenya. Null bila salah satunya tidak ada. */
async function muat(c: Tx | typeof db, locationId: string, revisionId?: string) {
  const [aktif, draft] = await Promise.all([
    c.rabRevision.findFirst({ where: { locationId, status: "aktif" }, select: { id: true } }),
    c.rabRevision.findFirst({
      where: { locationId, status: "draft", ...(revisionId ? { id: revisionId } : {}) },
      select: { id: true, revisionNo: true },
    }),
  ]);
  if (!aktif || !draft) return null;
  const [nodeAktif, nodeDraft] = await Promise.all([
    c.rabNode.findMany({ where: { revisionId: aktif.id }, select: PILIH_NODE, orderBy: { sortOrder: "asc" } }),
    c.rabNode.findMany({ where: { revisionId: draft.id }, select: PILIH_NODE, orderBy: { sortOrder: "asc" } }),
  ]);
  const beranak = new Set<string>();
  for (const n of [...nodeAktif, ...nodeDraft]) if (n.parentId) beranak.add(n.parentId);
  return {
    aktif,
    draft,
    nodeAktif,
    nodeDraft,
    beranak,
    lineageAktif: new Set(nodeAktif.map((n) => n.lineageKey)),
    lineageDraft: new Set(nodeDraft.map((n) => n.lineageKey)),
  };
}

const keAngka = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));

/**
 * Item kontrak yang sudah dilaporkan tetapi tidak ada di draft – beserta calon
 * pasangannya – dan pasangan yang sudah dibuat di draft ini.
 */
export async function dataPadananDraft(
  locationId: string,
): Promise<{ draftId: string | null; belum: ItemBelumDipetakan[]; sudah: PasanganDraft[] }> {
  const m = await muat(db, locationId);
  if (!m) return { draftId: null, belum: [], sudah: [] };

  const lepas = m.nodeAktif.filter(
    (n) => (n.kind === "item" || n.kind === "grup") && !m.beranak.has(n.id) && !m.lineageDraft.has(n.lineageKey),
  );
  const dipasang = m.nodeDraft.filter((n) => n.lineageSemula);
  const kunci = [...new Set([...lepas.map((n) => n.lineageKey), ...dipasang.map((n) => n.lineageKey)])];
  const [semuaBaris, baris] = kunci.length
    ? await Promise.all([
        db.dailyReportItem.findMany({
          where: { lineageKey: { in: kunci }, report: { locationId } },
          select: { lineageKey: true, reportId: true, report: { select: { reportDate: true } } },
        }),
        db.dailyReportItem.groupBy({
          by: ["lineageKey"],
          where: { lineageKey: { in: kunci }, report: { locationId, status: terhitung } },
          _sum: { volumeDone: true },
        }),
      ])
    : [[], []];
  const realisasi = new Map(baris.map((b) => [b.lineageKey, Number(b._sum.volumeDone ?? 0)]));
  const laporan = new Map<string, { ids: Set<string>; pertama: Date; terakhir: Date }>();
  for (const b of semuaBaris) {
    const t = b.report.reportDate;
    const ada = laporan.get(b.lineageKey);
    if (!ada) laporan.set(b.lineageKey, { ids: new Set([b.reportId]), pertama: t, terakhir: t });
    else {
      ada.ids.add(b.reportId);
      if (t < ada.pertama) ada.pertama = t;
      if (t > ada.terakhir) ada.terakhir = t;
    }
  }

  const jalur = await jalurNodeById([...lepas, ...m.nodeDraft].map((n) => n.id));
  const kodeJalur = (id: string, code: string) => jalur.get(id)?.kode ?? code;
  const konteks = { lineageAktif: m.lineageAktif, lineageDraft: m.lineageDraft };

  const belum: ItemBelumDipetakan[] = lepas
    .filter((n) => laporan.has(n.lineageKey))
    .map((n) => {
      const l = laporan.get(n.lineageKey)!;
      const calon = m.nodeDraft
        .filter((d) => periksaPadananDraft(sebagaiPadanan(n, m.beranak), sebagaiPadanan(d, m.beranak), konteks) === null)
        .map((d) => ({
          nodeId: d.id,
          code: d.code,
          name: d.name,
          unit: d.unit,
          jalur: kodeJalur(d.id, d.code),
          volume: keAngka(d.volume),
        }));
      return {
        lineageKey: n.lineageKey,
        code: n.code,
        name: n.name,
        unit: n.unit,
        jalur: kodeJalur(n.id, n.code),
        realisasi: realisasi.get(n.lineageKey) ?? 0,
        jumlahLaporan: l.ids.size,
        pertama: l.pertama,
        terakhir: l.terakhir,
        calon,
        catatan: false,
      };
    });

  const namaAktif = new Map(m.nodeAktif.map((n) => [n.lineageKey, n.name]));
  const sudah: PasanganDraft[] = dipasang.map((d) => ({
    nodeId: d.id,
    code: d.code,
    name: d.name,
    jalur: kodeJalur(d.id, d.code),
    unit: d.unit,
    volume: keAngka(d.volume),
    lineageLama: d.lineageKey,
    namaLama: namaAktif.get(d.lineageKey) ?? d.lineageKey,
    realisasi: realisasi.get(d.lineageKey) ?? 0,
  }));

  return { draftId: m.draft.id, belum, sudah };
}

/** Awalan `jalur` untuk catatan berasal-draft di daftar konfirmasi aktivasi. */
export const JALUR_CATATAN_ASAL_DRAFT = "Catatan di luar RAB:";

/**
 * LAPORAN ATAS ITEM DRAFT LAMA YANG SUDAH JADI CATATAN (DECISIONS 755) dan
 * belum dipadankan. Itemnya hilang saat draft diganti berkas baru; laporannya
 * menunggu di panel "Pekerjaan di luar RAB". Sama dengan item kontrak yang belum
 * dipasangkan: sesudah aktivasi realisasinya tidak dihitung, jadi ikut disebut
 * di konfirmasi aktivasi. Dikelompokkan per uraian + satuan; dipasangkan di
 * panel catatan, bukan di panel pemetaan – `calon` selalu kosong.
 *
 * `realisasi` di sini = volume catatannya, status laporan apa pun: panel
 * catatan di atasnya menyebut angka yang sama. Menghitung hanya laporan
 * terkirim membuat daftar aktivasi menulis "0 m3" untuk catatan 3,5 m3
 * yang laporannya masih draft (render-cek 755).
 */
export async function catatanAsalDraftMenunggu(locationId: string): Promise<ItemBelumDipetakan[]> {
  const rows = await db.pekerjaanLuarRab.findMany({
    where: { locationId, asalDraftNo: { not: null }, reportItemId: null, dibatalkanAt: null },
    select: {
      id: true,
      reportId: true,
      uraian: true,
      satuan: true,
      volume: true,
      report: { select: { reportDate: true } },
    },
    orderBy: [{ report: { reportDate: "asc" } }, { createdAt: "asc" }],
  });
  const grup = new Map<string, ItemBelumDipetakan & { laporan: Set<string> }>();
  for (const r of rows) {
    const k = `${r.uraian}|${r.satuan}`;
    const t = r.report.reportDate;
    const vol = Number(r.volume);
    const g = grup.get(k);
    if (!g) {
      grup.set(k, {
        lineageKey: `luar-rab:${r.id}`,
        code: "",
        name: r.uraian,
        unit: r.satuan,
        jalur: JALUR_CATATAN_ASAL_DRAFT,
        realisasi: vol,
        jumlahLaporan: 1,
        pertama: t,
        terakhir: t,
        calon: [],
        catatan: true,
        laporan: new Set([r.reportId]),
      });
    } else {
      g.realisasi = Math.round((g.realisasi + vol) * 1000) / 1000;
      g.laporan.add(r.reportId);
      g.jumlahLaporan = g.laporan.size;
      if (t > g.terakhir!) g.terakhir = t;
    }
  }
  return [...grup.values()].map(({ laporan: _, ...i }) => i);
}

/**
 * Item terlapor yang belum dipasangkan untuk draft tertentu – dipakai gerbang
 * aktivasi: item kontrak yang tidak ada di draft (DECISIONS 754) dan laporan
 * atas item draft lama yang menunggu sebagai catatan (DECISIONS 755).
 */
export async function belumDipetakan(draftId: string): Promise<ItemBelumDipetakan[]> {
  const rev = await db.rabRevision.findUnique({ where: { id: draftId }, select: { locationId: true, status: true } });
  if (!rev || rev.status !== "draft") return [];
  const d = await dataPadananDraft(rev.locationId);
  if (d.draftId !== draftId) return [];
  return [...d.belum, ...(await catatanAsalDraftMenunggu(rev.locationId))];
}

/**
 * Kalimat untuk orang yang akan mengaktifkan: siapa saja yang belum
 * dipasangkan dan akibatnya. `null` bila tidak ada.
 */
export function kalimatBelumDipetakan(items: readonly ItemBelumDipetakan[], batas = 6): string | null {
  if (items.length === 0) return null;
  const fmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
  const contoh = items
    .slice(0, batas)
    .map((i) => `${i.jalur} ${i.name} (${fmt.format(i.realisasi)}${i.unit ? ` ${i.unit}` : ""})`)
    .join("; ");
  const sisa = items.length > batas ? `; +${items.length - batas} lainnya` : "";
  return (
    `${items.length} item yang sudah dilaporkan belum dipasangkan ke item draft: ${contoh}${sisa}. ` +
    `Sesudah aktivasi, realisasinya tidak ikut dihitung di progres (laporan dan fotonya tetap ada).`
  );
}

/**
 * GERBANG KONFIRMASI aktivasi (pilihan user 2026-11-10: *"cukup minta
 * konfirmasi saat aktivasi"*). Mengembalikan pesan penolakan bila masih ada
 * yang belum dipasangkan dan konfirmasinya belum diberikan; `null` = lanjut.
 */
export async function tolakTanpaKonfirmasiPadanan(
  draftId: string,
  konfirmasi: FormDataEntryValue | null,
): Promise<string | null> {
  if (konfirmasi === "1") return null;
  const kalimat = kalimatBelumDipetakan(await belumDipetakan(draftId));
  if (!kalimat) return null;
  return `${kalimat} Pasangkan dulu di halaman draft adendum, atau centang konfirmasi untuk tetap mengaktifkan.`;
}

/** Pasangkan item kontrak terlapor ke item baru di draft. */
export async function pasangkanItemDraft(i: {
  locationId: string;
  revisionId: string;
  lineageLama: string;
  nodeIdDraft: string;
  userId: string;
}): Promise<{ barisDraftDipindah: number }> {
  return db.$transaction(async (tx) => {
    const m = await muat(tx, i.locationId, i.revisionId);
    if (!m) throw new PadananDraftError("Draft adendum tidak ditemukan, atau lokasi ini belum punya RAB aktif.");
    const lama = m.nodeAktif.find((n) => n.lineageKey === i.lineageLama);
    const sasaran = m.nodeDraft.find((n) => n.id === i.nodeIdDraft);
    if (!lama) throw new PadananDraftError("Item kontrak itu tidak ada di RAB aktif.");
    if (!sasaran) throw new PadananDraftError("Item itu tidak ada di draft ini.");
    const tolak = periksaPadananDraft(sebagaiPadanan(lama, m.beranak), sebagaiPadanan(sasaran, m.beranak), {
      lineageAktif: m.lineageAktif,
      lineageDraft: m.lineageDraft,
    });
    if (tolak) throw new PadananDraftError(tolak);

    /*
     * SATU LAPORAN YANG MEMUAT KEDUANYA tidak bisa dipasangkan begitu saja:
     * baris laporan unik per (laporan, kunci), dan dua baris dengan kunci yang
     * sama di satu laporan berarti satu pekerjaan dilaporkan dua kali di hari
     * yang sama. Menggabungkannya mengubah isi laporan; itu keputusan orang,
     * bukan efek samping pemetaan. Tanggalnya disebut supaya bisa dibereskan.
     */
    const barisSasaran = await tx.dailyReportItem.findMany({
      where: { rabNodeId: sasaran.id },
      select: { reportId: true },
    });
    if (barisSasaran.length > 0) {
      const bentrok = await tx.dailyReportItem.findMany({
        where: { lineageKey: lama.lineageKey, reportId: { in: barisSasaran.map((b) => b.reportId) } },
        select: { report: { select: { reportDate: true } } },
      });
      if (bentrok.length > 0) {
        const tanggal = [...new Set(bentrok.map((b) => formatTanggal(b.report.reportDate, "d MMMM yyyy")))];
        throw new PadananDraftError(
          `Laporan tanggal ${tanggal.join(", ")} memuat "${lama.name}" DAN "${sasaran.name}" sekaligus. ` +
            `Satukan dulu di laporan itu, lalu pasangkan lagi.`,
        );
      }
    }

    const dariKunci = sasaran.lineageKey;
    const keKunci = lama.lineageKey;
    // Rincian backup/analisa node ini ikut lewat FK ON UPDATE CASCADE.
    await tx.rabNode.update({ where: { id: sasaran.id }, data: { lineageKey: keKunci, lineageSemula: dariKunci } });
    const pindah = await pindahKunciTerkait(tx, i.locationId, sasaran.id, dariKunci, keKunci);
    await tx.rabRevision.update({ where: { id: m.draft.id }, data: { updatedAt: new Date() } });
    await audit(i.userId, "rab.padanan_draft_pasang", "rab_revision", m.draft.id, {
      locationId: i.locationId,
      revisionNo: m.draft.revisionNo,
      itemLama: { lineageKey: keKunci, code: lama.code, name: lama.name },
      itemDraft: { nodeId: sasaran.id, lineageSemula: dariKunci, code: sasaran.code, name: sasaran.name },
      ...pindah,
    });
    return { barisDraftDipindah: pindah.barisLaporan };
  });
}

/** Lepas pasangan: node draft kembali ke kuncinya sendiri. */
export async function lepasPadananDraft(i: {
  locationId: string;
  revisionId: string;
  nodeIdDraft: string;
  userId: string;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    const m = await muat(tx, i.locationId, i.revisionId);
    if (!m) throw new PadananDraftError("Draft adendum tidak ditemukan.");
    const n = m.nodeDraft.find((x) => x.id === i.nodeIdDraft);
    if (!n) throw new PadananDraftError("Item itu tidak ada di draft ini.");
    if (!n.lineageSemula) throw new PadananDraftError(`"${n.name}" tidak sedang dipasangkan.`);
    const kunciLama = n.lineageKey;
    // Kunci semula bisa sudah dipakai node lain (mis. item yang ditambahkan
    // sesudahnya) – jangan menabrak. Akhiran `~N` sama dengan kunci item baru
    // editor; BUKAN `#N`, karena cacah segmen `#` dibaca sebagai kedalaman.
    const terpakai = (k: string) => (m.lineageDraft.has(k) && k !== kunciLama) || m.lineageAktif.has(k);
    let semula = n.lineageSemula;
    for (let k = 2; terpakai(semula); k++) {
      if (k > 999) throw new PadananDraftError("Gagal mengembalikan kunci item draft.");
      semula = `${n.lineageSemula}~${k}`;
    }
    await tx.rabNode.update({ where: { id: n.id }, data: { lineageKey: semula, lineageSemula: null } });
    // Hanya baris yang dilaporkan TERHADAP node draft ini yang kembali. Baris
    // atas item kontrak lama tetap pada kuncinya sendiri.
    const baris = await tx.dailyReportItem.updateMany({ where: { rabNodeId: n.id }, data: { lineageKey: semula } });
    await tx.rabRevision.update({ where: { id: m.draft.id }, data: { updatedAt: new Date() } });
    await audit(i.userId, "rab.padanan_draft_lepas", "rab_revision", m.draft.id, {
      locationId: i.locationId,
      revisionNo: m.draft.revisionNo,
      itemDraft: { nodeId: n.id, code: n.code, name: n.name },
      dariKunci: kunciLama,
      keKunci: semula,
      barisLaporan: baris.count,
    });
  });
}

/**
 * Data lain yang menyebut kunci node draft ikut kunci barunya. Draf RAPL
 * berkunci unik per lokasi/run – yang bertabrakan dibiarkan (rujukan, bukan
 * angka resmi, DECISIONS 652) dan dihitung di audit.
 */
async function pindahKunciTerkait(tx: Tx, locationId: string, nodeId: string, dari: string, ke: string) {
  const barisLaporan = await tx.dailyReportItem.updateMany({ where: { rabNodeId: nodeId }, data: { lineageKey: ke } });
  const usulanWa = await tx.waUsulan.updateMany({ where: { locationId, lineageKey: dari }, data: { lineageKey: ke } });
  const sesiWa = await tx.waLaporSesi.updateMany({ where: { locationId, lineageKey: dari }, data: { lineageKey: ke } });
  const temuan = await tx.finding.updateMany({ where: { locationId, lineageKey: dari }, data: { lineageKey: ke } });
  const raplRincian = await tx.$executeRaw`
    UPDATE rapl_rincian SET lineage_key = ${ke}
     WHERE location_id = ${locationId}::uuid AND lineage_key = ${dari}
       AND NOT EXISTS (SELECT 1 FROM rapl_rincian r2 WHERE r2.location_id = ${locationId}::uuid AND r2.lineage_key = ${ke})`;
  const raplAi = await tx.$executeRaw`
    UPDATE rapl_analisa_ai a SET lineage_key = ${ke}
     WHERE a.location_id = ${locationId}::uuid AND a.lineage_key = ${dari}
       AND NOT EXISTS (SELECT 1 FROM rapl_analisa_ai b WHERE b.run_id = a.run_id AND b.lineage_key = ${ke})`;
  return {
    barisLaporan: barisLaporan.count,
    usulanWa: usulanWa.count,
    sesiWa: sesiWa.count,
    temuan: temuan.count,
    raplRincian,
    raplAi,
  };
}
