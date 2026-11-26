import type { FlatNode } from "@/lib/rab/flatten";
import { normalNama } from "@/lib/rab/cocok-lineage";
import { satuanSetara } from "@/lib/rab/padanan-draft-aturan";

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

/**
 * Satu baris RAB aktif yang PINDAH tempat bersama sub/grupnya (DECISIONS 790):
 * id node tetap, kuncinya berganti dari `dari` ke `ke`. Laporan harian dan
 * semua yang menunjuk kunci lama ikut dipindah saat koreksi disimpan.
 */
export type PindahTimpa = { id: string; dari: string; ke: string };

/** Ringkasan satu sub/grup yang pindah – untuk pratinjau dan jejak audit. */
export type PindahAkarTimpa = {
  /** Nomor + nama SEBELUM koreksi. */
  label: string;
  /** Nomor + nama di berkas. */
  labelBaru: string;
  /** Induk lama dan induk barunya (nomor + nama). */
  indukDari: string;
  indukKe: string;
  /** Banyaknya baris yang ikut pindah, termasuk sub/grupnya sendiri. */
  baris: number;
};

export type RencanaTimpa = {
  ubah: UbahTimpa[];
  tambah: FlatNode[];
  hapus: { id: string; lineageKey: string; label: string; kind: string }[];
  /** Baris yang pindah tempat bersama sub/grupnya – lihat `cariPindah`. */
  pindah: PindahTimpa[];
  pindahAkar: PindahAkarTimpa[];
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

// Volume disimpan Decimal(15,3), harga Decimal(15,2). Yang dibandingkan adalah
// angka SEBAGAIMANA AKAN DISIMPAN, bukan selisih mentahnya: berkas 45,3125 dan
// RAB aktif 45,313 sama persis begitu disimpan, tapi selisihnya tepat 0,0005 dan
// dulu terbaca "volume 45,313 → 45,313" di pratinjau BUYAT (DECISIONS 790).
const DESIMAL_VOLUME = 3;
const DESIMAL_HARGA = 2;
/**
 * Angka sebagaimana tersimpan: Postgres menerima angka JS sebagai float dan
 * mengubahnya ke numeric lewat 15 digit bermakna (berkas BUYAT: 113,08849999999998
 * tersimpan 113,089), lalu membulatkan setengah menjauhi nol.
 */
function bulatSimpan(x: number, d: number): number {
  const s = Math.abs(x).toPrecision(15);
  const m = s.includes("e") ? Math.round(Math.abs(x) * 10 ** d) : Math.round(Number(`${s}e${d}`));
  return (Math.sign(x) || 1) * m;
}
const samaAngka = (a: number | null, b: number | null, d: number) =>
  a == null || b == null ? a == null && b == null : bulatSimpan(a, d) === bulatSimpan(b, d);
const rapi = (s: string | null) => (s ?? "").trim();
const labelDari = (n: { code: string; name: string }) => [n.code, n.name].filter(Boolean).join(" ");

/**
 * SUB/GRUP YANG HANYA PINDAH TEMPAT (DECISIONS 790).
 *
 * Kasus nyata BUYAT TENGAH (user 2026-11-26): sub "III.2 Pekerjaan Pasangan
 * Batu" tertulis di bawah kategori IV – salah tulis, seharusnya IV.2. Laporan
 * harian sudah masuk ke itemnya. Kunci item memuat jalur kategorinya, jadi
 * koreksi dengan berkas yang benar membaca "item lama dihapus, item baru
 * ditambah", lalu menolak karena itemnya sudah dilaporkan. Pengguna dipaksa
 * memindah laporan satu per satu untuk pekerjaan yang sama persis.
 *
 * Sebuah sub/grup dianggap PEKERJAAN YANG SAMA di tempat baru bila:
 * - ia hilang dari tempat lamanya, dan di berkas ada sub/grup baru yang
 *   namanya sama – TUNGGAL di kedua sisi (tidak ditebak bila kembar);
 * - SELURUH isinya berpasangan satu lawan satu: jenis, nama, dan satuan sama,
 *   tidak ada yang kurang atau lebih. Nomor, volume, dan harga boleh berbeda –
 *   itulah yang dikoreksi.
 *
 * Satu item yang berdiri sendiri tidak pernah dipindah lintas tempat: nama
 * satu baris terlalu lemah sebagai bukti ("Pekerjaan Galian Tanah" ada di
 * hampir semua kategori). Kategori juga tidak, karena kategori adalah akar.
 *
 * Hasilnya peta kunci lama → kunci di berkas, untuk akar dan seluruh isinya.
 */
function cariPindah(aktif: readonly SimpulAktifTimpa[], baru: readonly FlatNode[]): Map<string, string> {
  const kunciAktif = new Set(aktif.map((n) => n.lineageKey));
  const kunciBaru = new Set(baru.map((n) => n.lineageKey));
  const hilang = new Set(aktif.filter((n) => !kunciBaru.has(n.lineageKey)).map((n) => n.lineageKey));
  const muncul = new Set(baru.filter((n) => !kunciAktif.has(n.lineageKey)).map((n) => n.lineageKey));
  const peta = new Map<string, string>();
  if (hilang.size === 0 || muncul.size === 0) return peta;

  const anak = <T extends { parentLineageKey: string | null }>(xs: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      if (x.parentLineageKey == null) continue;
      const arr = m.get(x.parentLineageKey);
      if (arr) arr.push(x);
      else m.set(x.parentLineageKey, [x]);
    }
    return m;
  };
  const anakAktif = anak(aktif);
  const anakBaru = anak(baru);
  const kelas = (kind: string) => (kind === "sub" ? "sub" : "item");
  const tanda = (x: { kind: string; name: string; lineageKey: string }, anakDari: Map<string, unknown[]>) =>
    `${kelas(x.kind)}|${anakDari.has(x.lineageKey) ? 1 : 0}|${normalNama(x.name)}`;

  /** Pasangan seluruh isi `a` ↔ `b`, atau null bila ada yang tidak berpasangan. */
  const pasangkanIsi = (a: string, b: string): [string, string][] | null => {
    const xa = anakAktif.get(a) ?? [];
    const xb = anakBaru.get(b) ?? [];
    if (xa.length !== xb.length) return null;
    const antre = new Map<string, FlatNode[]>();
    for (const y of xb) {
      const k = tanda(y, anakBaru);
      const arr = antre.get(k);
      if (arr) arr.push(y);
      else antre.set(k, [y]);
    }
    const hasil: [string, string][] = [];
    // Nama kembar di antara saudara dipasangkan menurut urutan dokumen.
    for (const x of [...xa].sort((p, q) => p.sortOrder - q.sortOrder)) {
      const y = antre.get(tanda(x, anakAktif))?.shift();
      if (!y || !hilang.has(x.lineageKey) || !muncul.has(y.lineageKey)) return null;
      if (!satuanSetara(x.unit, y.unit)) return null;
      hasil.push([x.lineageKey, y.lineageKey]);
      const dalam = pasangkanIsi(x.lineageKey, y.lineageKey);
      if (!dalam) return null;
      hasil.push(...dalam);
    }
    return hasil;
  };

  // Kategori tidak pernah dipindah; item tanpa isi gugur di bawah (tidak membawa item).
  const calon = <T extends { kind: string; lineageKey: string }>(xs: readonly T[], sisi: Set<string>) =>
    xs.filter((x) => x.kind !== "kategori" && sisi.has(x.lineageKey));
  const calonAktif = calon(aktif, hilang);
  const calonBaru = calon(baru, muncul);
  const jenisAktif = new Map(aktif.map((n) => [n.lineageKey, n.kind]));
  const terpakaiBaru = new Set<string>();
  const kedalaman = (k: string) => k.split("#").length;
  // Dari yang paling atas: sub yang pindah membawa seluruh grup di dalamnya.
  for (const a of [...calonAktif].sort((p, q) => kedalaman(p.lineageKey) - kedalaman(q.lineageKey))) {
    if (peta.has(a.lineageKey)) continue;
    const t = tanda(a, anakAktif);
    const lawan = calonBaru.filter((b) => !terpakaiBaru.has(b.lineageKey) && tanda(b, anakBaru) === t);
    const sesama = calonAktif.filter((x) => !peta.has(x.lineageKey) && tanda(x, anakAktif) === t);
    if (lawan.length !== 1 || sesama.length !== 1) continue;
    const b = lawan[0];
    if (!satuanSetara(a.unit, b.unit)) continue;
    const isi = pasangkanIsi(a.lineageKey, b.lineageKey);
    if (!isi || !isi.some(([x]) => jenisAktif.get(x) === "item")) continue;
    for (const [x, y] of [[a.lineageKey, b.lineageKey] as [string, string], ...isi]) {
      peta.set(x, y);
      terpakaiBaru.add(y);
    }
  }
  return peta;
}

