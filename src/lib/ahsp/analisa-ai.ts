import "server-only";
import { aiStructured } from "@/lib/ai/structured";
import { checkAiGuard, AiGuardError } from "@/lib/ai-hub/guard";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { analisaKontrakLokasi } from "./analisa-kontrak";
import {
  BATAS_ITEM_ANALISA_AI,
  cocokkanUsulanAnalisa,
  hasilAnalisaAiSchema,
  type TargetAnalisaAi,
  type UsulanAnalisaAi,
} from "./analisa-ai-parse";
import { itemUntukRapl } from "./rapl";
import { kunciSumberDaya } from "./rapl-calc";

/**
 * Draf ANALISA dari AI untuk item RAB yang tidak punya analisa sama sekali
 * (DECISIONS baru 2026-10-07): bukan dari berkas kontrak, bukan dari padanan
 * AHSP yang disetujui, bukan dirinci tangan, bukan borongan.
 *
 * Seperti draf harga (DECISIONS 441/475): jawabannya menjadi baris berstatus
 * `draf`, tidak ikut hitungan sampai DITERIMA orang, dan dipanggil DI LATAR.
 */

export type TargetAnalisaSiap = {
  lokasi: { name: string; regency: string; province: string };
  target: (TargetAnalisaAi & { jalur: string; volume: number | null; hargaSatuan: number | null })[];
  /** Sumber daya yang sudah dipakai analisa kontrak / diberi harga lokasi – supaya AI memakai nama yang sama. */
  sumberDaya: { kategori: string; nama: string; satuan: string; harga: number | null }[];
  totalTanpa: number;
  tidakDiminta: number;
};

/** Item yang belum punya cara hitung apa pun – sasaran draf analisa AI. */
export async function itemTanpaAnalisa(locationId: string) {
  const [items, draf] = await Promise.all([
    itemUntukRapl(locationId),
    db.raplAnalisaAi.findMany({ where: { locationId, status: "draf" }, select: { lineageKey: true } }),
  ]);
  const menunggu = new Set(draf.map((d) => d.lineageKey));
  const tanpa = items.filter(
    (it) =>
      it.analisa === null &&
      it.volume !== null &&
      it.rincian?.hargaBorongan == null &&
      (it.rincian?.tambahan.length ?? 0) === 0 &&
      // Usulan AHSP yang tinggal disetujui bukan "belum terpetakan".
      !it.adaUsulan,
  );
  return { tanpa, menungguDraf: menunggu };
}

/**
 * Siapkan target. DIPANGGIL DI DALAM REQUEST supaya penolakan yang bisa
 * dijawab tanpa provider ("semua item sudah punya analisa") sampai seketika.
 * Urutan: yang dicentang/dipilih orang, kalau tidak: nilai RAB terbesar.
 */
export async function siapkanTargetAnalisa(
  locationId: string,
  dipilih?: ReadonlySet<string>,
): Promise<TargetAnalisaSiap | { error: string }> {
  const [lokasi, { tanpa, menungguDraf }] = await Promise.all([
    db.location.findUnique({ where: { id: locationId }, select: { name: true, regency: true, province: true } }),
    itemTanpaAnalisa(locationId),
  ]);
  if (!lokasi) return { error: "Lokasi tidak ditemukan." };
  if (tanpa.length === 0) return { error: "Semua item sudah punya analisa, rincian, atau harga borongan." };

  const kandidat = dipilih && dipilih.size > 0
    ? tanpa.filter((t) => dipilih.has(t.lineageKey))
    : tanpa.filter((t) => !menungguDraf.has(t.lineageKey));
  if (kandidat.length === 0) {
    return {
      error: dipilih
        ? "Item yang dipilih sudah punya analisa atau rincian."
        : "Semua item tanpa analisa sudah punya draf AI yang menunggu keputusan. Putuskan dulu drafnya.",
    };
  }
  const urut = [...kandidat].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const pilih = urut.slice(0, BATAS_ITEM_ANALISA_AI);

  const aktif = await db.rabRevision.findFirst({ where: { locationId, status: "aktif" }, select: { id: true } });
  const nodes = aktif
    ? await db.rabNode.findMany({
        where: { revisionId: aktif.id },
        select: { id: true, parentId: true, lineageKey: true, name: true, unit: true, unitPrice: true, volume: true },
      })
    : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byLk = new Map(nodes.map((n) => [n.lineageKey, n]));
  const jalur = (lk: string) => {
    const out: string[] = [];
    let p = byLk.get(lk)?.parentId ?? null;
    while (p && out.length < 6) {
      const n = byId.get(p);
      if (!n) break;
      out.unshift(n.name);
      p = n.parentId;
    }
    return out.join(" › ");
  };

  // Sumber daya yang sudah punya nama di lokasi ini: komponen analisa kontrak
  // (dengan harganya bila seragam) + HSD lokasi. AI diminta memakai nama yang
  // SAMA supaya harganya langsung terpakai, bukan nama baru yang kosong harga.
  const [kontrak, hsd] = await Promise.all([
    analisaKontrakLokasi(locationId),
    db.hargaSatuanDasar.findMany({ where: { locationId }, select: { kategori: true, nama: true, satuan: true, harga: true } }),
  ]);
  const sd = new Map<string, { kategori: string; nama: string; satuan: string; harga: Set<number>; n: number }>();
  for (const a of kontrak.values()) {
    for (const k of a.komponen) {
      const satuan = (k.satuan ?? "").trim();
      const kk = kunciSumberDaya(k.kategori, k.nama, satuan);
      const x = sd.get(kk) ?? { kategori: k.kategori, nama: k.nama, satuan, harga: new Set<number>(), n: 0 };
      if (k.harga != null) x.harga.add(Math.round(k.harga));
      x.n++;
      sd.set(kk, x);
    }
  }
  for (const h of hsd) {
    const kk = kunciSumberDaya(h.kategori, h.nama, h.satuan);
    const x = sd.get(kk) ?? { kategori: h.kategori, nama: h.nama, satuan: h.satuan, harga: new Set<number>(), n: 0 };
    x.harga = new Set([Number(h.harga)]);
    x.n += 1000; // harga lokasi selalu diikutkan
    sd.set(kk, x);
  }
  const sumberDaya = [...sd.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 250)
    .map((x) => ({ kategori: x.kategori, nama: x.nama, satuan: x.satuan, harga: x.harga.size === 1 ? [...x.harga][0]! : null }));

  return {
    lokasi,
    target: pilih.map((it, i) => {
      const n = byLk.get(it.lineageKey);
      return {
        id: `r${i + 1}`,
        lineageKey: it.lineageKey,
        code: it.code,
        uraian: it.uraian,
        satuan: n?.unit?.trim() || it.satuanNorm || "satuan",
        jalur: jalur(it.lineageKey),
        volume: it.volume,
        hargaSatuan: n?.unitPrice == null ? null : Number(n.unitPrice),
      };
    }),
    sumberDaya,
    totalTanpa: tanpa.length,
    tidakDiminta: kandidat.length - pilih.length,
  };
}

