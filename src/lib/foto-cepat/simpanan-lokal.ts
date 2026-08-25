import { MAKS_ANTREAN, type StatusAntrean } from "./antrean-kebijakan";

/**
 * SIMPANAN FOTO DI PERANGKAT — IndexedDB (DECISIONS 257; dirombak 286).
 *
 * Tiap jepretan ditulis KE SINI LEBIH DULU, sebelum satu byte pun dikirim.
 * Urutannya bukan detail teknis: selama foto hanya ada di memori, menutup tab,
 * kehabisan baterai, atau peramban membunuh halaman di latar belakang berarti
 * bukti lapangan hilang tanpa jejak.
 *
 * ### Kenapa BYTE, bukan Blob (DECISIONS 286)
 *
 * Versi sebelumnya menyimpan objek `Blob`/`File` apa adanya. Itu sah menurut
 * spesifikasi, tapi di lapangan gagal — dan perangkat user sendiri yang
 * menuliskan sebabnya:
 *
 *     UnknownError: Error preparing Blob/File data to be stored in object store
 *
 * Blob di IndexedDB disokong berkas terpisah di dalam peramban, dan sokongan itu
 * bisa lepas. Sekali lepas, blob-nya tidak bisa ditulis ulang, tidak bisa
 * dibaca, bahkan tidak bisa ditampilkan — di peramban kedua, pratinjaunya
 * muncul sebagai ikon gambar rusak. Karena itu yang disimpan sekarang adalah
 * **`ArrayBuffer`**: data biasa, ikut aturan structured clone, tanpa berkas
 * sokongan yang bisa lepas.
 *
 * ### Kenapa DUA toko
 *
 * `antrean` menyimpan keterangannya saja (status, percobaan, koordinat, waktu);
 * `berkas` menyimpan bytenya. Pemisahan ini yang membuat perubahan status TIDAK
 * pernah menulis ulang isi fotonya. Versi lama menulis ulang seluruh baris —
 * berikut fotonya yang ratusan KB — hanya untuk mengubah satu kolom status,
 * dan justru penulisan ulang itulah yang gagal.
 *
 * Itu juga menjelaskan petunjuk user *"terjadi saat ambil foto dengan cepat"*:
 * foto yang langsung terkirim ditulis sekali lalu dibuang, sedangkan foto yang
 * menumpuk di antrean ditulis ulang berkali-kali.
 *
 * ### Yang TIDAK dijanjikan
 *
 * Simpanan ini melekat pada PERANGKAT + peramban itu. HP hilang, rusak, atau
 * "hapus data situs" berarti antreannya ikut hilang.
 */

const DB = "marlin-foto-cepat";
const TOKO = "antrean";
const TOKO_BERKAS = "berkas";
const VERSI = 2;

/** Keterangan satu jepretan — TANPA isi fotonya. */
export type FotoTertunda = {
  id: string;
  /** Koordinat saat rana ditekan; null = tidak diketahui (jangan ditebak). */
  lat: number | null;
  lng: number | null;
  /** ISO waktu jepret — dari jam perangkat pada detik rana ditekan. */
  takenAt: string;
  percobaan: number;
  terakhirCoba: number;
  status: StatusAntrean;
  pesan?: string;
  dibuat: number;
  /** Ukuran byte fotonya — supaya UI tak perlu memuat isinya hanya untuk ini. */
  ukuran: number;
  tipe: string;
};

const BATAS_OPERASI_MS = 10_000;

/**
 * Galat simpanan yang PANTAS DIBACA orang — DAN menyebutkan nama aslinya.
 *
 * Versi sebelumnya menutup nama galat IndexedDB-nya lalu menambahkan tebakan
 * *"Ruang penyimpanan HP mungkin penuh."*. Tebakan itu salah, dan user
 * membantahnya dalam satu kalimat: kalau memang penuh, foto baru pun tidak akan
 * bisa tersimpan. Pesan yang mengarang sebab lebih buruk daripada pesan yang
 * hanya menyebut fakta — ia mengirim orang ke arah yang salah.
 *
 * Nama galat inilah yang akhirnya menyelesaikan perkara ini: begitu layar
 * menuliskan `UnknownError: Error preparing Blob/File data…`, sebabnya berhenti
 * jadi tebakan.
 */
export class SimpananGagal extends Error {
  constructor(
    readonly tahap: "buka" | "transaksi" | "permintaan" | "batas waktu",
    sebab?: unknown,
  ) {
    super(
      tahap === "batas waktu"
        ? "Simpanan foto di HP tidak menjawab dalam 10 detik."
        : `Simpanan foto di HP gagal – tahap: ${tahap}; galat: ${namaGalat(sebab)}`,
    );
  }
}

