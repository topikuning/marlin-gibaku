import "server-only";
import { db } from "@/lib/db";
import { analisaRevisi, sumberBackupRevisi } from "./sumber-backup";
import type { SebabBelum, SumberBackup } from "./warisan";
import type {
  AnalisaEkspor,
  BackupEkspor,
  BarisBerkasEkspor,
  HargaDasarEkspor,
  ItemEkspor,
  KomponenEkspor,
  RincianEkspor,
} from "@/lib/export/rincian-rencana";

/**
 * Data backup volume & analisa satu revisi untuk unduhan bertaut
 * (DECISIONS 741). Sumbernya sama dengan layar Backup volume & analisa:
 * backup milik revisi ini, isian MARLIN, atau warisan revisi sebelumnya bila
 * volumenya sama (652); analisa berkas kontrak, diwarisi bila harga satuannya
 * sama. Draf analisa AI dan padanan AHSP SENGAJA tidak ikut – keduanya bukan
 * analisa kontrak (652).
 */

const SEBAB: Record<SebabBelum, string> = {
  volume_berubah: "Volume berubah dari revisi sebelumnya – backup lama menghitung volume lain",
  baru: "Item baru di revisi ini",
  belum_dilengkapi: "Rincian berkas revisi ini belum dilengkapi (Sistem → Backup volume & analisa)",
  tanpa_backup: "Volume di berkas diketik langsung, kosong, atau rujukannya putus",
  tanpa_berkas: "Revisi dibuat tanpa berkas dan item ini belum punya backup",
};

const KATEGORI = new Set(["upah", "bahan", "alat", "lain"]);
const POLA_BULAT = /^\s*=?\s*(ROUNDUP|ROUNDDOWN|ROUND)\s*\((.+),\s*(-?\d+)\s*\)\s*$/i;

/**
 * Pembulatan akhir blok analisa menurut rumus berkas: sel yang NILAINYA sama
 * dengan harga satuan analisa dan rumusnya ROUND/ROUNDUP/ROUNDDOWN(…, n).
 * Tidak ada sel seperti itu → tanpa pembulatan (bukan ditebak).
 */
function pembulatanBlok(baris: unknown, harga: number | null): AnalisaEkspor["pembulatan"] {
  if (harga == null || !Array.isArray(baris)) return null;
  for (const b of baris as BarisBerkasEkspor[]) {
    for (const s of b.sel ?? []) {
      if (typeof s.nilai !== "number" || !s.rumus || Math.abs(s.nilai - harga) > 0.005) continue;
      const m = POLA_BULAT.exec(s.rumus);
      if (m) return { fungsi: m[1]!.toUpperCase() as "ROUND" | "ROUNDUP" | "ROUNDDOWN", digit: Number(m[3]) };
    }
  }
  return null;
}
const angka = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
const tanpaDolar = (sel: string) => sel.replace(/\$/g, "").toUpperCase();
const kunciHarga = (revisionId: string, sheet: string, sel: string) => `${revisionId}|${sheet}|${tanpaDolar(sel)}`;

