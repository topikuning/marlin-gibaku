import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  NAMA_HARI,
  bukaLangsung,
  geserBulan,
  judulBulan,
  type BatasBulan,
  type BulanKey,
  type SelKalender,
} from "@/lib/daily-report/kalender-harian";

/**
 * KALENDER satu bulan (DECISIONS 340). Server Component murni — seluruh
 * keadaannya ada di ALAMAT halaman, tidak ada `useState` sama sekali.
 *
 * Alasannya sama dengan saringan halaman ini sebelumnya (DECISIONS 279): hasil
 * yang sedang dilihat harus punya URL sendiri supaya bisa dikirim ke orang lain
 * lewat WhatsApp — cara kerja tim ini sehari-hari. "Buka Juni, lihat tanggal
 * 12" jauh lebih berguna dikirim sebagai tautan daripada sebagai instruksi.
 *
 * ### Warna TIDAK PERNAH sendirian
 *
 * Tiap sel membawa KATA statusnya. Lapangan memakai HP murah di bawah matahari,
 * dan buta warna merah-hijau ada pada ±8% laki-laki — aturan yang sudah
 * berlaku di `kkp-weekly-plan.tsx` dan strip 7 hari, diteruskan di sini.
 *
 * ### Saringan MEREDUPKAN, bukan menyembunyikan
 *
 * Menghapus sel dari kalender akan merusak barisnya — tanggal 20 akan pindah ke
 * kolom hari Selasa. Karena itu saringan hanya meredupkan yang tidak cocok, dan
 * jumlah yang diredupkan disebut di bawah kalender. Yang tidak menonjol tetap
 * bisa dilihat; yang hilang tidak.
 */

const NADA_SEL = {
  success: "border-success-border bg-success-soft",
  info: "border-info-border bg-info-soft",
  warning: "border-warning-border bg-warning-soft",
  danger: "border-danger-border bg-danger-soft",
  neutral: "border-border bg-surface",
} as const;

const NADA_TEKS = {
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-ink-muted",
} as const;

export type KalenderProps = {
  bulan: BulanKey;
  batas: BatasBulan;
  sel: SelKalender[];
  /** dateKey yang sedang dipilih panel samping. */
  terpilih: string | null;
  /** Sel yang lolos saringan; sisanya diredupkan. */
  disorot: (s: SelKalender) => boolean;
  /** Pembentuk URL — mempertahankan saringan & mode tampilan. */
  taut: (ubah: { bulan?: BulanKey; tgl?: string; panel?: boolean }) => string;
  /** URL FORMULIR harian satu tanggal — tujuan sel yang masih kosong. */
  tautIsi: (dateKey: string) => string;
};

export function Kalender({ bulan, batas, sel, terpilih, disorot, taut, tautIsi }: KalenderProps) {
  const mundur = bulan > batas.min ? geserBulan(bulan, -1) : null;
  const maju = bulan < batas.max ? geserBulan(bulan, 1) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <NavBulan arah="mundur" href={mundur ? taut({ bulan: mundur }) : null} />
        <div className="text-center">
          <p className="text-[15px] font-bold">{judulBulan(bulan)}</p>
          {/* Batas navigasi DISEBUT, bukan cuma tombol mati. Tombol mati tanpa
              keterangan terbaca sebagai kerusakan. */}
          <p className="text-[11px] text-ink-muted">
            Riwayat tersedia {judulBulan(batas.min)} – {judulBulan(batas.max)}
          </p>
        </div>
        <NavBulan arah="maju" href={maju ? taut({ bulan: maju }) : null} />
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-muted">
        {NAMA_HARI.map((h) => (
          <div key={h} className="py-1">
            {h}
          </div>
        ))}
      </div>

      {/* Ber-label supaya petak hari bisa dibedakan dari tautan lain yang juga
          membawa "?tgl=" — bilah saringan di atas ikut mempertahankan tanggal
          terpilih, dan pemilih yang tidak membedakannya akan mengira chip
          "Draft (2)" adalah sebuah tanggal. */}
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Petak tanggal">
        {sel.map((s) =>
          !s.bulanIni ? (
            // Hari titipan bulan tetangga: penanda posisi, bukan data. Sengaja
            // tidak bisa diklik — mengkliknya akan memindahkan bulan diam-diam.
            <div
              key={s.dateKey}
              aria-hidden
              className="min-h-16 rounded-lg border border-transparent p-1.5 text-[12px] text-ink-faint sm:min-h-20"
            >
              {s.tanggal}
            </div>
          ) : (
            <SelHariKalender
              key={s.dateKey}
              sel={s}
              terpilih={s.dateKey === terpilih}
              redup={!disorot(s)}
              /*
                `panel: true` HANYA di petak tanggal (DECISIONS 414): di layar
                sempit panel ringkasan jatuh ke bawah kalender, jadi mengetuk
                tanggal terlihat seperti tidak terjadi apa-apa. Nav bulan dan
                chip saringan sengaja tidak membawanya — mereka tidak sedang
                menanyakan satu tanggal.
              */
              href={bukaLangsung(s) ? tautIsi(s.dateKey) : taut({ tgl: s.dateKey, panel: true })}
            />
          ),
        )}
      </div>
    </div>
  );
}

