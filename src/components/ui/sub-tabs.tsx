import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * SUB-TAB di dalam satu halaman — pil, berbasis query URL (DECISIONS 362).
 *
 * Keluhan user 2026-08-18 tentang halaman Rencana & RAB: *"terlalu panjang
 * scroll ke bawah. bahkan ada pengguna yang bilang baru tau kalau ternyata ada
 * fitur rencana, karena terlalu ke bawah menunya."*
 *
 * Itu bukan keluhan estetika, melainkan **fitur yang hilang**. Tiga bagian yang
 * setara ditumpuk vertikal, dan yang pertama adalah pohon RAB berisi ratusan
 * item — jadi dua bagian di bawahnya praktis tidak pernah terlihat oleh siapa
 * pun yang tidak tahu bahwa mereka ada. Menumpuk hanya adil kalau yang di atas
 * pendek.
 *
 * ### Kenapa URL, bukan `useState`
 *
 * Tab yang disimpan di state hilang setiap kali halaman dimuat ulang, tidak
 * bisa dikirim ke orang lain ("buka rencana minggu 5"), dan membuat tombol
 * Kembali peramban melompati halaman alih-alih kembali ke tab sebelumnya.
 * Berbasis URL, ketiganya benar tanpa satu baris JS pun — komponen ini server
 * component, jadi tidak menambah payload klien sama sekali.
 *
 * ### Beda dengan `LinkTabs`
 *
 * `LinkTabs` menandai tab aktif dari PATHNAME dan melekat di atas sebagai
 * navigasi utama lokasi. Sub-tab hidup DI DALAM satu halaman, dibedakan oleh
 * query, dan sengaja TIDAK melekat: dua bilah melekat bertumpuk memakan
 * sepertiga layar ponsel sebelum isinya mulai.
 */

export type SubTabItem = {
  /** Nilai query-nya — sekaligus kunci React. */
  key: string;
  label: string;
  /**
   * Label untuk layar sempit. Tiga pil berlabel penuh tidak muat di 375px, dan
   * yang terakhir terpotong di tepi kanan — pil yang separuh terlihat adalah
   * persis cara sebuah bagian berhenti ditemukan orang. Barisnya memang bisa
   * digeser, tapi menggeser hanya dilakukan orang yang sudah tahu ada sesuatu
   * di sana.
   */
  labelPendek?: string;
  href: string;
  /**
   * Angka/penanda kecil di kanan label, mis. jumlah draft yang menunggu.
   * Dipakai supaya hal yang perlu dikerjakan terlihat TANPA membuka tabnya.
   */
  badge?: string | number;
};

export function SubTabs({
  items,
  active,
  label = "Bagian",
  className,
}: {
  items: SubTabItem[];
  /** `key` yang sedang aktif. */
  active: string;
  /** Nama grup untuk pembaca layar — mis. "Bagian Rencana & RAB". */
  label?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn("flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2", className)}
    >
      {items.map((it) => {
        const aktif = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={aktif ? "page" : undefined}
            /* Nama yang dibacakan SELALU lengkap, apa pun lebar layarnya:
               label pendek hanya untuk mata. Tanpa ini, di ponsel yang
               terbaca cuma "Rencana" — dan pada lebar besar dua span-nya
               terbaca dua kali. */
            aria-label={it.badge != null ? `${it.label} (${it.badge})` : it.label}
            className={cn(
              // Padding & ukuran huruf mengecil di layar sempit. EMPAT pil
              // berlabel pendek pun masih meleset dari 375px pada ukuran penuh
              // — dan 375px adalah lebar ponsel yang benar-benar dipakai di
              // lapangan, bukan kasus tepi.
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-[13px]",
              aktif
                ? "border-primary-600 bg-primary-600 text-white"
                : "border-border bg-surface text-ink-muted hover:border-border-strong hover:bg-surface-muted",
            )}
          >
            {it.labelPendek ? (
              <>
                {/* Dua span, bukan satu yang dipotong CSS: pembaca layar dan
                    pencarian teks peramban tetap menemukan nama lengkapnya. */}
                <span className="sm:hidden">{it.labelPendek}</span>
                <span className="max-sm:hidden">{it.label}</span>
              </>
            ) : (
              it.label
            )}
            {it.badge != null ? (
              <span
                className={cn(
                  "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  aktif ? "bg-white/25 text-white" : "bg-warning-soft text-warning",
                )}
              >
                {it.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
