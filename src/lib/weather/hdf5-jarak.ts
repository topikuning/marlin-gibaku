import { inflateSync } from "node:zlib";

/**
 * PEMBACA HDF5 JARAK JAUH – hanya bagian yang dibutuhkan (DECISIONS baru 2026-10-07).
 *
 * Berkas awan Himawari di arsip NOAA berukuran ±360 MB per pemotretan. Yang
 * MARLIN butuhkan cuma beberapa piksel di sekitar lokasi proyek. Format HDF5
 * menyimpan data per potongan (chunk) 200×200 yang dimampatkan sendiri-sendiri,
 * jadi cukup membaca: kepala berkas → indeks potongan → SATU potongan. Semuanya
 * lewat permintaan HTTP Range, tanpa mengunduh berkas utuh.
 *
 * Sengaja SEMPIT: hanya fitur yang dipakai berkas NOAA (superblock versi 0/1,
 * grup tabel-simbol, object header versi 1, layout chunked versi 3, filter
 * shuffle + deflate). Fitur lain ditolak dengan galat yang menyebut namanya –
 * lebih baik gagal jujur daripada membaca angka yang salah.
 *
 * Murni (tanpa db, tanpa jaringan): sumber bita diserahkan pemanggil, jadi bisa
 * diuji dengan berkas lokal.
 */

export class Hdf5Error extends Error {}

/** Ambil `panjang` bita mulai `offset`. */
export type BacaBita = (offset: number, panjang: number) => Promise<Uint8Array>;

const TANDA = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const UNDEF = 2 ** 53; // alamat "tidak ada" (semua bit 1) sesudah dipangkas ke Number

type Tipe = {
  kelas: "int" | "float";
  ukuran: number;
  bigEndian: boolean;
  bertanda: boolean;
};
type Filter = { id: number; flags: number; data: number[] };

export type InfoDataset = {
  nama: string;
  bentuk: number[];
  potongan: number[];
  tipe: Tipe;
  filter: Filter[];
  alamatBtree: number;
};

class Pembaca {
  private O = 8;
  private L = 8;
  private blok = new Map<number, Promise<Uint8Array>>();
  private static UKURAN_BLOK = 64 * 1024;

  constructor(private readonly baca: BacaBita) {}

  setUkuran(o: number, l: number) {
    if (![4, 8].includes(o) || ![4, 8].includes(l))
      throw new Hdf5Error(`Ukuran alamat HDF5 tidak didukung (${o}/${l}).`);
    this.O = o;
    this.L = l;
  }
  get ukuranAlamat() {
    return this.O;
  }
  get ukuranPanjang() {
    return this.L;
  }

  /** Metadata dibaca per blok 64 KB yang disimpan – kepala berkas saling berdekatan. */
  async meta(offset: number, panjang: number): Promise<DataView> {
    const B = Pembaca.UKURAN_BLOK;
    const awal = Math.floor(offset / B);
    const akhir = Math.floor((offset + panjang - 1) / B);
    const out = new Uint8Array(panjang);
    for (let b = awal; b <= akhir; b++) {
      let p = this.blok.get(b);
      if (!p) {
        p = this.baca(b * B, B);
        this.blok.set(b, p);
      }
      const isi = await p;
      const dari = Math.max(offset, b * B);
      const sampai = Math.min(offset + panjang, b * B + isi.length);
      if (sampai <= dari)
        throw new Hdf5Error(
          "Berkas HDF5 terpotong: metadata melewati ujung berkas.",
        );
      out.set(isi.subarray(dari - b * B, sampai - b * B), dari - offset);
    }
    return new DataView(out.buffer);
  }

  /** Data potongan dibaca langsung, tidak lewat cache blok. */
  async mentah(offset: number, panjang: number): Promise<Uint8Array> {
    const isi = await this.baca(offset, panjang);
    if (isi.length < panjang)
      throw new Hdf5Error(
        "Berkas HDF5 terpotong: potongan data tidak lengkap.",
      );
    return isi.subarray(0, panjang);
  }

