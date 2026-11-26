import { bagiProporsional } from "@/lib/rab/padanan-aktif-aturan";
import { formatNumber, formatTanggal } from "@/lib/format";
import type { LaporanMarlin, ModeImpor, PilihanBentrok, SelMarlin } from "./jenis";

/**
 * RENCANA IMPOR REKAP HARIAN (DECISIONS 782). MURNI – dihitung di server saat
 * pratinjau DAN saat menyimpan (keduanya harus sama persis, dijaga `sidik`),
 * dan di layar tiap kali orang mengubah pilihan.
 *
 * Permintaan user 2026-11-25: *"ada dua mode, apend dan overwrite, jika di
 * tanggal yang sama itu tinggal penyesuaian, tapi jika ada tanggal yang tidak
 * sama antara di excel dan di marlin, lalu bentrok jumlahnya, ini juga perlu
 * dimitigasi, yang utama foto eksisting tidak boleh hilang dan harus aman."*
 *
 * Per item RAB:
 * - Tanggal ada di keduanya → DISESUAIKAN ke angka Excel (kedua mode).
 * - Hanya di Excel → DITAMBAH.
 * - Hanya di MARLIN, di dalam periode Excel → TAMBAH: dibiarkan; TIMPA:
 *   dinolkan. Baris yang sesudahnya tidak membawa apa-apa lagi (tanpa foto,
 *   catatan, catatan luar RAB, atau pemasangan) DIBUANG – baris 0 tanpa isi
 *   tidak ada gunanya di laporan (user 2026-11-26, DECISIONS 786). Yang masih
 *   membawa foto/catatan tetap ada dengan volume 0, dan sebabnya disebut.
 *   Baris 0 tanpa isi sisa impor sebelumnya ikut dibuang di mode timpa.
 *   Di luar periode Excel (laporan sesudah tanggal terakhir yang terisi)
 *   tidak pernah disentuh.
 * - Dua keadaan yang perlu keputusan (dulu sama-sama disebut "bentrok",
 *   membingungkan – user 2026-11-26):
 *   `beda_tanggal` (mode tambah: Excel dan MARLIN sama-sama punya tanggal yang
 *   tidak ada di pihak lain – bisa jadi pekerjaan yang sama dicatat di hari
 *   berbeda): DITANYAKAN, bawaannya dilewati;
 *   `melebihi_kontrak` (total Excel di atas volume RAB aktif): volume kontrak
 *   adalah batasnya, jadi bawaannya angka Excel DIPOTONG RATA sampai pas
 *   volume kontrak dan disebut; Lewati tetap bisa dipilih (DECISIONS 786).
 *   Hanya pilihan yang hasilnya sah yang ditawarkan, masing-masing dengan
 *   total hasilnya.
 * - "Ikut Excel" berarti ikut Excel (user 2026-11-25: *"perintah ikut excel ya
 *   ikut excel"*). Yang dulu ditahan kini DITULIS dan akibatnya disebut per
 *   tanggal: hari yang dinyatakan nihil (pernyataannya dibatalkan), baris draft
 *   adendum (dijadikan baris kontrak), baris hasil pemasangan 777 (pasangannya
 *   tidak bisa dilepas lagi).
 * - Yang tetap DITAHAN hanya aturan hak dan kontrak: laporan terkirim,
 *   disetujui, atau final yang diimpor oleh peran di bawah Site Manager
 *   (`izinImpor`, DECISIONS 784), dan lokasi yang sudah dicabut. Item yang sebagian perubahannya ditahan padahal ada yang
 *   dinolkan/diturunkan ditahan SELURUHNYA – supaya volumenya tidak terhitung
 *   dua kali.
 * - Foto tidak pernah disentuh – kecuali orang MEMINTA "pindahkan foto ke
 *   tanggal Excel" (DECISIONS 783): foto di baris yang dinolkan ikut ke
 *   tanggal Excel item yang sama yang paling dekat dengan waktu jepretnya.
 *   Jaraknya sama ke dua tanggal → tidak dipindah, disebut. Cap tanggal di foto
 *   TIDAK diubah: foto tetap menyebut kapan ia diambil (DECISIONS 197).
 */