export function rencanaKoreksiTimpa(aktifAsli: readonly SimpulAktifTimpa[], baru: readonly FlatNode[]): RencanaTimpa {
  /*
   * Baris yang pindah diberi kunci barunya LEBIH DULU, lalu dibandingkan seperti
   * baris lain: yang tersisa hanya perubahan nomor/induk/angka, di node yang
   * sama. `dari` tetap tercatat supaya penyimpan memindah rujukannya.
   */
  const peta = cariPindah(aktifAsli, baru);
  const ganti = (k: string | null) => (k == null ? null : (peta.get(k) ?? k));
  const aktif = peta.size === 0 ? aktifAsli : aktifAsli.map((n) => ({ ...n, lineageKey: ganti(n.lineageKey)!, parentLineageKey: ganti(n.parentLineageKey) }));
  const pindah: PindahTimpa[] = aktifAsli.filter((n) => peta.has(n.lineageKey)).map((n) => ({ id: n.id, dari: n.lineageKey, ke: peta.get(n.lineageKey)! }));
  const asliByKey = new Map(aktifAsli.map((n) => [n.lineageKey, n]));
  const baruByKey = new Map(baru.map((n) => [n.lineageKey, n]));
  const pindahAkar: PindahAkarTimpa[] = aktifAsli
    .filter((n) => peta.has(n.lineageKey) && !(n.parentLineageKey && peta.has(n.parentLineageKey)))
    .map((n) => {
      const b = baruByKey.get(peta.get(n.lineageKey)!)!;
      const iDari = n.parentLineageKey ? asliByKey.get(n.parentLineageKey) : undefined;
      const iKe = b.parentLineageKey ? baruByKey.get(b.parentLineageKey) : undefined;
      return {
        label: labelDari(n),
        labelBaru: labelDari(b),
        indukDari: iDari ? labelDari(iDari) : "",
        indukKe: iKe ? labelDari(iKe) : "",
        baris: pindah.filter((p) => p.dari === n.lineageKey || p.dari.startsWith(`${n.lineageKey}#`)).length,
      };
    });

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
    if (!samaAngka(a.volume, n.volume, DESIMAL_VOLUME)) u.volume = { dari: a.volume, ke: n.volume };
    if (!samaAngka(a.unitPrice, n.unitPrice, DESIMAL_HARGA)) u.unitPrice = { dari: a.unitPrice, ke: n.unitPrice };
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
  return { ubah, tambah, hapus, pindah, pindahAkar, jadiJudul, ringkas };
}

