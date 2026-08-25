"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { GalatUnduh, klikBiasa, useUnduhBerkas } from "./unduh";

/**
 * SATU tombol berkas, isinya pilihan cara mengeluarkannya (DECISIONS 334).
 *
 * Keberatan user 2026-08-16: *"laporan 7 harian itu seharusnya satu tombol
 * nanti muncul 3 opsi, kirim wa, kirim google drive, download. itu lebih
 * ringkas. pola itu di tombol lain juga sepertinya lebih oke."*
 *
 * Benar, dan alasannya lebih dalam daripada kerapian: baris tombol yang lama
 * menyusun DUA sumbu jadi satu deret — **berkas apa** (PDF blanko, Excel,
 * berkas mingguan) dan **mau diapakan** (unduh, WhatsApp, Drive). Di sini
 * sumbunya dipisah: **judul tombol = berkasnya**, isi menu = tujuannya.
 *
 * Sengaja `<details>`, bukan popover buatan sendiri: Esc, klik di luar, fokus
 * papan ketik, dan pembaca layar sudah benar tanpa satu baris JS pun.
 *
 * ---
 *
 * ### DUA hal yang WAJIB dijaga di sini (DECISIONS 360)
 *
 * Keduanya laporan user 2026-08-18, dan yang kedua sudah pernah terjadi
 * sebelumnya:
 *
 * **1. Aksi yang sedang berjalan HARUS terlihat, dan tombolnya HARUS mati.**
 * Menu ini menutup dirinya begitu sebuah pilihan ditekan. Akibatnya penanda
 * `loading` pada pilihan itu tidak pernah terlihat oleh siapa pun — panelnya
 * sudah tidak ada. Dari kursi pemakai: klik "Kirim ke WhatsApp" → menu hilang →
 * layar diam beberapa detik → klik lagi → **pesan terkirim dua kali**. Bukan
 * kesalahan pemakai; tidak ada satu pun tanda bahwa yang pertama sedang jalan.
 *
 * Karena itu selama ada pilihan yang `loading`, SELURUH kendali diganti kepingan
 * "sedang mengirim…" yang tidak bisa diklik sama sekali — bukan sekadar
 * diredupkan, dan bukan hanya item di dalam menunya.
 *
 * **2. Yang paling sering dipakai cukup SATU klik.** Membuka menu lalu memilih
 * "Unduh PDF" berarti dua klik untuk hal yang dilakukan setiap hari. `utama`
 * membuat separuh kiri tombol langsung mengerjakannya; panah di kanan tetap
 * membuka sisanya.
 *
 * ---
 *
 * ### Kenapa keluhan yang sama datang lagi (DECISIONS 400)
 *
 * User 2026-08-21: *"aku sudah pernah komplain terkait klik whatsapp dan upload
 * ke drive, atau aksi apapun di sini, ketika diklik tidak memberikan tanda
 * apapun kalau sedang proses. tapi kenapa masih belum tersolusikan!"*
 *
 * Karena DECISIONS 360 hanya menutup SEPARUH pintu. Tipe lama menulis
 * `PilihanTautan = { loading?: never; labelSibuk?: never }` — artinya tautan
 * **dilarang oleh kompiler** punya keadaan sibuk. Itu bukan kelalaian yang
 * kelupaan diperbaiki; itu keyakinan yang saya tuliskan ke dalam tipe: "tautan
 * pasti cepat". Diukur di halaman Laporan Periodik: unduh PDF mingguan **4,1
 * detik**, dan selama itu layar sama sekali diam.
 *
 * Karena itu tautan sekarang WAJIB menyatakan `jenis`:
 *
 * - `"berkas"` — href menghasilkan PDF/Excel. Dijemput lewat `fetch` lalu
 *   diserahkan ke peramban sebagai unduhan, supaya penanda sibuknya mengikuti
 *   lamanya server bekerja SUNGGUHAN, bukan tebakan. Bonusnya: galat 403/500
 *   sekarang terbaca sebagai kalimat, bukan tab kosong berisi JSON.
 * - `"tab"` — href adalah HALAMAN (mis. versi cetak). Tab barunya sendiri yang
 *   jadi penanda; mengaku "sedang memuat" di halaman induk hanya mengarang.
 *
 * Kompiler yang menagih, bukan ingatan — sama seperti `PilihanAksi`.
 */