const EPS = 0.0005;
const bulat3 = (v: number) => Math.round(v * 1000) / 1000;
const tglOrang = (k: string) => formatTanggal(new Date(`${k}T00:00:00.000Z`), "d MMM yyyy");

/**
 * Selisih PEMBULATAN di atas volume kontrak: rekap lapangan diketik dua desimal
 * (kontrak 0,1792 m³ ditulis 0,18 saat tuntas – berkas BUYAT 1 baris 273), jadi
 * tiap sel bisa lebih paling banyak 0,005. Sebesar itu disamakan ke volume
 * kontrak dan DISEBUT; lebih dari itu bentrok yang diputuskan orang
 * (DECISIONS 203: penyesuaian kecil seragam dan dikatakan, yang besar tidak
 * dibetulkan sendiri).
 */
const toleransiBulat = (sel: number) => 0.005 * Math.max(1, sel) + EPS;

export type BarisMasuk = { excelRow: number; nama: string; lineageKey: string | null; sel: { tanggal: string; volume: number }[] };

export type ItemRab = { name: string; unit: string | null; volume: number | null; jalur: string };

export type MasukanRencana = {
  mode: ModeImpor;
  hariIni: string;
  awalPeriode: string;
  akhirPeriode: string | null;
  baris: BarisMasuk[];
  /** Daun RAB aktif per kunci item. */
  rab: Record<string, ItemRab>;
  /** Baris MARLIN per kunci item → per tanggal. */
  marlin: Record<string, Record<string, SelMarlin>>;
  /** Laporan MARLIN per tanggal. */
  laporan: Record<string, LaporanMarlin>;
  /** Tanggal tanpa laporan yang tidak boleh dibuatkan laporan (lokasi dicabut), dengan sebabnya. */
  tertutup: Record<string, string>;
  izin: { ubahTerkirim: boolean; ubahFinal: boolean };
  pilihan: Record<string, PilihanBentrok>;
  /** Foto di baris yang dinolkan ikut pindah ke tanggal Excel (DECISIONS 783). */
  pindahFoto?: boolean;
};

/** `hapus` = baris dinolkan yang tidak membawa apa-apa lagi, dibuang (786). */
export type AksiSel = "tambah" | "ubah" | "nolkan" | "hapus";

export type PerubahanSel = {
  tanggal: string;
  dari: number | null;
  ke: number;
  aksi: AksiSel;
  rowId: string | null;
  reportId: string | null;
  status: string | null;
  foto: number;
  /** Sebab sel ini tidak ditulis; null = ditulis. */
  ditahan: string | null;
  /** Akibat yang ikut terjadi bila sel ini ditulis (pernyataan nihil dibatalkan, …). */
  catatan: string | null;
  /** Baris dinolkan yang TIDAK dibuang: apa yang masih dibawanya (foto, catatan, …). */
  tetapKarena: string | null;
};

export type JenisBentrok = "beda_tanggal" | "melebihi_kontrak";

