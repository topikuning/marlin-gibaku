/**
 * RAPL — Rencana Anggaran Pelaksanaan Lapangan: penurunan kebutuhan sumber daya
 * dari RAB + analisa AHSP. MURNI (tanpa db). DECISIONS 320.
 *
 * **Ini SATU-SATUNYA tempat formula kebutuhan RAPL boleh ditulis** — sejalan
 * dengan aturan yang sama untuk progress (`progress-calc.ts`) dan keuangan
 * (`finance/calc.ts`). Komponen, PDF, dan Excel dilarang menghitung ulang.
 *
 * Rumusnya sendiri sederhana:
 *
 *     kebutuhan(sumber daya) = Σ  koefisien(analisa, sumber daya) × volume(item)
 *
 * Yang tidak sederhana adalah SYARAT-SYARATNYA, dan justru di situ letak
 * jujur-tidaknya angka yang keluar:
 *
 *  1. **Satuan harus sepadan.** Analisa AHSP berbunyi "1 m3 Timbunan…" — artinya
 *     koefisiennya per SATU METER KUBIK. Mengalikannya dengan volume item yang
 *     bersatuan m² atau buah menghasilkan angka yang rapi tapi tidak berarti
 *     apa-apa. Baris begini DIKELUARKAN dan dilaporkan, bukan dipaksa dihitung.
 *  2. **Analisa harus punya koefisien terstruktur.** 435 analisa resmi baru
 *     berupa kutipan halaman; tidak ada yang bisa dikalikan.
 *  3. **Volume harus ada.** Item tanpa volume tidak bisa diturunkan.
 *  4. **Hanya padanan yang SUDAH DISETUJUI orang.** Usulan mesin, sebagus apa
 *     pun skornya, tidak boleh menjadi angka kebutuhan bahan.
 *
 * Setiap baris yang dikeluarkan dihitung dan dilaporkan lengkap dengan nilai
 * rupiahnya, supaya jelas seberapa besar bagian proyek yang BELUM masuk
 * simulasi. Simulasi yang tidak mengaku bolong akan dibaca sebagai total.
 */

export type KomponenUntukRapl = {
  kategori: "upah" | "bahan" | "alat" | string;
  nama: string;
  satuan: string | null;
  koefisien: number;
};

/**
 * Rincian pelaksanaan satu item RAB yang disusun ORANG — AHSP jadi pembantu,
 * bukan gerbang (RAPL-08, DECISIONS 473).
 *
 * Tiga bentuk campur tangan, dan hanya tiga:
 *
 * 1. `faktorKonversi` menyelamatkan item yang satuannya tidak sepadan dengan
 *    analisanya (item m² dinding vs analisa m³ pasangan). Angkanya WAJIB
 *    disertai alasan; konversi tanpa alasan adalah tebakan yang menyamar jadi
 *    data (DECISIONS 203).
 * 2. `tambahan` menambah komponen yang tidak ada di analisa. Koefisien AHSP
 *    sendiri TIDAK bisa disunting — keputusan user 2026-08-29.
 * 3. `hargaBorongan` untuk pekerjaan yang memang disubkan: satu harga per
 *    satuan item, tanpa rincian komponen. Lebih jujur daripada memaksa
 *    mobilisasi diurai jadi semen dan pasir.
 */
export type RincianItem = {
  /** Pengali volume item → satuan analisa. null = satuannya memang sepadan. */
  faktorKonversi: number | null;
  catatanKonversi: string | null;
  /** Rupiah per SATUAN ITEM. Bila terisi, item ini borongan. */
  hargaBorongan: bigint | null;
  /**
   * Komponen tambahan. Koefisiennya PER SATUAN ITEM RAB — bukan per satuan
   * analisa — jadi `faktorKonversi` TIDAK dikenakan padanya. Itu satuan yang
   * dipikirkan orang saat menambah sendiri, dan mencampurnya dengan koefisien
   * AHSP akan membuat faktor konversinya terpakai dua kali.
   */
  tambahan: KomponenUntukRapl[];
};

