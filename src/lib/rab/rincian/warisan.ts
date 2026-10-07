/**
 * SUMBER BACKUP VOLUME TIAP ITEM, LINTAS REVISI (DECISIONS baru 2026-10-07).
 *
 * Permintaan user: *"rab non aktif (rab awal) yang sudah di cco … ke depannya
 * tetap harus ada sumber informasi backup volumenya, kemudian yang sudah di cco
 * juga ketahuan backup volumenya … bukan sekedar simpan file saja."*
 *
 * Revisi adendum yang dibuat lewat editor atau Template Adendum tidak membawa
 * sheet backup. Volume item yang TIDAK berubah tetap sah dibuktikan backup
 * revisi sebelumnya; yang berubah atau baru TIDAK – backup lama menghitung
 * volume yang lain. Urutan sumber per item:
 *
 *   1. isian MARLIN di revisi ini (diisi orang untuk item itu);
 *   2. backup berkas revisi ini yang TERTAUT lewat rumus;
 *   3. diwarisi dari revisi terdekat sebelumnya yang memuat item itu, HANYA
 *      bila volumenya sama persis (3 desimal, presisi kolom volume);
 *   4. belum ada – dengan sebabnya, supaya layar bisa berkata apa yang kurang.
 *
 * Murni: tanpa DB, supaya aturannya bisa diuji langsung.
 */

export type ItemRevisiBackup = {
  /** Volume RAB apa adanya (string desimal) atau null. */
  volume: string | null;
  /** Status backup berkas (tertaut | angka_langsung | kosong | tidak_terbaca) atau null. */
  berkas: string | null;
  /** Ada baris backup isian MARLIN. */
  isian: boolean;
};

export type RevisiBackup = {
  id: string;
  revisionNo: number;
  /** Rincian berkas sudah tersimpan (impor/arsip). */
  punyaRincian: boolean;
  /** Revisi punya berkas sumber (Excel yang diarsipkan). Kosong = dianggap punya. */
  punyaBerkas?: boolean;
  items: Map<string, ItemRevisiBackup>;
};

export type SebabBelum =
  /** Volume beda dari revisi sebelumnya – backup lama menghitung volume lain. */
  | "volume_berubah"
  /** Item tidak ada di revisi sebelumnya. */
  | "baru"
  /** Rincian berkas revisi ini belum dilengkapi (Sistem → Backup volume & analisa). */
  | "belum_dilengkapi"
  /** Berkasnya ada, tapi volume item diketik langsung / kosong / rujukannya putus. */
  | "tanpa_backup"
  /** Revisi dibuat tanpa berkas (editor) dan item ini tidak punya backup sebelumnya. */
  | "tanpa_berkas";

export type SumberBackup =
  | { jenis: "berkas"; revisionId: string; revisionNo: number }
  | { jenis: "isian"; revisionId: string; revisionNo: number }
  | {
      jenis: "warisan";
      /** Bentuk backup di revisi asalnya. */
      dari: "berkas" | "isian";
      revisionId: string;
      revisionNo: number;
    }
  | {
      jenis: "belum";
      sebab: SebabBelum;
      /** Status berkas revisi ini, bila ada (angka_langsung, …). */
      berkas: string | null;
      /** Revisi terdekat sebelumnya yang memuat item ini. */
      sebelumnya: {
        revisionId: string;
        revisionNo: number;
        volume: string | null;
        /** Backup yang dimiliki item itu di sana – rujukan, bukan bukti volume baru. */
        sumber: BackupWarisan | null;
      } | null;
    };

/** Volume dibandingkan pada presisi kolomnya (Decimal 15,3). */
export function volumeSama(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Number(a).toFixed(3) === Number(b).toFixed(3);
}

export type BackupWarisan = Extract<SumberBackup, { jenis: "warisan" }>;

/** Ubah sumber menjadi bentuk yang bisa diwariskan (menunjuk ke asalnya). */
function asal(s: SumberBackup): BackupWarisan | null {
  if (s.jenis === "belum") return null;
  if (s.jenis === "warisan") return s;
  return { jenis: "warisan", dari: s.jenis, revisionId: s.revisionId, revisionNo: s.revisionNo };
}

/**
 * Selesaikan sumber backup SELURUH revisi rantai, urut naik nomor revisi.
 * Mengembalikan peta revisionId → (lineageKey → sumber).
 */