/** Nama + pesan galat apa adanya. Tidak ditafsirkan, tidak ditebak. */
function namaGalat(sebab: unknown): string {
  if (sebab instanceof DOMException) return `${sebab.name}: ${sebab.message || "(tanpa pesan)"}`;
  if (sebab instanceof Error) return `${sebab.name}: ${sebab.message}`;
  return "tidak disebutkan peramban";
}

function berbatas<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((selesai, gagal) => {
    const t = setTimeout(() => gagal(new SimpananGagal("batas waktu")), BATAS_OPERASI_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        selesai(v);
      },
      (e) => {
        clearTimeout(t);
        gagal(e);
      },
    );
  });
}

/**
 * SATU koneksi untuk seumur halaman — tidak dibuka-tutup tiap operasi.
 *
 * `onclose`/`onversionchange` melupakan pegangannya supaya operasi berikutnya
 * membuka koneksi baru, bukan memakai pegangan mati selamanya.
 */
let koneksi: Promise<IDBDatabase> | null = null;

function buka(): Promise<IDBDatabase> {
  if (koneksi) return koneksi;
  koneksi = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSI);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TOKO)) db.createObjectStore(TOKO, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TOKO_BERKAS))
        db.createObjectStore(TOKO_BERKAS, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        koneksi = null;
      };
      db.onversionchange = () => {
        db.close();
        koneksi = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      koneksi = null;
      reject(new SimpananGagal("buka", req.error));
    };
    req.onblocked = () => {
      koneksi = null;
      reject(new SimpananGagal("buka", new DOMException("dipakai tab lain", "BlockedError")));
    };
  });
  return koneksi;
}

/**
 * Jalankan satu transaksi pada satu atau beberapa toko.
 *
 * Tiga jalur kegagalan dipasang semuanya dan masing-masing menyebut namanya:
 * permintaan (`req.onerror`), transaksi (`tx.onerror`), penggugurannya
 * (`tx.onabort`). Satu putaran perbaikan sempat membuang `req.onerror` —
 * sehingga nama DOMException yang SEBENARNYA hilang dan layar cuma menulis
 * "transaksi". Itu membuat tangkapan layar dari lapangan tidak bisa dipakai,
 * padahal cuma itu alat yang ada.
 */
function jalankan<T>(
  toko: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction, selesai: (v: T) => void, gagal: (e: unknown) => void) => void,
): Promise<T> {
  return berbatas(
    buka().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          let hasil: T;
          let dapat = false;
          let sudahGagal = false;
          const gagal = (e: unknown) => {
            if (sudahGagal) return;
            sudahGagal = true;
            reject(e instanceof SimpananGagal ? e : new SimpananGagal("permintaan", e));
          };

          let tx: IDBTransaction;
          try {
            tx = db.transaction(toko, mode);
          } catch (e) {
            koneksi = null; // koneksinya sudah tertutup — buka lagi lain kali
            gagal(e);
            return;
          }

          fn(
            tx,
            (v) => {
              hasil = v;
              dapat = true;
            },
            gagal,
          );

          tx.oncomplete = () => {
            if (sudahGagal) return;
            if (dapat) resolve(hasil);
            else gagal(new DOMException("transaksi tuntas tanpa hasil", "NoResultError"));
          };
          tx.onerror = () => gagal(new SimpananGagal("transaksi", tx.error));
          tx.onabort = () => gagal(new SimpananGagal("transaksi", tx.error));
        }),
    ),
  );
}

