import { MAKS_ANTREAN, type StatusAntrean } from "./antrean-kebijakan";

/**
 * SIMPANAN FOTO DI PERANGKAT — IndexedDB (DECISIONS 257).
 *
 * Tiap jepretan ditulis KE SINI LEBIH DULU, sebelum satu byte pun dikirim.
 * Urutannya bukan detail teknis: selama foto hanya ada di memori, menutup tab,
 * kehabisan baterai, atau peramban membunuh halaman di latar belakang berarti
 * bukti lapangan hilang tanpa jejak — dan tidak ada yang akan tahu foto itu
 * pernah ada.
 *
 * IndexedDB, bukan localStorage: localStorage hanya menyimpan string (blob
 * harus di-base64, membengkak ~33%) dan kuotanya ±5 MB — habis oleh lima foto.
 *
 * ### Yang TIDAK dijanjikan
 *
 * Simpanan ini melekat pada PERANGKAT + peramban itu. HP hilang, rusak, atau
 * "hapus data situs" berarti antreannya ikut hilang. Ia melindungi dari sinyal
 * jelek dan halaman tertutup — bukan dari kehilangan perangkat. Karena itu
 * antreannya ditampilkan terang-terangan supaya tidak ada yang menganggapnya
 * sudah aman di server padahal belum.
 */

const DB = "marlin-foto-cepat";
const TOKO = "antrean";
const VERSI = 1;

export type FotoTertunda = {
  id: string;
  blob: Blob;
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
};

/**
 * Batas waktu SATU operasi simpanan.
 *
 * Membaca/menulis IndexedDB semestinya seketika, jadi 10 detik sudah sangat
 * longgar. Batas ini ada karena IndexedDB bisa **berhenti menjawab sama sekali**
 * — tidak melempar galat, tidak memanggil `onerror`, hanya diam. Di iOS itu
 * lazim terjadi sesudah halaman kembali dari latar belakang, dan pada peramban
 * mana pun ia terjadi saat transaksi digugurkan tanpa `onerror` menyala.
 *
 * Tanpa batas ini, satu operasi yang diam membekukan seluruh antrean tanpa satu
 * pun tanda di layar — tiga putaran perbaikan (DECISIONS 282, 283) tidak
 * terlihat hasilnya karena SEMUA jalur kegagalan di sini bisu.
 */
const BATAS_OPERASI_MS = 10_000;

/**
 * Galat simpanan yang PANTAS DIBACA orang — DAN menyebutkan nama aslinya.
 *
 * Versi sebelumnya menutup nama galat IndexedDB-nya lalu menambahkan tebakan
 * *"Ruang penyimpanan HP mungkin penuh."*. Tebakan itu SALAH dan user
 * menunjukkannya dalam satu kalimat: kalau memang penuh, foto baru pun tidak
 * akan bisa tersimpan — padahal foto baru lancar. Pesan yang mengarang sebab
 * lebih buruk daripada pesan yang cuma menyebut fakta: ia mengirim orang ke
 * arah yang salah.
 *
 * Sekarang yang ditulis hanya yang benar-benar diketahui: TAHAP mana yang gagal
 * dan NAMA galat dari peramban (`QuotaExceededError`, `DataCloneError`,
 * `UnknownError`, …). Nama itulah yang menentukan perbaikannya, dan ia harus
 * bisa dibaca dari tangkapan layar — di HP tidak ada inspect element.
 */