export type ItemUntukRapl = {
  lineageKey: string;
  code: string;
  uraian: string;
  /** Satuan item RAB, sudah dinormalkan (m³ → m3). */
  satuanNorm: string;
  volume: number | null;
  amount: bigint;
  /**
   * true = mesin SUDAH mengusulkan padanan, tinggal disetujui orang.
   * Dibedakan dari "belum ada padanan sama sekali" karena pekerjaannya beda:
   * yang satu tinggal diperiksa lalu diklik, yang satu lagi harus dicarikan
   * analisanya. "Belum disetujui" tanpa perbedaan ini menyuruh 534 baris
   * dikerjakan dengan cara yang sama padahal tidak.
   */
  adaUsulan?: boolean;
  /**
   * Rincian yang DISUSUN ORANG untuk item ini (RAPL-08, DECISIONS 473).
   * Kosong untuk item yang cukup dilayani analisa AHSP apa adanya.
   */
  rincian?: RincianItem;
  analisa: {
    kode: string;
    uraian: string;
    /** Satuan analisa AHSP, sudah dinormalkan. */
    satuanNorm: string;
    komponen: KomponenUntukRapl[];
  } | null;
};

export type Kebutuhan = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  /** Berapa baris RAB yang menyumbang — supaya asal angkanya bisa ditelusuri. */
  dariBaris: number;
  /**
   * Nilai RAB (rupiah) item-item yang MEMBUTUHKAN sumber daya ini.
   *
   * Gunanya mengurutkan pekerjaan pengisian harga: sumber daya yang menahan
   * Rp365 juta pekerjaan beton lebih menentukan daripada yang menahan Rp2 juta.
   * `jumlah` tidak bisa dipakai untuk itu — 5.000 kg semen, 12 OH mandor, dan
   * 0,3 jam excavator bukan besaran yang sebanding.
   *
   * **TIDAK BOLEH DIJUMLAHKAN antar baris.** Satu item RAB menyumbang nilai
   * PENUHNYA ke setiap sumber daya yang ia butuhkan, jadi Σ seluruh baris jauh
   * melampaui nilai RAB. Ini angka pengurut, bukan uang yang boleh ditotal.
   */
  nilaiTertahan: bigint;
  /**
   * true = kategorinya JANGGAL menurut satuannya sendiri (lihat `SATUAN_UPAH`).
   * Ditandai, BUKAN dipindahkan diam-diam — lihat catatan di `SATUAN_UPAH`.
   */
  janggal: boolean;
};

/**
 * Satuan yang wajar untuk komponen UPAH: orang-hari dan jam.
 *
 * Berkas master SE DJBK 47/2026 memuat 334 komponen berkategori `upah` yang
 * satuannya kg/m3/m2/buah/liter — mis. analisa [2.3.(21a)] "Saluran U Pracetak
 * Tipe DS 1" mendaftarkan "Semen (Kg)" dan "Besi Beton M57a (Kg)" sebagai upah.
 * Itu cacat di data sumbernya, tersebar di 62 analisa.
 *
 * Yang TIDAK dilakukan di sini: memindahkannya sendiri ke kategori `bahan`.
 * Menebak maksud dokumen resmi lalu menyajikannya sebagai fakta adalah cara
 * paling halus untuk membuat angka yang tidak bisa dipertanggungjawabkan —
 * dan setiap analisa di sini membawa nomor halaman PDF-nya justru supaya
 * manusia bisa memeriksa yang mana yang benar. Jadi barisnya tetap muncul apa
 * adanya, DITANDAI janggal, dan jumlahnya dilaporkan.
 */
const SATUAN_UPAH = new Set(["oh", "jam", "hari", "org", "orang"]);

function janggalKategori(kategori: string, satuan: string): boolean {
  if (kategori !== "upah") return false;
  const s = satuan.trim().toLowerCase();
  return s.length > 0 && !SATUAN_UPAH.has(s);
}