export type RencanaItem = {
  lineageKey: string;
  nama: string;
  unit: string | null;
  jalur: string;
  volumeKontrak: number | null;
  excelRows: number[];
  totalExcel: number;
  totalSekarang: number;
  totalSesudah: number;
  bentrok: JenisBentrok[];
  /** Tanggal yang hanya ada di Excel / hanya ada di MARLIN (dalam periode Excel) – untuk menjelaskan bentrok. */
  hanyaExcel: string[];
  hanyaMarlin: string[];
  /** Total bila diterapkan tanpa pilihan (dipakai menjelaskan "melebihi kontrak"). */
  totalBawaan: number;
  /** Angka Excel per tanggal – supaya terlihat dari mana totalnya. */
  excelPerTanggal: { tanggal: string; volume: number }[];
  pilihanTersedia: PilihanBentrok[];
  /** Total sesudah impor untuk tiap pilihan yang tersedia. */
  hasilPilihan: Partial<Record<PilihanBentrok, number>>;
  /** Pilihan yang dipakai untuk item bentrok; null = tidak bentrok. */
  pilihan: PilihanBentrok | null;
  perubahan: PerubahanSel[];
  catatan: string[];
  /** Seluruh item ditahan (sebabnya); perubahannya tidak ditulis. */
  ditahanSemua: string | null;
  /** Foto yang dipindah dari baris yang dinolkan ke tanggal Excel (DECISIONS 783). */
  pindahFoto: { dari: string; ke: string; jumlah: number }[];
  /** Foto di baris yang dinolkan yang TIDAK dipindah, dengan sebabnya. */
  fotoTetap: { dari: string; jumlah: number; sebab: string }[];
  /** Tanggal Excel yang boleh menerima foto – server memakai daftar yang sama persis. */
  tujuanFoto: string[];
};

export type Rencana = {
  item: RencanaItem[];
  ringkas: {
    tambah: number;
    ubah: number;
    nolkan: number;
    /** Baris dinolkan yang dibuang karena tidak membawa apa-apa lagi. */
    hapus: number;
    ditahan: number;
    /** Tanggal yang akan dibuatkan laporan baru. */
    laporanBaru: string[];
    itemBerubah: number;
    itemBentrok: number;
    itemDilewati: number;
    fotoDipindah: number;
  };
  /** Sidik jari perubahan yang akan ditulis – menyimpan menolak bila berbeda dari pratinjau. */
  sidik: string;
};

const TERKIRIM = new Set(["dikirim", "disetujui"]);

/** Yang menahan sel: hanya hak mengubah laporan dan lingkup kontrak lokasi. */
function sebabDitahan(o: MasukanRencana, tanggal: string): string | null {
  const lap = o.laporan[tanggal];
  if (!lap) return o.tertutup[tanggal] ?? null;
  if (lap.status === "final" && !o.izin.ubahFinal) return "laporan sudah final – perlu Site Manager ke atas";
  if (TERKIRIM.has(lap.status) && !o.izin.ubahTerkirim) return "laporan sudah dikirim – perlu Site Manager ke atas";
  return null;
}

const LABEL_NIHIL: Record<string, string> = {
  hujan: "hujan",
  libur: "libur",
  menunggu_material: "menunggu material",
  menunggu_lahan_izin: "menunggu lahan/izin",
  force_majeure: "force majeure",
  lainnya: "lainnya",
};

/** Akibat yang ikut terjadi bila sel ini ditulis – disebut, bukan ditahan. */
function akibatSel(o: MasukanRencana, tanggal: string, sel: SelMarlin | undefined, ke: number): string | null {
  const akibat: string[] = [];
  const lap = o.laporan[tanggal];
  if (lap?.noActivity && ke > EPS) {
    const sebab = lap.sebabNihil ? ` (${LABEL_NIHIL[lap.sebabNihil] ?? lap.sebabNihil})` : "";
    akibat.push(`pernyataan "tidak ada kegiatan"${sebab} dibatalkan`);
  }
  if (sel && sel.basis !== "aktif") akibat.push("baris draft adendum dijadikan baris kontrak");
  if (sel?.padanan) akibat.push("baris hasil pemasangan – pasangannya tidak bisa dilepas lagi");
  return akibat.length > 0 ? akibat.join("; ") : null;
}

const jumlah = (m: Map<string, number>) => bulat3([...m.values()].reduce((t, v) => t + v, 0));

const HARI = 86_400_000;
const jarak = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / HARI;

