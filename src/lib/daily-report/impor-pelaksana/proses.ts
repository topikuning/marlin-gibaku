import "server-only";
import type { WorkerRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { parseDateKey } from "@/lib/format";
import { DailyReportError, getOrCreateDraft, setEnrichment, upsertItem, type EnrichmentInput } from "../service";
import type { BacaanLaporan } from "./bentuk";
import { kenaliTemplatKkp, bacaTemplatKkp } from "./templat-kkp";
import {
  petakanBahan,
  petakanTenaga,
  periksaKonteks,
  susunUsulan,
  type BahanUsulan,
  type BarisUsulan,
  type KandidatItem,
  type TenagaUsulan,
} from "./cocok";

/**
 * Alur impor laporan harian pelaksana (DECISIONS 733): baca → pratinjau →
 * orang memilih → simpan lewat layanan laporan harian yang SAMA dengan input
 * manual (penjaga sisa RAB, nilai, histori, audit). Tidak ada angka progres
 * yang ditulis di sini.
 */

export class ImporPelaksanaError extends Error {}

export const BATAS_BYTE = 15 * 1024 * 1024;
const STATUS_BISA_DIISI = ["draft", "perlu_koreksi"];

export async function bacaBerkasPelaksana(buf: Buffer, nama: string, mime: string): Promise<BacaanLaporan> {
  if (mime !== "application/pdf" && !nama.toLowerCase().endsWith(".pdf")) {
    throw new ImporPelaksanaError("Baru berkas PDF yang bisa dibaca. Simpan laporannya sebagai PDF dulu.");
  }
  let items: Awaited<ReturnType<typeof import("./teks-pdf").teksHalamanPertama>>["items"] = [];
  try {
    const { teksHalamanPertama } = await import("./teks-pdf");
    items = (await teksHalamanPertama(new Uint8Array(buf))).items;
  } catch {
    // PDF rusak atau hasil pindai tanpa teks – dicoba lewat AI di bawah.
  }
  if (items.length > 0 && kenaliTemplatKkp(items)) return bacaTemplatKkp(items);
  const { bacaDenganAi } = await import("./ai-baca");
  const ai = await bacaDenganAi(buf, nama);
  if (!ai.ok) {
    throw new ImporPelaksanaError(
      items.length > 0
        ? `Format laporan ini belum dikenali MARLIN. ${ai.error}`
        : `PDF ini tidak memuat teks (mungkin hasil pindai). ${ai.error}`,
    );
  }
  return ai.bacaan;
}

/** Item RAB aktif (+ item draft adendum bila ada) beserta sisa yang masih bisa dilaporkan. */
export async function kandidatImpor(locationId: string, reportId: string | null): Promise<KandidatItem[]> {
  const revisi = await db.rabRevision.findMany({
    where: { locationId, status: { in: ["aktif", "draft"] } },
    select: { id: true, status: true, revisionNo: true },
  });
  if (revisi.length === 0) return [];
  const [nodes, kumAktif, kumSemua, diLaporan] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: { in: revisi.map((r) => r.id) } },
      select: { id: true, revisionId: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, lineageKey: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { lineageKey: "asc" }],
    }),
    cumulativeVolumeByLineage(locationId),
    cumulativeVolumeByLineage(locationId, undefined, "semua"),
    reportId
      ? db.dailyReportItem.findMany({ where: { reportId }, select: { lineageKey: true, volumeDone: true } })
      : Promise.resolve([]),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const statusRev = new Map(revisi.map((r) => [r.id, r.status]));
  const diLap = new Map(diLaporan.map((i) => [i.lineageKey, Number(i.volumeDone)]));
  const jalur = (id: string | null): string[] => {
    const hasil: string[] = [];
    for (let n = id ? byId.get(id) : undefined; n; n = n.parentId ? byId.get(n.parentId) : undefined) hasil.unshift(n.name);
    return hasil;
  };
  return nodes
    .filter((n) => n.kind === "item")
    .map((n) => {
      const basis = statusRev.get(n.revisionId) === "aktif" ? ("aktif" as const) : ("draft_adendum" as const);
      const volumeRab = n.volume != null ? Number(n.volume) : null;
      // Sama dengan penjaga di `upsertItem`: basis draft diadu dengan SELURUH realisasi.
      const kum = (basis === "aktif" ? kumAktif : kumSemua).get(n.lineageKey) ?? 0;
      return {
        id: n.id,
        lineageKey: n.lineageKey,
        kode: n.code ?? "",
        nama: n.name,
        jalur: jalur(n.parentId),
        satuan: n.unit,
        volumeRab,
        sisa: volumeRab != null ? Math.max(0, Math.round((volumeRab - kum) * 1000) / 1000) : null,
        basis,
        diLaporan: diLap.get(n.lineageKey) ?? null,
      };
    });
}

