import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter-var-latin.woff2",
  display: "swap",
  variable: "--font-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "MARLIN – Pengendalian Proyek KNMP",
    template: "%s · MARLIN",
  },
  description: "Sistem pengendalian proyek Kampung Nelayan Merah Putih",
};

export const viewport: Viewport = {
  themeColor: "#1E3A8A",
  width: "device-width",
  initialScale: 1,
};

/**
 * Penangkap `beforeinstallprompt` PALING AWAL (DECISIONS 405).
 *
 * Chrome menembakkan event ini segera sesudah halaman dimuat dan syarat
 * pasangnya terpenuhi — bisa SEBELUM React sempat memasang pendengarnya. Event
 * yang lewat tidak bisa diminta ulang: ia tidak akan datang lagi sampai halaman
 * dimuat berikutnya, dan tombol "Pasang" tidak akan pernah muncul di kunjungan
 * itu.
 *
 * Karena itu skrip kecil ini berjalan lebih dulu, menahan event-nya, dan
 * menyimpannya di `window`. Komponen React mengambilnya dari situ — plus tetap
 * mendengarkan sendiri untuk event yang datang belakangan.
 *
 * Ditulis inline dan bukan sebagai modul: berkas terpisah dimuat setelah HTML
 * diurai, yaitu justru sesudah jendela yang mau ditangkap.
 */
const TANGKAP_PASANG = `(function(){
  window.__marlinPasang = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__marlinPasang = e;
    window.dispatchEvent(new Event('marlin:pasang-siap'));
  });
  window.addEventListener('appinstalled', function () {
    window.__marlinPasang = null;
    window.dispatchEvent(new Event('marlin:terpasang'));
  });
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TANGKAP_PASANG }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
