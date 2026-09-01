import type { FlatNode } from "@/lib/rab/flatten";

/**
 * Bandingkan RAB hasil parse file dengan RAB AKTIF — untuk pratinjau impor
 * (DECISIONS 209). MURNI: tanpa DB, supaya bisa diuji tanpa env.
 *
 * Ini BUKAN `diffRevisions` (yang membandingkan dua revisi tersimpan). Di sini
 * sisi kanan belum tersimpan sama sekali — justru itu gunanya: user melihat
 * apa yang akan berubah SEBELUM ada yang ditulis.
 *
 * Identitas item = `lineageKey` (bukan nama), sama seperti yang dipakai
 * laporan harian. Itu sebabnya "item hilang" bisa dihitung bersama realisasi
 * yang sudah menempel padanya: item yang sudah dikerjakan tapi tidak ada di
 * file baru adalah kejadian paling mahal dalam impor — progresnya lepas.
 */

export type NodeAktif = {
  lineageKey: string;
  kind: string;
  code: string;
  name: string;
  volume: number | null;
  unitPrice: number | null;
  amount: bigint;
};

export type BarisBeda = {
  lineageKey: string;
  code: string;
  name: string;
};

export type VolumeBerubah = BarisBeda & {
  dari: number | null;
  ke: number | null;
  /** Volume yang SUDAH dilaporkan untuk item ini. */
  realisasi: number;
  /** Volume baru di bawah yang sudah terealisasi — mustahil dipertanggungjawabkan. */
  dibawahRealisasi: boolean;
};

export type ItemHilang = BarisBeda & { realisasi: number };

/**
 * Harga satuan item KONTRAK LAMA yang berubah di file baru (DECISIONS 213).
 *
 * Adendum mengubah VOLUME; harga satuan item yang sudah ada di kontrak adalah
 * harga yang sudah disepakati dan tidak boleh bergeser. Kalau bergeser, nilai
 * kontrak berubah tanpa ada pekerjaan yang bertambah — dan itu tidak akan
 * terlihat di kolom volume mana pun. Item BARU tidak masuk sini: harganya
 * memang belum pernah disepakati.
 */
export type HargaBerubah = BarisBeda & {
  /**
   * Nama item yang sama di KONTRAK. Wajib dibawa: panel lama mencetak nama dari
   * file baru bersama harga dari item lama, jadi pasangan yang meleset (nomor
   * bergeser) terbaca sebagai "harga berubah" dan tidak ada cara melihatnya.
   */
  namaLama: string;
  dari: number | null;
  ke: number | null;
  /** Volume kontrak baru — dipakai menaksir dampak rupiahnya. */
  volume: number | null;
  /** (harga baru − harga lama) × volume baru, dibulatkan ke rupiah. */
  dampakRupiah: bigint;
};

/**
 * Nilai (kolom JUMLAH) item KONTRAK LAMA yang bergeser padahal volume dan harga
 * satuannya tidak bergerak.
 *
 * `flatten` memakai `total_price` dari berkas APA ADANYA bila kolomnya terisi
 * (DECISIONS 212), jadi nilai item TIDAK selalu sama dengan volume × harga.
 * Konsekuensinya: kolom JUMLAH yang diketik ulang menggeser nilai kontrak tanpa
 * satu pun volume atau harga bergerak – dan sebelum ini tidak ada satu pun
 * daftar yang memuatnya, sehingga item itu terhitung "tetap". Cek-silang parser
 * baru berbunyi di atas 1% per baris; 0,9% dari berkas 8 miliar adalah puluhan
 * juta yang lewat tanpa suara.
 */
export type NilaiBergeser = BarisBeda & {
  dari: bigint;
  ke: bigint;
  /** ke − dari, dalam rupiah. */
  selisih: bigint;
};

export type RingkasBeda = {
  totalAktif: bigint;
  totalBaru: bigint;
  itemBaru: BarisBeda[];
  itemHilang: ItemHilang[];
  volumeBerubah: VolumeBerubah[];
  hargaBerubah: HargaBerubah[];
  nilaiBergeser: NilaiBergeser[];
  /** Item yang lineage-nya sama, volume, harga satuan DAN nilainya tidak berubah. */
  jumlahTetap: number;
};