export type PratinjauImpor = {
  berkas: string;
  sumber: BacaanLaporan["sumber"];
  catatanBaca: string[];
  tanggalBerkas: string | null;
  peringatan: string[];
  baris: BarisUsulan[];
  kandidat: KandidatItem[];
  tenaga: TenagaUsulan;
  bahan: BahanUsulan[];
  laporan: { ada: boolean; status: string | null; bisaDiisi: boolean; adaTenaga: boolean };
};

export async function pratinjauImporPelaksana(o: {
  locationId: string;
  dateKey: string;
  buf: Buffer;
  nama: string;
  mime: string;
}): Promise<PratinjauImpor> {
  const tanggal = parseDateKey(o.dateKey);
  if (!tanggal) throw new ImporPelaksanaError("Tanggal laporan tidak valid.");
  const [lokasi, laporan] = await Promise.all([
    db.location.findUniqueOrThrow({ where: { id: o.locationId }, select: { name: true, village: true } }),
    db.dailyReport.findUnique({
      where: { locationId_reportDate: { locationId: o.locationId, reportDate: tanggal } },
      select: { id: true, status: true, _count: { select: { workers: true } } },
    }),
  ]);
  const bacaan = await bacaBerkasPelaksana(o.buf, o.nama, o.mime);
  const kandidat = await kandidatImpor(o.locationId, laporan?.id ?? null);
  const konteks = periksaKonteks(bacaan, { dateKey: o.dateKey, namaLokasi: lokasi.name, desa: lokasi.village });
  const bisaDiisi = !laporan || STATUS_BISA_DIISI.includes(laporan.status);
  const peringatan = [...konteks.peringatan];
  if (!bisaDiisi) peringatan.unshift("Laporan tanggal ini sudah dikirim, jadi isinya tidak bisa ditambah dari berkas.");
  if (kandidat.length === 0) peringatan.unshift("Lokasi ini belum punya RAB aktif, jadi pekerjaan belum bisa dicocokkan.");
  return {
    berkas: o.nama,
    sumber: bacaan.sumber,
    catatanBaca: bacaan.catatanBaca,
    tanggalBerkas: konteks.tanggalBerkas,
    peringatan,
    baris: susunUsulan(bacaan.pekerjaan, kandidat),
    kandidat,
    tenaga: petakanTenaga(bacaan.tenaga),
    bahan: petakanBahan(bacaan.bahan),
    laporan: {
      ada: !!laporan,
      status: laporan?.status ?? null,
      bisaDiisi,
      adaTenaga: (laporan?._count.workers ?? 0) > 0,
    },
  };
}

export type SimpanImporInput = {
  berkas: string;
  sumber: string;
  baris: { kandidatId: string; volume: number; uraian: string; catatan: string | null }[];
  /** `null` = tenaga kerja laporan tidak diubah. Bila diisi, MENGGANTI isian tenaga. */
  tenaga: { role: WorkerRole; count: number }[] | null;
  /** Ditambahkan ke bahan/alat yang sudah ada (nama sama tidak digandakan). */
  bahan: { jenis: "bahan" | "alat"; nama: string; qty: number | null; satuan: string | null }[];
};

export type HasilSimpanImpor = {
  reportId: string;
  tersimpan: number;
  ditolak: { uraian: string; pesan: string }[];
  tenagaDiganti: boolean;
  bahanDitambah: number;
  galatPelengkap: string | null;
};

