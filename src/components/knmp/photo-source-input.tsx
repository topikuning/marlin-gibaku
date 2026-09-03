"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Images, MapPin, MapPinOff, X } from "lucide-react";
import { MAX_PHOTOS_PER_UPLOAD, muatSekaliUnggah } from "@/lib/photo-limits";
import { catatIzinPerangkat } from "@/lib/device-permission";

/**
 * Input foto sadar-sumber (Kamera vs Galeri) untuk kontrol tagging lokasi.
 * `hanyaKamera` menutup jalur galeri sama sekali — lihat propnya.
 *
 * - Kamera → merekam GPS real-time perangkat + waktu sekarang (foto baru di lokasi).
 * - Galeri → pelapor ditanya dulu "sedang di lokasi proyek?" (DECISIONS 220);
 *   urutan koordinatnya EXIF foto → posisi perangkat (hanya bila menjawab YA) →
 *   titik lokasi proyek. Langkah terakhir selalu ber-penanda `gpsSource=project`
 *   sehingga tidak pernah terhitung sebagai bukti GPS (DECISIONS 197).
 *
 * TIDAK ADA SAKLAR "foto galeri tanpa GPS → …". Dulu ada, dan itu keliru: sesudah
 * pertanyaan di atas ada, seluruh rantainya sudah ditentukan jawaban pelapor —
 * saklar itu jadi tempat KEDUA untuk menjawab hal yang sama, dan nilai bawaannya
 * ("pakai titik lokasi proyek") justru perilaku yang sedang diperbaiki. Saklar
 * yang bisa membatalkan jawaban barusan bukan keluwesan, itu jebakan.
 *
 * Mengirim hidden field: photoSource, galleryAtSite, photoTakenAt, dan koordinat
 * perangkat (nama field bisa diatur via latName/lngName). Dua input file berbagi
 * name "photos"; input yang tak dipakai dikosongkan saat memilih.
 *
 * IZIN LOKASI DIURUS DI DEPAN, BUKAN SAAT RANA DITEKAN (DECISIONS 219).
 * Permintaan user 2026-08-02: "aku perlu agak memaksa ini, karena saat ini
 * kebanyakan foto ditag dengan lokasi default."
 *
 * Sebabnya struktural: dulu GPS baru diminta SESUDAH file dipilih, dan bila
 * user menutup/menolak dialog izin, `onPicked()` tetap jalan — fotonya terunggah
 * tanpa koordinat lalu dicap memakai titik proyek. Dari sisi pelapor tidak ada
 * apa pun yang tampak salah, jadi kebiasaan itu terus berulang.
 *
 * Sekarang: keadaan izin dibaca saat komponen tampil, ditampilkan terang-terangan,
 * dan tombol "Izinkan akses lokasi" memicu dialog SEBELUM memotret. Keadaannya
 * juga dicatat ke server supaya bisa ditelusuri per orang & perangkat.
 */