/**
 * Tanggal tujuan tiap foto: tanggal di `tujuan` yang paling dekat dengan waktu
 * jepretnya. Sama dekat ke dua tanggal → `null` (tidak dipindah). Dipakai
 * rencana DAN penulis di server, jadi keduanya pasti sama.
 */
export function tujuanFoto(waktu: string, tujuan: readonly string[]): string | null {
  let terbaik: string | null = null;
  let jarakTerbaik = Infinity;
  let seri = false;
  for (const t of tujuan) {
    const d = jarak(waktu, t);
    if (d < jarakTerbaik) {
      terbaik = t;
      jarakTerbaik = d;
      seri = false;
    } else if (d === jarakTerbaik) seri = true;
  }
  return seri ? null : terbaik;
}

/** Penanda baris yang dibuat impor ini sendiri – bukan catatan orang. */
export const CATATAN_IMPOR = "Dari impor rekap harian";

/**
 * Apa yang masih dibawa baris bila volumenya 0 (null = tidak ada, boleh
 * dibuang). Pemasangan (777) dan catatan luar RAB (738) menunjuk barisnya;
 * foto dan catatan orang adalah isi laporan.
 */
function isiBaris(s: SelMarlin, fotoSisa: number): string | null {
  const isi: string[] = [];
  if (fotoSisa > 0) isi.push(`${fotoSisa} foto`);
  const cat = s.catatanBaris?.trim();
  if (cat && cat !== CATATAN_IMPOR) isi.push("catatan");
  if (s.luarRab) isi.push("catatan di luar RAB yang dipadankan");
  if (s.padanan) isi.push("hasil pemasangan");
  return isi.length > 0 ? isi.join(", ") : null;
}