function NavBulan({ arah, href }: { arah: "mundur" | "maju"; href: string | null }) {
  const Ikon = arah === "mundur" ? ChevronLeft : ChevronRight;
  const label = arah === "mundur" ? "Bulan sebelumnya" : "Bulan berikutnya";
  const kelas = "flex size-9 items-center justify-center rounded-lg border border-border";
  if (!href) {
    return (
      <span className={cn(kelas, "cursor-not-allowed text-ink-faint")} aria-hidden>
        <Ikon className="size-4" />
      </span>
    );
  }
  return (
    // Ganti bulan = kalender yang sama, isinya saja berganti — pembacanya
    // harus tetap menatap kalendernya (DECISIONS 433).
    <Link href={href} aria-label={label} scroll={false} className={cn(kelas, "text-ink hover:bg-surface-muted")}>
      <Ikon className="size-4" />
    </Link>
  );
}

function SelHariKalender({
  sel,
  terpilih,
  redup,
  href,
}: {
  sel: SelKalender;
  terpilih: boolean;
  redup: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      // 42 sel × prefetch = 42 permintaan hanya untuk membuka satu bulan.
      prefetch={false}
      /*
       * JANGAN loncat ke puncak halaman (DECISIONS 433).
       *
       * `<Link>` Next.js mengembalikan gulir ke atas setiap kali beralih —
       * termasuk saat alamatnya HALAMAN YANG SAMA dan hanya tanggalnya yang
       * berubah. Terukur: mengetuk petak di baris bawah kalender melempar
       * gulir dari 631px ke 0. Orang yang sedang menatap satu baris tanggal
       * kehilangan tempatnya, lalu harus menggulir turun lagi untuk melihat
       * akibat ketukannya sendiri.
       */
      scroll={false}
      aria-current={terpilih ? "date" : undefined}
      /* Menyebut AKIBATNYA, bukan cuma keadaannya: sel kosong membuka formulir
         langsung (DECISIONS 355), dan tujuan yang berbeda dari sel tetangganya
         harus bisa diketahui SEBELUM ditekan. */
      title={bukaLangsung(sel) ? `${sel.kata} – buat laporan` : sel.kata}
      className={cn(
        "relative flex min-h-16 flex-col justify-between rounded-lg border p-1.5 text-left transition sm:min-h-20",
        NADA_SEL[sel.nada],
        redup && "opacity-40",
        terpilih ? "ring-2 ring-primary ring-offset-1" : "hover:border-border-strong",
      )}
    >
      <span className="flex items-baseline justify-between gap-1">
        <span className={cn("text-[12px] font-bold", sel.hariIni && "text-primary")}>
          {sel.tanggal}
        </span>
        {sel.itemCount > 0 ? (
          <span className="tabular text-[10px] text-ink-muted">
            {sel.itemCount}
            <span className="max-sm:hidden"> item</span>
          </span>
        ) : null}
      </span>
      {sel.hariIni ? (
        <span className="text-[9px] font-bold text-primary uppercase">hari ini</span>
      ) : null}
      {/* KATA-nya, bukan warnanya. Di layar sempit dipendekkan — tetap KATA,
          bukan huruf tunggal atau titik: "·" untuk *di luar kontrak* dan
          *belum tiba* membuat dua fakta berbeda tampil identik. */}
      <span className={cn("text-[10px] leading-tight font-semibold", NADA_TEKS[sel.nada])}>
        <span className="max-sm:hidden">{sel.kata}</span>
        <span className="sm:hidden">{sel.singkat}</span>
      </span>
    </Link>
  );
}
