import type { FlatNode } from "@/lib/rab/flatten";

/**
 * PERBAIKAN PEMBACAAN RAB AKTIF – tanpa adendum (DECISIONS 680).
 *
 * Laporan user 2026-10-15 (CCO Krakahan): item baru adendum tersimpan dengan
 * harga satuan KOSONG, jumlahnya ada. Pembacanya sudah dibetulkan (679), tapi
 * impor ulang "Jadikan RAB AKTIF sekarang" berakhir sebagai DRAFT yang menunggu
 * dua persetujuan (DECISIONS 234) – padahal tidak ada satu angka kontrak pun
 * yang berubah. *"ini harus diperbaiki tanpa skema adendum"*.
 *
 * Gerbang empat mata menjaga ISI kontrak: item apa, berapa volumenya, berapa
 * rupiahnya. Berkas yang sama persis isinya dengan RAB aktif tidak mengubah
 * satu pun dari itu – yang berbeda hanyalah apa yang dulu salah terbaca. Itu
 * bukan adendum, jadi dibetulkan langsung pada revisi aktif: node yang sama,
 * id yang sama, realisasi dan kurva-S tidak tersentuh.
 *
 * Yang boleh berbeda: harga satuan, satuan, nama, nomor, dan jenis judul
 * kelompok (kategori/sub/grup – pembaca berkembang, judulnya tetap judul).
 * Yang TIDAK: himpunan baris, induk, item yang jadi judul atau sebaliknya,
 * volume, jumlah. Satu saja dari itu berbeda, berkasnya memang mengubah
 * kontrak dan tetap lewat adendum.
 */
export type SimpulAktif = {
  id: string;
  lineageKey: string;
  parentLineageKey: string | null;
  kind: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  unitPrice: number | null;
  amount: bigint;
};

type Ganti<T> = { dari: T; ke: T };

export type PerubahanKoreksi = {
  id: string;
  lineageKey: string;
  kind: string;
  /** Nomor + nama SEBELUM dibetulkan – yang dikenal orang dari layar RAB. */
  label: string;
  unitPrice?: Ganti<number | null>;
  unit?: Ganti<string | null>;
  name?: Ganti<string>;
  code?: Ganti<string>;
  /** Jenis judul kelompok – tidak pernah item ↔ judul. */
  jenis?: Ganti<"kategori" | "sub" | "grup">;
};

export type HasilKoreksi =
  | {
      boleh: true;
      perubahan: PerubahanKoreksi[];
      /** Item yang harga satuannya dulu kosong, kini terisi. */
      hargaTerisi: number;
      /** Item yang harga satuannya sudah ada, kini terbaca lain. */
      hargaBerubah: number;
    }
  | {
      boleh: false;
      sebab: string[];
      /**
       * Jalur sempit (laporan user 2026-10-16): harga satuan yang KOSONG di RAB
       * aktif, untuk item yang volume dan jumlahnya cocok dengan berkas. Mengisinya
       * tidak mengubah satu angka kontrak pun, berapa pun perbedaan lain berkas
       * itu dengan RAB aktif.
       */
      hargaKosong: PerubahanKoreksi[];
    };

// Volume disimpan Decimal(15,3), harga Decimal(15,2): selisih di bawah satu
// satuan presisinya hanyalah pembulatan simpan, bukan angka yang berbeda.
const SAMA_VOLUME = 0.0005;
const SAMA_HARGA = 0.005;

const samaAngka = (a: number | null, b: number | null, eps: number) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) < eps;
const rapi = (s: string | null) => (s ?? "").trim();