export class SimpananGagal extends Error {
  constructor(
    readonly tahap: "buka" | "transaksi" | "permintaan" | "batas waktu",
    sebab?: unknown,
  ) {
    super(
      tahap === "batas waktu"
        ? "Simpanan foto di HP tidak menjawab dalam 10 detik."
        : `Simpanan foto di HP gagal — tahap: ${tahap}; galat: ${namaGalat(sebab)}`,
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
 * SATU koneksi untuk seumur halaman — TIDAK dibuka-tutup tiap operasi.
 *
 * Ini bukan penghematan; ini perbaikan cacat. Di WebKit (Safari iOS), `Blob`
 * yang dibaca dari IndexedDB **berhenti bisa dipakai begitu koneksi yang
 * menghasilkannya ditutup**. Versi sebelumnya membuka koneksi baru tiap operasi
 * dan menutupnya di `tx.oncomplete` — jadi tiap `semua()` mengembalikan baris
 * yang blob-nya sudah mati sebelum sempat dipakai. Menulis baris itu kembali
 * (yang dilakukan `perbarui` setiap kali status berubah) berarti menulis blob
 * mati: permintaannya gagal, transaksinya ikut gugur, dan antreannya berhenti.
 *
 * Itu juga menjelaskan kenapa gejalanya muncul saat MEMOTRET CEPAT: foto yang
 * dikirim seketika masih memakai blob segar dari memori, sedangkan foto yang
 * menumpuk di antrean harus dibaca ulang dari simpanan lebih dulu.
 */
let koneksi: Promise<IDBDatabase> | null = null;

function buka(): Promise<IDBDatabase> {
  if (koneksi) return koneksi;
  koneksi = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSI);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TOKO)) db.createObjectStore(TOKO, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Koneksi yang tertutup dari luar (peramban membersihkan, tab lain minta
      // naik versi) harus dilupakan supaya operasi berikutnya membuka lagi —
      // bukan memakai pegangan mati selamanya.
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
 * Jalankan satu transaksi.
 *
 * `fn` boleh memakai beberapa permintaan dalam SATU transaksi — itu yang
 * dipakai `perbarui` untuk baca-lalu-tulis tanpa celah balapan.
 *
 * Tiga jalur kegagalan dipasang semuanya, dan masing-masing menyebut namanya:
 * permintaan (`req.onerror`), transaksi (`tx.onerror`), dan penggugurannya
 * (`tx.onabort`). Versi sebelumnya membuang `req.onerror` — sehingga galat yang
 * SEBENARNYA (nama DOMException-nya) hilang dan yang sampai ke layar hanya
 * "transaksi" tanpa sebab. Itu membuat tangkapan layar dari lapangan tidak bisa
 * dipakai, padahal cuma itu alat yang ada.
 */
function jalankan<T>(
  mode: IDBTransactionMode,
  fn: (t: IDBObjectStore, selesai: (v: T) => void, gagal: (e: unknown) => void) => void,
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
            tx = db.transaction(TOKO, mode);
          } catch (e) {
            // `InvalidStateError` di sini = koneksinya sudah tertutup. Lupakan
            // pegangannya supaya operasi berikutnya membuka yang baru.
            koneksi = null;
            gagal(e);
            return;
          }

          fn(
            tx.objectStore(TOKO),
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
function satuPermintaan<T>(
  mode: IDBTransactionMode,
  buatReq: (t: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return jalankan<T>(mode, (toko, selesai, gagal) => {
    const req = buatReq(toko);
    req.onsuccess = () => selesai(req.result);
    req.onerror = () => gagal(req.error);
  });
}

/** Apakah perangkat/peramban ini mendukung simpanan lokal sama sekali. */
export function simpananTersedia(): boolean {
  return typeof indexedDB !== "undefined";
}

export class SimpananPenuh extends Error {
  constructor() {
    super(
      `Antrean sudah ${MAKS_ANTREAN} foto dan belum terkirim. Cari sinyal dulu supaya antreannya terkirim, baru lanjut memotret.`,
    );
  }
}

/**
 * Simpan satu jepretan. Melempar `SimpananPenuh` bila antrean sudah penuh —
 * DILEMPAR, bukan didiamkan: jepretan yang hilang karena kuota penuh adalah
 * kegagalan paling buruk yang mungkin terjadi di sini.
 */
export async function simpan(item: Omit<FotoTertunda, "dibuat">): Promise<void> {
  const jumlah = await satuPermintaan<number>("readonly", (t) => t.count());
  if (jumlah >= MAKS_ANTREAN) throw new SimpananPenuh();
  await satuPermintaan("readwrite", (t) => t.put({ ...item, dibuat: Date.now() }));
}

export async function semua(): Promise<FotoTertunda[]> {
  const rows = await satuPermintaan<FotoTertunda[]>("readonly", (t) => t.getAll());
  return rows.sort((a, b) => a.dibuat - b.dibuat);
}

/**
 * Perbarui metadata satu baris — baca-lalu-tulis di SATU transaksi.
 *
 * Dulu ini dua transaksi terpisah (`getAll` lalu `put`), dengan celah di
 * antaranya. Saat memotret cepat, dua pembaruan bisa saling menimpa: yang satu
 * menulis kembali salinan yang sudah usang, mengembalikan status yang barusan
 * berubah. Satu transaksi menutup celah itu.
 *
 * `get(id)`, bukan `getAll()`: tidak ada gunanya menarik SELURUH antrean —
 * berikut semua blob-nya — hanya untuk mengubah satu kolom status.
 */
export async function perbarui(id: string, patch: Partial<FotoTertunda>): Promise<void> {
  await jalankan<void>("readwrite", (toko, selesai, gagal) => {
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
  await satuPermintaan("readwrite", (t) => t.delete(id));
}
