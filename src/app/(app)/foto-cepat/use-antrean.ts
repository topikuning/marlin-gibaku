"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bolehCoba,
  ringkasAntrean,
  statusDariKegagalan,
  type ItemAntrean,
} from "@/lib/foto-cepat/antrean-kebijakan";
import {
  SimpananPenuh,
  buang,
  perbarui,
  semua,
  simpan,
  simpananTersedia,
  type FotoTertunda,
} from "@/lib/foto-cepat/simpanan-lokal";
import { simpanFotoCepatAction } from "@/lib/foto-cepat/actions";
import type { PosisiJepret } from "@/lib/foto-cepat/gps-segar";

/**
 * ANTREAN UNGGAH TAHAN SINYAL JELEK (DECISIONS 257).
 *
 * Alurnya dibalik dari sebelumnya. Dulu: jepret → kirim → (kalau gagal, hilang).
 * Sekarang: **jepret → SIMPAN DI PERANGKAT → kirim dari simpanan → hapus dari
 * simpanan hanya setelah server memastikan tersimpan.**
 *
 * Urutan itu satu-satunya yang membuat foto selamat dari hal-hal yang normal di
 * lapangan: sinyal putus, tab tertutup, baterai habis, peramban membunuh
 * halaman di latar belakang. Selama fotonya masih ada di simpanan, ia akan
 * dicoba lagi — termasuk sesudah aplikasi dibuka kembali besok pagi.
 */

export type BarisAntrean = {
  id: string;
  url: string;
  status: ItemAntrean["status"];
  pesan?: string;
  lokasi?: string;
};

/** Selang pemeriksaan antrean. Cukup sering untuk terasa hidup, cukup jarang
 *  untuk tidak membangunkan radio terus-menerus saat memang tidak ada sinyal. */
const SELANG_PERIKSA_MS = 3_000;