  uint(v: DataView, at: number, n: number): number {
    switch (n) {
      case 1:
        return v.getUint8(at);
      case 2:
        return v.getUint16(at, true);
      case 4:
        return v.getUint32(at, true);
      case 8: {
        const lo = v.getUint32(at, true);
        const hi = v.getUint32(at + 4, true);
        if (hi === 0xffffffff && lo === 0xffffffff) return UNDEF;
        return hi * 2 ** 32 + lo;
      }
      default:
        throw new Hdf5Error(`Lebar bilangan ${n} tidak didukung.`);
    }
  }
  alamat(v: DataView, at: number) {
    return this.uint(v, at, this.O);
  }
  panjangL(v: DataView, at: number) {
    return this.uint(v, at, this.L);
  }
}

function cocokTanda(v: DataView, at: number, teks: string): boolean {
  for (let i = 0; i < teks.length; i++)
    if (v.getUint8(at + i) !== teks.charCodeAt(i)) return false;
  return true;
}

export type Hdf5Jarak = {
  daftar(): Promise<string[]>;
  info(nama: string): Promise<InfoDataset>;
  /** Baca jendela [baris0, baris0+tinggi) × [kolom0, kolom0+lebar) sebagai angka. */
  jendela(
    nama: string,
    baris0: number,
    kolom0: number,
    tinggi: number,
    lebar: number,
  ): Promise<number[][]>;
};

/** Buka berkas HDF5 lewat fungsi pembaca bita. Hanya membaca kepala berkas. */
export async function bukaHdf5(baca: BacaBita): Promise<Hdf5Jarak> {
  const r = new Pembaca(baca);
  const sb = await r.meta(0, 96);
  for (let i = 0; i < 8; i++) {
    if (sb.getUint8(i) !== TANDA[i])
      throw new Hdf5Error(
        "Bukan berkas HDF5 (tanda tangan berkas tidak cocok).",
      );
  }
  const versi = sb.getUint8(8);
  if (versi !== 0 && versi !== 1)
    throw new Hdf5Error(`Superblock HDF5 versi ${versi} belum didukung.`);
  r.setUkuran(sb.getUint8(13), sb.getUint8(14));
  const O = r.ukuranAlamat;
  // Versi 1 menambah 4 bita (indexed storage K + cadangan) sebelum base address.
  let p = 24 + (versi === 1 ? 4 : 0);
  p += O * 4; // base, free-space, end-of-file, driver info
  // Entri tabel simbol grup akar: name offset, object header, cache type, cadangan, scratch.
  const akarHeader = r.alamat(sb, p + O);
  const cacheType = sb.getUint32(p + 2 * O, true);
  const isiGrupAkar = async (): Promise<Map<string, number>> => {
    if (cacheType === 1) {
      return bacaGrup(
        r,
        r.alamat(sb, p + 2 * O + 8),
        r.alamat(sb, p + 2 * O + 8 + O),
      );
    }
    // Grup gaya baru (object header versi 2): tautan disimpan sebagai pesan
    // Link – langsung di header (ringkas) atau di fractal heap (padat). Berkas
    // NOAA memakai yang padat.
    const pesan = await bacaPesan(r, akarHeader);
    const st = pesan.find((m) => m.tipe === 0x11);
    if (st) return bacaGrup(r, r.alamat(st.data, 0), r.alamat(st.data, O));
    const out = new Map<string, number>();
    for (const m of pesan) if (m.tipe === 0x06) tambahTautan(r, m.data, 0, out);
    const li = pesan.find((m) => m.tipe === 0x02);
    if (li) {
      const heap = r.alamat(li.data, 2 + (li.data.getUint8(1) & 1 ? 8 : 0));
      if (heap !== UNDEF) await bacaTautanPadat(r, heap, out);
    }
    if (out.size === 0)
      throw new Hdf5Error(
        "Grup akar HDF5 kosong atau memakai susunan yang belum didukung.",
      );
    return out;
  };

  let isiAkar: Promise<Map<string, number>> | null = null;
  const anak = () => (isiAkar ??= isiGrupAkar());
  const cacheInfo = new Map<string, Promise<InfoDataset>>();

  const info = (nama: string) => {
    let pr = cacheInfo.get(nama);
    if (!pr) {
      pr = (async () => {
        const alamat = (await anak()).get(nama);
        if (alamat == null)
          throw new Hdf5Error(`Dataset "${nama}" tidak ada di berkas.`);
        return infoDataset(r, nama, alamat);
      })();
      cacheInfo.set(nama, pr);
    }
    return pr;
  };

  return {
    daftar: async () => [...(await anak()).keys()],
    info,
    async jendela(nama, baris0, kolom0, tinggi, lebar) {
      const ds = await info(nama);
      if (ds.bentuk.length !== 2)
        throw new Hdf5Error(`Dataset "${nama}" bukan dua dimensi.`);
      const [nb, nk] = ds.bentuk;
      const [pb, pk] = ds.potongan;
      if (
        baris0 < 0 ||
        kolom0 < 0 ||
        baris0 + tinggi > nb ||
        kolom0 + lebar > nk
      ) {
        throw new Hdf5Error(
          `Jendela di luar batas dataset "${nama}" (${nb}×${nk}).`,
        );
      }
      const hasil = Array.from({ length: tinggi }, () =>
        new Array<number>(lebar).fill(Number.NaN),
      );
      const potonganDibaca = new Map<string, Promise<number[] | null>>();
      for (let i = 0; i < tinggi; i++) {
        for (let j = 0; j < lebar; j++) {
          const b = baris0 + i;
          const k = kolom0 + j;
          const ob = Math.floor(b / pb) * pb;
          const ok = Math.floor(k / pk) * pk;
          const kunci = `${ob},${ok}`;
          let pr = potonganDibaca.get(kunci);
          if (!pr) {
            pr = bacaPotongan(r, ds, [ob, ok]);
            potonganDibaca.set(kunci, pr);
          }
          const nilai = await pr;
          // Potongan yang tidak pernah ditulis = nilai isi (fill), dianggap kosong.
          hasil[i][j] = nilai ? nilai[(b - ob) * pk + (k - ok)] : Number.NaN;
        }
      }
      return hasil;
    },
  };
}