/** FNV-1a 32 bit – cukup untuk mendeteksi rencana yang berubah, bukan untuk keamanan. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function susunRencana(o: MasukanRencana): Rencana {
  const dalamPeriode = (t: string) => t >= o.awalPeriode && (o.akhirPeriode == null || t <= o.akhirPeriode);
  const perItem = new Map<string, { rows: number[]; nama: string; sel: Map<string, number>; catatan: string[] }>();
  let itemDilewati = 0;
  for (const b of o.baris) {
    if (!b.lineageKey) {
      itemDilewati++;
      continue;
    }
    const g = perItem.get(b.lineageKey) ?? { rows: [], nama: b.nama, sel: new Map<string, number>(), catatan: [] };
    g.rows.push(b.excelRow);
    for (const s of b.sel) {
      if (s.tanggal > o.hariIni) {
        g.catatan.push(`Tanggal ${tglOrang(s.tanggal)} belum terjadi – dilewati.`);
        continue;
      }
      if (s.volume < 0) {
        g.catatan.push(`Baris ${b.excelRow} tanggal ${tglOrang(s.tanggal)}: volume negatif (${formatNumber(s.volume)}) – dilewati.`);
        continue;
      }
      g.sel.set(s.tanggal, bulat3((g.sel.get(s.tanggal) ?? 0) + s.volume));
    }
    perItem.set(b.lineageKey, g);
  }

  const item: RencanaItem[] = [];
  for (const [lineageKey, g] of perItem) {
    const rab = o.rab[lineageKey];
    const m = o.marlin[lineageKey] ?? {};
    const catatan = [...g.catatan];
    if (g.rows.length > 1) catatan.push(`Baris Excel ${g.rows.join(", ")} menunjuk item yang sama – angkanya dijumlahkan per tanggal.`);
    const kontrak = rab?.volume ?? null;

    // Keadaan MARLIN sekarang (baris basis aktif, semua status).
    const kini = new Map<string, number>();
    for (const [t, s] of Object.entries(m)) if (s.basis === "aktif") kini.set(t, s.volume);
    const excel = g.sel;
    const hanyaExcel = [...excel.keys()].filter((t) => !(t in m));
    const hanyaMarlin = [...kini.entries()].filter(([t, v]) => !excel.has(t) && dalamPeriode(t) && v > EPS).map(([t]) => t);

    // Hasil akhir per pilihan.
    const akhirJumlahkan = new Map(kini);
    for (const [t, v] of excel) akhirJumlahkan.set(t, v);
    const akhirExcel = new Map(akhirJumlahkan);
    for (const t of hanyaMarlin) akhirExcel.set(t, 0);
    const tol = toleransiBulat(excel.size);
    const lewatKontrak = (a: Map<string, number>) => kontrak != null && jumlah(a) > kontrak + tol;
    const potong = (dasar: Map<string, number>): Map<string, number> | null => {
      if (kontrak == null) return null;
      const luar = bulat3([...dasar].filter(([t]) => !excel.has(t)).reduce((t, [, v]) => t + v, 0));
      const ruang = bulat3(kontrak - luar);
      if (ruang < 0) return null;
      const tgl = [...excel.keys()].sort();
      const hasil = new Map(dasar);
      bagiProporsional(
        tgl.map((t) => excel.get(t)!),
        Math.min(ruang, jumlah(excel)),
      ).forEach((v, i) => hasil.set(tgl[i]!, v));
      return hasil;
    };

    const bentrok: JenisBentrok[] = [];
    if (o.mode === "tambah" && hanyaExcel.length > 0 && hanyaMarlin.length > 0) bentrok.push("beda_tanggal");
    const bawaan = o.mode === "timpa" ? akhirExcel : akhirJumlahkan;
    if (lewatKontrak(bawaan)) bentrok.push("melebihi_kontrak");

    let pilihan: PilihanBentrok | null = null;
    const tersedia: PilihanBentrok[] = [];
    const hasilPilihan: Partial<Record<PilihanBentrok, number>> = {};
    let akhir: Map<string, number> | null = bawaan;
    if (bentrok.length > 0) {
      // Potong rata hanya bila dasarnya memang melebihi kontrak.
      const dasarPotong = o.mode === "timpa" || bentrok.includes("beda_tanggal") ? akhirExcel : akhirJumlahkan;
      const opsi = new Map<PilihanBentrok, Map<string, number> | null>([
        ["lewati", null],
        ["excel", lewatKontrak(akhirExcel) ? null : akhirExcel],
        ["jumlahkan", o.mode === "tambah" && !lewatKontrak(akhirJumlahkan) ? akhirJumlahkan : null],
        ["potong", lewatKontrak(dasarPotong) ? potong(dasarPotong) : null],
      ]);
      for (const [k, v] of opsi) if (k === "lewati" || v) tersedia.push(k);
      for (const k of tersedia) hasilPilihan[k] = k === "lewati" ? jumlah(kini) : jumlah(opsi.get(k)!);
      const diminta = o.pilihan[lineageKey];
      // Melebihi kontrak saja: volume kontrak batasnya → bawaannya dipotong.
      // Tanggal berbeda: tidak ditebak → bawaannya dilewati.
      const bawaanPilihan: PilihanBentrok =
        !bentrok.includes("beda_tanggal") && tersedia.includes("potong") ? "potong" : "lewati";
      pilihan = diminta && tersedia.includes(diminta) ? diminta : bawaanPilihan;
      akhir = pilihan === "lewati" ? null : opsi.get(pilihan)!;
    }

    // Selisih pembulatan di atas kontrak: disamakan ke volume kontrak, disebut.
    if (akhir && kontrak != null && jumlah(akhir) > kontrak + EPS) {
      const lebih = bulat3(jumlah(akhir) - kontrak);
      const dipotong = potong(akhir);
      if (dipotong) {
        catatan.push(
          `Total ${formatNumber(jumlah(akhir))} sedikit di atas volume kontrak ${formatNumber(kontrak)} ` +
            `(selisih pembulatan ${formatNumber(lebih)}) – disamakan ke volume kontrak.`,
        );
        akhir = dipotong;
      }
    }

    // Sel yang berubah.
    const perubahan: PerubahanSel[] = [];
    if (akhir) {
      for (const t of [...new Set([...akhir.keys(), ...excel.keys()])].sort()) {
        const ke = bulat3(akhir.get(t) ?? 0);
        const s = m[t];
        const dari = s ? s.volume : null;
        // Baris 0 tanpa isi (sisa impor sebelumnya) dibuang di mode timpa (786).
        const sisaKosong =
          o.mode === "timpa" && s != null && dari != null && dari <= EPS && ke <= EPS && dalamPeriode(t) && !isiBaris(s, s.foto);
        if (dari != null && Math.abs(dari - ke) <= EPS && s!.basis === "aktif" && !sisaKosong) continue;
        if (dari == null && ke <= EPS) continue;
        perubahan.push({
          tanggal: t,
          dari,
          ke,
          aksi: dari == null ? "tambah" : ke <= EPS ? "nolkan" : "ubah",
          tetapKarena: null,
          rowId: s?.rowId ?? null,
          reportId: s?.reportId ?? o.laporan[t]?.reportId ?? null,
          status: o.laporan[t]?.status ?? null,
          foto: s?.foto ?? 0,
          ditahan: sebabDitahan(o, t),
          catatan: akibatSel(o, t, s, ke),
        });
      }
    }
    // Item yang angkanya DIPINDAH (ada yang naik dan ada yang turun) tidak boleh
    // ditulis sebagian: separuh pindahan berarti terhitung dua kali, atau hilang.
    const adaTahan = perubahan.some((p) => p.ditahan);
    const adaTurun = perubahan.some((p) => p.dari != null && p.ke < p.dari - EPS);
    const adaNaik = perubahan.some((p) => p.dari == null || p.ke > p.dari + EPS);
    let ditahanSemua: string | null = null;
    if (adaTahan && adaTurun && adaNaik) {
      const sebab = perubahan.find((p) => p.ditahan)!;
      ditahanSemua =
        `Perubahan tanggal ${tglOrang(sebab.tanggal)} ditahan (${sebab.ditahan}), padahal angka di tanggal lain ikut dipindah. ` +
        `Supaya volumenya tidak terhitung dua kali, seluruh item ini ditahan.`;
      for (const p of perubahan) p.ditahan ??= "ikut ditahan bersama item ini";
    }
    const akhirTulis = new Map(kini);
    for (const p of perubahan) if (!p.ditahan) akhirTulis.set(p.tanggal, p.ke);

    // Foto di baris yang dinolkan → tanggal Excel terdekat (hanya bila diminta).
    const pindahFoto: RencanaItem["pindahFoto"] = [];
    const fotoTetap: RencanaItem["fotoTetap"] = [];
    let tujuan: string[] = [];
    if (o.pindahFoto && !ditahanSemua) {
      const tahanDi = new Map(perubahan.map((p) => [p.tanggal, p.ditahan]));
      // Tujuan: tanggal Excel yang sesudah impor bervolume dan boleh diubah orang ini.
      tujuan = [...excel.keys()]
        .filter((t) => (akhirTulis.get(t) ?? 0) > EPS)
        .filter((t) => (tahanDi.has(t) ? !tahanDi.get(t) : !sebabDitahan(o, t)))
        .sort();
      for (const p of perubahan) {
        if (p.aksi !== "nolkan" || p.ditahan) continue;
        const asal = m[p.tanggal];
        const waktu = asal?.fotoWaktu ?? [];
        const lain = (asal?.foto ?? 0) - waktu.length;
        if (lain > 0) fotoTetap.push({ dari: p.tanggal, jumlah: lain, sebab: "foto bukti catatan di luar RAB, tetap bersama catatannya" });
        if (waktu.length === 0) continue;
        if (tujuan.length === 0) {
          fotoTetap.push({ dari: p.tanggal, jumlah: waktu.length, sebab: "tidak ada tanggal Excel yang bisa menerimanya" });
          continue;
        }
        const ke = new Map<string, number>();
        let seri = 0;
        for (const w of waktu) {
          const t = tujuanFoto(w, tujuan);
          if (t) ke.set(t, (ke.get(t) ?? 0) + 1);
          else seri++;
        }
        for (const [t, n] of [...ke].sort()) pindahFoto.push({ dari: p.tanggal, ke: t, jumlah: n });
        if (seri > 0) fotoTetap.push({ dari: p.tanggal, jumlah: seri, sebab: "jaraknya sama ke dua tanggal Excel" });
      }
    }

    // Baris yang dinolkan: dibuang bila sesudah foto dipindah tidak membawa
    // apa-apa lagi; yang masih membawa sesuatu tetap ada dan sebabnya disebut.
    for (const p of perubahan) {
      if (p.aksi !== "nolkan" || p.ditahan) continue;
      const s = m[p.tanggal];
      if (!s) continue;
      const dipindah = pindahFoto.filter((f) => f.dari === p.tanggal).reduce((t, f) => t + f.jumlah, 0);
      const isi = isiBaris(s, s.foto - dipindah);
      if (isi) p.tetapKarena = isi;
      else p.aksi = "hapus";
    }

    item.push({
      lineageKey,
      nama: rab?.name ?? g.nama,
      unit: rab?.unit ?? null,
      jalur: rab?.jalur ?? "",
      volumeKontrak: kontrak,
      excelRows: g.rows,
      totalExcel: jumlah(excel),
      totalSekarang: jumlah(kini),
      totalSesudah: jumlah(akhirTulis),
      bentrok,
      hanyaExcel: hanyaExcel.sort(),
      hanyaMarlin: hanyaMarlin.sort(),
      totalBawaan: jumlah(bawaan),
      excelPerTanggal: [...excel].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tanggal, volume]) => ({ tanggal, volume })),
      pilihanTersedia: tersedia,
      hasilPilihan,
      pilihan,
      perubahan,
      catatan,
      ditahanSemua,
      pindahFoto,
      fotoTetap,
      tujuanFoto: tujuan,
    });
  }

  const ditulis = item.flatMap((i) => i.perubahan.filter((p) => !p.ditahan).map((p) => ({ i, p })));
  const laporanBaru = [...new Set(ditulis.filter(({ p }) => !o.laporan[p.tanggal]).map(({ p }) => p.tanggal))].sort();
  const fotoPindah = item.flatMap((i) => i.pindahFoto.map((f) => `${i.lineageKey}#${f.dari}>${f.ke}:${f.jumlah}`));
  const sidik = fnv(
    o.mode +
      "|" +
      ditulis
        .map(({ i, p }) => `${i.lineageKey}@${p.tanggal}:${p.dari ?? "-"}>${p.ke}:${p.aksi}`)
        .sort()
        .join(";") +
      "|" +
      fotoPindah.sort().join(";"),
  );
  return {
    item: item.sort((a, b) => (a.excelRows[0] ?? 0) - (b.excelRows[0] ?? 0)),
    ringkas: {
      tambah: ditulis.filter(({ p }) => p.aksi === "tambah").length,
      ubah: ditulis.filter(({ p }) => p.aksi === "ubah").length,
      nolkan: ditulis.filter(({ p }) => p.aksi === "nolkan").length,
      hapus: ditulis.filter(({ p }) => p.aksi === "hapus").length,
      ditahan: item.reduce((t, i) => t + i.perubahan.filter((p) => p.ditahan).length, 0),
      laporanBaru,
      itemBerubah: new Set(ditulis.map(({ i }) => i.lineageKey)).size,
      itemBentrok: item.filter((i) => i.bentrok.length > 0).length,
      itemDilewati,
      fotoDipindah: item.reduce((t, i) => t + i.pindahFoto.reduce((u, f) => u + f.jumlah, 0), 0),
    },
    sidik,
  };
}
