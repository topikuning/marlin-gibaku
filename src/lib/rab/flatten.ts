import type { ParsedRab, ParsedRabItem } from "@/lib/rab/parsed";

/**
 * Flatten pohon ParsedRab → daftar node siap-insert ke model RabNode
 * (single-table). lineageKey = path kode digabung "#", stabil antar revisi,
 * dipakai untuk carry-over realisasi saat adendum.
 *
 * Duplikat kode antar-sibling (nyata di data HPS: kategori roman ganda,
 * sub "X.1" ganda, anak "6.a" ganda) → di-suffix `#2`, `#3`, … per sibling
 * (aturan lama rab-import untuk sub, digeneralisasi ke semua level) supaya
 * lineageKey unik (constraint @@unique([revisionId, lineageKey])).
 *
 * Pembulatan ke rupiah (uang = BigInt, tanpa sen) dilakukan TOP-DOWN via
 * apportionment (largest remainder): grand total = round(Σ nilai eksak) —
 * PERSIS seperti Excel yang menjumlah nilai penuh lalu membulatkan sekali —
 * lalu selisih pembulatan dibagi turun ke anak. Efeknya: (a) total lokasi
 * cocok dengan Excel (dulu Σ round-per-baris bisa meleset beberapa s.d.
 * ratusan rupiah), dan (b) anak SELALU menjumlah tepat ke induk (agregat
 * konsisten di semua level). DECISIONS 075.
 */

export type FlatNode = {
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: bigint;
  lineageKey: string;
  parentLineageKey: string | null;
  sortOrder: number;
};

/**
 * Nilai eksak (float) sebuah leaf.
 *
 * `cadangan` = boleh memakai `volume × unit_price` ketika kolom JUMLAH berkas
 * kosong. Bukan sakelar selera: yang memutuskannya `cadanganDipakaiBerkas`,
 * dari subtotal yang ditulis berkas itu sendiri.
 */
function leafRaw(it: ParsedRabItem, cadangan: boolean): number {
  if (it.total_price != null) return it.total_price;
  if (!cadangan) return 0;
  return it.volume != null && it.unit_price != null ? it.volume * it.unit_price : 0;
}

/** Nilai yang cadangan itu tambahkan pada satu baris (0 bila tidak berlaku). */
function nilaiCadangan(it: ParsedRabItem): number {
  return leafRaw(it, true) - leafRaw(it, false);
}

export type BarisTanpaJumlah = {
  code: string;
  name: string;
  volume: number;
  unitPrice: number;
  /** Nilai yang akan terbentuk SEANDAINYA dikarang – yang justru tidak dipakai. */
  seandainya: number;
};

/**
 * Baris yang punya volume DAN harga satuan tetapi kolom jumlahnya kosong di
 * berkas. Baris tanpa keduanya bukan temuan — itu baris judul atau keterangan.
 */
export function barisTanpaJumlah(parsed: ParsedRab): BarisTanpaJumlah[] {
  const out: BarisTanpaJumlah[] = [];
  const telusuri = (items: ParsedRabItem[]): void => {
    for (const it of items) {
      if (
        it.total_price == null &&
        it.volume != null &&
        it.volume !== 0 &&
        it.unit_price != null &&
        it.unit_price !== 0
      ) {
        out.push({
          code: it.code,
          name: it.name,
          volume: it.volume,
          unitPrice: it.unit_price,
          seandainya: it.volume * it.unit_price,
        });
      }
      telusuri(it.children);
    }
  };
  for (const c of parsed.categories) {
    telusuri(c.direct_items);
    for (const s of c.subcategories) telusuri(s.items);
  }
  return out;
}