export type AlasanLewat =
  | "belum_disetujui"
  | "satuan_tidak_sepadan"
  | "tanpa_koefisien"
  | "volume_kosong";

export type BarisDilewat = {
  lineageKey: string;
  code: string;
  uraian: string;
  amount: bigint;
  alasan: AlasanLewat;
  /** Keterangan yang bisa dibaca orang, mis. "item m2 vs analisa m3". */
  rinci: string;
};

export type HasilRapl = {
  kebutuhan: Kebutuhan[];
  dipakai: { baris: number; nilai: bigint };
  dilewat: BarisDilewat[];
  /** Nilai RAB per alasan dilewat — untuk melaporkan besar lubangnya. */
  nilaiDilewat: Record<AlasanLewat, bigint>;
};

/**
 * Pembulatan jumlah kebutuhan — gunanya HANYA merapikan derau penjumlahan
 * double (0,30000000000000004), bukan memangkas ketelitian.
 *
 * Karena itu 6 desimal, bukan 4. Koefisien alat berat lazim berorde 1e-4
 * (0,00012345 jam per m³); dengan 4 desimal, kebutuhan alat pada volume kecil
 * akan dibulatkan menjadi NOL dan tabelnya berbohong bahwa alatnya tidak
 * dibutuhkan. Diuji langsung di `tests/unit/rapl-calc.test.ts`.
 */
export const DESIMAL_KEBUTUHAN = 6;
const SKALA = 10 ** DESIMAL_KEBUTUHAN;

/**
 * Urutan tampil. Kategori yang TIDAK terdaftar tetap muncul (di paling belakang),
 * bukan hilang — terbitan berkas bisa menambah kategori kapan saja, dan yang
 * pertama kali terjadi (`fasilitas`, terbitan 5.0) nyaris lolos tanpa terlihat.
 */
const URUTAN_KATEGORI: Record<string, number> = { upah: 0, bahan: 1, alat: 2, fasilitas: 3 };


/**
 * Hasil membedah SATU item RAB: apa saja yang dibutuhkannya, atau kenapa ia
 * tidak bisa dihitung.
 *
 * Ada supaya aturan gerbangnya hidup di SATU tempat. Agregat sumber daya dan
 * biaya per item sama-sama memakainya; kalau keduanya menyalin aturan yang
 * sama, cepat atau lambat mereka berbeda pendapat tentang item yang sama —
 * dan halaman yang menampilkan keduanya berhenti bisa dipercaya.
 */
export type PecahanItem =
  | {
      ok: true;
      /** Terisi = item ini diborongkan; `komponen` pasti kosong. */
      borongan: bigint | null;
      /** Kebutuhan SUDAH dikalikan volume dan faktor — tinggal dijumlahkan. */
      komponen: { komponen: KomponenUntukRapl; jumlah: number; dariAhsp: boolean }[];
    }
  | { ok: false; alasan: AlasanLewat; rinci: string };

/**
 * Bedah satu item RAB menjadi kebutuhannya. MURNI.
 *
 * Urutan pemeriksaannya adalah urutan pekerjaan orang, bukan urutan kolom di
 * tabel: borongan menutup perkara, lalu ada-tidaknya sumber koefisien, lalu
 * volume, baru kesepadanan satuan.
 */
