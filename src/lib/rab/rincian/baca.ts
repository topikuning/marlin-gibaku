import { BukuRingan } from "./xlsx-ringan";
import { tanpaAwalanNamespace } from "@/lib/rab/xlsx-slim";
import { rujukanTunggal } from "./rumus";
import { Pelacak, PelacakAnalisa, type BlokAnalisa, type HargaDasar, type JejakSel, type Kepala } from "./lacak";

/**
 * RINCIAN SATU BERKAS RAB: backup volume, analisa, dan bahan & upah per item.
 *
 * Tidak menyentuh basis data dan tidak mengubah satu pun angka hasil impor –
 * ia hanya MEMBACA dari mana volume dan harga satuan item berasal (DECISIONS
 * baru, 2026-10-06). Volume dan harga resmi tetap yang dibaca `hps-parser`;
 * selisih antara RAB dan rinciannya disebut, tidak dibetulkan.
 */

export type ItemMasuk = {
  /** lineageKey node RAB. */
  kunci: string;
  excelRow: number;
  unitPrice: number | null;
};

export type CaraAnalisa =
  /** Baris item di RAB menunjuk Resume Analisa / ANALISA lewat rumus. */
  | "rumus"
  /**
   * Tidak ada rumus penunjuk; harga satuan item SAMA PERSIS dengan harga
   * satu-satunya baris Resume Analisa yang bernilai itu. Dicocokkan, bukan
   * ditulis penyusun – karena itu selalu ditandai di layar.
   */
  | "cocok_harga";

export type RincianItem = {
  kunci: string;
  excelRow: number;
  volume: JejakSel;
  analisa: { kunciBlok: string; cara: CaraAnalisa } | null;
};

export type RingkasanRincian = {
  item: number;
  volumeTertaut: number;
  volumeAngkaLangsung: number;
  volumeKosong: number;
  volumeTidakTerbaca: number;
  /**
   * Tertaut, tapi rumus RAB MENGOLAH nilai backup (mis. `=1/3*T433`,
   * `=K1479+E1479`, `='Vol'!P30*0`) – volume RAB ≠ angka di sheet backup, dan
   * itu tertulis di rumus penyusunnya, bukan galat bacaan.
   */
  volumeDiolah: number;
  /** Tertaut lurus (`='Vol'!M14`), tapi nilai tersimpannya berbeda – berkas belum dihitung ulang. */
  volumeBeda: number;
  analisaRumus: number;
  analisaCocokHarga: number;
  analisaTidakAda: number;
  /** Item yang harga satuan RAB-nya ≠ harga satuan analisanya. */
  hargaBeda: number;
  blokAnalisa: number;
  hargaDasar: number;
};

export type RincianBerkas = {
  sheetRab: string;
  kolom: { vol: number; price: number };
  items: RincianItem[];
  blokAnalisa: Map<string, BlokAnalisa>;
  hargaDasar: HargaDasar[];
  kepala: Record<string, Kepala>;
  /** Sheet tersembunyi yang DIBACA karena dirujuk rumus RAB. */
  tersembunyiDibaca: string[];
  ringkasan: RingkasanRincian;
};

const TOLERANSI = 0.005;

export function bedaAngka(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) > Math.max(TOLERANSI, Math.abs(a) * 1e-6);
}

export const kunciBlok = (b: Pick<BlokAnalisa, "sheet" | "barisAwal">) => `${b.sheet}!${b.barisAwal}`;