/**
 * Apportionment "largest remainder" (metode Hamilton): bagi `target` rupiah ke
 * sekumpulan sibling sesuai nilai eksaknya, sehingga Σ hasil == target PERSIS.
 * Tiap sibling dapat floor(eksak); sisa (target − Σfloor) rupiah dibagikan +1
 * ke sibling dengan pecahan desimal terbesar. Ini membuat pembulatan uang
 * konsisten: total induk = round(Σ eksak) (SAMA dengan Excel yang menjumlah
 * nilai penuh lalu membulatkan sekali), sekaligus anak tetap menjumlah tepat
 * ke induk (tak ada "selisih sepersekian rupiah" yang menggelembung antar baris).
 * Deterministik: tie-break pecahan sama mengikuti urutan asli (sort stabil).
 */
export function apportion(exacts: number[], target: bigint): bigint[] {
  const n = exacts.length;
  if (n === 0) return [];
  const floors = exacts.map((e) => Math.floor(e));
  let base = 0n;
  for (const f of floors) base += BigInt(f);
  let k = Number(target - base); // banyak rupiah +1 yang harus dibagikan
  if (k < 0) k = 0;
  if (k > n) k = n;
  const order = exacts
    .map((e, i) => ({ i, rem: e - floors[i] }))
    .sort((a, b) => b.rem - a.rem);
  const bump = new Set(order.slice(0, k).map((o) => o.i));
  return floors.map((f, i) => BigInt(f) + (bump.has(i) ? 1n : 0n));
}