export function pecahItem(it: ItemUntukRapl): PecahanItem {
  const r = it.rincian;
  const tambahan = r?.tambahan ?? [];
  /*
   * Faktor konversi hanya sah bila DISERTAI ALASAN. Angka konversi tanpa
   * keterangan adalah tebakan yang menyamar jadi data, dan di halaman yang
   * dipakai orang menawar itu kebohongan yang paling mahal (DECISIONS 203
   * diterapkan ke jalur RAPL).
   */
  const konversiSah =
    r?.faktorKonversi != null &&
    r.faktorKonversi > 0 &&
    (r.catatanKonversi ?? "").trim().length > 0;

  /*
   * BORONGAN mengalahkan segalanya: satu item satu cara hitung. Pekerjaan yang
   * disubkan memang tidak diketahui rincian bahannya, dan memaksanya diurai
   * jadi semen-pasir hanya melahirkan angka yang tidak punya asal.
   */
  if (r?.hargaBorongan != null && r.hargaBorongan > 0n) {
    if (it.volume === null) {
      return { ok: false, alasan: "volume_kosong", rinci: "item RAB tidak punya volume" };
    }
    return { ok: true, borongan: r.hargaBorongan, komponen: [] };
  }

  const analisaBerkoefisien = it.analisa !== null && it.analisa.komponen.length > 0;

  if (!analisaBerkoefisien && tambahan.length === 0) {
    if (!it.analisa) {
      return {
        ok: false,
        alasan: "belum_disetujui",
        rinci: it.adaUsulan
          ? "usulan mesin sudah ada – tinggal diperiksa lalu disetujui"
          : "belum ada padanan sama sekali – perlu dicarikan analisanya atau dirinci tangan",
      };
    }
    return {
      ok: false,
      alasan: "tanpa_koefisien",
      rinci: `analisa [${it.analisa.kode}] belum punya koefisien terstruktur`,
    };
  }

  if (it.volume === null) {
    return { ok: false, alasan: "volume_kosong", rinci: "item RAB tidak punya volume" };
  }

  /*
   * Satuan analisa "—" berarti berkas masternya sendiri tidak bisa membacanya;
   * itu bukan izin untuk menganggapnya sepadan.
   *
   * Ketidaksepadanan menggugurkan SELURUH item, bukan cuma bagian analisanya,
   * meski ia punya komponen tambahan. Memakai tambahannya saja menghasilkan
   * kebutuhan yang kelihatan lengkap padahal kehilangan bagian terbesarnya —
   * persis pengecilan diam-diam yang dilarang. Jalan keluarnya ada dan harus
   * ditempuh orang: nyatakan faktor konversinya beserta alasannya.
   */
  const sepadan =
    it.satuanNorm && it.analisa?.satuanNorm && it.satuanNorm === it.analisa.satuanNorm;
  if (analisaBerkoefisien && !sepadan && !konversiSah) {
    return {
      ok: false,
      alasan: "satuan_tidak_sepadan",
      rinci: `item ${it.satuanNorm || "tanpa satuan"} vs analisa ${it.analisa?.satuanNorm || "tanpa satuan"}`,
    };
  }

  /** Pengali volume untuk komponen ANALISA saja — lihat `RincianItem`. */
  const faktor = analisaBerkoefisien && !sepadan && konversiSah ? r!.faktorKonversi! : 1;
  const volume = it.volume;

  return {
    ok: true,
    borongan: null,
    komponen: [
      ...(analisaBerkoefisien
        ? it.analisa!.komponen.map((k) => ({
            komponen: k,
            jumlah: k.koefisien * volume * faktor,
            dariAhsp: true,
          }))
        : []),
      // Koefisien tambahan sudah PER SATUAN ITEM, jadi tidak ikut faktor.
      ...tambahan.map((k) => ({ komponen: k, jumlah: k.koefisien * volume, dariAhsp: false })),
    ],
  };
}

