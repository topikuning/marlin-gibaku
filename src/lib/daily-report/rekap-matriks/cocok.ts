import { kunciSatuan } from "@/lib/rab/padanan-draft-aturan";
import type { BarisRekap, Cocok, NodeRab } from "./jenis";

/**
 * PENCOCOKAN BARIS REKAP HARIAN → ITEM RAB AKTIF (DECISIONS 782). MURNI.
 *
 * Permintaan user: *"pastikan kamu tidak salah match"*.
 *
 * Nama saja tidak cukup: "Galian Tanah", "Bekisting Kayu", "Beton fc' 20 Mpa"
 * berulang di setiap bangunan. Yang membedakannya LETAK – di bawah judul
 * bangunan mana baris itu berada. Sheet REKAP HARIAN disusun dari RAB yang sama
 * (setiap barisnya rumus ke baris MC-0), jadi urutan barisnya sama dengan
 * urutan RAB. Kedua urutan disejajarkan (longest common subsequence atas nama,
 * judul ikut menjadi patokan), sehingga "Galian Tanah" ketiga di berkas jatuh
 * ke "Galian Tanah" ketiga di RAB, di bangunan yang sama.
 *
 * Hasil sejajar tetap diperiksa: harus item pekerjaan tanpa rincian, dan
 * satuannya setara. Baris yang tidak ikut sejajar dicari lewat nama + satuan,
 * dipersempit ke rentang di antara dua tetangga yang sudah cocok. Masih lebih
 * dari satu, atau tidak ada → TIDAK DITEBAK: orang memilih sendiri di
 * pratinjau.
 */

/** Bentuk baku nama untuk dibandingkan. */
export function kunciNama(s: string): string {
  return s
    .toLowerCase()
    .replace(/³/g, "3")
    .replace(/²/g, "2")
    .replace(/¹/g, "1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function satuanSetara(a: string | null, b: string | null): boolean {
  const ka = kunciSatuan(a);
  const kb = kunciSatuan(b);
  return ka == null || kb == null || ka === kb;
}

/** Pasangan (i, j) hasil penjajaran urutan; i = indeks baris rekap, j = indeks node. */
function sejajarkan(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const lebar = m + 1;
  // Uint16 cukup: panjang LCS ≤ min(n, m) < 65.536 baris.
  const dp = new Uint16Array((n + 1) * lebar);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * lebar + j] =
        a[i] !== "" && a[i] === b[j]
          ? dp[(i + 1) * lebar + j + 1]! + 1
          : Math.max(dp[(i + 1) * lebar + j]!, dp[i * lebar + j + 1]!);
    }
  }
  const pasang: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] !== "" && a[i] === b[j]) {
      pasang.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * lebar + j]! >= dp[i * lebar + j + 1]!) i++;
    else j++;
  }
  return pasang;
}

/**
 * Cocokkan baris yang BERISI angka ke node RAB aktif. Hasil per `excelRow`.
 * `nodes` urut seperti RAB (sortOrder), semua jenis (kategori ikut jadi patokan).
 */
export function cocokkanRekap(baris: readonly BarisRekap[], nodes: readonly NodeRab[]): Map<number, Cocok> {
  const a = baris.map((b) => kunciNama(b.nama));
  const bKunci = nodes.map((n) => kunciNama(n.name));
  const pasang = sejajarkan(a, bKunci);
  const keNode = new Map<number, number>(pasang);

  const hasil = new Map<number, Cocok>();
  const terpakai = new Set<string>();
  const perlu = baris.map((b, i) => ({ b, i })).filter(({ b }) => b.sel.length > 0);

  // Rentang patokan tiap pasangan: di antara pasangan sebelum dan sesudahnya.
  const rentang = new Map<number, [number, number]>();
  pasang.forEach(([pi], p) => rentang.set(pi, [pasang[p - 1]?.[1] ?? -1, pasang[p + 1]?.[1] ?? nodes.length]));

  // Tahap 1: hasil sejajar yang lolos pemeriksaan.
  for (const { b, i } of perlu) {
    const j = keNode.get(i);
    if (j == null) continue;
    const n = nodes[j]!;
    // Item bernama sama LAIN di antara dua patokan terdekat = letaknya tidak
    // pasti (berkas tidak memuat judul pembedanya). Tidak ditebak.
    const [kiri, kanan] = rentang.get(i)!;
    const pesaing = nodes.filter(
      (x, jx) => jx !== j && jx > kiri && jx < kanan && x.daun && kunciNama(x.name) === a[i] && satuanSetara(b.satuan, x.unit),
    );
    if (pesaing.length > 0 && satuanSetara(b.satuan, n.unit)) {
      hasil.set(b.excelRow, {
        lineageKey: null,
        sebab: `Ada ${pesaing.length + 1} item "${b.nama}" di RAB aktif dan berkas ini tidak memuat judul pembedanya. Pilih sendiri.`,
        kandidat: [n.lineageKey, ...pesaing.map((x) => x.lineageKey)],
      });
      continue;
    }
    if (!n.daun) {
      hasil.set(b.excelRow, {
        lineageKey: null,
        sebab: `"${n.name}" di RAB aktif punya rincian di bawahnya. Pilih rincian yang dimaksud.`,
        kandidat: [],
      });
      continue;
    }
    if (!satuanSetara(b.satuan, n.unit)) continue; // jatuh ke tahap 2
    hasil.set(b.excelRow, { lineageKey: n.lineageKey, cara: "urutan" });
    terpakai.add(n.lineageKey);
  }

  // Tahap 2: yang belum cocok – nama + satuan, dipersempit ke rentang tetangga.
  const daun = nodes.map((n, j) => ({ n, j })).filter(({ n }) => n.daun);
  for (const { b, i } of perlu) {
    if (hasil.has(b.excelRow)) continue;
    const k = kunciNama(b.nama);
    const sama = daun.filter(({ n }) => kunciNama(n.name) === k && satuanSetara(b.satuan, n.unit) && !terpakai.has(n.lineageKey));
    let pilih = sama;
    if (sama.length > 1) {
      // Rentang di antara tetangga terdekat yang sudah sejajar.
      let kiri = -1;
      let kanan = nodes.length;
      for (const [pi, pj] of pasang) {
        if (pi < i) kiri = pj;
        else if (pi > i) {
          kanan = pj;
          break;
        }
      }
      pilih = sama.filter(({ j }) => j > kiri && j < kanan);
    }
    if (pilih.length === 1) {
      hasil.set(b.excelRow, { lineageKey: pilih[0]!.n.lineageKey, cara: sama.length === 1 ? "nama" : "urutan" });
      terpakai.add(pilih[0]!.n.lineageKey);
      continue;
    }
    hasil.set(
      b.excelRow,
      sama.length > 1
        ? {
            lineageKey: null,
            sebab: `Ada ${sama.length} item "${b.nama}" di RAB aktif dan letaknya tidak bisa dipastikan. Pilih sendiri.`,
            kandidat: sama.map(({ n }) => n.lineageKey),
          }
        : {
            lineageKey: null,
            sebab: `"${b.nama}"${b.satuan ? ` (${b.satuan})` : ""} tidak ditemukan di RAB aktif. Pilih item yang dimaksud, atau lewati.`,
            kandidat: [],
          },
    );
  }
  return hasil;
}