/** Bungkus satu permintaan tunggal — pola yang paling sering dipakai. */
function satu<T>(
  toko: string,
  mode: IDBTransactionMode,
  buatReq: (t: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return jalankan<T>(toko, mode, (tx, selesai, gagal) => {
    const req = buatReq(tx.objectStore(toko));
    req.onsuccess = () => selesai(req.result);
    req.onerror = () => gagal(req.error);
  });
}

/** Apakah perangkat/peramban ini mendukung simpanan lokal sama sekali. */
export function simpananTersedia(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Ditulis, TAPI tidak terbaca kembali. Bukan "mungkin gagal" — sudah pasti.
 *
 * Dilempar oleh `simpan()` sesudah pemeriksaan baca-ulang. Bedanya dengan galat
 * lain: ini terjadi SAAT rana ditekan, selagi orangnya masih berdiri di titik
 * yang benar dan masih bisa memotret ulang. Kegagalan yang sama kalau baru
 * ketahuan sejam kemudian berarti bukti lapangannya hilang untuk selamanya.
 */
export class SimpananTakTerbaca extends Error {
  constructor() {
    super(
      "Foto tersimpan tapi TIDAK bisa dibaca kembali dari HP ini – jangan diandalkan. Potret ulang sekarang selagi masih di lokasi.",
    );
  }
}

export class SimpananPenuh extends Error {
  constructor() {
    super(
      `Antrean sudah ${MAKS_ANTREAN} foto dan belum terkirim. Cari sinyal dulu supaya antreannya terkirim, baru lanjut memotret.`,
    );
  }
}

/**
 * Simpan satu jepretan: byte ke toko `berkas`, keterangannya ke toko `antrean`
 * — dalam SATU transaksi, supaya tidak pernah ada keterangan tanpa berkas
 * maupun sebaliknya.
 */
export async function simpan(
  item: Omit<FotoTertunda, "dibuat" | "ukuran" | "tipe">,
  berkas: Blob,
): Promise<void> {
  const jumlah = await satu<number>(TOKO, "readonly", (t) => t.count());
  if (jumlah >= MAKS_ANTREAN) throw new SimpananPenuh();

  // `ArrayBuffer`, bukan Blob — lihat catatan kepala berkas ini.
  const buf = await berkas.arrayBuffer();
  await jalankan<void>([TOKO, TOKO_BERKAS], "readwrite", (tx, selesai, gagal) => {
    const a = tx.objectStore(TOKO_BERKAS).put({ id: item.id, buf });
    a.onerror = () => gagal(a.error);
    const b = tx.objectStore(TOKO).put({
      ...item,
      dibuat: Date.now(),
      ukuran: buf.byteLength,
      tipe: berkas.type || "image/jpeg",
    });
    b.onerror = () => gagal(b.error);
    b.onsuccess = () => selesai(undefined);
  });

  /*
   * BACA ULANG SEKARANG JUGA.
   *
   * Pertanyaan user 2026-08-07: *"berarti saat ambil foto cepat hal ini rentan
   * terjadi. bagaimana mengatasinya?"* — dan inilah lapis yang paling menjawab.
   *
   * Penulisan yang "sukses" ternyata tidak menjamin datanya bisa dibaca lagi;
   * itu pelajaran dari perkara ini. Yang bisa dijamin cuma satu: membacanya
   * KEMBALI. Kalau gagal, orangnya tahu SEKARANG — selagi masih berdiri di
   * titik yang benar, kamera masih di tangan, dan memotret ulang cuma perlu
   * dua detik. Ketahuan sejam kemudian berarti buktinya hilang.
   */
  const kembali = await ambilBerkas(item.id, berkas.type || "image/jpeg");
  if (!kembali || kembali.size !== buf.byteLength) {
    await buang(item.id).catch(() => {});
    throw new SimpananTakTerbaca();
  }
}

/**
 * Minta peramban TIDAK membuang simpanan ini saat ruang menipis.
 *
 * Tanpa izin ini, IndexedDB tergolong "best effort": peramban boleh
 * membersihkannya kapan saja tanpa memberi tahu siapa pun — dan yang dibersihkan
 * di sini adalah bukti lapangan yang belum sempat terkirim. Ditolak pun tidak
 * apa-apa; ini permintaan, bukan syarat.
 */
export async function mintaSimpananTetap(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Kuota & pemakaian penyimpanan — supaya "penuh" jadi ANGKA, bukan tebakan. */
export async function kuotaSimpanan(): Promise<{ pakai: number; kuota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { pakai: e.usage ?? 0, kuota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Keterangan semua antrean — RINGAN, tidak menyeret isi fotonya. */
export async function semua(): Promise<FotoTertunda[]> {
  const rows = await satu<FotoTertunda[]>(TOKO, "readonly", (t) => t.getAll());
  return rows.sort((a, b) => a.dibuat - b.dibuat);
}

/**
 * Ambil isi foto sebagai Blob. `null` = datanya tidak ada / tidak terbaca.
 *
 * Pemanggil WAJIB menangani `null`, bukan menganggapnya mustahil: inilah
 * keadaan yang menimpa antrean user — bytenya lenyap dari peramban sementara
 * keterangannya masih ada.
 */
export async function ambilBerkas(id: string, tipe = "image/jpeg"): Promise<Blob | null> {
  const row = await satu<{ id: string; buf: ArrayBuffer } | undefined>(
    TOKO_BERKAS,
    "readonly",
    (t) => t.get(id),
  );
  if (!row?.buf || row.buf.byteLength === 0) return null;
  return new Blob([row.buf], { type: tipe });
}

/**
 * Perbarui KETERANGAN satu baris — baca-lalu-tulis dalam SATU transaksi, dan
 * TIDAK PERNAH menyentuh isi fotonya.
 *
 * Dua cacat sekaligus yang ditutup di sini. Pertama, dulu ini dua transaksi
 * terpisah (`getAll` lalu `put`) dengan celah di antaranya: saat memotret cepat,
 * dua pembaruan bisa saling menimpa. Kedua — dan ini yang mematikan — barisnya
 * dulu memuat blob, jadi tiap perubahan status menulis ulang seluruh foto. Itu
 * penulisan ulang yang gagal dengan `Error preparing Blob/File data`.
 */
export async function perbarui(id: string, patch: Partial<FotoTertunda>): Promise<void> {
  await jalankan<void>(TOKO, "readwrite", (tx, selesai, gagal) => {
    const toko = tx.objectStore(TOKO);
    const baca = toko.get(id);
    baca.onerror = () => gagal(baca.error);
    baca.onsuccess = () => {
      const lama = baca.result as FotoTertunda | undefined;
      if (!lama) return selesai(undefined);
      const tulis = toko.put({ ...lama, ...patch });
      tulis.onerror = () => gagal(tulis.error);
      tulis.onsuccess = () => selesai(undefined);
    };
  });
}

/** Buang dari simpanan — HANYA setelah server memastikan fotonya tersimpan. */
export async function buang(id: string): Promise<void> {
  await jalankan<void>([TOKO, TOKO_BERKAS], "readwrite", (tx, selesai, gagal) => {
    const a = tx.objectStore(TOKO_BERKAS).delete(id);
    a.onerror = () => gagal(a.error);
    const b = tx.objectStore(TOKO).delete(id);
    b.onerror = () => gagal(b.error);
    b.onsuccess = () => selesai(undefined);
  });
}

/**
 * Pindahkan baris warisan (yang masih menyimpan `Blob`) ke bentuk baru.
 *
 * Dijalankan sekali tiap halaman dibuka, dan sengaja TIDAK di
 * `onupgradeneeded`: mengubah Blob jadi byte itu asinkron, sedangkan transaksi
 * pemutakhiran versi tidak boleh menunggu.
 *
 * Blob yang sudah TIDAK TERBACA tidak bisa diselamatkan — itu kenyataan, bukan
 * kegagalan yang bisa dicoba lagi. Barisnya ditandai `rusak` dengan sebab yang
 * disebutkan, supaya pemiliknya tahu fotonya memang hilang dan bisa
 * membuangnya, bukan menunggu selamanya sesuatu yang tak akan pernah terkirim.
 */
export async function pindahkanWarisan(): Promise<{ pindah: number; rusak: number }> {
  const rows = await satu<(FotoTertunda & { blob?: Blob })[]>(TOKO, "readonly", (t) => t.getAll());
  let pindah = 0;
  let rusak = 0;
  for (const r of rows) {
    if (!r.blob) continue;
    let buf: ArrayBuffer | null = null;
    try {
      const b = await r.blob.arrayBuffer();
      if (b.byteLength > 0) buf = b;
    } catch {
      buf = null;
    }
    if (buf) {
      await jalankan<void>([TOKO, TOKO_BERKAS], "readwrite", (tx, selesai, gagal) => {
        const a = tx.objectStore(TOKO_BERKAS).put({ id: r.id, buf });
        a.onerror = () => gagal(a.error);
        const { blob: _buang, ...tanpaBlob } = r;
        const b = tx.objectStore(TOKO).put({
          ...tanpaBlob,
          ukuran: buf.byteLength,
          tipe: r.tipe || "image/jpeg",
        });
        b.onerror = () => gagal(b.error);
        b.onsuccess = () => selesai(undefined);
      });
      pindah++;
    } else {
      await jalankan<void>(TOKO, "readwrite", (tx, selesai, gagal) => {
        const { blob: _buang, ...tanpaBlob } = r;
        const req = tx.objectStore(TOKO).put({
          ...tanpaBlob,
          status: "rusak" as StatusAntrean,
          pesan:
            "Isi fotonya hilang dari simpanan HP (peramban melepas berkasnya) – tidak bisa dikirim. Buang saja lalu potret ulang.",
          ukuran: 0,
          tipe: r.tipe || "image/jpeg",
        });
        req.onerror = () => gagal(req.error);
        req.onsuccess = () => selesai(undefined);
      });
      rusak++;
    }
  }
  return { pindah, rusak };
}