type Dasar = {
  label: string;
  icon?: ReactNode;
  /** Alasan pilihan ini mati — DITULIS, bukan sekadar diredupkan. */
  disabledReason?: string | null;
  /** Keterangan sebaris di bawah label; dipakai menjelaskan isi berkasnya. */
  hint?: string;
};

/**
 * Tautan yang menghasilkan BERKAS (PDF/Excel).
 *
 * `labelSibuk` wajib dengan alasan yang sama seperti pada {@link PilihanAksi}:
 * yang menagihnya harus kompiler. Berkas laporan dibangun di server — kurva-S,
 * foto, exceljs — dan itu memakan detik, bukan milidetik.
 */
export type PilihanUnduh = Dasar & {
  href: string;
  jenis: "berkas";
  /** Kata KERJA selagi berkasnya disiapkan: "Menyiapkan PDF…". */
  labelSibuk: string;
  /** Cadangan nama berkas bila server tidak mengirim `Content-Disposition`. */
  namaBerkas?: string;
  onSelect?: never;
  loading?: never;
};

/** Tautan ke HALAMAN yang dibuka di tab baru — tab itu sendiri penandanya. */
export type PilihanTautan = Dasar & {
  href: string;
  jenis: "tab";
  onSelect?: never;
  loading?: never;
  labelSibuk?: never;
};

/**
 * Pilihan yang MENJALANKAN sesuatu di server.
 *
 * `loading` dan `labelSibuk` **wajib**, dan itu disengaja: kiriman WhatsApp
 * ganda pada 2026-08-18 terjadi persis karena sebuah pilihan aksi bisa ada
 * tanpa penanda sibuk, dan tidak ada apa pun yang memaksa penulisnya
 * memasangkannya. Sekarang yang menolak adalah **kompilernya**, bukan ingatan
 * orang — satu-satunya penjaga yang tidak ikut lelah (DECISIONS 360).
 */
export type PilihanAksi = Dasar & {
  onSelect: () => void;
  href?: never;
  /** Biasanya `pending` dari `useActionState`. */
  loading: boolean;
  /** Kata KERJA yang menggantikan tombol selagi jalan: "Mengirim ke WhatsApp…". */
  labelSibuk: string;
};

export type PilihanBerkas = PilihanUnduh | PilihanTautan | PilihanAksi;

