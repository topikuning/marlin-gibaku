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

/** Turunkan kebutuhan sumber daya dari item RAB yang padanannya sudah disetujui. */
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

  const lewat = (it: ItemUntukRapl, alasan: AlasanLewat, rinci: string) => {
    dilewat.push({
      lineageKey: it.lineageKey,
      code: it.code,
      uraian: it.uraian,
      amount: it.amount,
      alasan,
      rinci,
    });
    nilaiDilewat[alasan] += it.amount;
  };

  for (const it of items) {
    if (!it.analisa) {
      lewat(
        it,
        "belum_disetujui",
        it.adaUsulan
          ? "usulan mesin sudah ada – tinggal diperiksa lalu disetujui"
          : "belum ada padanan sama sekali – perlu dicarikan analisanya",
      );
      continue;
    }
    if (it.analisa.komponen.length === 0) {
      lewat(
        it,
        "tanpa_koefisien",
        `analisa [${it.analisa.kode}] belum punya koefisien terstruktur`,
      );
      continue;
    }
    if (it.volume === null) {
      lewat(it, "volume_kosong", "item RAB tidak punya volume");
      continue;
    }
    // Satuan analisa "—" berarti berkas masternya sendiri tidak bisa membacanya;
    // itu bukan izin untuk menganggapnya sepadan.
    if (!it.satuanNorm || !it.analisa.satuanNorm || it.satuanNorm !== it.analisa.satuanNorm) {
      lewat(
        it,
        "satuan_tidak_sepadan",
        `item ${it.satuanNorm || "tanpa satuan"} vs analisa ${it.analisa.satuanNorm || "tanpa satuan"}`,
      );
      continue;
    }

    barisDipakai += 1;
    nilaiDipakai += it.amount;
    for (const k of it.analisa.komponen) {
      // Besar-kecil huruf satuan ("Kg" vs "kg") cuma cara mengetik — kalau ikut
      // jadi kunci, satu bahan yang sama pecah jadi dua baris berjumlah separuh
      // dan pembacanya menyimpulkan kebutuhannya lebih kecil dari yang sebenarnya.
      const satuan = (k.satuan ?? "").trim();
      const kunci = JSON.stringify([k.kategori, k.nama, satuan.toLowerCase()]);
      const ada = peta.get(kunci);
      const tambah = k.koefisien * it.volume;
      if (ada) {
        ada.jumlah += tambah;
        ada.dariBaris += 1;
      } else {
        peta.set(kunci, {
          kategori: k.kategori,
          nama: k.nama,
          satuan,
          jumlah: tambah,
          dariBaris: 1,
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
