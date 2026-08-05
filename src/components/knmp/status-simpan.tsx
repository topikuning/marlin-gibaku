"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Check, CloudOff, Loader2, TriangleAlert, Wifi } from "lucide-react";

/**
 * STATUS PENYIMPANAN untuk editor laporan harian (PRD §8, fase 2 redesign).
 *
 * Penggunanya mandor di lapangan: satu tangan, layar di bawah matahari, sinyal
 * naik-turun. Editor ini menyimpan lewat belasan server action terpisah (satu
 * per item, per foto, per pelengkap), dan masing-masing hanya memberi umpan
 * balik di dalam formnya sendiri — sebuah banner kecil yang lewat begitu saja.
 * Dari luar, tidak pernah ada jawaban untuk pertanyaan yang paling menentukan
 * apakah orang berani menutup halaman: **apa yang saya ketik tadi sudah masuk
 * atau belum.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YANG SENGAJA TIDAK ADA DI SINI: "Belum tersinkron".
 *
 * Rancangan desain meminta lima keadaan, salah satunya antrean offline. MARLIN
 * TIDAK punya antrean itu — tidak ada service worker, tidak ada penyimpanan
 * lokal, tidak ada pengiriman ulang. Menampilkan "belum tersinkron" berarti
 * menjanjikan bahwa ketikan yang gagal terkirim masih tersimpan di suatu tempat
 * dan akan menyusul sendiri. Mandor yang percaya itu akan menutup halaman, dan
 * pekerjaan seharian benar-benar hilang.
 *
 * Jadi saat offline yang dikatakan adalah yang sebenarnya terjadi: perubahan
 * TIDAK tersimpan, dan halaman jangan ditutup. Lebih baik memberi kabar buruk
 * yang benar daripada kabar baik yang palsu.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Keadaan = {
  /** Berapa penyimpanan yang sedang berjalan. */
  berjalan: number;
  /** Waktu (ms epoch) penyimpanan terakhir yang BERHASIL. */
  terakhir: number | null;
  /** Pesan galat penyimpanan terakhir; dibersihkan begitu ada yang berhasil. */
  galat: string | null;
};

let keadaan: Keadaan = { berjalan: 0, terakhir: null, galat: null };
const pendengar = new Set<() => void>();

function umumkan() {
  for (const f of pendengar) f();
}

function ubah(next: Partial<Keadaan>) {
  keadaan = { ...keadaan, ...next };
  umumkan();
}

/**
 * Store MODUL, bukan React context.
 *
 * Alasannya bukan selera: dengan `useSyncExternalStore`, form pelapor tidak
 * pernah memanggil `setState` milik komponen lain dari dalam effect — pola yang
 * dilarang lint React Compiler dan memang rawan render bertingkat. Form cukup
 * memberi tahu store; yang berlangganan me-render ulang sendiri.
 */
function langganan(f: () => void) {
  pendengar.add(f);
  return () => {
    pendengar.delete(f);
  };
}

const potret = () => keadaan;
const potretServer = (): Keadaan => KEADAAN_AWAL;
const KEADAAN_AWAL: Keadaan = { berjalan: 0, terakhir: null, galat: null };

/** Status jaringan peramban. `true` di server supaya tidak ada kedipan "offline" saat hidrasi. */
function langgananJaringan(f: () => void) {
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  return () => {
    window.removeEventListener("online", f);
    window.removeEventListener("offline", f);
  };
}
const potretJaringan = () => navigator.onLine;
const potretJaringanServer = () => true;

export type HasilAksi = { error?: string; success?: string; warning?: string } | undefined;

/**
 * Dipanggil SETIAP form yang menyimpan sesuatu di editor laporan.
 *
 * `pending` dan `state` datang apa adanya dari `useActionState`, jadi
 * pemakaiannya satu baris dan tidak ada keadaan baru yang perlu dijaga
 * pemanggil.
 */
export function useLaporSimpan(pending: boolean, state: HasilAksi): void {
  useEffect(() => {
    if (!pending) return;
    ubah({ berjalan: keadaan.berjalan + 1 });
    return () => {
      ubah({ berjalan: Math.max(0, keadaan.berjalan - 1) });
    };
  }, [pending]);

  useEffect(() => {
    if (state?.error) ubah({ galat: state.error });
    else if (state?.success) ubah({ terakhir: Date.now(), galat: null });
  }, [state]);
}

function jam(ms: number): string {
  return new Date(ms).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Pita status. Ditempel di atas editor (`sticky`) supaya tetap terlihat saat
 * menggulir — keadaan penyimpanan yang harus dicari dengan menggulir ke atas
 * sama saja dengan tidak ada.
 */
export function StatusSimpan({ className = "" }: { className?: string }) {
  const s = useSyncExternalStore(langganan, potret, potretServer);
  const online = useSyncExternalStore(langgananJaringan, potretJaringan, potretJaringanServer);

  // Urutannya = urutan kegentingan. Offline menang atas segalanya: selama
  // jaringan mati, "Tersimpan 14:03" benar untuk masa lalu tetapi menyesatkan
  // untuk apa yang sedang diketik sekarang.
  const { ikon: Ikon, teks, rinci, kelas } = !online
    ? {
        ikon: CloudOff,
        teks: "Offline — perubahan TIDAK tersimpan",
        rinci: "Jangan tutup halaman. Ketikan baru hilang sampai sinyal kembali; tidak ada antrean yang mengirimnya nanti.",
        kelas: "border-danger-border bg-danger-soft text-danger",
      }
    : s.berjalan > 0
      ? {
          ikon: Loader2,
          teks: "Menyimpan…",
          rinci: null,
          kelas: "border-info-border bg-info-soft text-info",
        }
      : s.galat
        ? {
            ikon: TriangleAlert,
            teks: "Gagal menyimpan",
            rinci: s.galat,
            kelas: "border-warning-border bg-warning-soft text-warning",
          }
        : s.terakhir
          ? {
              ikon: Check,
              teks: `Tersimpan ${jam(s.terakhir)}`,
              rinci: null,
              kelas: "border-success-border bg-success-soft text-success",
            }
          : {
              ikon: Wifi,
              teks: "Online — belum ada perubahan",
              rinci: null,
              kelas: "border-border bg-surface-inset text-ink-muted",
            };

  return (
    <div
      // `role="status"` + aria-live: pembaca layar mengumumkan perpindahan
      // keadaan tanpa merebut fokus dari kolom yang sedang diisi.
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2.5 py-1.5 text-xs ${kelas} ${className}`}
    >
      <Ikon aria-hidden className={`size-3.5 shrink-0 ${s.berjalan > 0 && online ? "animate-spin" : ""}`} />
      <span className="font-medium">{teks}</span>
      {rinci ? <span className="min-w-0 basis-full opacity-90">{rinci}</span> : null}
    </div>
  );
}