type Pesan = { tipe: number; data: DataView };

/** Semua pesan object header (versi 1 atau 2), termasuk blok sambungan (continuation). */
async function bacaPesan(r: Pembaca, alamat: number): Promise<Pesan[]> {
  const kepala = await r.meta(alamat, 16);
  if (cocokTanda(kepala, 0, "OHDR")) return bacaPesanV2(r, alamat);
  const versi = kepala.getUint8(0);
  if (versi !== 1)
    throw new Hdf5Error(`Object header HDF5 versi ${versi} belum didukung.`);
  const jumlah = kepala.getUint16(2, true);
  const ukuran = kepala.getUint32(8, true);
  const blok: { awal: number; panjang: number }[] = [
    { awal: alamat + 16, panjang: ukuran },
  ];
  const out: Pesan[] = [];
  while (blok.length > 0 && out.length < jumlah) {
    const { awal, panjang } = blok.shift()!;
    const v = await r.meta(awal, panjang);
    let p = 0;
    while (p + 8 <= panjang && out.length < jumlah) {
      const tipe = v.getUint16(p, true);
      const besar = v.getUint16(p + 2, true);
      const data = new DataView(v.buffer, v.byteOffset + p + 8, besar);
      if (tipe === 0x10) {
        blok.push({
          awal: r.alamat(data, 0),
          panjang: r.panjangL(data, r.ukuranAlamat),
        });
      }
      out.push({ tipe, data });
      p += 8 + besar;
    }
  }
  return out;
}

