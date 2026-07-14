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

/** amount leaf: total_price ?? volume×unit_price ?? 0, dibulatkan ke rupiah. */
function leafAmount(it: ParsedRabItem): bigint {
  const raw =
    it.total_price ??
    (it.volume != null && it.unit_price != null ? it.volume * it.unit_price : 0);
  return BigInt(Math.round(raw));
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

  // Kembalikan amount node yang baru ditambahkan (untuk rollup ke atas).
  const walkItem = (it: ParsedRabItem, parentKey: string): bigint => {
    const { code, key } = dedup(parentKey, it.code);
    const isGrup = it.children.length > 0;
    const node: FlatNode = {
      kind: isGrup ? "grup" : "item",
      code,
      name: it.name,
      volume: it.volume,
      unit: it.unit,
      unitPrice: it.unit_price,
      amount: 0n, // diisi setelah anak dihitung
      lineageKey: key,
      parentLineageKey: parentKey,
      sortOrder: sort++,
    };
    out.push(node);
    if (isGrup) {
      let childSum = 0n;
      for (const ch of it.children) childSum += walkItem(ch, key);
      // Semantik sumLeaves lama: kalau semua anak nihil, pakai total_price sendiri.
      node.amount = childSum > 0n ? childSum : BigInt(Math.round(it.total_price ?? 0));
    } else {
      node.amount = leafAmount(it);
    }
    return node.amount;
  };

  for (const cat of parsed.categories) {
    const { code: catCode, key: catKey } = dedup(null, cat.roman);
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
    out.push(catNode);

    let catSum = 0n;

    // direct_items dulu (urutan dokumen: item langsung sebelum subkategori)
    for (const it of cat.direct_items) catSum += walkItem(it, catKey);

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
      out.push(subNode);
      let subSum = 0n;
      for (const it of s.items) subSum += walkItem(it, subKey);
      subNode.amount = subSum;
      catSum += subSum;
    }

    catNode.amount = catSum;
  }

  return out;
}

/** Grand total = Σ amount node kategori. */
export function grandTotal(nodes: FlatNode[]): bigint {
  let t = 0n;
  for (const n of nodes) if (n.kind === "kategori") t += n.amount;
  return t;
}
