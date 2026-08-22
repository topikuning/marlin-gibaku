"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PanelGeser } from "@/components/ui";

/**
 * RINGKASAN SATU TANGGAL: panel samping di layar lebar, POP-UP di layar sempit
 * (DECISIONS 414).
 *
 * Keluhan user 2026-08-22: *"ketika tampilan pas lebar kalender saja, sidebarmu
 * akan berada di bawah, mengakibatkan saat tanggal diklik seakan-akan tidak
 * terjadi apa-apa."*
 *
 * Tepat, dan sebabnya tata letak: panelnya `lg:grid-cols-[1fr_320px]`, jadi di
 * bawah `lg` ia jatuh KE BAWAH kalender — di luar layar. Mengetuk tanggal tetap
 * bekerja (URL berubah, panelnya terisi), tapi hasilnya ada di tempat yang tidak
 * dilihat siapa pun. Dari kursi pemakai itu tidak bisa dibedakan dari tombol
 * yang rusak, dan yang dilakukan orang berikutnya adalah mengetuk lagi.
 *
 * ### Kenapa bukan pop-up di SEMUA lebar
 *
 * Di ≥lg panelnya duduk bersebelahan dengan kalender dan ikut terlihat setiap
 * kali tanggal diketuk — tidak ada yang perlu diperbaiki. Menggantinya dengan
 * pop-up justru menutupi kalender yang barusan dibaca, dan menambah satu ketukan
 * untuk menutupnya. Yang diperbaiki hanya lebar yang memang rusak.
 *
 * ### Kenapa lewat URL, bukan state klik
 *
 * Isi panel (jumlah item, foto, kendala, cap waktu simpan) dirender SERVER untuk
 * tanggal terpilih. Membukanya dari state klik berarti panel terbuka lebih dulu
 * lalu isinya menyusul — atau semua tanggal harus diambil datanya di muka. URL
 * `?panel=1` membuat panel terbuka bersama isi yang sudah benar, dan tautannya
 * bisa dibagikan apa adanya.
 */
export function PanelHari({
  bukaPanel,
  judul,
  children,
}: {
  /** URL meminta panel terbuka (`?panel=1`). */
  bukaPanel: boolean;
  /** Judul dialog – tanggal yang sedang dibuka. */
  judul: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /*
   * Pop-upnya dipasang hanya pada lebar yang memakainya — DIUKUR, bukan
   * disembunyikan CSS.
   *
   * `lg:hidden` pada pembungkus akan tetap MENJALANKAN efek `PanelGeser`,
   * termasuk mengunci gulir halaman. Akibatnya di desktop, alamat ber-`?panel=1`
   * akan membuat halaman tidak bisa digulir sementara tidak ada panel yang
   * terlihat — persis jenis cacat yang tidak bersuara.
   */
  const [sempit, setSempit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 63.999rem)");
    const ikut = () => setSempit(mq.matches);
    const t = window.setTimeout(ikut, 0);
    mq.addEventListener("change", ikut);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", ikut);
    };
  }, []);

  const tutup = () => {
    const q = new URLSearchParams(params.toString());
    q.delete("panel");
    const qs = q.toString();
    // `scroll: false`: menutup panel tidak boleh melempar orang ke pucuk
    // halaman – ia baru saja melihat petak tanggal tertentu.
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <>
      {/* Layar lebar: panel samping seperti sebelumnya, tidak diubah. */}
      <div className="hidden lg:block">{children}</div>

      {sempit ? (
        <PanelGeser terbuka={bukaPanel} onTutup={tutup} title={judul}>
          {children}
        </PanelGeser>
      ) : null}
    </>
  );
}