/** Object header versi 2 ("OHDR") dan blok sambungannya ("OCHK"). */
async function bacaPesanV2(r: Pembaca, alamat: number): Promise<Pesan[]> {
  const awal = await r.meta(alamat, 32);
  const flags = awal.getUint8(5);
  let p = 6 + (flags & 0x20 ? 16 : 0) + (flags & 0x10 ? 4 : 0);
  const lebarUkuran = [1, 2, 4, 8][flags & 3];
  const ukuran0 = r.uint(awal, p, lebarUkuran);
  p += lebarUkuran;
  const lebarKepalaPesan = flags & 0x04 ? 6 : 4;
  const out: Pesan[] = [];
  const blok: { awal: number; panjang: number }[] = [
    { awal: alamat + p, panjang: ukuran0 },
  ];
  while (blok.length > 0) {
    const b = blok.shift()!;
    const v = await r.meta(b.awal, b.panjang);
    let q = 0;
    while (q + lebarKepalaPesan <= b.panjang) {
      const tipe = v.getUint8(q);
      const besar = v.getUint16(q + 1, true);
      if (q + lebarKepalaPesan + besar > b.panjang) break; // celah di ujung blok
      const data = new DataView(
        v.buffer,
        v.byteOffset + q + lebarKepalaPesan,
        besar,
      );
      if (tipe === 0x10) {
        // Panjang blok sambungan mencakup tanda "OCHK" (4) dan checksum (4).
        const alamatLanjut = r.alamat(data, 0);
        const panjangLanjut = r.panjangL(data, r.ukuranAlamat);
        blok.push({ awal: alamatLanjut + 4, panjang: panjangLanjut - 8 });
      }
      out.push({ tipe, data });
      q += lebarKepalaPesan + besar;
    }
  }
  return out;
}

/**
 * Urai SATU pesan Link mulai `at`, simpan tautan keras (hard link) ke `out`,
 * kembalikan panjang pesannya – supaya tautan padat bisa dibaca berurutan.
 */
function tambahTautan(
  r: Pembaca,
  v: DataView,
  at: number,
  out: Map<string, number>,
): number {
  const mulai = at;
  if (v.getUint8(at) !== 1)
    throw new Hdf5Error("Pesan Link HDF5 versi tidak dikenal.");
  const flags = v.getUint8(at + 1);
  at += 2;
  let jenis = 0;
  if (flags & 0x08) jenis = v.getUint8(at++);
  if (flags & 0x04) at += 8;
  if (flags & 0x10) at += 1;
  const lebar = [1, 2, 4, 8][flags & 3];
  const panjangNama = r.uint(v, at, lebar);
  at += lebar;
  let nama = "";
  for (let i = 0; i < panjangNama; i++)
    nama += String.fromCharCode(v.getUint8(at + i));
  at += panjangNama;
  if (jenis === 0) {
    out.set(nama, r.alamat(v, at));
    at += r.ukuranAlamat;
  } else {
    at += 2 + v.getUint16(at, true); // tautan lunak/eksternal – dilewati
  }
  return at - mulai;
}

/**
 * Tautan PADAT: pesan Link disimpan sebagai objek di fractal heap. Berkas
 * produk ditulis sekali dan tidak pernah dihapus isinya, jadi objek di tiap
 * blok langsung (direct block) tersusun rapat dari awal blok; sisa blok berisi
 * nol. Blok dibaca berurutan sampai bertemu bita bukan-pesan.
 */