export async function muatRincianEkspor(revisionId: string): Promise<RincianEkspor> {
  const [nodes, { peta }, petaAnalisa, revisi] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId, kind: "item" },
      orderBy: { sortOrder: "asc" },
      select: { lineageKey: true, code: true, name: true, unit: true, volume: true, unitPrice: true },
    }),
    sumberBackupRevisi(revisionId),
    analisaRevisi(revisionId),
    db.rabRevision.findUniqueOrThrow({ where: { id: revisionId }, select: { revisionNo: true, locationId: true } }),
  ]);
  const noRevisi = new Map(
    (
      await db.rabRevision.findMany({ where: { locationId: revisi.locationId }, select: { id: true, revisionNo: true } })
    ).map((r) => [r.id, r.revisionNo]),
  );

  // Revisi asal tiap backup (miliknya sendiri atau warisan).
  const asalBackup = (s: SumberBackup | undefined): { revId: string; dari: "berkas" | "isian"; warisan: boolean } | null => {
    if (!s || s.jenis === "belum") return null;
    if (s.jenis === "warisan") return { revId: s.revisionId, dari: s.dari, warisan: true };
    return { revId: s.revisionId, dari: s.jenis, warisan: false };
  };
  const butuhBerkas = new Set<string>();
  const butuhIsian = new Set<string>();
  const revBerkas = new Set<string>();
  for (const n of nodes) {
    const a = asalBackup(peta.get(n.lineageKey));
    if (!a) continue;
    (a.dari === "berkas" ? butuhBerkas : butuhIsian).add(`${a.revId}|${n.lineageKey}`);
    if (a.dari === "berkas") revBerkas.add(a.revId);
  }
  const lk = nodes.map((n) => n.lineageKey);
  const [backupBerkas, backupIsian, kepalaRevisi] = await Promise.all([
    butuhBerkas.size
      ? db.rabBackupVolume.findMany({
          where: { revisionId: { in: [...revBerkas] }, lineageKey: { in: lk } },
          select: { revisionId: true, lineageKey: true, rumusRab: true, nilaiRab: true, sumber: true, baris: true },
        })
      : Promise.resolve([]),
    butuhIsian.size
      ? db.rabBackupIsian.findMany({
          where: { lineageKey: { in: lk }, revisionId: { in: [...new Set([...butuhIsian].map((k) => k.split("|")[0]!))] } },
          orderBy: { urutan: "asc" },
          select: {
            revisionId: true,
            lineageKey: true,
            uraian: true,
            jumlah: true,
            panjang: true,
            lebar: true,
            tinggi: true,
            kurang: true,
            keterangan: true,
          },
        })
      : Promise.resolve([]),
    revBerkas.size
      ? db.rabRincianRevisi.findMany({ where: { revisionId: { in: [...revBerkas] } }, select: { revisionId: true, kepala: true } })
      : Promise.resolve([]),
  ]);
  const berkasPer = new Map(backupBerkas.map((b) => [`${b.revisionId}|${b.lineageKey}`, b]));
  const isianPer = new Map<string, typeof backupIsian>();
  for (const i of backupIsian) {
    const k = `${i.revisionId}|${i.lineageKey}`;
    isianPer.set(k, [...(isianPer.get(k) ?? []), i]);
  }
  const kepalaPer = new Map(kepalaRevisi.map((k) => [k.revisionId, k.kepala as unknown as Record<string, Record<number, string>>]));

  // Analisa kontrak + harga dasar yang dirujuknya.
  const idAnalisa = [...new Set([...petaAnalisa.values()].map((a) => a.analisaId))];
  const analisaDb = idAnalisa.length
    ? await db.rabAnalisa.findMany({
        where: { id: { in: idAnalisa } },
        include: { komponen: { orderBy: { urutan: "asc" } } },
      })
    : [];
  const revHarga = [...new Set(analisaDb.map((a) => a.revisionId))];
  const hargaDb = revHarga.length
    ? await db.rabHargaDasar.findMany({ where: { revisionId: { in: revHarga } }, orderBy: [{ sheet: "asc" }, { baris: "asc" }] })
    : [];

  const hargaDasar: HargaDasarEkspor[] = hargaDb.map((h) => ({
    kunci: kunciHarga(h.revisionId, h.sheet, h.sel),
    nama: h.nama,
    satuan: h.satuan,
    harga: angka(h.harga),
    asalSel: `${h.sheet}!${tanpaDolar(h.sel)} · revisi #${noRevisi.get(h.revisionId) ?? "?"}`,
  }));
  const adaHarga = new Set(hargaDasar.map((h) => h.kunci));

  const asalAnalisa = new Map([...petaAnalisa.values()].map((a) => [a.analisaId, a]));
  const analisa: AnalisaEkspor[] = analisaDb.map((a) => {
    const s = asalAnalisa.get(a.id);
    return {
      id: a.id,
      kode: a.kode,
      uraian: a.uraian,
      hargaSatuan: angka(a.hargaSatuan),
      overhead: angka(a.overhead),
      pembulatan: pembulatanBlok(a.baris, angka(a.hargaSatuan)),
      asal: { revisionNo: s?.revisionNo ?? noRevisi.get(a.revisionId) ?? 0, warisan: s?.warisan ?? false },
      komponen: a.komponen.map((k): KomponenEkspor => {
        const kunci = k.sumberSheet && k.sumberSel ? kunciHarga(a.revisionId, k.sumberSheet, k.sumberSel) : null;
        return {
          kategori: (KATEGORI.has(k.kategori) ? k.kategori : "lain") as KomponenEkspor["kategori"],
          nama: k.nama,
          satuan: k.satuan,
          koefisien: angka(k.koefisien),
          harga: angka(k.harga),
          jumlah: angka(k.jumlah),
          hargaDasar: kunci && adaHarga.has(kunci) ? kunci : null,
        };
      }),
    };
  });
  // Urut kode supaya Resume Analisa terbaca seperti berkas KKP.
  analisa.sort((x, y) => (x.kode ?? "").localeCompare(y.kode ?? "", "id", { numeric: true }));

  const item: ItemEkspor[] = nodes.map((n) => {
    const s = peta.get(n.lineageKey);
    const a = asalBackup(s);
    let backup: BackupEkspor | null = null;
    if (a?.dari === "berkas") {
      const b = berkasPer.get(`${a.revId}|${n.lineageKey}`);
      if (b) {
        backup = {
          jenis: "berkas",
          asal: { revisionNo: noRevisi.get(a.revId) ?? 0, warisan: a.warisan },
          rumusRab: b.rumusRab,
          nilaiRab: angka(b.nilaiRab),
          sumber: (b.sumber as unknown as { sheet: string; sel: string; nilai: number | null }[]).map((x) => ({
            sheet: x.sheet,
            sel: x.sel,
            nilai: x.nilai,
          })),
          baris: b.baris as unknown as BarisBerkasEkspor[],
          kepala: kepalaPer.get(a.revId) ?? {},
        };
      }
    } else if (a?.dari === "isian") {
      const rows = isianPer.get(`${a.revId}|${n.lineageKey}`) ?? [];
      if (rows.length) {
        backup = {
          jenis: "isian",
          asal: { revisionNo: noRevisi.get(a.revId) ?? 0, warisan: a.warisan },
          baris: rows.map((x) => ({
            uraian: x.uraian,
            jumlah: angka(x.jumlah),
            panjang: angka(x.panjang),
            lebar: angka(x.lebar),
            tinggi: angka(x.tinggi),
            kurang: x.kurang,
            keterangan: x.keterangan,
          })),
        };
      }
    }
    return {
      lineageKey: n.lineageKey,
      kode: n.code.replace(/(?:#\d+)+$/, "").trim(),
      nama: n.name.replace(/\s+/g, " ").trim(),
      satuan: n.unit,
      volume: angka(n.volume),
      hargaSatuan: angka(n.unitPrice),
      backup,
      sebabTanpaBackup: backup ? null : s?.jenis === "belum" ? SEBAB[s.sebab] : "Backup tidak ditemukan",
      analisaId: petaAnalisa.get(n.lineageKey)?.analisaId ?? null,
    };
  });

  return { item, analisa, hargaDasar };
}
