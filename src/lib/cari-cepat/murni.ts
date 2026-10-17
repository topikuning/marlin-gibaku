/**
 * CARI CEPAT LOKASI & PAKET – aturan murni (DECISIONS 684).
 *
 * Permintaan user 2026-10-17: *"di topbar itu ada semacam command + K mac,
 * yang berisi pencarian lokasi/paket yang mempercepat navigasi ke lokasi
 * lain"* – tanpa harus kembali ke menu Lokasi lalu mencari lagi.
 */

/** Huruf kecil, tanpa tanda diakritik, selain huruf/angka jadi spasi. */
export function normalCari(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Saring + urutkan entri. Semua kata yang diketik wajib ada (di judul ATAU
 * keterangan); yang judulnya cocok lebih dulu:
 *
 * 0. judul diawali ketikan utuh
 * 1. salah satu kata judul diawali kata pertama ketikan
 * 2. judul memuat ketikan utuh
 * 3. semua kata ketikan ada di judul
 * 4. sisanya (cocok lewat desa, kabupaten, paket, perusahaan)
 *
 * Nilai sama → urutan asal (abjad dari server) dipertahankan.
 */
export function saringCari<T extends { judul: string; cari: string }>(entri: T[], kueri: string): T[] {
  const q = normalCari(kueri);
  if (!q) return [];
  const kata = q.split(" ");
  const bernilai: { e: T; nilai: number; i: number }[] = [];
  entri.forEach((e, i) => {
    const judul = normalCari(e.judul);
    const semua = `${judul} ${normalCari(e.cari)}`;
    if (!kata.every((k) => semua.includes(k))) return;
    const nilai = judul.startsWith(q)
      ? 0
      : judul.split(" ").some((w) => w.startsWith(kata[0]))
        ? 1
        : judul.includes(q)
          ? 2
          : kata.every((k) => judul.includes(k))
            ? 3
            : 4;
    bernilai.push({ e, nilai, i });
  });
  return bernilai.sort((a, b) => a.nilai - b.nilai || a.i - b.i).map((x) => x.e);
}

/**
 * Alamat lokasi lain DI TAB YANG SAMA: hanya segmen slug yang diganti. Satu
 * pengecualian: `foto-sarpras/[kunci]` – kunci sarana milik RAB lokasi asal,
 * belum tentu ada di lokasi tujuan, jadi berhenti di daftar sarananya.
 */
export function hrefLokasiSerupa(pathname: string, slug: string): string {
  const parts = pathname.split("/");
  // ["", "lokasi", "<slug>", ...sisa]
  if (parts[1] !== "lokasi" || parts.length < 3) return `/lokasi/${slug}`;
  parts[2] = slug;
  if (parts[3] === "foto-sarpras") parts.length = 4;
  return parts.join("/");
}

const POLA_PAKET = /^\/paket\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** Kunci "terakhir dibuka" dari alamat halaman: `l:<slug>` / `p:<id>`, selain itu `null`. */
export function kunciKunjungan(pathname: string): string | null {
  const l = /^\/lokasi\/([^/]+)/.exec(pathname);
  if (l) return `l:${decodeURIComponent(l[1])}`;
  const p = POLA_PAKET.exec(pathname);
  return p ? `p:${p[1].toLowerCase()}` : null;
}

/** Taruh kunci di depan, buang duplikat, simpan paling banyak `batas`. */
export function catatKunjungan(daftar: string[], kunci: string, batas = 6): string[] {
  return [kunci, ...daftar.filter((k) => k !== kunci)].slice(0, batas);
}
