/**
 * PEMETAAN ITEM TERLAPOR KE ITEM DRAFT ADENDUM – aturan murni (DECISIONS 754).
 *
 * Permintaan user 2026-11-10: *"intinya sebelum aktif item yang sudah
 * terlaporkan, harus bisa dipetakan dengan pekerjaan yang ada di draft
 * adendum"*. Sampai sini pemetaan hanya bisa di layar pratinjau impor –
 * *"waktunya terlalu pendek"*.
 *
 * Caranya sama dengan pratinjau impor (`samakanLineage`): item draft MEWARISI
 * `lineageKey` item kontrak lama, jadi realisasinya ikut tanpa satu baris
 * laporan pun ditulis ulang. Aturannya juga sama – satu lawan satu, jenis baris
 * sama, kategori sama – ditambah SATUAN: volume terlapor pindah apa adanya,
 * jadi 7 m³ yang dibaca sebagai 7 m² adalah angka salah tanpa tanda.
 *
 * MURNI: tanpa DB.
 */

export type NodePadanan = {
  lineageKey: string;
  kind: string;
  name: string;
  unit: string | null;
  /** Baris ini punya rincian di bawahnya (grup beranak). */
  punyaAnak: boolean;
  /** Terisi = node draft ini sudah mewarisi kunci item lain (DECISIONS 754). */
  lineageSemula: string | null;
};

/**
 * Volume yang dihitung NOL: kosong, 0, atau sisa pembulatan. Sama dengan
 * pratinjau impor (`(ke ?? 0) === 0`), ditambah toleransi Decimal(15,3).
 */
export function volumeNol(v: number | null): boolean {
  return v == null || Math.abs(v) < 0.0005;
}

/** Akar kunci = kode kategori; dipakai di banyak tempat untuk menemukan kategori. */
export const akarLineage = (lineageKey: string): string => lineageKey.split("#")[0]!;

/** "M³", "m3", "m 3" → "m3"; "m’" → "m'"; "Bh." → "bh". */
function normalSatuan(u: string): string {
  return u
    .toLowerCase()
    .replace(/³/g, "3")
    .replace(/²/g, "2")
    .replace(/[’`´]/g, "'")
    .replace(/[\s.]/g, "");
}

/** Satuan kosong di salah satu sisi tidak bisa dibandingkan – dianggap setara. */
export function satuanSetara(a: string | null, b: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  return normalSatuan(a) === normalSatuan(b);
}

/**
 * Sebab pasangan ini TIDAK sah, atau `null` bila sah.
 *
 * `lama` = item di RAB aktif yang sudah dilaporkan; `draft` = item di draft
 * yang akan mewarisi kuncinya.
 */
export function periksaPadananDraft(
  lama: NodePadanan,
  draft: NodePadanan,
  konteks: {
    lineageAktif: ReadonlySet<string>;
    lineageDraft: ReadonlySet<string>;
    /**
     * Kunci item kontrak yang MASIH ADA di draft tetapi volumenya 0 (DECISIONS
     * 756). Pekerjaannya pindah ke item lain di draft; tanpa dipasangkan,
     * laporannya diturunkan jadi 0 saat aktivasi. Boleh dipasangkan seperti
     * item yang hilang – sama dengan pratinjau impor ("volumenya jadi 0").
     */
    lineageDraftNol?: ReadonlySet<string>;
  },
): string | null {
  if (!konteks.lineageAktif.has(lama.lineageKey)) return `"${lama.name}" bukan item di RAB aktif.`;
  if (konteks.lineageDraft.has(lama.lineageKey) && !konteks.lineageDraftNol?.has(lama.lineageKey)) {
    return `"${lama.name}" masih ada di draft, jadi realisasinya sudah tersambung tanpa dipasangkan.`;
  }
  if (draft.kind !== "item" && draft.kind !== "grup") return `"${draft.name}" bukan item pekerjaan.`;
  if (draft.punyaAnak) return `"${draft.name}" punya rincian di bawahnya. Pasangkan ke salah satu rinciannya.`;
  if (draft.lineageSemula) return `"${draft.name}" sudah dipasangkan ke item lain. Lepas dulu pasangannya.`;
  if (konteks.lineageAktif.has(draft.lineageKey)) {
    return `"${draft.name}" adalah item kontrak lama yang sudah punya realisasinya sendiri. Pilih item baru di draft.`;
  }
  if (akarLineage(lama.lineageKey) !== akarLineage(draft.lineageKey)) {
    return (
      `Beda kategori: "${lama.name}" dan "${draft.name}" ada di kategori yang berbeda. ` +
      `Pemetaan lintas kategori memindahkan realisasinya ke kategori lain di blanko KKP.`
    );
  }
  if (!satuanSetara(lama.unit, draft.unit)) {
    return (
      `Beda satuan: "${lama.name}" dalam ${lama.unit}, "${draft.name}" dalam ${draft.unit}. ` +
      `Volume yang sudah dilaporkan dipindah apa adanya, jadi satuannya harus sama.`
    );
  }
  return null;
}