export async function simpanImporPelaksana(
  locationId: string,
  dateKey: string,
  input: SimpanImporInput,
  userId: string,
): Promise<HasilSimpanImpor> {
  const laporan = await getOrCreateDraft(locationId, dateKey, userId);
  if (!STATUS_BISA_DIISI.includes(laporan.status)) {
    throw new ImporPelaksanaError("Laporan tanggal ini sudah dikirim, jadi isinya tidak bisa ditambah dari berkas.");
  }

  // Satu item = satu baris laporan: baris berkas yang menunjuk item sama dijumlahkan.
  const perItem = new Map<string, { volume: number; uraian: string[] }>();
  for (const b of input.baris) {
    if (!(b.volume > 0)) continue;
    const g = perItem.get(b.kandidatId) ?? { volume: 0, uraian: [] };
    g.volume += b.volume;
    g.uraian.push(b.catatan ? `${b.uraian} (${b.catatan})` : b.uraian);
    perItem.set(b.kandidatId, g);
  }
  let tersimpan = 0;
  const ditolak: HasilSimpanImpor["ditolak"] = [];
  for (const [rabNodeId, g] of perItem) {
    try {
      await upsertItem(
        laporan.id,
        {
          rabNodeId,
          volumeDone: Math.round(g.volume * 1000) / 1000,
          notes: `Dari laporan pelaksana: ${g.uraian.join("; ")}`.slice(0, 500),
        },
        userId,
      );
      tersimpan++;
    } catch (e) {
      if (!(e instanceof DailyReportError)) throw e;
      ditolak.push({ uraian: g.uraian.join("; "), pesan: e.message });
    }
  }

  let tenagaDiganti = false;
  let bahanDitambah = 0;
  let galatPelengkap: string | null = null;
  if (input.tenaga || input.bahan.length > 0) {
    const kini = await db.dailyReport.findUniqueOrThrow({
      where: { id: laporan.id },
      select: {
        workStart: true,
        workEnd: true,
        notes: true,
        workers: { select: { role: true, count: true } },
        materials: { select: { id: true, name: true, unit: true, qtyReceived: true } },
        equipment: { select: { id: true, name: true, count: true } },
      },
    });
    const sudah = new Set([...kini.materials, ...kini.equipment].map((x) => x.name.trim().toLowerCase()));
    const baru = input.bahan.filter((b) => b.nama.trim() && !sudah.has(b.nama.trim().toLowerCase()));
    const isian: EnrichmentInput = {
      // `weather` sengaja tidak dikirim: cuaca otomatis/manual dibiarkan apa adanya.
      workStart: kini.workStart,
      workEnd: kini.workEnd,
      notes: kini.notes,
      workers: input.tenaga ?? kini.workers.map((w) => ({ role: w.role, count: w.count })),
      materials: [
        ...kini.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, qty: m.qtyReceived != null ? Number(m.qtyReceived) : null })),
        ...baru.filter((b) => b.jenis === "bahan").map((b) => ({ id: null, name: b.nama, unit: b.satuan, qty: b.qty })),
      ],
      equipment: [
        ...kini.equipment.map((e) => ({ id: e.id, name: e.name, count: e.count })),
        ...baru.filter((b) => b.jenis === "alat").map((b) => ({ id: null, name: b.nama, count: Math.max(1, Math.round(b.qty ?? 1)) })),
      ],
    };
    try {
      await setEnrichment(laporan.id, isian, userId);
      tenagaDiganti = !!input.tenaga;
      bahanDitambah = baru.length;
    } catch (e) {
      if (!(e instanceof DailyReportError)) throw e;
      galatPelengkap = e.message;
    }
  }

  await audit(userId, "daily_report.impor_pelaksana", "daily_report", laporan.id, {
    berkas: input.berkas,
    sumber: input.sumber,
    baris: input.baris.length,
    tersimpan,
    ditolak: ditolak.length,
    tenagaDiganti,
    bahanDitambah,
  });
  return { reportId: laporan.id, tersimpan, ditolak, tenagaDiganti, bahanDitambah, galatPelengkap };
}