export function selesaikanBackup(revisi: RevisiBackup[]): Map<string, Map<string, SumberBackup>> {
  const urut = [...revisi].sort((a, b) => a.revisionNo - b.revisionNo);
  const hasil = new Map<string, Map<string, SumberBackup>>();
  for (const [idx, r] of urut.entries()) {
    const peta = new Map<string, SumberBackup>();
    for (const [lk, it] of r.items) {
      if (it.isian) {
        peta.set(lk, { jenis: "isian", revisionId: r.id, revisionNo: r.revisionNo });
        continue;
      }
      if (it.berkas === "tertaut") {
        peta.set(lk, { jenis: "berkas", revisionId: r.id, revisionNo: r.revisionNo });
        continue;
      }
      // Revisi terdekat sebelumnya yang memuat item ini.
      let prev: RevisiBackup | null = null;
      for (let j = idx - 1; j >= 0; j--) {
        if (urut[j]!.items.has(lk)) {
          prev = urut[j]!;
          break;
        }
      }
      const sPrev = prev ? (hasil.get(prev.id)!.get(lk) ?? null) : null;
      const itPrev = prev ? prev.items.get(lk)! : null;
      if (prev && itPrev && sPrev && sPrev.jenis !== "belum" && volumeSama(itPrev.volume, it.volume)) {
        peta.set(lk, asal(sPrev)!);
        continue;
      }
      /*
       * Sebab "belum". Rincian berkas revisi ini sendiri didahulukan; kalau
       * tidak ada dan volumenya sama dengan revisi sebelumnya, SEBAB ASAL-nya
       * yang dibawa (mis. "diketik langsung di berkas revisi #1"), bukan
       * kalimat yang menyalahkan revisi yang memang tidak punya berkas.
       */
      let sebab: SebabBelum;
      let berkas = it.berkas;
      if (prev && !volumeSama(itPrev!.volume, it.volume)) sebab = "volume_berubah";
      else if (r.punyaRincian) sebab = "tanpa_backup";
      else if (prev && sPrev && sPrev.jenis === "belum") {
        sebab = sPrev.sebab;
        berkas = sPrev.berkas;
      } else if (!prev && idx > 0) sebab = "baru";
      else sebab = r.punyaBerkas === false ? "tanpa_berkas" : "belum_dilengkapi";
      peta.set(lk, {
        jenis: "belum",
        sebab,
        berkas,
        sebelumnya: prev
          ? { revisionId: prev.id, revisionNo: prev.revisionNo, volume: itPrev!.volume, sumber: sPrev ? asal(sPrev) : null }
          : null,
      });
    }
    hasil.set(r.id, peta);
  }
  return hasil;
}

export type RingkasBackup = {
  item: number;
  berkas: number;
  isian: number;
  warisan: number;
  belum: number;
  volumeBerubah: number;
  baru: number;
};

export function ringkasBackup(peta: Map<string, SumberBackup>): RingkasBackup {
  const r: RingkasBackup = { item: 0, berkas: 0, isian: 0, warisan: 0, belum: 0, volumeBerubah: 0, baru: 0 };
  for (const s of peta.values()) {
    r.item++;
    r[s.jenis]++;
    if (s.jenis === "belum" && s.sebab === "volume_berubah") r.volumeBerubah++;
    if (s.jenis === "belum" && s.sebab === "baru") r.baru++;
  }
  return r;
}

/* ── Analisa: diwarisi bila HARGA SATUAN sama ─────────────────────────── */

/**
 * Analisa harga satuan mengikuti aturan yang sama dengan backup volume, tetapi
 * yang dibandingkan HARGA SATUAN: analisa menjelaskan harga, bukan volume.
 * Adendum lewat editor/template tidak membawa sheet analisa; tanpa pewarisan,
 * RAPL kehilangan seluruh analisa kontrak begitu adendum itu diaktifkan.
 */
export type ItemRevisiAnalisa = { harga: string | null; analisaId: string | null; cara: string | null };
export type RevisiAnalisa = { id: string; revisionNo: number; items: Map<string, ItemRevisiAnalisa> };
export type SumberAnalisa = {
  analisaId: string;
  cara: string;
  /** Revisi tempat analisa itu dibaca dari berkas. */
  revisionId: string;
  revisionNo: number;
  warisan: boolean;
};

export function hargaSama(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return Number(a).toFixed(2) === Number(b).toFixed(2);
}

export function selesaikanAnalisa(revisi: RevisiAnalisa[]): Map<string, Map<string, SumberAnalisa>> {
  const urut = [...revisi].sort((a, b) => a.revisionNo - b.revisionNo);
  const hasil = new Map<string, Map<string, SumberAnalisa>>();
  for (const [idx, r] of urut.entries()) {
    const peta = new Map<string, SumberAnalisa>();
    for (const [lk, it] of r.items) {
      if (it.analisaId) {
        peta.set(lk, { analisaId: it.analisaId, cara: it.cara ?? "rumus", revisionId: r.id, revisionNo: r.revisionNo, warisan: false });
        continue;
      }
      for (let j = idx - 1; j >= 0; j--) {
        const p = urut[j]!;
        const ip = p.items.get(lk);
        if (!ip) continue;
        const s = hasil.get(p.id)!.get(lk);
        if (s && hargaSama(ip.harga, it.harga)) peta.set(lk, { ...s, warisan: true });
        break;
      }
    }
    hasil.set(r.id, peta);
  }
  return hasil;
}