async function bacaTautanPadat(
  r: Pembaca,
  alamatHeap: number,
  out: Map<string, number>,
): Promise<void> {
  const O = r.ukuranAlamat;
  const L = r.ukuranPanjang;
  const h = await r.meta(alamatHeap, 160);
  if (!cocokTanda(h, 0, "FRHP"))
    throw new Hdf5Error("Fractal heap HDF5 rusak.");
  if (h.getUint16(7, true) !== 0)
    throw new Hdf5Error("Fractal heap bertapis belum didukung.");
  const flags = h.getUint8(9);
  // Lewati: maks objek (4), next huge id (L), btree huge (O), free space (L),
  // free-space manager (O), managed space (L), allocated (L), iterator (L),
  // jumlah objek (L), huge size (L), huge count (L), tiny size (L), tiny count (L).
  let p = 10 + 4 + L + O + L + O + L * 8;
  const lebarTabel = h.getUint16(p, true);
  p += 2;
  const blokAwal = r.panjangL(h, p);
  const blokLangsungMaks = r.panjangL(h, p + L);
  const bitHeapMaks = h.getUint16(p + 2 * L, true);
  const akar = r.alamat(h, p + 2 * L + 4);
  const barisAkar = h.getUint16(p + 2 * L + 4 + O, true);
  const lebarOffsetBlok = Math.ceil(bitHeapMaks / 8);
  const kepalaBlok = 5 + O + lebarOffsetBlok + (flags & 0x02 ? 4 : 0);

  const blokLangsung: { alamat: number; ukuran: number }[] = [];
  if (barisAkar === 0) {
    blokLangsung.push({ alamat: akar, ukuran: blokAwal });
  } else {
    const ib = await r.meta(akar, 5 + O + lebarOffsetBlok);
    if (!cocokTanda(ib, 0, "FHIB"))
      throw new Hdf5Error("Blok tak langsung fractal heap rusak.");
    let q = 5 + O + lebarOffsetBlok;
    for (let baris = 0; baris < barisAkar; baris++) {
      const ukuran = blokAwal * 2 ** Math.max(0, baris - 1);
      if (ukuran > blokLangsungMaks)
        throw new Hdf5Error("Fractal heap bertingkat belum didukung.");
      const isi = await r.meta(akar + q, lebarTabel * O);
      for (let k = 0; k < lebarTabel; k++) {
        const a = r.alamat(isi, k * O);
        if (a !== UNDEF && a !== 0) blokLangsung.push({ alamat: a, ukuran });
      }
      q += lebarTabel * O;
    }
  }

  for (const b of blokLangsung) {
    const v = await r.meta(b.alamat, b.ukuran);
    if (!cocokTanda(v, 0, "FHDB"))
      throw new Hdf5Error("Blok langsung fractal heap rusak.");
    let q = kepalaBlok;
    while (q < b.ukuran - 4 && v.getUint8(q) === 1) {
      q += tambahTautan(r, v, q, out);
    }
  }
}

/** Peta nama → alamat object header, dari B-tree grup + heap lokal. */
async function bacaGrup(
  r: Pembaca,
  btree: number,
  heap: number,
): Promise<Map<string, number>> {
  const O = r.ukuranAlamat;
  const L = r.ukuranPanjang;
  const h = await r.meta(heap, 8 + 2 * L + O);
  if (!cocokTanda(h, 0, "HEAP"))
    throw new Hdf5Error("Heap lokal grup HDF5 rusak.");
  const ukuranData = r.panjangL(h, 8);
  const alamatData = r.alamat(h, 8 + 2 * L);
  const nama = await r.meta(alamatData, ukuranData);
  const teks = (off: number) => {
    let s = "";
    for (let i = off; i < ukuranData && nama.getUint8(i) !== 0; i++)
      s += String.fromCharCode(nama.getUint8(i));
    return s;
  };

  const out = new Map<string, number>();
  const jelajah = async (node: number): Promise<void> => {
    const kepala = await r.meta(node, 8 + 2 * O);
    if (!cocokTanda(kepala, 0, "TREE") || kepala.getUint8(4) !== 0)
      throw new Hdf5Error("B-tree grup HDF5 rusak.");
    const level = kepala.getUint8(5);
    const n = kepala.getUint16(6, true);
    const isi = await r.meta(node + 8 + 2 * O, L + n * (O + L));
    for (let i = 0; i < n; i++) {
      const anak = r.alamat(isi, L + i * (O + L));
      if (level > 0) {
        await jelajah(anak);
        continue;
      }
      const snod = await r.meta(anak, 8);
      if (!cocokTanda(snod, 0, "SNOD"))
        throw new Hdf5Error("Node tabel simbol HDF5 rusak.");
      const jml = snod.getUint16(6, true);
      const lebarEntri = 2 * O + 24;
      const e = await r.meta(anak + 8, jml * lebarEntri);
      for (let k = 0; k < jml; k++) {
        out.set(
          teks(r.alamat(e, k * lebarEntri)),
          r.alamat(e, k * lebarEntri + O),
        );
      }
    }
  };
  await jelajah(btree);
  return out;
}

