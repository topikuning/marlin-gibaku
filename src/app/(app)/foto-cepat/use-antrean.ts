"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BATAS_SATU_KIRIM_MS,
  bolehCoba,
  kirimMacet,
  putaranDitinggalkan,
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

/**
 * Jalankan `p`, tapi JANGAN menunggunya selamanya.
 *
 * `Promise` yang menggantung tidak bisa dibatalkan — tapi bisa diabaikan.
 * Tanpa ini, satu permintaan yang tidak pernah dijawab (jaringan seluler
 * setengah hidup, atau IndexedDB iOS yang berhenti menjawab sesudah halaman
 * kembali dari latar belakang) menghentikan SELURUH antrean: statusnya tidak
 * pernah turun dari "kirim", dan `finally` yang melepas kuncinya tidak pernah
 * dijalankan. Laporan user 2026-08-07 — tiga baris "kirim…" yang tidak bergerak
 * sejam pun.
 */
function berbatasWaktu<T>(p: Promise<T>, ms: number, pesan: string): Promise<T> {
  return new Promise<T>((selesai, gagal) => {
    const t = window.setTimeout(() => gagal(new Error(pesan)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        selesai(v);
      },
      (e) => {
        window.clearTimeout(t);
        gagal(e);
      },
    );
  });
}

export function useAntreanFoto() {
  const [baris, setBaris] = useState<BarisAntrean[]>([]);
  const [penuh, setPenuh] = useState<string | null>(null);
  /**
   * Galat terakhir dari antrean — DITAMPILKAN, bukan ditelan.
   *
   * Sebelumnya tiap jalur kegagalan di sini bisu: `.catch(() => {})` di semua
   * pemanggil, dan tidak satu pun keadaan gagal punya tempat di layar. Itulah
   * kenapa tiga putaran perbaikan (DECISIONS 282, 283) tidak terlihat hasilnya
   * dari lapangan — yang bisa dilaporkan cuma "stuck", tanpa satu kata pun
   * tentang sebabnya. Layar yang diam saat gagal membuat perbaikan jadi tebakan.
   */
  const [galat, setGalat] = useState<string | null>(null);
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
  /**
   * Kapan putaran antrean yang sedang berjalan dimulai — `null` bila menganggur.
   *
   * Dulu ini boolean. Boolean tidak bisa membedakan "sedang jalan" dari
   * "pemegang kuncinya sudah tidak ada", dan bedanya menentukan apakah antrean
   * hidup atau mati: `finally` yang melepas kunci tidak pernah jalan kalau yang
   * ditunggu tidak pernah menjawab.
   */
  const mulaiPutaran = useRef<number | null>(null);

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
        const hasil = await berbatasWaktu(
          simpanFotoCepatAction({}, fd),
          BATAS_SATU_KIRIM_MS,
          "batas waktu",
        );
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
      } catch (e) {
        // Melempar = permintaannya tidak pernah sampai, ATAU tidak pernah
        // dijawab sampai batas waktu. Keduanya soal jaringan, dan keduanya
        // dicoba lagi — selamanya.
        const habisWaktu = e instanceof Error && e.message === "batas waktu";
        await perbarui(r.id, {
          status: statusDariKegagalan("jaringan"),
          pesan: habisWaktu
            ? "Jaringan tidak menjawab sampai batas waktu — akan dicoba lagi otomatis."
            : "Belum ada jaringan — akan dicoba lagi otomatis.",
          percobaan: r.percobaan + 1,
        });
      }
      await muat();
    },
    [muat],
  );

  /**
   * @param paksa Ketukan "Coba kirim sekarang". Semua baris yang tersangkut di
   *   status "kirim" dibebaskan tanpa menunggu ambang macet — orangnya sedang
   *   menatap layar, dan di tab INI tidak ada unggahan yang sedang berjalan
   *   (kalau ada, penjaga putaran sudah menghentikan kita di atas).
   */
  const proses = useCallback(async (paksa = false) => {
    if (!simpananTersedia()) return;
    /*
     * Kunci yang pemegangnya sudah tidak ada TIDAK boleh menyandera antrean.
     *
     * Kalau putaran sebelumnya menggantung di sesuatu yang tak pernah menjawab,
     * `finally` di bawah tidak pernah jalan dan kuncinya dipegang selamanya —
     * antreannya mati diam-diam, layarnya membeku pada label terakhir, dan
     * "Coba kirim sekarang" pun tidak berbuat apa-apa. Sesudah `BATAS_PUTARAN_MS`
     * kuncinya diambil alih.
     */
    if (mulaiPutaran.current != null && !putaranDitinggalkan(mulaiPutaran.current, Date.now())) {
      return;
    }
    mulaiPutaran.current = Date.now();
    try {
      /*
       * BEBASKAN yang macet dulu.
       *
       * "kirim" hanya bisa diturunkan oleh halaman yang menyetelnya. Kalau
       * halaman itu mati di tengah unggahan, barisnya tinggal bertuliskan
       * "kirim…" selamanya dan `bolehCoba` menolak menyentuhnya — persis
       * keluhan user 2026-08-07 yang tidak sembuh oleh logout maupun ganti
       * user, karena antreannya milik PERANGKAT, bukan sesi.
       *
       * Percobaannya TIDAK dinaikkan: baris ini belum pernah benar-benar
       * ditolak, ia cuma kehilangan halamannya. Menaikkannya akan mendorongnya
       * ke jeda 5 menit tanpa sebab.
       */
      setGalat(null);
      const awal = await semua();
      const kini = Date.now();
      for (const r of awal) {
        if (r.status !== "kirim") continue;
        if (!paksa && !kirimMacet(r, kini)) continue;
        await perbarui(r.id, { status: "menunggu", terakhirCoba: 0 });
      }

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
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Antrean gagal diproses.");
    } finally {
      mulaiPutaran.current = null;
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
      await muat().catch(() => {});
      void proses().catch(() => {});
      return true;
    },
    [muat, proses],
  );

  // Muat antrean yang tertinggal dari sesi sebelumnya, lalu jalan.
  //
  // Kegagalan di sini SENGAJA ditelan: `muat` cuma menyegarkan tampilan, dan
  // simpanan yang sesaat tidak menjawab bukan alasan untuk melempar galat yang
  // tidak ada yang menangkap. Denyut di bawah akan mencobanya lagi 3 detik lagi
  // — foto yang tersimpan tidak ke mana-mana.
  useEffect(() => {
    void (async () => {
      await muat().catch(() => {});
      void proses().catch(() => {});
    })();
  }, [muat, proses]);

  // Denyut pemeriksaan + reaksi saat jaringan kembali.
  useEffect(() => {
    const t = window.setInterval(() => void proses().catch(() => {}), SELANG_PERIKSA_MS);
    const naik = () => {
      setOnline(true);
      void proses().catch(() => {});
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
      try {
        await buang(id);
        await muat();
      } catch (e) {
        setGalat(e instanceof Error ? e.message : "Gagal membuang foto dari antrean.");
      }
    },
    [muat],
  );

  const ringkas = ringkasAntrean(baris);
  const kirimSekarang = useCallback(() => proses(true), [proses]);

  return { baris, ringkas, penuh, galat, online, titip, hapus, kirimSekarang };
}