export function useAntreanFoto() {
  const [baris, setBaris] = useState<BarisAntrean[]>([]);
  const [penuh, setPenuh] = useState<string | null>(null);
  /**
   * Nilai awal `true` dengan sengaja, BUKAN `navigator.onLine`.
   *
   * Server tidak punya `navigator`, jadi membacanya saat render awal membuat
   * HTML server dan hidrasi klien berbeda dan React membuang seluruh pohonnya.
   * Keadaan sebenarnya masuk lewat effect di bawah — sebelum itu, menganggap
   * ada jaringan adalah tebakan yang aman: paling buruk satu percobaan kirim
   * gagal, lalu antreannya mencoba lagi.
   */
  const [online, setOnline] = useState(true);
  /** URL objek yang sedang dipakai pratinjau — dicabut saat barisnya hilang. */
  const urlRef = useRef(new Map<string, string>());
  const sedangJalan = useRef(false);

  const urlUntuk = useCallback((id: string, blob: Blob) => {
    const ada = urlRef.current.get(id);
    if (ada) return ada;
    const u = URL.createObjectURL(blob);
    urlRef.current.set(id, u);
    return u;
  }, []);

  const muat = useCallback(async () => {
    if (!simpananTersedia()) return;
    const rows = await semua();
    const hidup = new Set(rows.map((r) => r.id));
    for (const [id, u] of urlRef.current) {
      if (!hidup.has(id)) {
        URL.revokeObjectURL(u);
        urlRef.current.delete(id);
      }
    }
    setBaris(
      rows.map((r) => ({
        id: r.id,
        url: urlUntuk(r.id, r.blob),
        status: r.status,
        pesan: r.pesan,
      })),
    );
  }, [urlUntuk]);

  /** Coba kirim satu foto. Sebab kegagalan DIBEDAKAN — lihat antrean-kebijakan. */
  const kirimSatu = useCallback(
    async (r: FotoTertunda) => {
      await perbarui(r.id, { status: "kirim", terakhirCoba: Date.now() });
      await muat();

      const fd = new FormData();
      fd.append("photos", new File([r.blob], `${r.id}.jpg`, { type: "image/jpeg" }));
      fd.set("photoTakenAt", r.takenAt);
      if (r.lat != null && r.lng != null) {
        fd.set("gpsLat", String(r.lat));
        fd.set("gpsLng", String(r.lng));
      }

      try {
        const hasil = await simpanFotoCepatAction({}, fd);
        if (hasil.error) {
          // Server MENJAWAB dan menolak — mencoba lagi akan ditolak lagi.
          await perbarui(r.id, {
            status: statusDariKegagalan("server"),
            pesan: hasil.error,
            percobaan: r.percobaan + 1,
          });
        } else {
          // Baru DI SINI fotonya dibuang dari perangkat: server sudah memastikan
          // menyimpannya. Membuangnya lebih awal (mis. saat permintaan terkirim)
          // berarti kegagalan di tengah jalan menghapus bukti.
          await buang(r.id);
        }
      } catch {
        // Melempar = permintaannya tidak pernah sampai (jaringan). Ini yang
        // dicoba lagi selamanya.
        await perbarui(r.id, {
          status: statusDariKegagalan("jaringan"),
          pesan: "Belum ada jaringan — akan dicoba lagi otomatis.",
          percobaan: r.percobaan + 1,
        });
      }
      await muat();
    },
    [muat],
  );

  const proses = useCallback(async () => {
    if (sedangJalan.current || !simpananTersedia()) return;
    sedangJalan.current = true;
    try {
      const rows = await semua();
      const sekarang = Date.now();
      const daring = typeof navigator === "undefined" ? true : navigator.onLine;
      for (const r of rows) {
        if (!bolehCoba(r, sekarang, daring)) continue;
        // Berurutan, bukan serentak: di jaringan lemah, mengirim lima foto
        // sekaligus membuat kelimanya sama-sama timeout. Satu per satu lebih
        // lambat di atas kertas, tapi jauh lebih sering berhasil.
        await kirimSatu(r);
      }
    } finally {
      sedangJalan.current = false;
    }
  }, [kirimSatu]);

  /** Titipkan satu jepretan ke antrean. Mengembalikan false bila simpanan penuh. */
  const titip = useCallback(
    async (file: File, posisi: PosisiJepret): Promise<boolean> => {
      if (!simpananTersedia()) {
        setPenuh("Peramban ini tidak mendukung simpanan lokal — foto dikirim langsung tanpa antrean.");
        return false;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await simpan({
          id,
          blob: file,
          lat: posisi?.lat ?? null,
          lng: posisi?.lng ?? null,
          takenAt: new Date().toISOString(),
          percobaan: 0,
          terakhirCoba: 0,
          status: "menunggu",
        });
      } catch (e) {
        setPenuh(e instanceof SimpananPenuh ? e.message : "Gagal menyimpan foto di perangkat.");
        return false;
      }
      setPenuh(null);
      await muat();
      void proses();
      return true;
    },
    [muat, proses],
  );

  // Muat antrean yang tertinggal dari sesi sebelumnya, lalu jalan.
  useEffect(() => {
    void (async () => {
      await muat();
      void proses();
    })();
  }, [muat, proses]);

  // Denyut pemeriksaan + reaksi saat jaringan kembali.
  useEffect(() => {
    const t = window.setInterval(() => void proses(), SELANG_PERIKSA_MS);
    const naik = () => {
      setOnline(true);
      void proses();
    };
    const turun = () => setOnline(false);
    window.addEventListener("online", naik);
    window.addEventListener("offline", turun);
    // Ditunda ke microtask: menyetel state di badan effect memicu render
    // kaskade (aturan lint repo ini).
    void Promise.resolve().then(() => {
      if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    });
    return () => {
      window.clearInterval(t);
      window.removeEventListener("online", naik);
      window.removeEventListener("offline", turun);
    };
  }, [proses]);

  const hapus = useCallback(
    async (id: string) => {
      await buang(id);
      await muat();
    },
    [muat],
  );

  const ringkas = ringkasAntrean(baris);
  return { baris, ringkas, penuh, online, titip, hapus, kirimSekarang: proses };
}