/**
 * Presisi SIMPAN, bukan presisi bilangan mengambang. `volume Decimal(15,3)` dan
 * `unitPrice Decimal(15,2)` (prisma/schema.prisma) berarti angka dari berkas
 * dibulatkan Postgres saat ditulis. Membandingkan angka berkas dengan angka
 * tersimpan memakai epsilon yang LEBIH KECIL dari pembulatan itu membuat berkas
 * yang identik dilaporkan berubah selamanya: file 12,3456 tersimpan 12,346,
 * selisih 0,0004 – 400x lebih besar dari EPS 1e-6 yang dipakai sebelumnya.
 *
 * Jadi yang dibandingkan adalah "yang akan tersimpan" lawan "yang tersimpan":
 * kedua sisi dibulatkan ke presisi kolomnya, lalu diadu sebagai bilangan bulat.
 */
const DESIMAL_VOLUME = 3;
const DESIMAL_HARGA = 2;

/**
 * KOSONG DAN NOL ADALAH KEADAAN YANG SAMA.
 *
 * Laporan user 2026-09-01: sembilan item dilaporkan "harga satuan berubah"
 * padahal harga kontraknya memang 0 sejak awal dan sel harga di berkas kosong.
 * Sebabnya perbandingan lama menuntut KEDUA sisi bukan-null sebelum boleh
 * mengadu angkanya, sehingga 0 lawan null tidak pernah sampai ke perbandingan
 * dan langsung jatuh sebagai "berbeda". Panel lalu mencetak buktinya sendiri
 * bahwa tidak ada yang berubah – "Rp 0", tanda hubung, "(+Rp 0)" – lalu tetap
 * berteriak merah.
 */
function samaPadaPresisi(a: number | null, b: number | null, desimal: number): boolean {
  const f = 10 ** desimal;
  return Math.round((a ?? 0) * f) === Math.round((b ?? 0) * f);
}

/** Nilai rupiah item pada suatu harga satuan; volume kosong = tidak ada volume. */
function rupiah(harga: number | null, volume: number | null): bigint {
  return BigInt(Math.round((harga ?? 0) * (volume ?? 0)));
}

/**
 * Toleransi nilai item: apportionment "largest remainder" di `flatten`
 * memindahkan sisa pembulatan antar-saudara, sehingga `amount` satu item bisa
 * bergeser 1 rupiah hanya karena saudaranya berubah. Yang dicari di sini adalah
 * nilai yang DIKETIK ulang, bukan derau pembulatan.
 */
const TOLERANSI_NILAI = 2n;

const EPS = 1e-6;

