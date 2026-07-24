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

/** Nilai eksak (float) sebuah leaf: total_price ?? volume×unit_price ?? 0. */
function leafRaw(it: ParsedRabItem): number {
  return it.total_price ?? (it.volume != null && it.unit_price != null ? it.volume * it.unit_price : 0);
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
    let eff = code;
    let key = parentKey ? `${parentKey}#${eff}` : eff;
    for (let n = 2; usedKeys.has(key); n++) {
      eff = `${code}#${n}`;
      key = parentKey ? `${parentKey}#${eff}` : eff;
    }
    usedKeys.add(key);
    return { code: eff, key };
  };

  // Pohon bantu: tiap node menyimpan nilai EKSAK (float) + anak-anaknya, supaya
  // pembulatan ke rupiah bisa dilakukan top-down via apportionment (bukan
  // menjumlah nilai yang sudah dibulatkan per baris — itu yang dulu menyebabkan
  // total menyimpang beberapa/ratusan rupiah dari Excel).
  type Aux = { node: FlatNode; exact: number; children: Aux[] };

  const walkItem = (it: ParsedRabItem, parentKey: string, sink: FlatNode[]): Aux => {
    const { code, key } = dedup(parentKey, it.code);
    const isGrup = it.children.length > 0;
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
    if (isGrup) {
      let childExact = 0;
      for (const ch of it.children) {
        const ca = walkItem(ch, key, sink);
        aux.children.push(ca);
        childExact += ca.exact;
      }
      // Semantik sumLeaves lama: kalau semua anak nihil, pakai total_price sendiri
      // dan perlakukan grup ini sebagai leaf (tak ada anak untuk dibagi).
      if (childExact > 0) aux.exact = childExact;
      else {
        aux.exact = leafRaw(it);
        aux.children = [];
      }
    } else {
      aux.exact = leafRaw(it);
    }
    return aux;
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
      const a = walkItem(it, catKey, catBuf);
      catAux.children.push(a);
      catExact += a.exact;
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
        const a = walkItem(it, subKey, catBuf);
        subAux.children.push(a);
        subExact += a.exact;
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

  // Kategori bernilai 0 (template kosong: mis. SENTRA KULINER, BALAI NELAYAN)
  // TIDAK dimasukkan ke DB — tak ada pekerjaan di dalamnya.
  for (const c of cats) if (c.aux.node.amount > 0n) out.push(...c.buf);

  return out;
}

/** Grand total = Σ amount node kategori. */
export function grandTotal(nodes: FlatNode[]): bigint {
  let t = 0n;
  for (const n of nodes) if (n.kind === "kategori") t += n.amount;
  return t;
}
