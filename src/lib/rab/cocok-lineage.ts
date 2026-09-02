import type { FlatNode } from "@/lib/rab/flatten";

/**
 * SAMAKAN IDENTITAS item file baru dengan RAB AKTIF sebelum apa pun dibandingkan
 * atau ditulis.
 *
 * ### Kenapa ini ada
 *
 * `lineageKey` adalah JALUR KODE ("V#6", "V#6#a"). Ia dipakai untuk dua hal
 * sekaligus: menyusun pohon, dan menyambungkan realisasi harian lintas revisi
 * (`DailyReportItem.lineageKey`). Selama penomoran berkas tidak berubah, itu
 * cukup. Begitu satu baris disisipkan atau dihapus di adendum, seluruh nomor di
 * bawahnya bergeser — dan "item nomor 6" di berkas baru dibandingkan dengan
 * "item nomor 6" di kontrak, padahal itu dua pekerjaan berbeda.
 *
 * Berkas nyata `DRAFT_MC0_..._KEMANTREN` (keberatan user 2026-09-01)
 * memperlihatkan akibatnya: pratinjau melaporkan *"harga satuan 39 item KONTRAK
 * LAMA berubah"*, dan salah satunya *"6 Pekerjaan Skonengan – 1.037.988,58 →
 * 78.808,37"*. Di berkas itu 1.037.988,58 adalah harga **Pintu Rooling Door**,
 * yaitu item nomor **7**; 78.808,37 memang harga Skonengan. Bukan harga yang
 * berubah — pasangannya yang meleset satu baris. Yang lebih mahal: realisasi
 * harian ikut nempel ke pekerjaan yang salah, diam-diam, karena kuncinya cocok.
 *
 * ### Aturannya, dari yang paling kuat
 *
 * 1. **Nama + satuan, di antara SAUDARA SEKANDUNG yang sama** — hanya bila
 *    pasangannya TUNGGAL di kedua sisi. Identitas pekerjaan adalah
 *    pekerjaannya, bukan nomor urutnya.
 * 2. **Jalur kode** (perilaku lama). Dipakai kalau nama tidak menghasilkan
 *    pasangan tunggal — mis. item yang memang DIGANTI NAMA, atau saudara
 *    sekandung yang namanya kembar (di berkas KKP itu lazim: "Pekerjaan Urugan
 *    Pasir t = 3 cm" muncul berkali-kali). Kalau kuncinya cocok tapi namanya
 *    berbeda, itu DILAPORKAN, bukan didiamkan.
 * 3. Tidak keduanya → item baru.
 *
 * Pencocokan nama sengaja dikurung di dalam satu induk yang sama. Itu bukan
 * kehati-hatian kosong: beberapa tempat lain membaca kategori dari segmen
 * pertama kunci (`lineageKey.split("#")[0]`) dan kedalaman dari cacah
 * segmennya. Dengan kurungan ini, akar dan kedalaman kunci tidak pernah
 * berubah — yang berubah hanya nomor di ujungnya.
 *
 * MURNI: tanpa DB, tanpa I/O.
 */

export type NodeLamaCocok = {
  lineageKey: string;
  parentLineageKey: string | null;
  kind: string;
  code: string;
  name: string;
  unit: string | null;
};

/** Item file baru yang dipasangkan lewat NAMA karena nomornya bergeser. */
export type Digeser = {
  name: string;
  /** Kode di file baru. */
  kode: string;
  /** Kode item yang sama di kontrak. */
  kodeLama: string;
  lineageKey: string;
};

/** Kunci sama, tapi NAMA berbeda — dipakai apa adanya, tapi disebut. */
export type NamaBerbeda = {
  lineageKey: string;
  kode: string;
  name: string;
  namaLama: string;
};

/**
 * PEMETAAN MANUAL — item kontrak yang DINOLKAN di berkas, dipasangkan sendiri
 * oleh user ke item BARU di berkas yang sama.
 *
 * Permintaan user 2026-09-02: *"item yang sudah diinput di laporan harian lalu
 * di draft dinolkan, bisa dimatch manual dengan item baru yang ada di draft."*
 *
 * Pencocokan otomatis tidak bisa menebak keadaan ini: namanya berbeda DAN
 * nomornya berbeda, jadi tidak ada satu pun sinyal yang tersisa. Yang tahu
 * bahwa dua baris itu pekerjaan yang sama hanya orangnya.
 *
 * Caranya lewat PEWARISAN lineage, BUKAN menulis ulang laporan harian:
 * realisasi dikunci pada `lineageKey`, jadi begitu item baru mewarisi kunci
 * item lama, realisasinya ikut dengan sendirinya — tanpa satu baris laporan pun
 * disentuh, dan tanpa konsep baru di calculation layer.
 */