export function bandingkanTerhadapAktif(
  aktif: NodeAktif[],
  baru: FlatNode[],
  realisasiByLineage: Map<string, number>,
): RingkasBeda {
  const itemAktif = new Map(aktif.filter((n) => n.kind === "item").map((n) => [n.lineageKey, n]));
  const itemBaruList = baru.filter((n) => n.kind === "item");
  const itemBaruMap = new Map(itemBaruList.map((n) => [n.lineageKey, n]));

  const itemBaru: BarisBeda[] = [];
  const volumeBerubah: VolumeBerubah[] = [];
  const hargaBerubah: HargaBerubah[] = [];
  const nilaiBergeser: NilaiBergeser[] = [];
  let jumlahTetap = 0;

  for (const n of itemBaruList) {
    const lama = itemAktif.get(n.lineageKey);
    if (!lama) {
      itemBaru.push({ lineageKey: n.lineageKey, code: n.code, name: n.name });
      continue;
    }
    const dari = lama.volume;
    const ke = n.volume;
    const volumeSama = samaPadaPresisi(dari, ke, DESIMAL_VOLUME);

    // Harga satuan diperiksa TERPISAH dari volume: item bisa volumenya tetap
    // tapi harganya bergeser, dan itu justru yang paling mudah lolos.
    //
    // GERBANGNYA RUPIAH YANG BERPINDAH, BUKAN SELISIH DESIMAL. Uang di sistem
    // ini BigInt rupiah tanpa sen, dan yang dijaga DECISIONS 213 adalah "nilai
    // kontrak berubah tanpa ada pekerjaan yang bertambah". Selisih harga satuan
    // yang tidak memindahkan satu rupiah pun karena itu bukan perubahan harga:
    // 706.908,69 lawan 706.908,70 adalah satu nilai yang dibulatkan dua arah
    // oleh dua dokumen, bukan harga yang bergeser. Toleransi lama 0,005 justru
    // menangkapnya, sebab beda TERKECIL yang mungkin ada antara dua dokumen
    // ber-dua-desimal adalah 0,01 – tepat di atas ambangnya.
    const hargaLama = lama.unitPrice;
    const hargaBaruNilai = n.unitPrice;
    // Volume kosong (item lump-sum) tidak boleh membuat perubahan harga menguap:
    // (baru − lama) × 0 = 0 akan melaporkan kenaikan 100 juta sebagai "Rp 0",
    // lalu mengurutkannya paling bawah dan memotongnya dari layar. Untuk item
    // itu dampaknya diambil dari pergerakan nilai tercatat.
    const adaVolume = (ke ?? 0) > 0;
    const dampakRupiah = adaVolume
      ? rupiah(hargaBaruNilai, ke) - rupiah(hargaLama, ke)
      : n.amount - lama.amount;
    const hargaSama = adaVolume
      ? dampakRupiah === 0n
      : samaPadaPresisi(hargaLama, hargaBaruNilai, DESIMAL_HARGA);
    if (!hargaSama) {
      hargaBerubah.push({
        lineageKey: n.lineageKey,
        code: n.code,
        name: n.name,
        namaLama: lama.name,
        dari: hargaLama,
        ke: hargaBaruNilai,
        volume: ke,
        dampakRupiah,
      });
    }

    // Nilai item yang bergeser SENDIRI – volume tetap, harga tetap, JUMLAH
    // berbeda. Diperiksa hanya bila keduanya tidak bergerak; kalau salah satu
    // bergerak, nilai memang seharusnya ikut dan barisnya sudah muncul di
    // daftar lain.
    const selisihNilai = n.amount - lama.amount;
    const nilaiSama =
      !volumeSama || !hargaSama
        ? true
        : (selisihNilai < 0n ? -selisihNilai : selisihNilai) <= TOLERANSI_NILAI;
    if (!nilaiSama) {
      nilaiBergeser.push({
        lineageKey: n.lineageKey,
        code: n.code,
        name: n.name,
        dari: lama.amount,
        ke: n.amount,
        selisih: selisihNilai,
      });
    }

    if (volumeSama) {
      if (hargaSama && nilaiSama) jumlahTetap++;
      continue;
    }
    const realisasi = realisasiByLineage.get(n.lineageKey) ?? 0;
    volumeBerubah.push({
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name,
      dari,
      ke,
      realisasi,
      // Volume kontrak di bawah yang sudah dikerjakan = ada pekerjaan yang tak
      // punya dasar bayar. Ditandai, tidak dibetulkan sendiri.
      //
      // `ke == null` ikut dihitung DI BAWAH realisasi, bukan dilewati. Volume
      // yang menjadi tidak diketahui pada item yang sudah dikerjakan adalah
      // keadaan yang lebih buruk, bukan lebih aman: sebelumnya syarat
      // `ke != null` membuat item ber-realisasi 60 yang volumenya hilang dari
      // berkas lolos tanpa menyalakan panel merah sama sekali.
      dibawahRealisasi: realisasi > EPS && (ke == null || realisasi - ke > EPS),
    });
  }
  // Dampak rupiah terbesar disebut lebih dulu.
  hargaBerubah.sort((a, b) => {
    const av = a.dampakRupiah < 0n ? -a.dampakRupiah : a.dampakRupiah;
    const bv = b.dampakRupiah < 0n ? -b.dampakRupiah : b.dampakRupiah;
    return bv > av ? 1 : bv < av ? -1 : a.code.localeCompare(b.code, "id");
  });

  const abs = (v: bigint) => (v < 0n ? -v : v);
  nilaiBergeser.sort((a, b) => {
    const av = abs(a.selisih);
    const bv = abs(b.selisih);
    return bv > av ? 1 : bv < av ? -1 : a.code.localeCompare(b.code, "id");
  });

  const itemHilang: ItemHilang[] = [];
  for (const [key, lama] of itemAktif) {
    if (itemBaruMap.has(key)) continue;
    itemHilang.push({
      lineageKey: key,
      code: lama.code,
      name: lama.name,
      realisasi: realisasiByLineage.get(key) ?? 0,
    });
  }
  // Yang sudah dikerjakan disebut LEBIH DULU — itu yang paling perlu dilihat.
  itemHilang.sort((a, b) => b.realisasi - a.realisasi || a.code.localeCompare(b.code, "id"));

  const jumlah = (ns: { kind: string; amount: bigint }[]) =>
    ns.filter((n) => n.kind === "kategori").reduce((t, n) => t + n.amount, 0n);

  return {
    totalAktif: jumlah(aktif),
    totalBaru: jumlah(baru),
    itemBaru,
    itemHilang,
    volumeBerubah,
    hargaBerubah,
    nilaiBergeser,
    jumlahTetap,
  };
}
