/**
 * Pembulatan penjaga-jumlah (metode sisa terbesar / largest remainder).
 *
 * Dipakai di mana pun sebuah kolom angka HARUS menjumlah tepat ke totalnya:
 * kolom "Bobot (%)" kurva-S yang di Excel berupa `=SUM(minggu)` (DECISIONS 157)
 * dan pecahan rencana mingguan → harian (DECISIONS 163). Kalau tiap sel
 * dibulatkan sendiri-sendiri, jumlahnya meleset dari angka resmi dan pembaca
 * melihat kolom yang tidak pas.
 *
 * Sel bernilai 0 TIDAK PERNAH menerima alokasi: hari/minggu tanpa pekerjaan
 * harus tetap kosong, jeda jangan sampai "ketempelan" satu satuan terakhir.
 * MURNI.
 */
export function allocateRounded(values: number[], target: number, scale: number): number[] {
  const units = values.map((v) => Math.floor(v * scale + 1e-9));
  const out = [...units];
  let rest = Math.round(target * scale) - units.reduce((s, u) => s + u, 0);
  const movable = values.map((v, i) => ({ i, frac: v * scale - units[i], v })).filter((x) => x.v > 0);
  if (movable.length === 0) return out.map((u) => u / scale);
  const order = [...movable].sort((a, b) =>
    rest > 0 ? b.frac - a.frac || b.v - a.v || a.i - b.i : a.frac - b.frac || a.v - b.v || a.i - b.i,
  );
  for (let k = 0; rest !== 0 && k < order.length * 4 + 16; k++) {
    const idx = order[k % order.length].i;
    if (rest > 0) {
      out[idx] += 1;
      rest -= 1;
    } else if (out[idx] > 0) {
      out[idx] -= 1;
      rest += 1;
    }
  }
  return out.map((u) => u / scale);
}