export type PadananManual = {
  /** `lineageKey` item BARU sebagaimana terbaca di berkas (sebelum dicocokkan). */
  lineageBaru: string;
  /** `lineageKey` item KONTRAK yang realisasinya diwariskan. */
  lineageLama: string;
};

export type PadananDipakai = PadananManual & { code: string; name: string; namaLama: string };
export type PadananDitolak = PadananManual & { sebab: string };

export type HasilCocok = {
  nodes: FlatNode[];
  digeser: Digeser[];
  namaBerbeda: NamaBerbeda[];
  /**
   * Item yang TIDAK punya pasangan di kontrak, menurut kunci ASLI-nya di
   * berkas. Kunci asli — bukan kunci final — karena itulah yang dipakai
   * `PadananManual.lineageBaru`, dan keduanya bisa berbeda saat induknya ikut
   * bergeser.
   */
  itemBaruAsli: { lineageAsli: string; code: string; name: string }[];
  padananDipakai: PadananDipakai[];
  /** Pemetaan yang TIDAK bisa dipakai — disebut sebabnya, tidak didiamkan. */
  padananDitolak: PadananDitolak[];
};

/** Akar kunci = kode kategori. Dipakai enam tempat lain untuk menemukan kategori. */
const akar = (lineageKey: string): string => lineageKey.split("#")[0]!;

/** Nama dibandingkan longgar: beda huruf besar/kecil & spasi bukan beda pekerjaan. */
export function normalNama(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim();
}

/** kategori / sub / item — grup diperlakukan sebagai item (ia memang item beranak). */
function kelas(kind: string): string {
  return kind === "kategori" ? "kategori" : kind === "sub" ? "sub" : "item";
}