/** Kalimat satu sub/grup yang pindah tempat (DECISIONS 790), untuk pratinjau dan pesan hasil. */
export function kalimatPindah(p: PindahAkarTimpa): string {
  // Induk sama: yang berubah hanya kuncinya (mis. nomor kembar), bukan letaknya.
  if (p.indukDari === p.indukKe) {
    return (
      `${p.label} (${p.baris} baris) tetap di ${p.indukKe}` +
      `${p.labelBaru !== p.label ? ` sebagai ${p.labelBaru}` : ""} – dikenali dari nama dan isinya`
    );
  }
  return (
    `${p.label} pindah ke ${p.indukKe}${p.labelBaru !== p.label ? ` sebagai ${p.labelBaru}` : ""} (${p.baris} baris)` +
    (p.indukDari ? ` – sebelumnya di ${p.indukDari}` : "")
  );
}

/** Bagian pesan hasil koreksi tentang yang pindah tempat; "" bila tidak ada. Diawali spasi. */
export function kalimatHasilPindah(h: {
  pindahAkar: readonly PindahAkarTimpa[];
  rujukanDipindah: { laporanHarian: number } | null;
}): string {
  if (h.pindahAkar.length === 0) return "";
  const laporan = h.rujukanDipindah?.laporanHarian ?? 0;
  return ` ${h.pindahAkar.map(kalimatPindah).join("; ")}.` + (laporan > 0 ? ` ${laporan} baris laporan harian ikut pindah.` : "");
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
