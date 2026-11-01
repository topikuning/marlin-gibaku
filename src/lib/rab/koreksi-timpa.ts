import type { FlatNode } from "@/lib/rab/flatten";

/**
 * KOREKSI RAB AKTIF = DITIMPA DI TEMPAT (DECISIONS 728).
 *
 * Ketetapan user 2026-11-01: *"perintahku untuk pilihan jadikan rab aktif
 * sekarang oleh dan hanya super admin adalah koreksi, bukan adendum"*, dengan
 * pilihan "timpa revisi aktif di tempat". Dulu (680/681) hanya berkas yang
 * item, volume, dan jumlahnya SAMA PERSIS yang dibetulkan di tempat; berkas
 * lain dijadikan REVISI ADENDUM baru, ikut dihitung sebagai CCO, dan draft
 * adendum pertama sesudahnya tercetak CCO-02.
 *
 * Kini isi revisi aktif disamakan dengan berkas:
 * - baris yang identitasnya (lineage) sama DIUBAH di tempat – id node tetap,
 *   jadi laporan harian, rencana mingguan, backup, dan analisa tetap menunjuk
 *   barang yang sama;
 * - baris baru DITAMBAHKAN;
 * - baris yang tidak ada lagi di berkas DIHAPUS – kecuali masih dipakai
 *   laporan harian/rencana (pemeriksaannya di sisi DB, bukan di sini).
 *
 * MURNI: tanpa DB. Identitas sudah disamakan lebih dulu oleh `samakanLineage`.
 */

export type SimpulAktifTimpa = {
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
  sortOrder: number;
};

type Ganti<T> = { dari: T; ke: T };

export type UbahTimpa = {
  id: string;
  lineageKey: string;
  /** Nomor + nama SEBELUM dikoreksi. */
  label: string;
  kind?: Ganti<string>;
  code?: Ganti<string>;
  name?: Ganti<string>;
  unit?: Ganti<string | null>;
  volume?: Ganti<number | null>;
  unitPrice?: Ganti<number | null>;
  amount?: Ganti<bigint>;
  induk?: Ganti<string | null>;
  sortOrder?: Ganti<number>;
};

export type RencanaTimpa = {
  ubah: UbahTimpa[];
  tambah: FlatNode[];
  hapus: { id: string; lineageKey: string; label: string; kind: string }[];
  /** Item yang menjadi judul kelompok – laporan harian tidak boleh menempel di judul. */
  jadiJudul: { id: string; label: string }[];
  ringkas: {
    volume: number;
    harga: number;
    jumlah: number;
    pindah: number;
    lain: number;
    tambah: number;
    hapus: number;
  };
};

// Volume disimpan Decimal(15,3), harga Decimal(15,2): selisih di bawah satu
// satuan presisinya hanyalah pembulatan simpan, bukan angka yang berbeda.
const SAMA_VOLUME = 0.0005;
const SAMA_HARGA = 0.005;
const samaAngka = (a: number | null, b: number | null, eps: number) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) < eps;
const rapi = (s: string | null) => (s ?? "").trim();
const labelDari = (n: { code: string; name: string }) => [n.code, n.name].filter(Boolean).join(" ");

export function rencanaKoreksiTimpa(aktif: readonly SimpulAktifTimpa[], baru: readonly FlatNode[]): RencanaTimpa {
  const aktifByKey = new Map(aktif.map((n) => [n.lineageKey, n]));
  const baruKeys = new Set(baru.map((n) => n.lineageKey));
  const ubah: UbahTimpa[] = [];
  const tambah: FlatNode[] = [];
  const jadiJudul: RencanaTimpa["jadiJudul"] = [];
  const ringkas = { volume: 0, harga: 0, jumlah: 0, pindah: 0, lain: 0, tambah: 0, hapus: 0 };

  for (const n of baru) {
    const a = aktifByKey.get(n.lineageKey);
    if (!a) {
      tambah.push(n);
      continue;
    }
    const u: UbahTimpa = { id: a.id, lineageKey: a.lineageKey, label: labelDari(a) };
    if (a.kind !== n.kind) {
      u.kind = { dari: a.kind, ke: n.kind };
      if (a.kind === "item") jadiJudul.push({ id: a.id, label: u.label });
    }
    if (rapi(a.code) !== rapi(n.code)) u.code = { dari: a.code, ke: n.code };
    if (rapi(a.name) !== rapi(n.name)) u.name = { dari: a.name, ke: n.name };
    if (rapi(a.unit) !== rapi(n.unit)) u.unit = { dari: a.unit, ke: n.unit };
    if (!samaAngka(a.volume, n.volume, SAMA_VOLUME)) u.volume = { dari: a.volume, ke: n.volume };
    if (!samaAngka(a.unitPrice, n.unitPrice, SAMA_HARGA)) u.unitPrice = { dari: a.unitPrice, ke: n.unitPrice };
    if (a.amount !== n.amount) u.amount = { dari: a.amount, ke: n.amount };
    if (a.parentLineageKey !== n.parentLineageKey) u.induk = { dari: a.parentLineageKey, ke: n.parentLineageKey };
    if (a.sortOrder !== n.sortOrder) u.sortOrder = { dari: a.sortOrder, ke: n.sortOrder };

    const beda = Object.keys(u).length > 3;
    if (!beda) continue;
    ubah.push(u);
    // Satu baris dihitung SEKALI, di sebab terberatnya – ringkasannya dibaca orang.
    if (u.volume) ringkas.volume++;
    else if (u.unitPrice) ringkas.harga++;
    else if (u.amount) ringkas.jumlah++;
    else if (u.induk) ringkas.pindah++;
    else if (u.kind || u.code || u.name || u.unit) ringkas.lain++;
  }
  const hapus = aktif
    .filter((a) => !baruKeys.has(a.lineageKey))
    .map((a) => ({ id: a.id, lineageKey: a.lineageKey, label: labelDari(a), kind: a.kind }));
  ringkas.tambah = tambah.length;
  ringkas.hapus = hapus.length;
  return { ubah, tambah, hapus, jadiJudul, ringkas };
}

/** Kalimat satu perubahan untuk pratinjau dan jejak audit yang dibaca orang. */
export function kalimatUbah(u: UbahTimpa, fmt: { angka: (n: number | null) => string; rupiah: (n: number | null) => string }): string {
  return [
    u.volume ? `volume ${fmt.angka(u.volume.dari)} → ${fmt.angka(u.volume.ke)}` : null,
    u.unitPrice ? `harga satuan ${fmt.rupiah(u.unitPrice.dari)} → ${fmt.rupiah(u.unitPrice.ke)}` : null,
    u.amount && !u.volume && !u.unitPrice ? `jumlah ${fmt.rupiah(Number(u.amount.dari))} → ${fmt.rupiah(Number(u.amount.ke))}` : null,
    u.induk ? "pindah kelompok" : null,
    u.kind ? `jenis ${u.kind.dari} → ${u.kind.ke}` : null,
    u.code ? `nomor ${u.code.dari} → ${u.code.ke}` : null,
    u.name ? `nama → "${u.name.ke}"` : null,
    u.unit ? `satuan "${u.unit.dari ?? ""}" → "${u.unit.ke ?? ""}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