/** Turunkan kebutuhan sumber daya dari seluruh item yang bisa dihitung. */
export function agregasiKebutuhan(items: ItemUntukRapl[]): HasilRapl {
  const peta = new Map<string, Kebutuhan>();
  const dilewat: BarisDilewat[] = [];
  const nilaiDilewat: Record<AlasanLewat, bigint> = {
    belum_disetujui: 0n,
    satuan_tidak_sepadan: 0n,
    tanpa_koefisien: 0n,
    volume_kosong: 0n,
  };
  let barisDipakai = 0;
  let nilaiDipakai = 0n;

  for (const it of items) {
    const pecah = pecahItem(it);
    if (!pecah.ok) {
      dilewat.push({
        lineageKey: it.lineageKey,
        code: it.code,
        uraian: it.uraian,
        amount: it.amount,
        alasan: pecah.alasan,
        rinci: pecah.rinci,
      });
      nilaiDilewat[pecah.alasan] += it.amount;
      continue;
    }

    barisDipakai += 1;
    nilaiDipakai += it.amount;

    /*
     * Satu item hanya boleh menyumbangkan nilainya SEKALI per sumber daya.
     * Ada analisa yang mendaftarkan sumber daya yang sama dua kali (mis. dua
     * baris "Semen (Kg)" dengan koefisien berbeda); tanpa penjaga ini nilai
     * item itu terhitung dobel dan urutan pengisian harga jadi salah.
     */
    const sudahDariItemIni = new Set<string>();
    for (const { komponen: k, jumlah: tambah } of pecah.komponen) {
      // Besar-kecil huruf satuan ("Kg" vs "kg") cuma cara mengetik — kalau ikut
      // jadi kunci, satu bahan yang sama pecah jadi dua baris berjumlah separuh
      // dan pembacanya menyimpulkan kebutuhannya lebih kecil dari yang sebenarnya.
      const satuan = (k.satuan ?? "").trim();
      const kunci = JSON.stringify([k.kategori, k.nama, satuan.toLowerCase()]);
      const ada = peta.get(kunci);
      const baruDariItemIni = !sudahDariItemIni.has(kunci);
      sudahDariItemIni.add(kunci);
      if (ada) {
        ada.jumlah += tambah;
        ada.dariBaris += 1;
        if (baruDariItemIni) ada.nilaiTertahan += it.amount;
      } else {
        peta.set(kunci, {
          kategori: k.kategori,
          nama: k.nama,
          satuan,
          jumlah: tambah,
          dariBaris: 1,
          nilaiTertahan: it.amount,
          janggal: janggalKategori(k.kategori, satuan),
        });
      }
    }
  }

  const kebutuhan = [...peta.values()]
    .map((k) => ({ ...k, jumlah: Math.round(k.jumlah * SKALA) / SKALA }))
    // Nama sumber daya TIDAK disatukan antar ejaan yang berbeda ("Semen PC" vs
    // "Semen Portland"): menggabungkannya butuh keputusan yang tidak boleh
    // diambil diam-diam oleh pengurut daftar.
    .sort(
      (a, b) =>
        (URUTAN_KATEGORI[a.kategori] ?? 9) - (URUTAN_KATEGORI[b.kategori] ?? 9) ||
        b.jumlah - a.jumlah ||
        a.nama.localeCompare(b.nama, "id"),
    );

  return {
    kebutuhan,
    dipakai: { baris: barisDipakai, nilai: nilaiDipakai },
    dilewat,
    nilaiDilewat,
  };
}

/* ------------------------------------------------------------------ BIAYA */

/**
 * Harga satuan dasar yang sudah diisi orang, dikunci sama persis dengan kunci
 * pengelompokan kebutuhan: kategori + nama + satuan (huruf kecil).
 */
export type HargaSatuan = {
  kategori: string;
  nama: string;
  satuan: string;
  /** Rupiah per satuan. */
  harga: bigint;
};

export type BarisBiaya = Kebutuhan & {
  /** null = harganya belum diisi. */
  harga: bigint | null;
  /** null selama harganya belum diisi — BUKAN nol. */
  biaya: bigint | null;
};

export type HasilBiaya = {
  baris: BarisBiaya[];
  /** Total biaya sumber daya yang SUDAH berharga. */
  totalBiaya: bigint;
  perKategori: { kategori: string; biaya: bigint; berharga: number; total: number }[];
  /** Berapa jenis sumber daya yang sudah/belum berharga. */
  berharga: number;
  belumBerharga: number;
};

