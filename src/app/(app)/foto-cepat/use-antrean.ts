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
  SimpananTakTerbaca,
  ambilBerkas,
  kuotaSimpanan,
  mintaSimpananTetap,
  buang,
  perbarui,
  pindahkanWarisan,
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
  /** Rincian teknis — dibaca dari LAYAR, karena di HP tidak ada inspect element. */
  percobaan: number;
  bytes: number;
  umurMs: number;
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
  /**
   * Salinan SEGAR tiap jepretan, di memori halaman ini.
   *
   * Pertanyaan user 2026-08-07: *"berarti saat ambil foto cepat hal ini rentan
   * terjadi. bagaimana mengatasinya?"*
   *
   * Ini lapis yang paling mengurangi peluangnya. Selama halaman masih hidup,
   * pengiriman memakai salinan yang JELAS UTUH — yang baru saja keluar dari
   * kamera — bukan hasil membaca ulang simpanan. Simpanan tetap ditulis lebih
   * dulu (itu yang menyelamatkan foto kalau halamannya mati), tapi ia turun
   * pangkat jadi CADANGAN: dibaca hanya kalau halamannya sempat tertutup.
   *
   * Bukti yang mendukung ini datang dari user sendiri: foto yang langsung
   * terkirim tidak pernah rusak; yang rusak selalu yang menunggu di antrean.
   */
  const segarRef = useRef(new Map<string, Blob>());
  const [kuota, setKuota] = useState<string | null>(null);

  /**
   * Pratinjau dibuat SEKALI per foto, dari byte di simpanan.
   *
   * Dulu tiap `muat()` menyeret seluruh isi antrean — ratusan KB per foto,
   * setiap 3 detik — hanya untuk menggambar petak 56px. Sekarang `semua()`
   * hanya membawa keterangannya, dan bytenya diambil sekali saja di sini.
   */
  const pinjamUrl = useCallback(async (id: string, tipe: string) => {
    const ada = urlRef.current.get(id);
    if (ada) return ada;
    const blob = await ambilBerkas(id, tipe);
    if (!blob) return "";
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
    const kini = Date.now();
    const siap: BarisAntrean[] = [];
    for (const r of rows) {
      siap.push({
        id: r.id,
        url: await pinjamUrl(r.id, r.tipe),
        status: r.status,
        pesan: r.pesan,
        percobaan: r.percobaan,
        bytes: r.ukuran ?? 0,
        umurMs: kini - (r.dibuat ?? kini),
      });
    }
    setBaris(siap);
  }, [pinjamUrl]);

  /** Coba kirim satu foto. Sebab kegagalan DIBEDAKAN — lihat antrean-kebijakan. */
  const kirimSatu = useCallback(
    async (r: FotoTertunda) => {
      // Salinan segar dulu (kalau halamannya masih yang sama), simpanan belakangan.
      const berkas = segarRef.current.get(r.id) ?? (await ambilBerkas(r.id, r.tipe));
      // Ukuran nol = tidak ada yang bisa dikirim. Membiarkannya lewat berarti
      // mengirim badan kosong, dan kegagalannya nanti terbaca seperti masalah
      // jaringan — persis salah-tuduh yang sedang diberantas di berkas ini.
      if (!berkas || berkas.size === 0) {
        /*
         * Bytenya tidak ada lagi. Ini BUKAN kegagalan jaringan dan bukan
         * penolakan server — tidak ada apa pun untuk dikirim, dan mencobanya
         * seribu kali tidak akan mengubah itu. Ditandai `rusak` supaya
         * pemiliknya tahu fotonya memang hilang dan bisa membuangnya, bukan
         * menunggu selamanya sesuatu yang tak akan pernah terkirim.
         */
        await perbarui(r.id, {
          status: "rusak",
          pesan:
            "Isi fotonya hilang dari simpanan HP (peramban melepas berkasnya) — tidak bisa dikirim. Buang saja lalu potret ulang.",
        });
        await muat();
        return;
      }

      await perbarui(r.id, { status: "kirim", terakhirCoba: Date.now() });
      await muat();

      const fd = new FormData();
      fd.append("photos", new File([berkas], `${r.id}.jpg`, { type: r.tipe || "image/jpeg" }));
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
          segarRef.current.delete(r.id);
        }
      } catch (e) {
        /*
         * JANGAN menuduh jaringan tanpa bukti.
         *
         * Dulu SEMUA lemparan di sini dilabeli "Belum ada jaringan — akan
         * dicoba lagi otomatis." Itu keliru, dan user menunjukkannya dua kali:
         * *"padahal jaringan jelas ada, foto baru bisa upload"*. Memang ada.
         * Yang gagal adalah pengirimannya, karena isi fotonya tak terbaca —
         * dan aplikasi menutupi sebab itu dengan tuduhan yang salah. Pesan
         * yang menyalahkan hal yang keliru lebih buruk daripada pesan yang
         * mengaku tidak tahu: ia membuat orang mencari sinyal, memindah HP,
         * menunggu — semuanya sia-sia.
         *
         * Sekarang: "belum ada jaringan" HANYA ditulis kalau perangkatnya
         * memang menyatakan tidak ada jaringan. Selain itu yang ditulis adalah
         * apa yang benar-benar terjadi, berikut nama galatnya.
         */
        const habisWaktu = e instanceof Error && e.message === "batas waktu";
        const daring = typeof navigator === "undefined" ? true : navigator.onLine;
        const nama = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        await perbarui(r.id, {
          status: statusDariKegagalan("jaringan"),
          pesan: habisWaktu
            ? "Server tidak menjawab sampai 60 detik — akan dicoba lagi otomatis."
            : !daring
              ? "Belum ada jaringan — akan dicoba lagi otomatis."
              : `Pengiriman gagal padahal jaringan TERDETEKSI ADA — ${nama}. Akan dicoba lagi otomatis.`,
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
        segarRef.current.set(id, file);
        await simpan(
          {
            id,
            lat: posisi?.lat ?? null,
            lng: posisi?.lng ?? null,
            takenAt: new Date().toISOString(),
            percobaan: 0,
            terakhirCoba: 0,
            status: "menunggu",
          },
          file,
        );
      } catch (e) {
        segarRef.current.delete(id);
        setPenuh(
          e instanceof SimpananPenuh || e instanceof SimpananTakTerbaca
            ? e.message
            : e instanceof Error
              ? `Gagal menyimpan foto di HP — ${e.message}`
              : "Gagal menyimpan foto di perangkat.",
        );
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
      // Baris lama (yang masih menyimpan Blob) dipindah ke bentuk byte lebih
      // dulu — termasuk menandai yang bytenya sudah tidak terbaca sebagai
      // `rusak`. Tanpa langkah ini, antrean warisan tidak akan pernah bergerak.
      // Minta peramban tidak membuang simpanan ini saat ruang menipis, lalu
      // catat kuotanya supaya "penuh" bisa jadi ANGKA, bukan tebakan.
      void mintaSimpananTetap();
      void kuotaSimpanan().then((k) => {
        if (!k) return;
        setKuota(
          `${Math.round(k.pakai / 1024 / 1024)} MB dipakai dari ${Math.round(k.kuota / 1024 / 1024)} MB`,
        );
      });
      await pindahkanWarisan().catch(() => {});
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

  return { baris, ringkas, penuh, galat, kuota, online, titip, hapus, kirimSekarang };
}
