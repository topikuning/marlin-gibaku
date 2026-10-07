/**
 * RUJUKAN DI DALAM RUMUS EXCEL (DECISIONS baru, backup volume & analisa).
 *
 * Murni dan tanpa I/O: dipakai pelacak rincian untuk tahu sel mana yang
 * dirujuk sebuah rumus. Yang dikenali hanya bentuk yang memang dipakai berkas
 * RAB KKP – sel tunggal dan rentang, dengan atau tanpa nama sheet, dengan atau
 * tanpa `$`. Rujukan kolom/baris utuh (`A:A`, `3:3`), nama terdefinisi, dan
 * rujukan ke berkas lain (`[1]Sheet!A1`) TIDAK diikuti: menebaknya lebih
 * berbahaya daripada mengatakan "tidak tertaut".
 */

export type Rujukan = {
  /** null = sheet yang sama dengan sel pemilik rumus. */
  sheet: string | null;
  c1: number;
  r1: number;
  c2: number;
  r2: number;
};

export function kolomKeAngka(huruf: string): number {
  let n = 0;
  for (const ch of huruf.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function angkaKeKolom(c: number): string {
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function alamat(c: number, r: number): string {
  return `${angkaKeKolom(c)}${r}`;
}

/** "M14" / "$M$14" → { c, r }; null bila bukan alamat sel. */
export function bacaAlamat(a: string): { c: number; r: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim());
  if (!m) return null;
  return { c: kolomKeAngka(m[1]!), r: Number(m[2]) };
}

// Nama sheet: 'apa saja (kutip ganda '' di dalamnya)' atau token tanpa spasi.
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!`;
const SEL = String.raw`\$?([A-Za-z]{1,3})\$?(\d+)`;
const POLA = new RegExp(String.raw`(\[[^\]]*\])?(?:${SHEET})?${SEL}(?::${SEL})?(?![\w(!])`, "g");

/**
 * Semua rujukan sel di sebuah rumus. Teks dalam tanda kutip ganda dibuang
 * dulu supaya "A1" di dalam string tidak terbaca sebagai sel.
 */
export function rujukanDalam(rumus: string): Rujukan[] {
  const bersih = rumus.replace(/"(?:[^"]|"")*"/g, '""');
  const hasil: Rujukan[] = [];
  for (const m of bersih.matchAll(POLA)) {
    const awal = m.index ?? 0;
    // Bagian dari nama lain (mis. "LOG10" atau "ABC1_x") – huruf/angka tepat sebelumnya.
    const sebelum = bersih[awal - 1];
    if (sebelum && /[\w.$]/.test(sebelum) && !m[2] && !m[3]) continue;
    if (m[1]) continue; // rujukan ke berkas lain
    const sheet = m[2] != null ? m[2].replace(/''/g, "'") : (m[3] ?? null);
    const c1 = kolomKeAngka(m[4]!);
    const r1 = Number(m[5]);
    const c2 = m[6] ? kolomKeAngka(m[6]) : c1;
    const r2 = m[7] ? Number(m[7]) : r1;
    if (c1 > 16384 || c2 > 16384 || r1 < 1 || r2 < 1) continue;
    hasil.push({
      sheet,
      c1: Math.min(c1, c2),
      r1: Math.min(r1, r2),
      c2: Math.max(c1, c2),
      r2: Math.max(r1, r2),
    });
  }
  return hasil;
}

/**
 * Rumus yang isinya HANYA satu rujukan sel (boleh dibungkus kurung), mis.
 * `='Resume Analisa'!D6` atau `=(RABX!G10)`. Sel seperti ini cuma penerus:
 * rinciannya ada di sel yang dirujuk, jadi pelacak melompat ke sana.
 */
export function rujukanTunggal(rumus: string): Rujukan | null {
  let t = rumus.trim().replace(/^=/, "").trim();
  while (/^\(.*\)$/.test(t)) t = t.slice(1, -1).trim();
  const r = rujukanDalam(t);
  if (r.length !== 1) return null;
  const x = r[0]!;
  if (x.c1 !== x.c2 || x.r1 !== x.r2) return null;
  // Sisa teks selain rujukannya harus kosong.
  const sisa = t
    .replace(/^(\[[^\]]*\])?(?:'(?:[^']|'')+'|[^'!]+)!/, "")
    .replace(/^\$?[A-Za-z]{1,3}\$?\d+$/, "");
  return sisa === "" ? x : null;
}