/** Kunci penjodohan harga ↔ kebutuhan. Satu tempat, supaya tidak pernah beda. */
export function kunciSumberDaya(kategori: string, nama: string, satuan: string): string {
  return JSON.stringify([kategori, nama, satuan.trim().toLowerCase()]);
}

/**
 * Kalikan kebutuhan dengan harga satuan dasar.
 *
 *     biaya(sumber daya) = kebutuhan × harga satuan
 *
 * Sumber daya yang BELUM berharga bernilai `null`, bukan nol. Nol berarti
 * "gratis" dan akan diam-diam mengecilkan total; null berarti "belum diketahui"
 * dan memaksa angkanya dilaporkan sebagai belum lengkap. Ini pembeda yang sama
 * dengan volume kosong di atas, dan alasannya sama: total yang terlihat rapi
 * padahal separuh isinya belum berharga adalah cara paling mudah salah menawar.
 */
export function hitungBiaya(kebutuhan: Kebutuhan[], harga: HargaSatuan[]): HasilBiaya {
  // Harga nol diperlakukan sebagai belum diketahui, bukan sumber daya gratis.
  // Ini juga menjaga data lama yang mungkin tersimpan sebelum input HSD
  // menghapus nilai nol secara eksplisit.
  const peta = new Map(
    harga
      .filter((h) => h.harga > 0n)
      .map((h) => [kunciSumberDaya(h.kategori, h.nama, h.satuan), h.harga]),
  );

  const baris: BarisBiaya[] = kebutuhan.map((k) => {
    const h = peta.get(kunciSumberDaya(k.kategori, k.nama, k.satuan)) ?? null;
    return {
      ...k,
      harga: h,
      // Dibulatkan ke rupiah penuh: uang di sistem ini BigInt, dan pecahan
      // rupiah tidak pernah ada di penawaran.
      biaya: h === null ? null : BigInt(Math.round(k.jumlah * Number(h))),
    };
  });

  const perKategoriPeta = new Map<string, { biaya: bigint; berharga: number; total: number }>();
  let totalBiaya = 0n;
  let berharga = 0;
  for (const b of baris) {
    const a = perKategoriPeta.get(b.kategori) ?? { biaya: 0n, berharga: 0, total: 0 };
    a.total += 1;
    if (b.biaya !== null) {
      a.biaya += b.biaya;
      a.berharga += 1;
      totalBiaya += b.biaya;
      berharga += 1;
    }
    perKategoriPeta.set(b.kategori, a);
  }

  return {
    baris,
    totalBiaya,
    perKategori: [...perKategoriPeta.entries()]
      .map(([kategori, v]) => ({ kategori, ...v }))
      .sort(
        (a, b) =>
          (URUTAN_KATEGORI[a.kategori] ?? 9) - (URUTAN_KATEGORI[b.kategori] ?? 9) ||
          a.kategori.localeCompare(b.kategori, "id"),
      ),
    berharga,
    belumBerharga: baris.length - berharga,
  };
}

export type Perbandingan = {
  /** Total biaya pelaksanaan menurut RAPL (hanya yang sudah berharga). */
  biayaRapl: bigint;
  /** Nilai RAB aktif lokasi (pra-PPN) yang menjadi nilai proyek. */
  nilaiProyek: bigint;
  /** Nilai proyek − RAPL. Positif = ada ruang margin pelaksanaan. */
  margin: bigint;
  /** margin ÷ nilai proyek × 100. */
  marginPersen: number;
  /**
   * Seberapa boleh dipercaya perbandingan ini: hasil kali cakupan pemetaan dan
   * cakupan harga. Perbandingan tanpa angka ini adalah angka yang menyesatkan.
   */
  keandalan: {
    /** % nilai RAB yang masuk hitungan kebutuhan. */
    cakupanNilai: number;
    /** % jenis sumber daya yang sudah berharga. */
    cakupanHarga: number;
    /** true = kedua cakupan penuh; hanya saat itu selisihnya berarti apa adanya. */
    utuh: boolean;
  };
};