export function flattenParsedRab(parsed: ParsedRab): FlatNode[] {
  const out: FlatNode[] = [];
  let sort = 0;
  const usedKeys = new Set<string>();

  // Kode efektif + lineageKey unik GLOBAL. Suffix `#2` per duplikat; karena "#"
  // juga separator path, cek terus ke set global (mis. sub "X.1#2" vs anak
  // "X.1" → "2" yang kebetulan membentuk key sama) sampai bebas tabrakan.
  const dedup = (parentKey: string | null, code: string): { code: string; key: string } => {
    /*
     * Sufiksnya masuk ke KUNCI saja, tidak ke KODE.
     *
     * Versi lama menulisnya ke keduanya, sehingga kode yang sudah bersufiks dari
     * `hps-parser` ("II.1#2") bertambah lagi jadi "II.1#2#2" dan tersimpan
     * begitu di kolom `code` — kode yang tidak pernah ditulis siapa pun di
     * berkas HPS, lalu ikut tercetak di dokumen resmi. Kode adalah milik user
     * (DECISIONS 203); yang perlu unik hanyalah `lineageKey`.
     * Audit 2026-09-15 (D-3).
     */
    let key = parentKey ? `${parentKey}#${code}` : code;
    for (let n = 2; usedKeys.has(key); n++) {
      key = parentKey ? `${parentKey}#${code}#${n}` : `${code}#${n}`;
    }
    usedKeys.add(key);
    return { code, key };
  };

  // Pohon bantu: tiap node menyimpan nilai EKSAK (float) + anak-anaknya, supaya
  // pembulatan ke rupiah bisa dilakukan top-down via apportionment (bukan
  // menjumlah nilai yang sudah dibulatkan per baris — itu yang dulu menyebabkan
  // total menyimpang beberapa/ratusan rupiah dari Excel).
  type Aux = { node: FlatNode; exact: number; children: Aux[] };

  /*
   * BARIS YANG KOLOM JUMLAHNYA KOSONG — BERKAS YANG MEMUTUSKAN, BUKAN KITA.
   *
   * Cadangan `volume × harga satuan` itu TEBAKAN. Sering benar: banyak berkas
   * mengisi volume dan harga satuan lalu menjumlahkannya di tempat lain. Tapi
   * kadang berkasnya menyatakan sebaliknya, dan waktu itu terjadi, menebak
   * berarti mengarang uang.
   *
   * Kasus nyata (user 2026-09-17, `6 NEGO PENAWARAN KNMP DESA PANTAI HARAPAN
   * PENYANGGA DARAT.xlsx`): baris RAB!177 "Pekerjaan Pancang Cerucuk Dolken"
   * punya volume 288 dan harga satuan 38.237, tetapi sel JUMLAH-nya dihapus
   * saat negosiasi. Subtotal berkasnya sendiri `SUM(I166:I214)` karena itu
   * melewatinya, sementara cadangan mengarang 288 × 38.237 = 11.012.256 dan
   * memasukkannya. Pagar antar-layer menolak impornya — benar, tapi buntu:
   * berkasnya tidak bisa masuk sama sekali.
   *
   * Karena itu keputusannya PER KATEGORI dan berdasar bukti, bukan aturan
   * seragam: subtotal yang DITULIS berkas dibandingkan dengan kedua cara baca.
   * Yang cocok itulah yang dipakai. Kalau berkas tidak menulis subtotalnya,
   * tidak ada bukti apa pun untuk membantah tebakan, jadi cadangan tetap
   * dipakai seperti sebelumnya. Kalau dua-duanya meleset, biarkan cadangan —
   * pagar antar-layer yang akan menolak, dan pesannya menyebut kategori mana.
   *
   * Berapa pun keputusannya, barisnya disebutkan lewat `barisTanpaJumlah`:
   * volume dan harga satuan yang menganggur patut diperiksa orang, dan
   * DECISIONS 203 menuntut setiap perlakuan atas angka user dikatakan.
   */
  const cadanganDipakaiBerkas = (cat: ParsedRab["categories"][number]): boolean => {
    const ditulis = cat.total_value;
    if (!Number.isFinite(ditulis) || ditulis <= 0) return true;
    let tambahan = 0;
    const telusuri = (items: ParsedRabItem[]): void => {
      for (const it of items) {
        tambahan += nilaiCadangan(it);
        telusuri(it.children);
      }
    };
    telusuri(cat.direct_items);
    for (const s of cat.subcategories) telusuri(s.items);
    if (tambahan === 0) return true;

    const simpan = cadangan;
    let dengan = 0;
    cadangan = true;
    for (const it of cat.direct_items) dengan += nilaiEksak(it);
    for (const s of cat.subcategories) for (const it of s.items) dengan += nilaiEksak(it);
    let tanpa = 0;
    cadangan = false;
    for (const it of cat.direct_items) tanpa += nilaiEksak(it);
    for (const s of cat.subcategories) for (const it of s.items) tanpa += nilaiEksak(it);
    cadangan = simpan;

    // Toleransi 1 rupiah: pembulatan dilakukan sekali di puncak, sama seperti
    // Excel menjumlah nilai penuh lalu membulatkan.
    return !(Math.abs(tanpa - ditulis) <= 1 && Math.abs(dengan - ditulis) > 1);
  };

  /** Diset per kategori oleh `cadanganDipakaiBerkas` sebelum kategori ditelusuri. */
  let cadangan = true;

  /**
   * Nilai eksak sebuah baris, TANPA menyentuh penomoran kunci — dipakai
   * memutuskan bentuk pohon sebelum satu kunci pun dialokasikan.
   */
  const nilaiEksak = (it: ParsedRabItem): number => {
    if (it.children.length === 0) return leafRaw(it, cadangan);
    const anak = it.children.reduce((t, c) => t + nilaiEksak(c), 0);
    if (anak === 0) return leafRaw(it, cadangan);
    return dinaikkan(it) ? leafRaw(it, cadangan) : anak;
  };

  /*
   * BARIS INDUK YANG PUNYA NILAI SENDIRI **DAN** RINCIAN.
   *
   * `sumLeaves` (hps-parser, yang mengisi `parsed.total`) menjumlahkan keduanya:
   * "Item BERHARGA yang juga punya baris tambahan → jumlahkan keduanya, jangan
   * membuang nilai item induknya." Modul ini dulu hanya mengenal dua dari empat
   * cabang itu, sehingga nilai induknya lenyap — Rp 35.003.407 pada satu berkas
   * (`MC 1 FINAL GEMPOLSEWU`, baris 138: bekesting 96 m² × 364.618,83, dengan
   * empat baris pembesian/beton/vibrator di bawahnya). Dua calculation layer
   * mengucapkan dua angka untuk berkas yang sama, dan yang dipakai menulis DB
   * justru yang lebih kecil.
   *
   * Menaruh uang itu di node `grup` bukan jalan keluar: laporan harian dan
   * `hitungProgress` hanya mengenal `kind = 'item'`, jadi rupiah di node grup
   * tak akan pernah bisa dilaporkan dan Σ bobot item di blanko KKP jatuh di
   * bawah 100%.
   *
   * Jadi bentuknya yang dibaca ulang: induk yang punya `volume × harga` sendiri
   * adalah PEKERJAAN, bukan judul. Baris di bawahnya karena itu bukan
   * rinciannya — kalau memang rincian, jumlahnya akan sama dengan induknya, dan
   * itu ditangani cabang "subtotal" di bawah. Induknya dibaca sebagai item
   * biasa, baris-baris di bawahnya naik sejajar dengannya (urutan dokumen
   * tetap). Uangnya utuh, semuanya di daun, dan kedua layer akhirnya sepakat.
   */
  function dinaikkan(it: ParsedRabItem): boolean {
    if (it.children.length === 0) return false;
    const anak = it.children.reduce((t, c) => t + nilaiEksak(c), 0);
    const sendiri = leafRaw(it, cadangan);
    if (anak === 0 || sendiri === 0) return false;
    // Ambang SAMA dengan `sumLeaves`: selisih di dalamnya = baris subtotal.
    return Math.abs(sendiri - anak) > Math.max(2, anak * 0.001);
  }

  /**
   * Mengembalikan node itu sendiri, DIIKUTI baris-baris yang naik sejajar
   * dengannya (lihat `dinaikkan`). Umumnya berisi satu elemen.
   */
  const walkItem = (it: ParsedRabItem, parentKey: string, sink: FlatNode[]): Aux[] => {
    const naik = dinaikkan(it);
    const { code, key } = dedup(parentKey, it.code);
    const isGrup = it.children.length > 0 && !naik;
    const node: FlatNode = {
      kind: isGrup ? "grup" : "item",
      code,
      name: it.name,
      volume: it.volume,
      unit: it.unit,
      unitPrice: it.unit_price,
      amount: 0n, // diisi saat apportionment
      lineageKey: key,
      parentLineageKey: parentKey,
      sortOrder: sort++,
    };
    sink.push(node);
    const aux: Aux = { node, exact: 0, children: [] };
    const keluar: Aux[] = [aux];
    if (isGrup) {
      let childExact = 0;
      for (const ch of it.children) {
        for (const ca of walkItem(ch, key, sink)) {
          aux.children.push(ca);
          childExact += ca.exact;
        }
      }
      // Semantik sumLeaves lama: kalau semua anak nihil, pakai total_price sendiri
      // dan perlakukan grup ini sebagai leaf (tak ada anak untuk dibagi).
      if (childExact > 0) aux.exact = childExact;
      else {
        aux.exact = leafRaw(it, cadangan);
        aux.children = [];
      }
    } else {
      aux.exact = leafRaw(it, cadangan);
      // Baris di bawah item berharga naik SEJAJAR dengannya, tepat sesudahnya
      // (urutan dokumen), dengan induk yang sama.
      if (naik) for (const ch of it.children) keluar.push(...walkItem(ch, parentKey, sink));
    }
    return keluar;
  };

  // Bagikan `target` ke anak-anak `a` sesuai nilai eksak, rekursif ke bawah.
  const assign = (a: Aux, target: bigint): void => {
    a.node.amount = target;
    if (a.children.length > 0) {
      const alloc = apportion(
        a.children.map((c) => c.exact),
        target,
      );
      a.children.forEach((c, i) => assign(c, alloc[i]));
    }
  };

  // Pass 1: bangun struktur + nilai eksak per kategori (buffer ditahan dulu).
  const cats: { aux: Aux; buf: FlatNode[] }[] = [];
  for (const cat of parsed.categories) {
    cadangan = cadanganDipakaiBerkas(cat);
    const { code: catCode, key: catKey } = dedup(null, cat.roman);
    const catBuf: FlatNode[] = [];
    const catNode: FlatNode = {
      kind: "kategori",
      code: catCode,
      name: cat.name,
      volume: null,
      unit: null,
      unitPrice: null,
      amount: 0n,
      lineageKey: catKey,
      parentLineageKey: null,
      sortOrder: sort++,
    };
    catBuf.push(catNode);
    const catAux: Aux = { node: catNode, exact: 0, children: [] };
    let catExact = 0;

    // direct_items dulu (urutan dokumen: item langsung sebelum subkategori)
    for (const it of cat.direct_items) {
      for (const a of walkItem(it, catKey, catBuf)) {
        catAux.children.push(a);
        catExact += a.exact;
      }
    }

    for (const s of cat.subcategories) {
      const { code: subCode, key: subKey } = dedup(catKey, s.code);
      const subNode: FlatNode = {
        kind: "sub",
        code: subCode,
        name: s.name,
        volume: null,
        unit: null,
        unitPrice: null,
        amount: 0n,
        lineageKey: subKey,
        parentLineageKey: catKey,
        sortOrder: sort++,
      };
      catBuf.push(subNode);
      const subAux: Aux = { node: subNode, exact: 0, children: [] };
      let subExact = 0;
      for (const it of s.items) {
        for (const a of walkItem(it, subKey, catBuf)) {
          subAux.children.push(a);
          subExact += a.exact;
        }
      }
      subAux.exact = subExact;
      catAux.children.push(subAux);
      catExact += subExact;
    }

    catAux.exact = catExact;
    cats.push({ aux: catAux, buf: catBuf });
  }

  // Pass 2: grand total = round(Σ eksak) (SAMA dengan Excel), lalu apportion
  // turun ke kategori → sub → item → anak. Anak selalu menjumlah tepat ke induk.
  const grandExact = cats.reduce((s, c) => s + c.aux.exact, 0);
  const catTargets = apportion(
    cats.map((c) => c.aux.exact),
    BigInt(Math.round(grandExact)),
  );
  cats.forEach((c, i) => assign(c.aux, catTargets[i]));

  /*
   * Kategori bernilai 0 — DUA KEADAAN YANG BERLAWANAN, dan pembedanya bukan
   * nilainya.
   *
   * (a) TEMPLATE KOSONG (mis. SENTRA KULINER, BALAI NELAYAN pada HPS baru):
   *     judul kategori tanpa satu pun baris berharga. Tak ada pekerjaan di
   *     dalamnya, jadi tak ada yang perlu masuk DB.
   * (b) KATEGORI YANG DINOLKAN ADENDUM: barisnya utuh — kode, nama, satuan,
   *     harga satuan semua terbaca — hanya volumenya 0 di blok hasil.
   *
   * Sampai 2026-09-07 keduanya sama-sama dibuang, dan (b) itu mahal. Berkas
   * `MC 1 FINAL GEMPOLSEWU` menolkan seluruh kategori "III PEKERJAAN TAMBATAN
   * PERAHU" dan "IV PEKERJAAN DINDING PENAHAN TANAH"; karena barisnya tidak
   * pernah keluar dari sini, pratinjau impor tidak menemukan pasangannya dan
   * melaporkan *"146 item kontrak tidak ada di file ini"* — padahal semuanya
   * ada di berkas itu. Satu di antaranya sudah punya realisasi 22,61.
   *
   * Selisihnya bukan kosmetik: "item hilang" berarti realisasi lepas dari
   * induknya, sedangkan "volume kontrak jadi 0 padahal sudah dikerjakan"
   * adalah peringatan merah yang memang harus menyala.
   *
   * Yang membedakan: ADA BARIS BERHARGA di bawahnya. Template kosong tidak
   * punya satu pun harga satuan; kategori yang dinolkan punya semuanya.
   */
  for (const c of cats) {
    const adaBarisBerharga = c.buf.some((n) => (n.unitPrice ?? 0) > 0);
    if (c.aux.node.amount > 0n || adaBarisBerharga) out.push(...c.buf);
  }

  return out;
}