export function bandingKoreksiBaca(aktif: SimpulAktif[], baru: FlatNode[]): HasilKoreksi {
  const aktifByKey = new Map(aktif.map((n) => [n.lineageKey, n]));
  const baruKeys = new Set(baru.map((n) => n.lineageKey));
  const label = (n: { code: string; name: string }) => [n.code, n.name].filter(Boolean).join(" ");

  const tambah: string[] = [];
  const hilang: string[] = [];
  const induk: string[] = [];
  const volume: string[] = [];
  const jumlah: string[] = [];
  for (const n of baru) {
    const a = aktifByKey.get(n.lineageKey);
    if (!a) {
      tambah.push(label(n));
      continue;
    }
    if (a.parentLineageKey !== n.parentLineageKey || (a.kind !== n.kind && (a.kind === "item" || n.kind === "item"))) {
      induk.push(label(a));
    }
    else if (!samaAngka(a.volume, n.volume, SAMA_VOLUME)) volume.push(label(a));
    else if (a.amount !== n.amount) jumlah.push(label(a));
  }
  for (const a of aktif) if (!baruKeys.has(a.lineageKey)) hilang.push(label(a));

  const kalimat = (daftar: string[], awal: string) => {
    if (daftar.length === 0) return null;
    const contoh = daftar.slice(0, 5).map((s) => `"${s}"`).join(", ");
    const sisa = daftar.length > 5 ? ` dan ${daftar.length - 5} lainnya` : "";
    return `${daftar.length} ${awal}: ${contoh}${sisa}.`;
  };
  const sebab = [
    kalimat(tambah, "baris tidak ada di RAB aktif"),
    kalimat(hilang, "baris RAB aktif tidak ada di berkas"),
    kalimat(induk, "baris pindah kelompok atau jenisnya berubah"),
    kalimat(volume, "item volumenya berbeda"),
    kalimat(jumlah, "baris jumlahnya berbeda"),
  ].filter((s): s is string => s != null);
  if (sebab.length > 0) return { boleh: false, sebab, hargaKosong: isiHargaKosong(aktif, baru) };

  const perubahan: PerubahanKoreksi[] = [];
  let hargaTerisi = 0;
  let hargaBerubah = 0;
  for (const n of baru) {
    const a = aktifByKey.get(n.lineageKey)!;
    const p: PerubahanKoreksi = { id: a.id, lineageKey: a.lineageKey, kind: a.kind, label: label(a) };
    if (!samaAngka(a.unitPrice, n.unitPrice, SAMA_HARGA)) {
      p.unitPrice = { dari: a.unitPrice, ke: n.unitPrice };
      if (a.unitPrice == null) hargaTerisi++;
      else hargaBerubah++;
    }
    if (rapi(a.unit) !== rapi(n.unit)) p.unit = { dari: a.unit, ke: n.unit };
    if (rapi(a.name) !== rapi(n.name)) p.name = { dari: a.name, ke: n.name };
    if (rapi(a.code) !== rapi(n.code)) p.code = { dari: a.code, ke: n.code };
    if (a.kind !== n.kind) p.jenis = { dari: a.kind as "kategori", ke: n.kind as "kategori" };
    if (p.unitPrice || p.unit || p.name || p.code || p.jenis) perubahan.push(p);
  }
  return { boleh: true, perubahan, hargaTerisi, hargaBerubah };
}

/**
 * Harga satuan yang kosong di RAB aktif, diisi dari berkas – hanya untuk item
 * yang volume (±0,0005) dan jumlahnya (rupiah persis) SAMA dengan baris
 * pasangannya, dan baris itu punya harga satuan. Item lain, dan harga yang
 * sudah terisi, tidak disentuh.
 *
 * Pasangan dicari lewat identitas baris (lineage) lebih dulu. Bila identitasnya
 * berbeda (susunan berkas tidak sama dengan RAB aktif), lewat nama + volume +
 * jumlah – dan hanya bila calonnya TUNGGAL. Dua calon kembar tidak ditebak.
 */
function isiHargaKosong(aktif: SimpulAktif[], baru: FlatNode[]): PerubahanKoreksi[] {
  const kunciNama = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const label = (n: { code: string; name: string }) => [n.code, n.name].filter(Boolean).join(" ");
  const cocok = (a: SimpulAktif, n: FlatNode) =>
    n.kind === "item" && n.unitPrice != null && samaAngka(a.volume, n.volume, SAMA_VOLUME) && a.amount === n.amount;

  const kosong = aktif.filter((a) => a.kind === "item" && a.unitPrice == null && a.amount > 0n);
  const baruByKey = new Map(baru.map((n) => [n.lineageKey, n]));
  const perNama = new Map<string, FlatNode[]>();
  for (const n of baru) {
    if (n.kind !== "item" || n.unitPrice == null) continue;
    const k = kunciNama(n.name);
    perNama.set(k, [...(perNama.get(k) ?? []), n]);
  }

  const dipakai = new Set<string>();
  const pasangan = new Map<string, FlatNode>();
  // Putaran 1: identitas baris yang sama.
  for (const a of kosong) {
    const n = baruByKey.get(a.lineageKey);
    if (n && cocok(a, n)) {
      pasangan.set(a.id, n);
      dipakai.add(n.lineageKey);
    }
  }
  // Putaran 2: nama + volume + jumlah, hanya bila tunggal.
  for (const a of kosong) {
    if (pasangan.has(a.id)) continue;
    const calon = (perNama.get(kunciNama(a.name)) ?? []).filter((n) => cocok(a, n));
    if (calon.length !== 1 || dipakai.has(calon[0].lineageKey)) continue;
    pasangan.set(a.id, calon[0]);
    dipakai.add(calon[0].lineageKey);
  }

  return kosong
    .filter((a) => pasangan.has(a.id))
    .map((a) => ({
      id: a.id,
      lineageKey: a.lineageKey,
      kind: a.kind,
      label: label(a),
      unitPrice: { dari: null, ke: pasangan.get(a.id)!.unitPrice },
    }));
}