/**
 * Bandingkan biaya RAPL dengan nilai proyek dari RAB aktif lokasi.
 *
 * Yang dikembalikan SELALU membawa `keandalan`. Selisih Rp1,5 M yang dihitung
 * dari 72% nilai RAB dan 40% sumber daya berharga BUKAN keuntungan Rp1,5 M —
 * ia angka setengah jadi, dan menyajikannya telanjang adalah cara sistem ini
 * bisa menyebabkan orang salah menawar.
 */
export function bandingkanDenganNilaiProyek(args: {
  biayaRapl: bigint;
  nilaiProyek: bigint;
  nilaiRabTerhitung: bigint;
  nilaiRabTotal: bigint;
  sumberDayaBerharga: number;
  sumberDayaTotal: number;
}): Perbandingan {
  const margin = args.nilaiProyek - args.biayaRapl;
  const cakupanNilai =
    args.nilaiRabTotal > 0n ? (Number(args.nilaiRabTerhitung) / Number(args.nilaiRabTotal)) * 100 : 0;
  const cakupanHarga =
    args.sumberDayaTotal > 0 ? (args.sumberDayaBerharga / args.sumberDayaTotal) * 100 : 0;
  return {
    biayaRapl: args.biayaRapl,
    nilaiProyek: args.nilaiProyek,
    margin,
    marginPersen:
      args.nilaiProyek > 0n ? (Number(margin) / Number(args.nilaiProyek)) * 100 : 0,
    keandalan: {
      cakupanNilai,
      cakupanHarga,
      utuh: cakupanNilai >= 99.95 && cakupanHarga >= 99.95,
    },
  };
}

/* -------------------------------------------------------- BIAYA PER ITEM */

export type KomponenItem = {
  kategori: string;
  nama: string;
  satuan: string;
  /** Kebutuhan untuk item ini saja — sudah dikalikan volume dan faktor. */
  jumlah: number;
  /** false = ditambahkan orang, bukan dari analisa AHSP. */
  dariAhsp: boolean;
  harga: bigint | null;
  /** null selama harganya belum diisi — BUKAN nol. */
  biaya: bigint | null;
};

/** Bagaimana biaya item ini disusun. */
export type CaraItem = "ahsp" | "manual" | "campuran" | "borongan" | "belum";

export type BiayaItem = {
  lineageKey: string;
  code: string;
  uraian: string;
  satuan: string;
  volume: number | null;
  /** Nilai item menurut RAB aktif — harga jualnya. */
  nilaiRab: bigint;
  cara: CaraItem;
  komponen: KomponenItem[];
  /** Σ biaya komponen yang SUDAH berharga; borongan = harga × volume. */
  biaya: bigint;
  komponenBelumBerharga: number;
  /** true = seluruh komponennya berharga, atau item ini borongan. */
  lengkap: boolean;
  /**
   * nilaiRab − biaya. **null selama belum lengkap.** Separuh biaya bukan
   * margin: menyajikannya telanjang membuat item yang sebenarnya rugi terlihat
   * untung, dan itulah angka yang dipakai orang memutuskan menawar.
   */
  margin: bigint | null;
  marginPersen: number | null;
  /** Terisi = item ini tidak bisa dihitung, dan ini sebabnya. */
  alasanLewat: AlasanLewat | null;
  rinciLewat: string | null;
  /**
   * Keadaan rincian yang sedang berlaku — dibawa apa adanya supaya layar bisa
   * mengisi formulirnya tanpa membaca ulang dari tempat lain (dan lalu
   * menampilkan sesuatu yang berbeda dari yang dipakai menghitung).
   */
  faktorKonversi: number | null;
  catatanKonversi: string | null;
  hargaBorongan: bigint | null;
};