/** Grand total = Σ amount node kategori. */
export function grandTotal(nodes: FlatNode[]): bigint {
  let t = 0n;
  for (const n of nodes) if (n.kind === "kategori") t += n.amount;
  return t;
}

/**
 * Satu baris selisih antara apa yang DIBACA dari berkas dan apa yang AKAN
 * DISIMPAN. `label` = nama kategorinya, atau "SELURUH BERKAS" untuk grand total.
 */
export type BedaLayer = { label: string; berkas: bigint; masuk: bigint };

/**
 * PAGAR ANTAR CALCULATION LAYER — berlaku untuk SEMUA berkas, bukan berkas
 * tertentu.
 *
 * Rantai impor punya dua ruas, dan sampai 2026-09-07 hanya ruas pertama yang
 * dijaga:
 *
 *     berkas ──(hps-parser)──> parsed.total ──(flatten)──> RabNode.amount
 *              └── dijaga: Σ item vs total yang DITULIS berkas ┘
 *                                          └── TIDAK dijaga ───┘
 *
 * Ruas kedua itulah yang melewatkan Rp 35.003.407 pada `MC 1 FINAL GEMPOLSEWU`
 * (DECISIONS 543): `parsed.total` benar DAN sudah dicek-silang terhadap total
 * yang ditulis berkasnya sendiri, lalu modul ini menyimpan angka yang lain, dan
 * tak satu pun layar menyebutkan bedanya. Yang menemukannya bukan sistem —
 * melainkan user yang bertanya *"apakah totalnya sudah sama dengan file itu
 * untuk semua kategorinya?!"*
 *
 * Dua layer yang berselisih adalah cacat KODE, bukan cacat berkas: keduanya
 * membaca berkas yang sama. Karena itu keluarannya bukan peringatan yang bisa
 * dilewati — pemanggilnya wajib menolak menulis nilai kontrak sampai keduanya
 * sepakat. Kategori disebut namanya supaya berkas berikutnya tidak menuntut
 * pembedahan manual dari nol.
 *
 * `[]` = sepakat.
 */