export async function bacaRincian(
  buf: Buffer | ArrayBuffer,
  opsi: { sheetRab: string; kolom: { vol: number; price: number }; items: ItemMasuk[] },
): Promise<RincianBerkas> {
  // Workbook ber-awalan namespace dibaca dengan bentuk yang sama dengan parser
  // RAB-nya (DECISIONS 664).
  const buku = await BukuRingan.buka(await tanpaAwalanNamespace(buf));
  const pelacak = new Pelacak(buku);
  const pAnalisa = new PelacakAnalisa(buku, pelacak);
  const blokAnalisa = new Map<string, BlokAnalisa>();
  const items: RincianItem[] = [];
  const tanpaAnalisa: { i: number; harga: number }[] = [];

  // Volume dulu untuk semua item, baru analisa – supaya sheet yang dibuka
  // berurutan (RAB + backup, lalu Resume Analisa + ANALISA + Bahan & Upah).
  for (const it of opsi.items) {
    const volume = await pelacak.lacak(opsi.sheetRab, opsi.kolom.vol, it.excelRow);
    items.push({ kunci: it.kunci, excelRow: it.excelRow, volume, analisa: null });
  }
  for (const [i, it] of opsi.items.entries()) {
    const blok = await pAnalisa.untukBaris(opsi.sheetRab, it.excelRow);
    if (blok) {
      const k = kunciBlok(blok);
      blokAnalisa.set(k, blok);
      items[i]!.analisa = { kunciBlok: k, cara: "rumus" };
    } else if (it.unitPrice != null && it.unitPrice > 0) {
      tanpaAnalisa.push({ i, harga: it.unitPrice });
    }
  }

  // Cadangan: cocokkan harga satuan dengan baris Resume Analisa – HANYA bila
  // harganya sama persis dan cuma satu baris resume yang bernilai itu.
  if (tanpaAnalisa.length > 0) {
    const indeks = await pAnalisa.indeksHargaResume();
    for (const t of tanpaAnalisa) {
      const kandidat = indeks.get(Math.round(t.harga * 100));
      if (!kandidat || kandidat.length !== 1) continue;
      const blok = await pAnalisa.blokDariResume(kandidat[0]!);
      if (!blok) continue;
      const k = kunciBlok(blok);
      blokAnalisa.set(k, blok);
      items[t.i]!.analisa = { kunciBlok: k, cara: "cocok_harga" };
    }
  }

  const ringkasan: RingkasanRincian = {
    item: items.length,
    volumeTertaut: 0,
    volumeAngkaLangsung: 0,
    volumeKosong: 0,
    volumeTidakTerbaca: 0,
    volumeDiolah: 0,
    volumeBeda: 0,
    analisaRumus: 0,
    analisaCocokHarga: 0,
    analisaTidakAda: 0,
    hargaBeda: 0,
    blokAnalisa: blokAnalisa.size,
    hargaDasar: pAnalisa.hargaDasar.size,
  };
  for (const [i, it] of items.entries()) {
    const v = it.volume;
    if (v.status === "tertaut") {
      ringkasan.volumeTertaut++;
      if (!volumeLurus(v)) ringkasan.volumeDiolah++;
      else if (bedaAngka(v.nilaiRab, jumlahSumber(v))) ringkasan.volumeBeda++;
    } else if (v.status === "angka_langsung") ringkasan.volumeAngkaLangsung++;
    else if (v.status === "kosong") ringkasan.volumeKosong++;
    else ringkasan.volumeTidakTerbaca++;
    if (!it.analisa) ringkasan.analisaTidakAda++;
    else {
      if (it.analisa.cara === "rumus") ringkasan.analisaRumus++;
      else ringkasan.analisaCocokHarga++;
      const blok = blokAnalisa.get(it.analisa.kunciBlok);
      if (bedaAngka(opsi.items[i]!.unitPrice, blok?.hargaSatuan ?? null)) ringkasan.hargaBeda++;
    }
  }

  return {
    sheetRab: opsi.sheetRab,
    kolom: opsi.kolom,
    items,
    blokAnalisa,
    hargaDasar: [...pAnalisa.hargaDasar.values()],
    kepala: Object.fromEntries(pelacak.kepala),
    tersembunyiDibaca: [...pelacak.tersembunyiDibaca].sort(),
    ringkasan,
  };
}

/** Rumus sel RAB cuma meneruskan satu sel di sheet lain (`='Vol'!M14`). */
export function volumeLurus(v: JejakSel): boolean {
  if (v.rumusRab == null || v.sumber.length !== 1) return false;
  const r = rujukanTunggal(v.rumusRab);
  return r != null && r.sheet != null;
}

/**
 * Nilai sel ujung yang bisa dibandingkan dengan sel RAB: hanya bila sel RAB
 * menunjuk SATU sel ujung. Rumus gabungan (`=A!M1+B!M4`) atau berpengali
 * tidak dibandingkan – hasilnya bukan jumlah sederhana.
 */
export function jumlahSumber(v: JejakSel): number | null {
  if (v.sumber.length !== 1) return null;
  return v.sumber[0]!.nilai;
}

/**
 * Ganti kunci item (mis. nomor baris Excel → lineage final). Item yang tidak
 * ada di peta dibuang – pemanggil yang menghitung dan mengatakannya.
 */
export function gantiKunci(r: RincianBerkas, peta: Map<string, string>): RincianBerkas {
  return {
    ...r,
    items: r.items.flatMap((it) => {
      const k = peta.get(it.kunci);
      return k ? [{ ...it, kunci: k }] : [];
    }),
  };
}