export function MenuBerkas({
  label,
  icon,
  pilihan,
  utama,
  variant = "secondary",
  className,
}: {
  /** Nama BERKASNYA, bukan tujuannya — mis. "7 Laporan Harian". */
  label: string;
  icon?: ReactNode;
  pilihan: PilihanBerkas[];
  /**
   * Aksi sekali-klik di badan tombol. Isi dengan yang paling sering dipakai —
   * biasanya "Unduh". Tetap ikut didaftar di `pilihan` supaya orang bisa
   * menemukannya tanpa menebak apa yang dilakukan badan tombol.
   */
  utama?: PilihanBerkas;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [terbuka, setTerbuka] = useState(false);

  // Klik di luar menutup menu. `<details>` tidak melakukannya sendiri.
  useEffect(() => {
    if (!terbuka) return;
    const luar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setTerbuka(false);
    };
    document.addEventListener("mousedown", luar);
    return () => document.removeEventListener("mousedown", luar);
  }, [terbuka]);

  /*
   * Panel menu tidak boleh MELEBARKAN HALAMAN (DECISIONS 352).
   *
   * Panelnya `absolute` tanpa jangkar horizontal, jadi ia selalu membuka ke
   * KANAN dari tepi kiri tombolnya. Tombol yang kebetulan duduk di paruh kanan
   * layar mendorong panel selebar 15rem melewati tepi kanan — dan karena tak
   * ada leluhur yang memotong, yang melebar adalah SELURUH halaman.
   *
   * Sisinya dipilih saat DIBUKA, bukan lewat CSS statis: `right-0` saja hanya
   * memindahkan masalahnya ke tombol yang duduk di dekat tepi kiri.
   */
  const [keKiri, setKeKiri] = useState(false);
  useEffect(() => {
    if (!terbuka) return;
    const panel = ref.current?.querySelector<HTMLElement>('[role="menu"]');
    if (!panel) return;
    // Diukur dengan jangkar dikembalikan ke kiri dulu, supaya keputusannya
    // tidak dipengaruhi hasil pengukuran sebelumnya.
    setKeKiri(false);
    requestAnimationFrame(() => {
      const r = panel.getBoundingClientRect();
      const muatDiKanan = r.right <= document.documentElement.clientWidth - 4;
      // Hanya dibalik kalau sisi seberangnya benar-benar lebih baik: pada layar
      // yang lebih sempit dari panelnya, membalik tidak menolong apa pun.
      if (!muatDiKanan && r.width <= document.documentElement.clientWidth - 8) setKeKiri(true);
    });
  }, [terbuka]);

  /*
   * Unduhan yang sedang disiapkan. Dipegang di sini, bukan di pemanggil: tautan
   * tidak punya `useActionState` yang bisa dititipi keadaan sibuk, dan menuntut
   * setiap pemanggil membuat state sendiri berarti mengulang cacat lamanya —
   * yang lupa, lupa diam-diam.
   */
  /*
   * Mesin unduhannya BERSAMA dengan `ButtonLink unduhan` (DECISIONS 401).
   * Disatukan supaya tidak ada dua perilaku unduhan yang bisa menyimpang —
   * dua kali keluhan yang sama lahir dari penanda yang dipasang per tempat.
   */
  const { sibuk: sedangUnduh, galat, bersihkanGalat, unduh } = useUnduhBerkas();
  const [labelUnduh, setLabelUnduh] = useState<string | null>(null);

  function jemputBerkas(p: PilihanUnduh) {
    setLabelUnduh(p.labelSibuk);
    void unduh(p.href, p.namaBerkas);
  }

  /*
   * Satu aksi yang sedang berjalan mematikan SELURUH kendali ini, bukan hanya
   * dirinya sendiri: "Kirim ke WhatsApp" dan "Upload ke Drive" pada berkas yang
   * sama tidak pernah dimaksudkan berjalan bersamaan, dan menyisakan satu pintu
   * terbuka hanya memindahkan kiriman gandanya ke pintu sebelah.
   *
   * Unduhan ikut menutup pintu dengan alasan yang sama: menekan "Unduh" tiga
   * kali karena layarnya diam berarti server membangun PDF yang sama tiga kali.
   */
  const sibuk: { labelSibuk: string } | null =
    (sedangUnduh && labelUnduh ? { labelSibuk: labelUnduh } : null) ??
    ([utama, ...pilihan].find((p) => p?.loading) as PilihanAksi | undefined) ??
    null;

  const kelasTombol = cn(
    "inline-flex h-9 items-center gap-1.5 border px-3 text-[13px] font-medium transition-colors",
    variant === "primary"
      ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
      : "border-border bg-surface text-ink hover:border-border-strong hover:bg-surface-muted",
  );

  if (sibuk) {
    return (
      <span
        // Halaman ini kadang menaruh beberapa menu bersebelahan; `role="status"`
        // membuat kepingan sibuknya diumumkan sebagai satu wilayah yang berdiri
        // sendiri, bukan potongan teks yang mengambang.
        role="status"
        aria-busy="true"
        // `aria-live` supaya perubahannya juga SAMPAI ke pembaca layar; tanpa
        // ini penanda sibuk hanya ada untuk yang melihat layar.
        aria-live="polite"
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface-muted px-3 text-[13px] font-medium text-ink-muted",
          className,
        )}
      >
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {sibuk.labelSibuk ?? "Memproses…"}
      </span>
    );
  }

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      {/*
        Galat unduhan dikatakan DI SINI, menempel pada tombolnya. Sebelumnya ia
        mendarat sebagai JSON di tab baru yang terbuka di belakang – dari kursi
        pemakai itu sama saja dengan "tidak terjadi apa-apa".
      */}
      {galat ? <GalatUnduh galat={galat} onTutup={bersihkanGalat} /> : null}

      {utama ? (
        <TombolUtama
          utama={utama}
          label={label}
          icon={icon}
          kelas={kelasTombol}
          onUnduh={jemputBerkas}
        />
      ) : null}

      {/* `static`: panel di dalamnya menjangkar ke pembungkus, supaya pada mode
          terpisah ia sejajar dengan SELURUH kendali, bukan cuma panahnya. */}
      <details
        open={terbuka}
        onToggle={(e) => setTerbuka((e.currentTarget as HTMLDetailsElement).open)}
        className="static"
      >
        <summary
          aria-haspopup="menu"
          aria-label={utama ? `Pilihan lain untuk ${label}` : undefined}
          className={cn(
            kelasTombol,
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            utama ? "rounded-r-md border-l-0 px-2" : "rounded-md",
          )}
        >
          {utama ? null : (
            <>
              {icon}
              {label}
            </>
          )}
          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", terbuka && "rotate-180")} />
        </summary>

        <div
          id={id}
          role="menu"
          className={cn(
            "absolute z-20 mt-1 min-w-60 rounded-md border border-border bg-surface p-1 shadow-lg",
            // Pagar terakhir: pada layar yang lebih sempit dari panelnya, tidak
            // ada sisi yang muat — jadi panelnya yang mengalah, bukan halamannya.
            "max-w-[calc(100vw-1.5rem)]",
            keKiri ? "right-0" : "left-0",
          )}
          style={{ top: "100%" }}
        >
          {pilihan.map((p) => (
            <ItemMenu
              key={p.label}
              p={p}
              onTutup={() => setTerbuka(false)}
              onUnduh={jemputBerkas}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

/** Badan tombol = aksi sekali-klik. */
function TombolUtama({
  utama,
  label,
  icon,
  kelas,
  onUnduh,
}: {
  utama: PilihanBerkas;
  label: string;
  icon?: ReactNode;
  kelas: string;
  onUnduh: (p: PilihanUnduh) => void;
}) {
  const isi = (
    <>
      {icon}
      {label}
    </>
  );
  const bentuk = cn(kelas, "rounded-l-md");

  if (utama.disabledReason) {
    // Syaratnya belum terpenuhi: badan tombol mati, tapi panahnya tetap hidup
    // supaya pilihan lain (dan alasan matinya) masih bisa dibaca.
    return (
      <span aria-disabled className={cn(bentuk, "cursor-not-allowed text-ink-faint")} title={utama.disabledReason}>
        {isi}
      </span>
    );
  }
  if (utama.href) {
    /*
     * Tetap `<a href>` walau berkasnya dijemput lewat fetch: klik-tengah,
     * "Buka di tab baru", dan "Simpan tautan sebagai" tetap bekerja seperti
     * yang orang harapkan dari sebuah tautan. Yang diambil alih hanya klik
     * biasa — supaya ada yang bisa mengatakan "sedang disiapkan".
     */
    const berkas = utama.jenis === "berkas";
    return (
      <a
        href={utama.href}
        target={berkas ? undefined : "_blank"}
        rel="noopener"
        className={bentuk}
        title={utama.label}
        onClick={
          berkas
            ? (e) => {
                if (!klikBiasa(e)) return;
                e.preventDefault();
                onUnduh(utama);
              }
            : undefined
        }
      >
        {isi}
      </a>
    );
  }
  return (
    <button type="button" onClick={utama.onSelect} className={bentuk} title={utama.label}>
      {isi}
    </button>
  );
}

function ItemMenu({
  p,
  onTutup,
  onUnduh,
}: {
  p: PilihanBerkas;
  onTutup: () => void;
  onUnduh: (p: PilihanUnduh) => void;
}) {
  const mati = !!p.disabledReason;
  const isi = (
    <>
      <span className="flex items-center gap-2">
        {p.icon}
        <span className="font-medium">{p.label}</span>
      </span>
      {/* Alasan mati DITULIS. "Redup tanpa keterangan" membuat orang mengira
          aplikasinya rusak, bukan syaratnya belum terpenuhi. */}
      {p.disabledReason ? (
        <span className="mt-0.5 block text-[11px] text-ink-faint">{p.disabledReason}</span>
      ) : p.hint ? (
        <span className="mt-0.5 block text-[11px] text-ink-muted">{p.hint}</span>
      ) : null}
    </>
  );
  const kelas = cn(
    "block w-full rounded px-2.5 py-1.5 text-start text-[13px]",
    mati ? "cursor-not-allowed text-ink-faint" : "text-ink hover:bg-surface-muted",
  );

  if (mati) {
    return (
      <span role="menuitem" aria-disabled className={kelas}>
        {isi}
      </span>
    );
  }
  if (p.href) {
    const berkas = p.jenis === "berkas";
    return (
      <a
        role="menuitem"
        href={p.href}
        target={berkas ? undefined : "_blank"}
        rel="noopener"
        onClick={(e) => {
          if (berkas && klikBiasa(e)) {
            e.preventDefault();
            onUnduh(p);
          }
          onTutup();
        }}
        className={kelas}
      >
        {isi}
      </a>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        p.onSelect?.();
        onTutup();
      }}
      className={kelas}
    >
      {isi}
    </button>
  );
}