export function PhotoSourceInput({
  latName = "gpsLat",
  lngName = "gpsLng",
  onPicked,
  compact = false,
  hanyaKamera = false,
  slotKetiga,
  prefix = "",
  sunyiIzin = false,
  ringkas = false,
}: {
  latName?: string;
  lngName?: string;
  /** Dipanggil setelah file dipilih (untuk auto-submit). */
  onPicked?: () => void;
  /** true → sembunyikan pratinjau (mode inline auto-submit). */
  compact?: boolean;
  /**
   * Ubin KETIGA di baris sumber foto — dipakai "Foto Cepat" (DECISIONS 341).
   *
   * Sengaja slot, bukan prop boolean: mengambil dari kantong Foto Cepat BUKAN
   * `<input type=file>` melainkan panel pemilih tersendiri, jadi pemiliknya
   * yang tahu cara membukanya. Yang dijamin berkas ini hanyalah ketiganya
   * TAMPIL SETARA — sebelumnya Foto Cepat terbaca seperti aksi kelas dua
   * padahal koordinatnya justru yang paling benar.
   */
  slotKetiga?: React.ReactNode;
  /**
   * true → JALUR GALERI DITUTUP; hanya memotret langsung (DECISIONS 255).
   *
   * Dipakai Foto Cepat, yang seluruh gunanya adalah koordinat + jam yang BENAR.
   * Foto galeri tidak bisa menjaminnya: kebanyakan tidak membawa GPS (~96%
   * berakhir di titik proyek, DECISIONS 197), WhatsApp membuang EXIF-nya, dan
   * jam yang tercatat bisa berbulan-bulan lalu. Menyediakannya di sana justru
   * memproduksi pekerjaan yang fiturnya ada untuk menghilangkan.
   *
   * Laporan harian TETAP boleh dari galeri — di sana galeri menjawab kebutuhan
   * lain, yaitu foto yang KETINGGALAN (DECISIONS 226).
   */
  hanyaKamera?: boolean;
  /**
   * Awalan nama medan, supaya BEBERAPA pemilih bisa hidup dalam SATU form
   * (DECISIONS 343).
   *
   * Tiap baris material/alat punya pemilih fotonya sendiri; tanpa awalan,
   * `photos` dari semua baris menyatu jadi satu daftar dan tidak ada lagi cara
   * mengetahui foto mana milik baris mana. Kosong = perilaku lama, dipakai
   * pemilih yang memang sendirian di formnya.
   */
  prefix?: string;
  /**
   * Sembunyikan KOTAK PERINGATAN izin lokasi (perilakunya tidak berubah).
   *
   * Dipakai pemilih ke-2 dan seterusnya dalam satu layar (DECISIONS 343):
   * peringatan yang sama diulang lima belas kali — sekali per baris material —
   * berhenti dibaca sebagai peringatan dan berubah jadi latar. Yang pertama
   * tetap menampilkannya, jadi kabarnya tidak hilang.
   */
  sunyiIzin?: boolean;
  /**
   * Bentuk RINGKAS: tiga tombol kecil sebaris, bukan ubin selebar kolom
   * (DECISIONS 344).
   *
   * Ubin besar benar di tempat ia jadi pilihan UTAMA layar — form item
   * pekerjaan, satu per laporan. Di baris material/alat ia terbit sekali per
   * BARIS: pada satu laporan berisi lima material dan dua alat, tujuh salinan
   * ubin yang sama menenggelamkan kolom yang justru harus diisi. Keluhan user
   * 2026-08-17: *"tombol sumber fotomu terlalu besar di bagian alat dan bahan
   * ini, perkecil sampai 1/3 nya."*
   *
   * Yang dibuang cuma ukuran dan keterangan barisnya; pilihannya tetap tiga,
   * namanya tetap ditulis (bukan ikon telanjang).
   */
  ringkas?: boolean;
}) {
  const n = (nama: string) => `${prefix}${nama}`;
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  /** Input yang BENAR-BENAR dikirim — isinya kumpulan dari semua pemilihan. */
  const berkasRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<"camera" | "gallery">("camera");
  const [takenAt, setTakenAt] = useState("");
  /**
   * Foto terpilih, MENUMPUK lintas ketukan Kamera/Galeri (DECISIONS 229).
   *
   * URL pratinjau disimpan BERSAMA berkasnya, bukan diturunkan di effect:
   * `URL.createObjectURL` mengalokasikan blob yang harus dicabut, dan membuatnya
   * di dalam render/effect berarti alokasi ikut setiap render — bocor perlahan.
   * Dibuat sekali di penanganan ketukan, dicabut saat fotonya dibuang.
   */
  const [berkas, setBerkas] = useState<{ file: File; url: string }[]>([]);
  const [pesanBatas, setPesanBatas] = useState<string | null>(null);
  /**
   * Berisi nama galat bila perakitan `DataTransfer` tidak bisa dipakai di
   * peramban ini. Bukan sekadar penanda: pesannya ditampilkan apa adanya,
   * karena pelapor memakai ponsel dan tidak bisa membuka console.
   *
   * Bukan null → JALUR CADANGAN: pemilih kamera/galeri sendiri yang ber-`name`
   * dan terkirim langsung. Fitur menumpuk pilihan hilang (DECISIONS 229),
   * unggahnya tetap jalan. Fitur yang berkurang jauh lebih baik daripada
   * halaman yang runtuh.
   */
  const [rakitGagal, setRakitGagal] = useState<string | null>(null);
  // "unknown" = belum diperiksa. Nilai awal sengaja BUKAN "prompt": menebak
  // keadaan izin lalu menampilkan peringatan yang salah lebih buruk daripada
  // diam sebentar.
  // Jawaban "sedang di lokasi proyek?" untuk unggahan GALERI (DECISIONS 220).
  // null = belum dijawab → pemilih berkas belum dibuka.
  const [diLokasi, setDiLokasi] = useState<boolean | null>(null);
  /**
   * Galeri "gunakan apa adanya" (user 2026-08-24): foto dipakai TANPA tag
   * koordinat & waktu — cap hanya lokasi/pekerjaan/logo, meski EXIF ada.
   */
  const [apaAdanya, setApaAdanya] = useState(false);
  const [tanyaLokasi, setTanyaLokasi] = useState(false);
  const [izin, setIzin] = useState<"granted" | "denied" | "prompt" | "unsupported" | "unknown">("unknown");
  const [mintaIzin, setMintaIzin] = useState(false);

  /** Catat ke server; kegagalan mencatat TIDAK boleh menghalangi memotret. */
  const catat = useCallback((state: "granted" | "denied" | "prompt" | "unsupported") => {
    setIzin(state);
    void catatIzinPerangkat({ kind: "geolocation", state }).catch(() => {});
  }, []);

  useEffect(() => {
    let batal = false;
    // Pemeriksaan ditunda ke microtask supaya tidak menyetel state saat render
    // effect berjalan (aturan react-hooks/set-state-in-effect).
    void (async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!batal) catat("unsupported");
        return;
      }
      // Permissions API tidak ada di semua browser (Safari lama). Tanpa itu
      // keadaannya memang tidak diketahui — ditulis apa adanya sebagai
      // "prompt", bukan ditebak "granted".
      if (!navigator.permissions?.query) {
        if (!batal) setIzin("prompt");
        return;
      }
      try {
        const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        if (batal) return;
        catat(st.state as "granted" | "denied" | "prompt");
        st.onchange = () => catat(st.state as "granted" | "denied" | "prompt");
      } catch {
        if (!batal) setIzin("prompt");
      }
    })();
    return () => {
      batal = true;
    };
  }, [catat]);

  /** Picu dialog izin browser. Hanya `getCurrentPosition` yang bisa memunculkannya. */
  const izinkan = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return catat("unsupported");
    setMintaIzin(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMintaIzin(false);
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        catat("granted");
      },
      (err) => {
        setMintaIzin(false);
        catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const clearGps = () => {
    if (latRef.current) latRef.current.value = "";
    if (lngRef.current) lngRef.current.value = "";
  };

  /**
   * Tumpuk foto baru ke yang sudah dipilih — JANGAN menimpa (DECISIONS 229).
   *
   * `<input type="file">` mengganti seluruh isinya tiap kali pemilih dibuka.
   * Itu perilaku bawaan peramban, dan akibatnya: memilih satu foto dari galeri
   * lalu berubah pikiran ingin menambah satu lagi MENGHAPUS yang pertama —
   * begitu juga memotret kedua kali. Di lapangan satu pekerjaan lazim butuh
   * beberapa sudut, jadi ini bukan kasus tepi.
   *
   * Solusinya: dua tombol di atas hanya PEMILIH (tanpa `name`, jadi tidak ikut
   * terkirim). Hasilnya ditumpuk di state, lalu ditulis ulang ke satu input
   * tersembunyi ber-`name="photos"` lewat `DataTransfer` — satu-satunya cara
   * merakit `FileList` sendiri.
   */
  const idBerkas = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

  const tumpuk = (baru: FileList) => {
    // Saat perakitan tidak bisa dipakai, pilihan TIDAK boleh menumpuk: yang
    // benar-benar terkirim cuma isi pemilih terakhir, jadi pratinjau yang
    // menumpuk akan berbohong tentang apa yang akan terunggah.
    const dasar = rakitGagal ? [] : berkas;
    if (rakitGagal) for (const b of berkas) URL.revokeObjectURL(b.url);
    // Berkas identik (nama+ukuran+waktu) tidak ditambahkan dua kali: memilih
    // ulang foto yang sama biasanya salah tekan, bukan permintaan duplikat —
    // dan server memang menolak duplikat byte-identik.
    const sudah = new Set(dasar.map((b) => idBerkas(b.file)));
    const tambah = Array.from(baru).filter((f) => !sudah.has(idBerkas(f)));
    const gabung = [...dasar, ...tambah.map((file) => ({ file, url: URL.createObjectURL(file) }))];
    // TIGA pagar: ukuran satu foto, jumlah foto, dan ukuran permintaan
    // (DECISIONS 425). Yang tidak muat disebut jumlahnya beserta sebabnya —
    // tidak pernah hilang diam-diam.
    //
    // Diambil per-INDEKS, bukan sebagai awalan daftar: satu foto kebesaran di
    // tengah pilihan ditolak sendirian, dan foto wajar sesudahnya tetap ikut.
    const batas = muatSekaliUnggah(gabung.map((b) => b.file.size));
    const diterima = new Set(batas.terima);
    for (let i = 0; i < gabung.length; i++) {
      if (!diterima.has(i)) URL.revokeObjectURL(gabung[i]!.url);
    }
    setPesanBatas(batas.pesan);
    setBerkas(batas.terima.map((i) => gabung[i]!));
  };

  /** Buang satu foto dari pilihan (bukan dari server — belum terunggah). */
  const buang = (i: number) => {
    setPesanBatas(null);
    const b = berkas[i];
    if (b) URL.revokeObjectURL(b.url);
    setBerkas(berkas.filter((_, n) => n !== i));
  };

  /**
   * Tulis ulang isi input pengirim tiap kali daftarnya berubah. Efek, bukan
   * di dalam handler: state-lah sumber kebenarannya, dan input hanya cerminan.
   *
   * SELURUHNYA DIJAGA, karena tiga langkah di bawah ini semuanya bergantung
   * pada dukungan peramban yang tidak merata di ponsel: `new DataTransfer()`,
   * `items.add()` (di beberapa peramban daftarnya read-only kalau bukan dari
   * peristiwa seret), dan penugasan ke `input.files`. Berkas ini modul ES —
   * mode ketat — jadi penugasan yang ditolak MELEMPAR, bukan diam. Sebelum
   * dijaga, lemparan itu menjatuhkan seluruh halaman tanpa menyebut apa pun
   * dan tanpa jejak di server (tidak ada permintaan yang pernah dikirim).
   *
   * Hasilnya juga DIPERIKSA, bukan cuma "tidak melempar": peramban yang
   * menerima penugasan lalu mengabaikannya akan mengirim form tanpa foto —
   * gagal diam-diam, jenis kegagalan terburuk untuk bukti lapangan.
   */
  useEffect(() => {
    const el = berkasRef.current;
    if (!el || rakitGagal) return;
    try {
      const dt = new DataTransfer();
      for (const b of berkas) dt.items.add(b.file);
      el.files = dt.files;
      if (el.files.length !== berkas.length) {
        throw new Error(`input file hanya menerima ${el.files.length} dari ${berkas.length} berkas`);
      }
    } catch (e) {
      const nama = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      // Ditunda ke microtask supaya tidak menyetel state saat efek berjalan.
      queueMicrotask(() => setRakitGagal(nama));
    }
  }, [berkas, rakitGagal]);

  const pickCamera = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSource("camera");
    setTakenAt(new Date().toISOString());
    tumpuk(files);
    // Pemilih dikosongkan supaya memotret objek yang sama dua kali tetap
    // memicu `change` (nilai yang tidak berubah = tidak ada event). Di jalur
    // cadangan justru TIDAK boleh dikosongkan — pemilih inilah yang terkirim.
    if (rakitGagal) {
      if (galRef.current) galRef.current.value = "";
    } else {
      e.target.value = "";
    }
    clearGps();
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (latRef.current) latRef.current.value = String(pos.coords.latitude);
          if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
          catat("granted");
          onPicked?.();
        },
        (err) => {
          // maximumAge 0: JANGAN pakai koordinat basi. Foto yang diambil di
          // lokasi B tidak boleh membawa titik lokasi A yang tersimpan satu
          // menit lalu — itu bukan sekadar tidak akurat, itu keliru.
          catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt");
          onPicked?.();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } else {
      catat("unsupported");
      onPicked?.();
    }
  };

  /**
   * Jawab "sedang di lokasi proyek?" lalu buka pemilih berkas (DECISIONS 220).
   *
   * Kalau YA, posisi perangkat diambil dan dikirim sebagai cadangan — dipakai
   * hanya bila foto tidak punya GPS sendiri. Kalau TIDAK, tidak ada koordinat
   * perangkat yang dikirim sama sekali: mengunggah dari kantor lalu menandai
   * fotonya dengan posisi kantor jauh lebih buruk daripada tidak menandai apa
   * pun.
   *
   * PEMILIH BERKAS DIBUKA LEBIH DULU, di dalam gestur ketukan — BUKAN di dalam
   * callback geolokasi. Peramban seluler hanya mengizinkan pemilih berkas
   * dibuka dari gestur pengguna; menundanya sampai GPS menjawab (bisa 10 detik,
   * atau tidak pernah) membuat ketukan "Ya, saya di lokasi" tampak tidak
   * melakukan apa-apa. GPS berjalan PARALEL dan mengisi field tersembunyi
   * selagi pelapor memilih foto.
   */
  const jawabLokasi = (ya: boolean) => {
    setDiLokasi(ya);
    setApaAdanya(false);
    setTanyaLokasi(false);
    setSource("gallery");
    clearGps();
    galRef.current?.click();
    if (ya && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (latRef.current) latRef.current.value = String(pos.coords.latitude);
          if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
          catat("granted");
        },
        (err) => catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    }
  };

  const pickGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSource("gallery");
    setTakenAt(new Date().toISOString());
    tumpuk(files);
    if (rakitGagal) {
      if (camRef.current) camRef.current.value = "";
    } else {
      e.target.value = "";
    }
    onPicked?.();
  };

  /**
   * SUMBER FOTO SEBAGAI UBIN, bukan tombol kecil sebaris (DECISIONS 341).
   *
   * Keluhan user 2026-08-17 atas layar input harian: pilihan sumber foto tidak
   * terbaca sebagai pilihan. Dua tombol setinggi 36px di sela-sela form memang
   * terlihat seperti tombol pelengkap, bukan seperti "dari mana fotonya?" —
   * dan di lapangan, dengan sarung tangan dan layar kena matahari, sasaran
   * ketuk sekecil itu sering meleset.
   *
   * Ubin ini setinggi ±64px dengan ikon + nama + keterangan satu baris:
   * pilihannya terbaca sekali lihat, dan tetap masuk akal di laptop karena
   * lebarnya mengikuti kolom, bukan dipatok.
   */
  const ubin = ringkas
    ? "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-primary hover:bg-primary-50"
    : "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-surface px-2 py-2 text-center text-ink hover:border-primary hover:bg-primary-50";

  /**
   * Jalur SATU SUMBER (Foto Cepat, `hanyaKamera`) tetap tombol ringkas.
   *
   * Ubin ada untuk membuat sebuah PILIHAN terbaca. Kalau sumbernya cuma satu,
   * tidak ada pilihan yang perlu dibaca — dan satu ubin selebar kolom hanya
   * memakan ruang di layar yang justru dirancang tanpa gulir (DECISIONS 255).
   */
  const tombolTunggal =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted";

  return (
    <div className="space-y-2">
      <input type="hidden" name={n("photoSource")} value={source} />
      <input type="hidden" name={n("galleryAtSite")} value={diLokasi === true ? "1" : ""} />
      {apaAdanya ? <input type="hidden" name={n("galleryFallback")} value="apa_adanya" /> : null}
      <input type="hidden" name={n("photoTakenAt")} value={takenAt} />
      <input ref={latRef} type="hidden" name={n(latName)} defaultValue="" />
      <input ref={lngRef} type="hidden" name={n(lngName)} defaultValue="" />

      {/* Keadaan izin lokasi — disebut TERANG-TERANGAN sebelum memotret.
          Dulu ini diam saja dan fotonya diam-diam dicap titik proyek. */}
      {sunyiIzin ? null : izin === "granted" ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <MapPin aria-hidden className="size-3.5" /> Izin lokasi aktif – foto kamera akan membawa
          koordinat asli.
        </p>
      ) : izin === "unsupported" ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <MapPinOff aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Perangkat/browser ini tidak
          mendukung GPS. Foto akan dicap memakai titik lokasi proyek, bukan posisi sebenarnya.
        </p>
      ) : izin === "unknown" ? null : (
        <div
          className={`rounded-md border px-3 py-2 ${izin === "denied" ? "border-danger-border bg-danger-soft" : "border-warning-border bg-warning-soft"}`}
        >
          <p className={`text-xs font-medium ${izin === "denied" ? "text-danger" : "text-warning"}`}>
            {izin === "denied"
              ? "Izin lokasi DITOLAK di browser ini"
              : "Izin lokasi belum diberikan"}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tanpa izin, foto dicap memakai <strong>titik lokasi proyek</strong> – bukan posisi
            sebenarnya saat memotret.
            {izin === "denied"
              ? " Buka setelan situs di browser (ikon di kiri address bar) → izinkan Lokasi, lalu muat ulang halaman."
              : ""}
          </p>
          {izin !== "denied" ? (
            <button
              type="button"
              onClick={izinkan}
              disabled={mintaIzin}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-60"
            >
              <MapPin aria-hidden className="size-3.5" />
              {mintaIzin ? "Meminta izin…" : "Izinkan akses lokasi"}
            </button>
          ) : null}
        </div>
      )}

      <div
        className={
          hanyaKamera || ringkas
            ? "flex flex-wrap gap-1.5"
            : `grid gap-2 ${slotKetiga ? "grid-cols-3" : "grid-cols-2"}`
        }
      >
        <label className={hanyaKamera ? tombolTunggal : ubin}>
          <Camera
            aria-hidden
            className={hanyaKamera || ringkas ? "size-3.5 text-ink-muted" : "size-5 text-ink-muted"}
          />
          <span className={hanyaKamera || ringkas ? "" : "text-[13px] font-semibold"}>Kamera</span>
          {hanyaKamera || ringkas ? null : (
            <span className="text-[10px] leading-tight text-ink-muted">Ambil langsung</span>
          )}
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            name={rakitGagal ? n("photos") : undefined}
            className="sr-only"
            onChange={pickCamera}
          />
        </label>
        {hanyaKamera ? null : (
          <>
            <button type="button" className={ubin} onClick={() => setTanyaLokasi(true)}>
              <Images aria-hidden className={ringkas ? "size-3.5 text-ink-muted" : "size-5 text-ink-muted"} />
              <span className={ringkas ? "" : "text-[13px] font-semibold"}>Galeri</span>
              {ringkas ? null : (
                <span className="text-[10px] leading-tight text-ink-muted">Dari perangkat</span>
              )}
            </button>
            <input
              ref={galRef}
              type="file"
              accept="image/*"
              multiple
              name={rakitGagal ? n("photos") : undefined}
              className="sr-only"
              onChange={pickGallery}
            />
          </>
        )}
        {slotKetiga}
        {/* Input yang ikut terkirim; isinya dirakit dari state. Di jalur
            cadangan `name`-nya dilepas supaya tidak mengirim daftar kosong
            yang menimpa pilihan asli dari pemilih. */}
        <input
          ref={berkasRef}
          type="file"
          name={rakitGagal ? undefined : n("photos")}
          multiple
          className="sr-only"
          tabIndex={-1}
        />
      </div>

      {/* Konfirmasi sebelum memilih berkas galeri (DECISIONS 220), sebagai
          DIALOG — bukan kotak kecil di sela-sela form.

          Permintaan user 2026-08-02: "terlalu kecil … terlalu banyak penjelasan
          di situ, langsung saja button". Pertanyaan yang menentukan koordinat
          mana yang menempel di bukti tidak boleh terlihat sebagai catatan kaki,
          dan penjelasan panjang di atas dua tombol hanya membuat orang menekan
          yang pertama tanpa membaca. Pertanyaannya sengaja tentang KEADAAN
          NYATA pelapor, bukan teknis GPS — itu bisa dijawab mandor mana pun. */}
      {tanyaLokasi ? (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tanya-lokasi-judul"
        >
          <button
            type="button"
            aria-label="Batal"
            className="absolute inset-0 bg-ink/50"
            onClick={() => setTanyaLokasi(false)}
            tabIndex={-1}
          />
          <div className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-lg">
            <p id="tanya-lokasi-judul" className="text-center text-base font-semibold text-ink">
              Kamu sedang di lokasi proyek?
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                autoFocus
                onClick={() => jawabLokasi(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-base font-semibold text-white hover:bg-primary-800"
              >
                <MapPin aria-hidden className="size-5" /> Ya, saya di lokasi
              </button>
              <button
                type="button"
                onClick={() => jawabLokasi(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-base font-medium text-ink hover:bg-surface-muted"
              >
                <MapPinOff aria-hidden className="size-5" /> Tidak
              </button>
              {/* Jalur ketiga (user 2026-08-24): foto dipakai apa adanya —
                  cap TANPA tag koordinat & waktu, meski EXIF ada. */}
              <button
                type="button"
                onClick={() => {
                  setApaAdanya(true);
                  setDiLokasi(null);
                  setTanyaLokasi(false);
                  setSource("gallery");
                  clearGps();
                  galRef.current?.click();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium text-ink-muted hover:bg-surface-muted"
              >
                Gunakan apa adanya – tanpa tag koordinat & waktu
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hasil jawaban, disebut SESUDAH dijawab — bukan saklar yang bisa
          membatalkannya. Yang perlu diketahui pelapor cuma satu: koordinat mana
          yang akan menempel di fotonya. */}
      {source === "gallery" && apaAdanya ? (
        <p className="text-xs text-ink-muted">
          Foto galeri: dipakai apa adanya – cap tanpa tag koordinat & waktu.
        </p>
      ) : source === "gallery" && diLokasi !== null ? (
        <p className="text-xs text-ink-muted">
          {diLokasi
            ? "Foto galeri: GPS di foto dipakai lebih dulu; kalau tidak ada, posisimu sekarang."
            : "Foto galeri: GPS di foto dipakai lebih dulu; kalau tidak ada, dicap titik lokasi proyek dan ditandai bukan bukti GPS."}
        </p>
      ) : null}

      {pesanBatas ? <p className="text-xs text-warning">{pesanBatas}</p> : null}

      {/* Jalur cadangan disebut TERANG-TERANGAN. Pelapor yang terbiasa
          menumpuk pilihan harus tahu di perangkat ini caranya berbeda —
          kalau tidak, ia mengira foto pertamanya ikut padahal tidak. */}
      {rakitGagal ? (
        <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2">
          <p className="text-xs font-medium text-warning">
            Perangkat ini tidak bisa menggabungkan beberapa kali pemilihan foto
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Pilih SEMUA foto sekaligus dalam satu ketukan – yang terkirim hanya pemilihan terakhir.
            Unggahnya tetap jalan.
          </p>
          <p className="mt-1 text-[11px] break-words text-ink-muted">{rakitGagal}</p>
        </div>
      ) : null}

      {/*
       * PRATINJAU SELALU MUNCUL BEGITU FOTO DIPILIH — termasuk bentuk ringkas.
       *
       * Keluhan user 2026-09-03: *"kenapa aku nambah foto malah gak ada respon
       * sama sekali, apa ini sedang masalah?"* Ia sedang di baris material/alat,
       * dan di situ blok ini dulu dimatikan oleh `compact`.
       *
       * `compact` lahir untuk jalur AUTO-SUBMIT: di sana pratinjau memang
       * mubazir karena formnya langsung terkirim, jadi gambarnya cuma
       * berkelebat. Tapi baris material/alat memakai `compact` demi bentuknya
       * yang sempit, TANPA auto-submit — fotonya menunggu barisnya disimpan.
       * Akibatnya persis kebalikan dari maksudnya: satu-satunya tempat foto
       * benar-benar menunggu justru yang tidak memberi tanda apa pun bahwa ia
       * sudah terpilih. Orang mengetuk lagi, memilih lagi, lalu mengira
       * aplikasinya rusak.
       *
       * Jadi yang menentukan bukan lagi sempit atau tidaknya, melainkan apakah
       * pilihannya MENUNGGU: yang auto-submit tetap sunyi, sisanya bersuara.
       */}
      {(!compact || !onPicked) && berkas.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-ink-muted">
            {berkas.length} foto dipilih (maks {MAX_PHOTOS_PER_UPLOAD}).{" "}
            {rakitGagal
              ? "Ketuk lagi = mengganti pilihan, bukan menambah."
              : `Ketuk ${hanyaKamera ? "Kamera" : "Kamera/Galeri"} lagi untuk menambah.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {berkas.map((b, i) => (
              <div key={b.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal (objectURL) sebelum unggah */}
                <img src={b.url} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
                {/* Salah pilih harus bisa dibatalkan SATU-SATU. Tanpa ini,
                    satu foto keliru memaksa mengulang seluruh pemilihan. */}
                <button
                  type="button"
                  onClick={() => buang(i)}
                  aria-label={`Buang foto ${i + 1}`}
                  className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full border border-border bg-surface text-ink shadow-xs hover:bg-danger-soft hover:text-danger"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