async function infoDataset(
  r: Pembaca,
  nama: string,
  alamat: number,
): Promise<InfoDataset> {
  const O = r.ukuranAlamat;
  const L = r.ukuranPanjang;
  const pesan = await bacaPesan(r, alamat);
  const ambil = (t: number) => pesan.find((m) => m.tipe === t)?.data;

  const ruang = ambil(0x01);
  if (!ruang) throw new Hdf5Error(`Dataset "${nama}" tanpa dataspace.`);
  const vRuang = ruang.getUint8(0);
  const dimensi = ruang.getUint8(1);
  const awalDim = vRuang === 1 ? 8 : 4;
  const bentuk = Array.from({ length: dimensi }, (_, i) =>
    r.panjangL(ruang, awalDim + i * L),
  );

  const dt = ambil(0x03);
  if (!dt) throw new Hdf5Error(`Dataset "${nama}" tanpa tipe data.`);
  const kelas = dt.getUint8(0) & 0x0f;
  const bit0 = dt.getUint8(1);
  const ukuran = dt.getUint32(4, true);
  if (kelas !== 0 && kelas !== 1)
    throw new Hdf5Error(
      `Tipe data kelas ${kelas} di "${nama}" belum didukung.`,
    );
  const tipe: Tipe = {
    kelas: kelas === 0 ? "int" : "float",
    ukuran,
    bigEndian: (bit0 & 1) === 1,
    bertanda: kelas === 0 ? (bit0 & 0x08) !== 0 : true,
  };
  if (tipe.kelas === "float" && ukuran !== 4 && ukuran !== 8)
    throw new Hdf5Error(`Float ${ukuran} bita belum didukung.`);

  const lay = ambil(0x08);
  if (!lay) throw new Hdf5Error(`Dataset "${nama}" tanpa layout.`);
  const vLay = lay.getUint8(0);
  if (vLay !== 3)
    throw new Hdf5Error(`Layout HDF5 versi ${vLay} belum didukung.`);
  if (lay.getUint8(1) !== 2)
    throw new Hdf5Error(
      `Dataset "${nama}" tidak dipotong-potong (chunked); belum didukung.`,
    );
  const dimLay = lay.getUint8(2);
  const alamatBtree = r.alamat(lay, 3);
  const potongan = Array.from({ length: dimLay - 1 }, (_, i) =>
    lay.getUint32(3 + O + i * 4, true),
  );

  const filter: Filter[] = [];
  const fp = ambil(0x0b);
  if (fp) {
    const vF = fp.getUint8(0);
    const n = fp.getUint8(1);
    let p = vF === 1 ? 8 : 2;
    for (let i = 0; i < n; i++) {
      const id = fp.getUint16(p, true);
      let panjangNama = 0;
      p += 2;
      if (vF === 1 || id >= 256) {
        panjangNama = fp.getUint16(p, true);
        p += 2;
      }
      const flags = fp.getUint16(p, true);
      const ncd = fp.getUint16(p + 2, true);
      p += 4;
      p += vF === 1 ? Math.ceil(panjangNama / 8) * 8 : panjangNama;
      const data = Array.from({ length: ncd }, (_, k) =>
        fp.getUint32(p + k * 4, true),
      );
      p += ncd * 4 + (vF === 1 && ncd % 2 === 1 ? 4 : 0);
      if (id !== 1 && id !== 2)
        throw new Hdf5Error(
          `Filter HDF5 nomor ${id} di "${nama}" belum didukung.`,
        );
      filter.push({ id, flags, data });
    }
  }
  return { nama, bentuk, potongan, tipe, filter, alamatBtree };
}

