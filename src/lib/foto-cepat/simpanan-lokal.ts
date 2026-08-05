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

function buka(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSI);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TOKO)) db.createObjectStore(TOKO, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function jalankan<T>(mode: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return buka().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(TOKO, mode);
        const req = fn(tx.objectStore(TOKO));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
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
  const jumlah = await jalankan<number>("readonly", (t) => t.count());
  if (jumlah >= MAKS_ANTREAN) throw new SimpananPenuh();
  await jalankan("readwrite", (t) => t.put({ ...item, dibuat: Date.now() }));
}

export async function semua(): Promise<FotoTertunda[]> {
  const rows = await jalankan<FotoTertunda[]>("readonly", (t) => t.getAll());
  return rows.sort((a, b) => a.dibuat - b.dibuat);
}

export async function perbarui(id: string, patch: Partial<FotoTertunda>): Promise<void> {
  const rows = await jalankan<FotoTertunda[]>("readonly", (t) => t.getAll());
  const lama = rows.find((r) => r.id === id);
  if (!lama) return;
  await jalankan("readwrite", (t) => t.put({ ...lama, ...patch }));
}

/** Buang dari simpanan — HANYA setelah server memastikan fotonya tersimpan. */
export async function buang(id: string): Promise<void> {
  await jalankan("readwrite", (t) => t.delete(id));
}
