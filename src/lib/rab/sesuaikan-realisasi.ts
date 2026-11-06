/**
 * PENYESUAIAN REALISASI saat adendum menurunkan volume di bawah yang sudah
 * dilaporkan — murni, tanpa DB.
 *
 * ### Kenapa ada
 *
 * Permintaan user 2026-09-03: *"saat pemetaan manual itu konfirmasi, maka
 * laporan harian yang sebelumnya langsung menyesuaikan volume baru."*
 *
 * Keadaan nyatanya (berkas KRANJI): item "Pekerjaan Galian Tanah sampai dengan
 * 1 m" dilaporkan 45,7 m³ dan tuntas. Adendum memindahkannya ke baris pengganti
 * bervolume 32,15 m³ — dan di lapangan pekerjaannya memang akhirnya sebesar itu.
 * Angka 45,7 di laporan bukan lagi fakta; ia sisa dari spesifikasi lama.
 *
 * Angka RESMI sebenarnya sudah aman tanpa ini: prestasi dan nilai sama-sama
 * dibatasi `LEAST(1, Σvol/volRAB)`, jadi item itu terbaca 100% dengan nilai
 * penuh baris barunya. Yang tidak aman adalah DOKUMEN-nya — blanko harian
 * menuliskan 45,7 m³ terpasang atas baris kontrak 32,15 m³, dan itu harus
 * dijelaskan ke PPK setiap kali dibaca.
 *
 * ### Kenapa proporsional
 *
 * Keputusan user 2026-09-03. Realisasi lazim terkumpul dari beberapa hari, dan
 * tidak ada cara mengetahui hari MANA yang tersalip adendum. Membagi rata
 * menjaga bentuk kurva progres per hari; memotong dari yang terbaru akan
 * menihilkan satu hari kerja yang sebenarnya ada.
 *
 * ### Kenapa harus PERSIS
 *
 * Hasilnya wajib menjumlah tepat ke volume baru. Menskalakan lalu membulatkan
 * tiap baris sendiri-sendiri meninggalkan sisa beberapa mili, dan sisa itu
 * membuat item terbaca 99,98% selamanya — cacat yang mustahil ditelusuri dari
 * layar. Karena itu dipakai pembagian sisa terbesar (Hamilton) pada satuan
 * MILI, presisi kolom `volume_done Decimal(15,3)`.
 */

/** Presisi kolom `volume_done` / `volume`: 3 desimal. */
const MILI = 1000;

/**
 * Bagi `targetTotal` ke tiap baris sesuai porsinya. Σ hasil == `targetTotal`
 * PERSIS (pada presisi 3 desimal).
 *
 * Mengembalikan `null` bila tidak ada yang perlu disesuaikan — Σ sekarang sudah
 * ≤ target, atau tidak ada yang bisa dibagi. `null`, bukan salinan yang sama,
 * supaya pemanggilnya tidak menulis ulang baris yang tidak berubah.
 */
export function sesuaikanProporsional(volume: number[], targetTotal: number): number[] | null {
  if (volume.length === 0) return null;
  const mili = volume.map((v) => Math.round(v * MILI));
  const total = mili.reduce((t, v) => t + v, 0);
  const target = Math.round(targetTotal * MILI);
  if (target < 0) return null;
  // Belum melebihi: tidak ada yang perlu diperbaiki. Adendum yang MENAIKKAN
  // volume tidak boleh menggelembungkan laporan yang sudah ada.
  if (total <= target) return null;
  if (total === 0) return null;

  const eksak = mili.map((v) => (v * target) / total);
  const bawah = eksak.map((e) => Math.floor(e));
  const sisa = target - bawah.reduce((t, v) => t + v, 0);
  const urut = eksak
    .map((e, i) => ({ i, pecahan: e - bawah[i]! }))
    .sort((a, b) => b.pecahan - a.pecahan || a.i - b.i);
  const naik = new Set(urut.slice(0, Math.max(0, Math.min(sisa, eksak.length))).map((o) => o.i));

  return bawah.map((b, i) => (b + (naik.has(i) ? 1 : 0)) / MILI);
}

/**
 * KELEBIHAN DIPOTONG DARI BARIS DRAFT DULU (DECISIONS 745).
 *
 * Jawaban user 2026-11-06 atas pertanyaan "saat adendum disahkan dengan
 * volume lebih kecil dari yang sudah dilaporkan, apakah kelebihannya dipotong
 * dari baris draft dulu?": *"ya"*.
 *
 * Sejak 742 satu item bisa punya baris KONTRAK (resmi, mungkin sudah ditagih)
 * dan baris DRAFT ADENDUM (di atas volume kontrak, belum resmi). Membagi rata
 * kelebihannya ke semua baris menurunkan juga pekerjaan yang sah di dalam
 * kontrak – contoh: kontrak 100 + draft 150, disahkan 180 → dulu 72 + 108.
 * Sekarang:
 *  - kelebihan diserap baris draft lebih dulu, dibagi rata DI ANTARA baris
 *    draft (`sesuaikanProporsional`, menjumlah persis);
 *  - baru bila baris draft habis (0) dan masih lebih – adendum menurunkan
 *    volume di bawah realisasi kontrak sendiri – baris kontrak dibagi rata
 *    seperti ketetapan 2026-09-03.
 *
 * `dariDraft[i]` = baris i dilaporkan terhadap draft adendum. Tanpa baris
 * draft hasilnya sama dengan `sesuaikanProporsional`.
 */
export function sesuaikanDraftDulu(volume: number[], dariDraft: boolean[], targetTotal: number): number[] | null {
  const mili = (v: number) => Math.round(v * MILI);
  const total = volume.reduce((t, v) => t + mili(v), 0);
  const target = mili(targetTotal);
  if (target < 0 || total <= target) return null;
  const iDraft = volume.map((_, i) => i).filter((i) => dariDraft[i]);
  const iKontrak = volume.map((_, i) => i).filter((i) => !dariDraft[i]);
  if (iDraft.length === 0) return sesuaikanProporsional(volume, targetTotal);

  const totalKontrak = iKontrak.reduce((t, i) => t + mili(volume[i]!), 0);
  const hasil = [...volume];
  if (totalKontrak <= target) {
    // Kelebihan muat di baris draft: baris kontrak utuh.
    const draftBaru = sesuaikanProporsional(
      iDraft.map((i) => volume[i]!),
      (target - totalKontrak) / MILI,
    );
    if (!draftBaru) return null;
    iDraft.forEach((i, k) => (hasil[i] = draftBaru[k]!));
    return hasil;
  }
  // Draft habis, masih lebih: draft 0, kontrak dibagi rata ke target.
  for (const i of iDraft) hasil[i] = 0;
  const kontrakBaru = sesuaikanProporsional(
    iKontrak.map((i) => volume[i]!),
    targetTotal,
  );
  if (kontrakBaru) iKontrak.forEach((i, k) => (hasil[i] = kontrakBaru[k]!));
  return hasil;
}