export function bedaAntarLayer(parsed: ParsedRab, nodes: FlatNode[]): BedaLayer[] {
  const out: BedaLayer[] = [];
  const kat = nodes.filter((n) => n.kind === "kategori");

  /*
   * Pemasangan MENURUT URUTAN, bukan menurut kode: kode roman boleh kembar di
   * satu berkas (`flatten` men-suffix-nya `#2`), dan kategori yang sengaja
   * dibuang (template kosong, DECISIONS 542) membuat indeksnya bergeser.
   * Kategori yang tak punya pasangan memang tidak ditulis — yang perlu dijaga
   * di situ hanyalah nilainya nol.
   */
  let i = 0;
  for (const c of parsed.categories) {
    const berkas = BigInt(Math.round(c.total_value));
    const cocok = i < kat.length && kat[i].name === c.name && kat[i].code.split("#")[0] === c.roman;
    const masuk = cocok ? kat[i].amount : 0n;
    if (cocok) i++;
    // Pembulatan per kategori boleh meleset 1 rupiah: `flatten` membulatkan
    // SEKALI di puncak lalu membagi turun (largest remainder), persis seperti
    // Excel menjumlah nilai penuh baru membulatkan.
    if (berkas - masuk > 1n || masuk - berkas > 1n)
      out.push({ label: `${c.roman} ${c.name}`.trim(), berkas, masuk });
  }

  const grand = grandTotal(nodes);
  const berkasGrand = BigInt(Math.round(parsed.total));
  if (berkasGrand !== grand) out.push({ label: "SELURUH BERKAS", berkas: berkasGrand, masuk: grand });

  return out;
}