export function samakanLineage(
  nodes: FlatNode[],
  lama: NodeLamaCocok[],
  opts: { padanan?: PadananManual[] } = {},
): HasilCocok {
  const lamaByKey = new Map(lama.map((n) => [n.lineageKey, n]));
  const anakLama = new Map<string, NodeLamaCocok[]>();
  for (const n of lama) {
    const k = n.parentLineageKey ?? "";
    const arr = anakLama.get(k);
    if (arr) arr.push(n);
    else anakLama.set(k, [n]);
  }
  // Saudara sekandung di FILE BARU, memakai kunci ASLI (konsisten dalam berkas).
  const anakBaru = new Map<string, FlatNode[]>();
  for (const n of nodes) {
    const k = n.parentLineageKey ?? "";
    const arr = anakBaru.get(k);
    if (arr) arr.push(n);
    else anakBaru.set(k, [n]);
  }

  const dipakaiLama = new Set<string>();
  const terpakai = new Set<string>();
  const digeser: Digeser[] = [];
  const namaBerbeda: NamaBerbeda[] = [];
  const itemBaruAsli: HasilCocok["itemBaruAsli"] = [];
  const padananDipakai: PadananDipakai[] = [];
  const padananDitolak: PadananDitolak[] = [];
  const padananByBaru = new Map((opts.padanan ?? []).map((p) => [p.lineageBaru, p]));
  const hasil: FlatNode[] = [];

  /*
   * RESERVASI PEMETAAN MANUAL — dikerjakan SEBELUM pohon ditelusuri.
   *
   * Ini bukan detail: pohon ditelusuri per kelompok saudara menurut urutan
   * dokumen, dan pasangan manual hampir selalu berada di kelompok yang BERBEDA
   * dari lawannya. Kasus nyata user 2026-09-03: seluruh grup "Pekerjaan Tapak
   * Beton Menerus" dinolkan dan digantikan grup baru "Pekerjaan Pondasi Batu
   * Belah" di bawah sub yang sama. Baris lama yang dinolkan MASIH BERNAMA SAMA,
   * jadi saat grup lama diproses ia langsung mengklaim item kontraknya lewat
   * pencocokan nama — dan waktu giliran grup baru tiba, pasangan yang dipilih
   * user sudah diambil oleh baris yang justru sedang ditinggalkan.
   *
   * Karena itu targetnya dikunci lebih dulu untuk SELURUH pohon. Setelah
   * dikunci, giliran nama maupun nomor tidak bisa lagi menyentuhnya.
   */
  const barisBerkas = new Map(nodes.map((n) => [n.lineageKey, n]));

  /*
   * Peta KATEGORI berkas → kategori kontrak, dicocokkan lewat NAMA.
   *
   * Nomor romawi kategori lazim bergeser antar revisi: satu kategori disisipkan
   * atau dibuang, dan semua yang di bawahnya bergeser. Kasus nyata user
   * 2026-09-03: "PEKERJAAN DINDING PENAHAN TANAH" bernomor IV di RAB kontrak
   * dan III di berkas adendumnya. Membandingkan KODE kategori karena itu
   * menolak pemetaan yang sah — persis kesalahan yang sudah diperbaiki untuk
   * ITEM (DECISIONS 489: identitas dikenali dari pekerjaannya, bukan dari nomor
   * urutnya), tapi belum untuk KATEGORI.
   *
   * Penelusuran pohon sendiri SUDAH menyelesaikannya: giliran nama di tingkat
   * akar memberi kategori berkas itu kunci milik kategori kontrak. Peta ini
   * hanya membuat pemeriksaan di muka melihat hal yang sama.
   */
  const kategoriBerkasKeKontrak = new Map<string, string>();
  {
    const akarBerkas = nodes.filter((n) => n.parentLineageKey == null);
    const akarKontrak = lama.filter((x) => x.parentLineageKey == null);
    for (const n of akarBerkas) {
      const nama = normalNama(n.name);
      /*
       * TUNGGAL di kedua sisi, sama seperti disiplin pencocokan item.
       *
       * Nama kategori bisa kembar — pertanyaan user 2026-09-03 setelah membaca
       * berkasnya sendiri, di mana satu nama pekerjaan muncul di dua kategori
       * berbeda. Mengambil yang pertama berarti melempar koin atas milik siapa
       * realisasi sebuah item, dan taruhannya angka resmi. Kalau kembar,
       * pemetaan lintas-kode ditolak dan pemakainya diberi tahu — bukan
       * ditebak diam-diam.
       */
      if (akarBerkas.filter((x) => normalNama(x.name) === nama).length !== 1) continue;
      const kandidat = akarKontrak.filter((x) => normalNama(x.name) === nama);
      if (kandidat.length !== 1) continue;
      kategoriBerkasKeKontrak.set(n.lineageKey, kandidat[0].lineageKey);
    }
  }
  /** Akar kunci berkas dan akar kunci kontrak menunjuk KATEGORI yang sama? */
  const kategoriSetara = (lineageBaru: string, lineageLama: string): boolean => {
    const aBaru = akar(lineageBaru);
    const aLama = akar(lineageLama);
    return aBaru === aLama || kategoriBerkasKeKontrak.get(aBaru) === aLama;
  };
  const namaKategori = (kunci: string, dariBerkas: boolean): string => {
    const n = dariBerkas ? barisBerkas.get(akar(kunci)) : lamaByKey.get(akar(kunci));
    return n ? `${akar(kunci)} ${n.name}` : akar(kunci);
  };
  const reservasi = new Map<string, NodeLamaCocok>();
  for (const p of opts.padanan ?? []) {
    const tolak = (sebab: string) => padananDitolak.push({ ...p, sebab });
    const target = lamaByKey.get(p.lineageLama);
    const nBaru = barisBerkas.get(p.lineageBaru);
    if (!target) {
      tolak(`Item kontrak "${p.lineageLama}" tidak ditemukan di RAB aktif.`);
      continue;
    }
    if (!nBaru) {
      tolak(`Baris "${p.lineageBaru}" tidak ada di berkas ini.`);
      continue;
    }
    if (dipakaiLama.has(p.lineageLama) || reservasi.has(p.lineageBaru)) {
      tolak(`Item kontrak "${p.lineageLama}" sudah dipakai pasangan lain.`);
      continue;
    }
    if (kelas(target.kind) !== kelas(nBaru.kind)) {
      tolak(`"${nBaru.name}" dan "${target.name}" bukan jenis baris yang sama.`);
      continue;
    }
    /*
     * KATEGORI dibandingkan pada kunci ASLI kedua sisi — akar kunci adalah kode
     * kategori, dan ia menentukan kategori di enam tempat lain. Mewarisi kunci
     * lintas kategori memindahkan realisasinya di blanko KKP tanpa ada yang
     * memindahkannya. GRUP dan SUB boleh berbeda: pekerjaan yang sama memang
     * lazim pindah grup dalam kategori yang sama, dan itulah bentuk adendum
     * yang dilaporkan user.
     */
    if (!kategoriSetara(p.lineageBaru, p.lineageLama)) {
      tolak(
        `Beda kategori: "${target.name}" ada di ${namaKategori(p.lineageLama, false)}, ` +
          `"${nBaru.name}" di ${namaKategori(p.lineageBaru, true)}. ` +
          `Pemetaan lintas kategori memindahkan realisasinya di blanko KKP.`,
      );
      continue;
    }
    dipakaiLama.add(p.lineageLama);
    reservasi.set(p.lineageBaru, target);
    padananDipakai.push({ ...p, code: nBaru.code, name: nBaru.name, namaLama: target.name });
  }

  /**
   * Satu kelompok SAUDARA SEKANDUNG diselesaikan sekaligus, dalam DUA giliran.
   *
   * Urutannya penting dan pernah salah: kalau tiap baris diputuskan sendiri-
   * sendiri, item BARU yang kebetulan bernomor 6 akan mengklaim item kontrak
   * nomor 6 lewat jalur kode, padahal saudara di bawahnya cocok persis lewat
   * nama. Giliran nama karena itu diselesaikan LEBIH DULU untuk seluruh
   * kelompok, baru sisanya boleh memakai nomor.
   */
  const selesaikan = (indukAsli: string, indukFinal: string | null): void => {
    const grup = anakBaru.get(indukAsli) ?? [];
    if (grup.length === 0) return;
    const saudaraLama = anakLama.get(indukFinal ?? "") ?? [];
    const pilihan = new Map<FlatNode, NodeLamaCocok>();

    /*
     * Giliran 0 — PEMETAAN MANUAL. Pasangannya sudah DIPESAN sebelum pohon
     * ditelusuri (lihat `reservasi` di atas), jadi di sini tinggal dipakai.
     */
    for (const n of grup) {
      const target = reservasi.get(n.lineageKey);
      if (!target) continue;
      pilihan.set(n, target);
      reservasi.delete(n.lineageKey);
    }

    // Giliran 1 — nama (+ satuan bila perlu), harus TUNGGAL di kedua sisi.
    for (const n of grup) {
      if (pilihan.has(n)) continue;
      const nama = normalNama(n.name);
      const kembarBaru = grup.filter(
        (x) => kelas(x.kind) === kelas(n.kind) && normalNama(x.name) === nama,
      );
      if (kembarBaru.length !== 1) continue;
      let kandidat = saudaraLama.filter(
        (x) =>
          !dipakaiLama.has(x.lineageKey) &&
          kelas(x.kind) === kelas(n.kind) &&
          normalNama(x.name) === nama,
      );
      // Satuan hanya menyaring bila masih menyisakan kandidat: berkas KKP sering
      // menulis satuan yang sama dengan ejaan berbeda (m², m2, M2).
      if (kandidat.length > 1 && n.unit) {
        const perSatuan = kandidat.filter(
          (x) => x.unit != null && normalNama(x.unit) === normalNama(n.unit!),
        );
        if (perSatuan.length > 0) kandidat = perSatuan;
      }
      if (kandidat.length === 1) {
        pilihan.set(n, kandidat[0]);
        dipakaiLama.add(kandidat[0].lineageKey);
      }
    }

    // Giliran 2 — jalur kode (perilaku lama), untuk yang belum dapat pasangan.
    for (const n of grup) {
      if (pilihan.has(n)) continue;
      const kunciKode = indukFinal === null ? n.code : `${indukFinal}#${n.code}`;
      const byKey = lamaByKey.get(kunciKode);
      if (!byKey || dipakaiLama.has(byKey.lineageKey) || kelas(byKey.kind) !== kelas(n.kind)) continue;
      pilihan.set(n, byKey);
      dipakaiLama.add(byKey.lineageKey);
      if (normalNama(byKey.name) !== normalNama(n.name))
        namaBerbeda.push({
          lineageKey: byKey.lineageKey,
          kode: n.code,
          name: n.name,
          namaLama: byKey.name,
        });
    }

    for (const n of grup) {
      const kunciKode = indukFinal === null ? n.code : `${indukFinal}#${n.code}`;
      const cocok = pilihan.get(n);
      let kunciFinal: string;
      if (cocok) {
        kunciFinal = cocok.lineageKey;
        if (cocok.lineageKey !== kunciKode)
          digeser.push({
            name: n.name,
            kode: n.code,
            kodeLama: cocok.code,
            lineageKey: cocok.lineageKey,
          });
      } else {
        if (kelas(n.kind) === "item") itemBaruAsli.push({ lineageAsli: n.lineageKey, code: n.code, name: n.name });
        // Item baru — kunci dari jalur kodenya, dijaga tetap unik.
        kunciFinal = kunciKode;
        for (let i = 2; terpakai.has(kunciFinal) || lamaByKey.has(kunciFinal); i++)
          kunciFinal = `${kunciKode}#${i}`;
      }
      terpakai.add(kunciFinal);
      hasil.push({ ...n, lineageKey: kunciFinal, parentLineageKey: indukFinal });
      // Anak-anaknya menyusul segera (urutan dokumen: induk lalu seluruh
      // rantingnya), dengan induk yang sudah pasti kuncinya.
      selesaikan(n.lineageKey, kunciFinal);
    }
  };

  selesaikan("", null);
  return { nodes: hasil, digeser, namaBerbeda, itemBaruAsli, padananDipakai, padananDitolak };
}