export type HasilUsulanAnalisaAi = { ok: true; model: string; usulan: UsulanAnalisaAi[] } | { ok: false; error: string };

export function promptAnalisa(siap: TargetAnalisaSiap): string {
  return [
    `Lokasi proyek: ${siap.lokasi.name}, ${siap.lokasi.regency}, ${siap.lokasi.province}, Indonesia. Proyek Kampung Nelayan (bangunan dan prasarana pesisir).`,
    "Susun ANALISA HARGA SATUAN (gaya AHSP PUPR / SNI) untuk tiap item pekerjaan di bawah: daftar bahan, upah, dan alat beserta KOEFISIEN per SATU satuan item itu.",
    "Aturan:",
    "- Koefisien dihitung per 1 satuan item seperti tertulis di kolom satuan item (mis. per 1 m³, per 1 m², per 1 Ls), bukan per satuan lain.",
    "- Bila sumber dayanya sama dengan salah satu di DAFTAR SUMBER DAYA LOKASI, pakai nama dan satuannya PERSIS seperti di daftar, supaya harganya bisa dipakai. Bila tidak ada, pakai nama yang lazim di Indonesia.",
    "- Harga satuan kontrak item diberikan sebagai pembanding skala: jumlah koefisien × harga biasanya sedikit di bawah harga satuan kontrak (selisihnya overhead & keuntungan, umumnya 10–15%). Jangan memaksakan sama persis.",
    "- Untuk item Ls/paket (mobilisasi, K3, papan nama, dll.), uraikan sumber daya yang wajar untuk 1 paket itu.",
    "- Bila suatu item tidak bisa diuraikan dengan wajar, LEWATI item itu. Jangan mengarang.",
    "- Jangan mengubah id. Ini draf untuk diperiksa orang, bukan angka resmi.",
    "ITEM:",
    JSON.stringify(
      siap.target.map((t) => ({
        id: t.id,
        kode: t.code,
        uraian: t.uraian,
        kelompok: t.jalur,
        satuan: t.satuan,
        volume: t.volume,
        harga_satuan_kontrak: t.hargaSatuan,
      })),
    ),
    "DAFTAR SUMBER DAYA LOKASI (kategori|nama|satuan|harga):",
    siap.sumberDaya.map((s) => `${s.kategori}|${s.nama}|${s.satuan}|${s.harga ?? "-"}`).join("\n") || "(belum ada)",
  ].join("\n");
}

/** Panggil provider untuk target yang sudah disiapkan. Dipakai dari latar. */
export async function usulkanAnalisaDenganAi(
  user: SessionUser,
  siap: TargetAnalisaSiap,
  opsi: { tenggatTotalMs?: number } = {},
): Promise<HasilUsulanAnalisaAi> {
  const prompt = promptAnalisa(siap);
  try {
    await checkAiGuard(user, { kind: "rapl.usulan_analisa", locationCount: 1, inputChars: prompt.length });
  } catch (err) {
    if (err instanceof AiGuardError) return { ok: false, error: err.message };
    throw err;
  }
  const result = await aiStructured(hasilAnalisaAiSchema, {
    system:
      "Anda estimator biaya konstruksi Indonesia yang menyusun analisa harga satuan pekerjaan. Jujur soal ketidakpastian: tandai keyakinan rendah bila datanya tipis. Jangan mengaku melakukan survei atau memperoleh penawaran.",
    prompt,
    schemaHint:
      '{"items":[{"id":"r1","keyakinan":"rendah|sedang|tinggi","alasan":"dasar analisa, maksimal 300 karakter","komponen":[{"kategori":"bahan|upah|alat","nama":"Semen Portland","satuan":"kg","koefisien":326}]}]}',
    maxTokens: 6000,
    timeoutMs: 90_000,
    ...(opsi.tenggatTotalMs ? { tenggatTotalMs: opsi.tenggatTotalMs } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };
  const usulan = cocokkanUsulanAnalisa(siap.target, result.data.items);
  if (usulan.length === 0) return { ok: false, error: "AI tidak menghasilkan analisa yang bisa dipakai untuk item-item ini." };
  return { ok: true, model: result.meta.model, usulan };
}