/** Cari potongan berawalan `awal` lewat B-tree potongan, lalu urai isinya. */
async function bacaPotongan(
  r: Pembaca,
  ds: InfoDataset,
  awal: number[],
): Promise<number[] | null> {
  const O = r.ukuranAlamat;
  const dim = ds.potongan.length + 1; // + dimensi ukuran elemen
  const lebarKunci = 8 + 8 * dim;
  const banding = (v: DataView, at: number): number => {
    for (let d = 0; d < ds.potongan.length; d++) {
      const x = r.uint(v, at + 8 + d * 8, 8);
      if (x !== awal[d]) return x < awal[d] ? -1 : 1;
    }
    return 0;
  };

  let node = ds.alamatBtree;
  if (node === UNDEF) return null;
  for (let langkah = 0; langkah < 64; langkah++) {
    const kepala = await r.meta(node, 8 + 2 * O);
    if (!cocokTanda(kepala, 0, "TREE") || kepala.getUint8(4) !== 1)
      throw new Hdf5Error("B-tree potongan HDF5 rusak.");
    const level = kepala.getUint8(5);
    const n = kepala.getUint16(6, true);
    const isi = await r.meta(
      node + 8 + 2 * O,
      n * (lebarKunci + O) + lebarKunci,
    );
    // Anak ke-i memuat potongan dengan kunci_i ≤ x < kunci_{i+1}.
    let pilih = -1;
    for (let i = 0; i < n; i++) {
      if (banding(isi, i * (lebarKunci + O)) <= 0) pilih = i;
      else break;
    }
    if (pilih < 0) return null;
    const at = pilih * (lebarKunci + O);
    const anak = r.alamat(isi, at + lebarKunci);
    if (level > 0) {
      node = anak;
      continue;
    }
    if (banding(isi, at) !== 0) return null;
    const ukuran = isi.getUint32(at, true);
    const maskFilter = isi.getUint32(at + 4, true);
    let bita = await r.mentah(anak, ukuran);
    for (let i = ds.filter.length - 1; i >= 0; i--) {
      if (maskFilter & (1 << i)) continue;
      const f = ds.filter[i];
      if (f.id === 1) bita = new Uint8Array(inflateSync(bita));
      else if (f.id === 2) bita = unshuffle(bita, ds.tipe.ukuran);
    }
    return urai(bita, ds);
  }
  throw new Hdf5Error("B-tree potongan HDF5 terlalu dalam.");
}

function unshuffle(b: Uint8Array, e: number): Uint8Array {
  if (e <= 1) return b;
  const n = Math.floor(b.length / e);
  const out = new Uint8Array(b.length);
  for (let j = 0; j < e; j++)
    for (let i = 0; i < n; i++) out[i * e + j] = b[j * n + i];
  out.set(b.subarray(n * e), n * e);
  return out;
}

function urai(b: Uint8Array, ds: InfoDataset): number[] {
  const { tipe } = ds;
  const n = ds.potongan.reduce((a, x) => a * x, 1);
  if (b.length < n * tipe.ukuran)
    throw new Hdf5Error(`Potongan "${ds.nama}" lebih pendek dari seharusnya.`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = !tipe.bigEndian;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const at = i * tipe.ukuran;
    if (tipe.kelas === "float")
      out[i] = tipe.ukuran === 4 ? v.getFloat32(at, le) : v.getFloat64(at, le);
    else if (tipe.ukuran === 1)
      out[i] = tipe.bertanda ? v.getInt8(at) : v.getUint8(at);
    else if (tipe.ukuran === 2)
      out[i] = tipe.bertanda ? v.getInt16(at, le) : v.getUint16(at, le);
    else if (tipe.ukuran === 4)
      out[i] = tipe.bertanda ? v.getInt32(at, le) : v.getUint32(at, le);
    else
      throw new Hdf5Error(`Bilangan bulat ${tipe.ukuran} bita belum didukung.`);
  }
  return out;
}