/**
 * Biaya dan margin PER ITEM RAB (RAPL-08, DECISIONS 473).
 *
 * Inilah bentuk yang sebenarnya dipakai orang: bukan "berapa total semen se-
 * lokasi", melainkan **item mana yang rugi**. Agregat sumber daya tetap ada
 * dan tetap berguna untuk pengadaan, tetapi ia sekarang TURUNAN dari daftar
 * ini — bukan sebaliknya.
 *
 * MURNI. Gerbangnya memakai `pecahItem` yang sama dengan `agregasiKebutuhan`,
 * jadi item yang masuk hitungan di satu tempat tidak pernah berbeda di tempat
 * lain.
 */
export function hitungItemRapl(items: ItemUntukRapl[], harga: HargaSatuan[]): BiayaItem[] {
  const peta = new Map(
    harga
      .filter((h) => h.harga > 0n)
      .map((h) => [kunciSumberDaya(h.kategori, h.nama, h.satuan), h.harga]),
  );

  return items.map((it) => {
    const dasar = {
      lineageKey: it.lineageKey,
      code: it.code,
      uraian: it.uraian,
      satuan: it.satuanNorm,
      volume: it.volume,
      nilaiRab: it.amount,
      faktorKonversi: it.rincian?.faktorKonversi ?? null,
      catatanKonversi: it.rincian?.catatanKonversi ?? null,
      hargaBorongan: it.rincian?.hargaBorongan ?? null,
    };

    const pecah = pecahItem(it);
    if (!pecah.ok) {
      return {
        ...dasar,
        cara: "belum" as CaraItem,
        komponen: [],
        biaya: 0n,
        komponenBelumBerharga: 0,
        lengkap: false,
        margin: null,
        marginPersen: null,
        alasanLewat: pecah.alasan,
        rinciLewat: pecah.rinci,
      };
    }

    if (pecah.borongan !== null) {
      // Borongan sudah berupa harga per satuan item: tidak ada komponen yang
      // bisa belum berharga, jadi ia SELALU lengkap.
      const biaya = BigInt(Math.round((it.volume ?? 0) * Number(pecah.borongan)));
      return {
        ...dasar,
        cara: "borongan" as CaraItem,
        komponen: [],
        biaya,
        komponenBelumBerharga: 0,
        lengkap: true,
        margin: it.amount - biaya,
        marginPersen: it.amount > 0n ? (Number(it.amount - biaya) / Number(it.amount)) * 100 : 0,
        alasanLewat: null,
        rinciLewat: null,
      };
    }

    const komponen: KomponenItem[] = pecah.komponen.map((c) => {
      const satuan = (c.komponen.satuan ?? "").trim();
      const h = peta.get(kunciSumberDaya(c.komponen.kategori, c.komponen.nama, satuan)) ?? null;
      const jumlah = Math.round(c.jumlah * SKALA) / SKALA;
      return {
        kategori: c.komponen.kategori,
        nama: c.komponen.nama,
        satuan,
        jumlah,
        dariAhsp: c.dariAhsp,
        harga: h,
        biaya: h === null ? null : BigInt(Math.round(jumlah * Number(h))),
      };
    });

    const biaya = komponen.reduce((a, k) => a + (k.biaya ?? 0n), 0n);
    const belum = komponen.filter((k) => k.biaya === null).length;
    const lengkap = komponen.length > 0 && belum === 0;
    const adaAhsp = komponen.some((k) => k.dariAhsp);
    const adaManual = komponen.some((k) => !k.dariAhsp);

    return {
      ...dasar,
      cara: (adaAhsp && adaManual ? "campuran" : adaAhsp ? "ahsp" : "manual") as CaraItem,
      komponen,
      biaya,
      komponenBelumBerharga: belum,
      lengkap,
      margin: lengkap ? it.amount - biaya : null,
      marginPersen:
        lengkap && it.amount > 0n ? (Number(it.amount - biaya) / Number(it.amount)) * 100 : null,
      alasanLewat: null,
      rinciLewat: null,
    };
  });
}
