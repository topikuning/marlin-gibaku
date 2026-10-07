import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { RincianBerkas } from "./baca";

/**
 * SIMPAN RINCIAN BERKAS ke satu revisi RAB (DECISIONS baru 2026-10-06).
 *
 * Seluruh rincian revisi ditulis ulang dalam SATU transaksi: hapus yang lama,
 * tulis yang baru. Tidak ada keadaan setengah jadi – kalau gagal, rincian
 * lama tetap utuh. Tidak satu pun kolom `rab_nodes`/`rab_revisions` disentuh.
 *
 * Item yang tidak punya node di revisi itu (lineage tidak cocok) tidak
 * disimpan dan DIHITUNG, supaya pemanggil bisa mengatakannya.
 */
export type HasilSimpanRincian = {
  backupVolume: number;
  analisa: number;
  komponen: number;
  itemAnalisa: number;
  hargaDasar: number;
  /** Item rincian yang lineage-nya tidak ada di revisi ini. */
  tanpaNode: number;
};

const dec = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : new Prisma.Decimal(Number(n.toPrecision(15)));

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function simpanRincian(
  revisionId: string,
  r: RincianBerkas,
  opsi: { asal: "impor" | "arsip"; documentId: string | null; userId: string | null },
): Promise<HasilSimpanRincian> {
  const nodes = await db.rabNode.findMany({
    where: { revisionId, kind: "item" },
    select: { lineageKey: true },
  });
  const ada = new Set(nodes.map((n) => n.lineageKey));
  const items = r.items.filter((it) => ada.has(it.kunci));
  const tanpaNode = r.items.length - items.length;

  // Hanya blok analisa yang benar-benar dipakai item yang tersimpan.
  const blokDipakai = new Set(items.map((it) => it.analisa?.kunciBlok).filter((k): k is string => k != null));
  const blok = [...r.blokAnalisa.entries()].filter(([k]) => blokDipakai.has(k));

  return db.$transaction(
    async (tx) => {
      await tx.rabItemAnalisa.deleteMany({ where: { revisionId } });
      await tx.rabAnalisa.deleteMany({ where: { revisionId } });
      await tx.rabBackupVolume.deleteMany({ where: { revisionId } });
      await tx.rabHargaDasar.deleteMany({ where: { revisionId } });
      await tx.rabRincianRevisi.deleteMany({ where: { revisionId } });

      await tx.rabRincianRevisi.create({
        data: {
          revisionId,
          documentId: opsi.documentId,
          asal: opsi.asal,
          sheetRab: r.sheetRab,
          kolomVolume: r.kolom.vol,
          kolomHarga: r.kolom.price,
          ringkasan: json({ ...r.ringkasan, tanpaNode }),
          kepala: json(r.kepala),
          tersembunyiDibaca: r.tersembunyiDibaca,
          dibuatOlehId: opsi.userId,
        },
      });

      for (let i = 0; i < items.length; i += 500) {
        await tx.rabBackupVolume.createMany({
          data: items.slice(i, i + 500).map((it) => ({
            revisionId,
            lineageKey: it.kunci,
            status: it.volume.status,
            nilaiRab: dec(it.volume.nilaiRab),
            rumusRab: it.volume.rumusRab,
            sumber: json(it.volume.sumber),
            perantara: json(it.volume.perantara),
            baris: json(it.volume.baris),
            terpotong: it.volume.terpotong,
            catatan: it.volume.catatan,
          })),
        });
      }

      const idBlok = new Map<string, string>();
      let komponen = 0;
      for (let i = 0; i < blok.length; i += 200) {
        const potong = blok.slice(i, i + 200);
        const dibuat = await tx.rabAnalisa.createManyAndReturn({
          data: potong.map(([kunciBlok, b]) => ({
            revisionId,
            kunciBlok,
            sheet: b.sheet,
            barisAwal: b.barisAwal,
            barisAkhir: b.barisAkhir,
            tersembunyi: b.tersembunyi,
            kode: b.kode,
            uraian: b.uraian,
            hargaSatuan: dec(b.hargaSatuan),
            overhead: dec(b.overhead),
            perantara: json(b.perantara),
            baris: json(b.baris),
            catatan: b.catatan,
          })),
          select: { id: true, kunciBlok: true },
        });
        for (const d of dibuat) idBlok.set(d.kunciBlok, d.id);
        const kompData = potong.flatMap(([kunciBlok, b]) =>
          b.komponen.map((k, urutan) => ({
            analisaId: idBlok.get(kunciBlok)!,
            urutan,
            baris: k.baris,
            kategori: k.kategori,
            nama: k.nama,
            satuan: k.satuan,
            koefisien: dec(k.koefisien),
            harga: dec(k.harga),
            jumlah: dec(k.jumlah),
            sumberSheet: k.rujukanHarga?.sheet ?? null,
            sumberSel: k.rujukanHarga?.sel ?? null,
          })),
        );
        if (kompData.length > 0) await tx.rabAnalisaKomponen.createMany({ data: kompData });
        komponen += kompData.length;
      }

      const itemAnalisa = items
        .filter((it) => it.analisa && idBlok.has(it.analisa.kunciBlok))
        .map((it) => ({
          revisionId,
          lineageKey: it.kunci,
          analisaId: idBlok.get(it.analisa!.kunciBlok)!,
          cara: it.analisa!.cara,
        }));
      for (let i = 0; i < itemAnalisa.length; i += 1000) {
        await tx.rabItemAnalisa.createMany({ data: itemAnalisa.slice(i, i + 1000) });
      }

      if (r.hargaDasar.length > 0) {
        await tx.rabHargaDasar.createMany({
          data: r.hargaDasar.map((h) => ({
            revisionId,
            sheet: h.sheet,
            sel: h.sel,
            baris: h.baris,
            tersembunyi: h.tersembunyi,
            nama: h.nama,
            satuan: h.satuan,
            harga: dec(h.harga),
          })),
          skipDuplicates: true,
        });
      }

      return {
        backupVolume: items.length,
        analisa: blok.length,
        komponen,
        itemAnalisa: itemAnalisa.length,
        hargaDasar: r.hargaDasar.length,
        tanpaNode,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
