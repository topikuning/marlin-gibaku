"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AlertTriangle, Check, ExternalLink, FileText, Loader2, X } from "lucide-react";
import { Banner } from "@/components/ui";
import { MarlinGrid } from "@/components/grid/marlin-grid";
import { uploadDailyReportToDriveAction } from "@/lib/gdrive/actions";
import { sendDailyRingkasToWaAction } from "@/lib/waha/actions";
import type { StatusHarianRow } from "@/lib/daily-report/status-harian";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { barisTabel, type BarisTabel } from "@/lib/daily-report/status-harian-tabel";

/**
 * PAPAN STATUS HARIAN SEBAGAI GRID.
 *
 * Teguran user 2026-08-06:
 *
 *   *"status laporan harianmu sungguh tidak nyaman, kenapa tidak kamu model
 *   grid saja, yang per kolomnya tombol. tidak perlu keterangan panjang, kalau
 *   memang belum punya folder drive, kasih aja seperti tombol atau symbol X
 *   warna merah... lalu tiap kolom sortable... kamu ini terlalu rumit!"*
 *
 * Benar, dan tegurannya mengenai dua kesalahan sekaligus:
 *
 * 1. **Bentuknya salah.** Ini data tabular: 83 baris dengan kolom yang sama
 *    persis. Daftar kartu memaksa mata memindai kalimat untuk membandingkan
 *    dua lokasi, padahal yang ditanyakan cuma "mana yang sudah, mana yang
 *    belum". Aturan repo pun sudah menyebutnya: tabel data → `MarlinGrid`.
 * 2. **Saringannya buatan sendiri.** Aku membangun bilah saring dengan chip &
 *    Combobox, padahal AG Grid sudah memberi sortir + saring PER KOLOM gratis.
 *    Menyortir kolom "Folder Drive" langsung mengelompokkan yang punya dan yang
 *    tidak; kombinasi "punya folder TAPI belum naik" tinggal dua kali klik —
 *    tanpa satu baris kode saringan pun.
 *
 * Kalimat prasyarat yang panjang ("Paket belum punya folder Drive") diganti
 * **tanda**: centang hijau atau silang merah, dengan kalimat lengkapnya pindah
 * ke `title` supaya tetap bisa dibaca saat dibutuhkan tanpa memakan kolom.
 */

type Props = { rows: StatusHarianRow[]; dateKey: string };

type Pesan = { tone: "success" | "error" | "warning"; teks: string } | null;

export function TabelStatus({ rows, dateKey }: Props) {
  const router = useRouter();
  const [pesan, setPesan] = useState<Pesan>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [, mulai] = useTransition();

  const data = useMemo(() => rows.map(barisTabel), [rows]);

  /**
   * Aksi dijalankan imperatif, bukan lewat `useActionState` per baris.
   *
   * Di dalam sel grid, hasil per baris tidak punya tempat untuk ditampilkan —
   * dan menaruh spanduk di dalam sel akan merusak tinggi barisnya. Jadi
   * hasilnya diangkat ke SATU spanduk di atas grid, sementara keberhasilannya
   * terlihat dari tandanya sendiri yang berubah sesudah `router.refresh()`.
   */
  const jalankan = useCallback(
    (
      kunci: string,
      aksi: (prev: undefined, fd: FormData) => Promise<{ error?: string; success?: string; warning?: string } | undefined>,
      slug: string,
    ) => {
      setSibuk(kunci);
      setPesan(null);
      mulai(async () => {
        const fd = new FormData();
        fd.set("slug", slug);
        fd.set("dateKey", dateKey);
        const hasil = await aksi(undefined, fd);
        setSibuk(null);
        if (hasil?.error) setPesan({ tone: "error", teks: hasil.error });
        else if (hasil?.warning) setPesan({ tone: "warning", teks: hasil.warning });
        else if (hasil?.success) setPesan({ tone: "success", teks: hasil.success });
        router.refresh();
      });
    },
    [dateKey, router],
  );

  const columnDefs = useMemo<ColDef<BarisTabel>[]>(
    () => [
      {
        field: "lokasi",
        headerName: "Lokasi",
        // Kolom ini yang MENYERAP sisa lebar: di layar lebar tabelnya pas
        // tanpa geser; di ponsel ia menyusut ke minWidth dan gridnya bergeser
        // DI DALAM kontainernya sendiri (DECISIONS 010), bukan melebarkan
        // halaman. Nama paket dibuang atas permintaan user 2026-08-06 ("gak
        // penting itu nama paket!") — yang dicari di papan ini adalah LOKASI.
        minWidth: 150,
        flex: 1,
        pinned: "left",
        cellRenderer: (p: ICellRendererParams<BarisTabel>) =>
          p.data ? (
            <a
              href={`/lokasi/${p.data.slug}/harian/${dateKey}`}
              className="font-medium text-primary hover:underline"
            >
              {p.data.lokasi}
            </a>
          ) : null,
      },
      { field: "kabupaten", headerName: "Kab.", width: 96 },
      {
        field: "status",
        // "Laporan", bukan "Status" — dan nilainya "Belum lapor", bukan
        // "Belum ada". Teguran user 2026-08-06: *"status, belum ada, apanya
        // yang belum ada"*. Betul: di kolom bernama "Status", kata "Belum ada"
        // tidak menyebut APA yang belum ada.
        headerName: "Laporan",
        width: 110,
        valueFormatter: (p) =>
          p.value === "belum"
            ? "Belum lapor"
            : REPORT_STATUS_LABEL[p.value as keyof typeof REPORT_STATUS_LABEL],
      },
      { field: "item", headerName: "Item", type: "numericColumn", width: 84, filter: false },
      { field: "foto", headerName: "Foto", type: "numericColumn", width: 84, filter: false },
      { field: "kegiatan", headerName: "Keg.", type: "numericColumn", width: 84, filter: false },
      {
        field: "punyaFolderDrive",
        headerName: "Folder",
        width: 92,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => (
          <TombolTanda
            keadaan={p.value === true ? "ya" : "tidak"}
            bisa={false}
            sibuk={false}
            judul={
              p.value === true
                ? "Paket punya folder Google Drive"
                : "Paket BELUM punya folder Google Drive — unggahan tidak akan berhasil"
            }
            onClick={() => {}}
          />
        ),
      },
      {
        field: "diDrive",
        headerName: "Drive",
        width: 92,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <TombolTanda
              keadaan={d.diDrive === "Sudah" ? "ya" : d.diDrive === "Gagal" ? "gagal" : "tidak"}
              bisa={d.punyaFolderDrive && d.adaIsi}
              sibuk={sibuk === `${d.slug}-drive`}
              judul={
                !d.punyaFolderDrive
                  ? "Paket belum punya folder Drive — tidak bisa diunggah"
                  : !d.adaIsi
                    ? "Belum ada isi yang bisa diunggah"
                    : d.diDrive === "Sudah"
                      ? `${d.driveKeterangan} · klik untuk unggah ulang`
                      : d.diDrive === "Gagal"
                        ? `${d.driveKeterangan} · klik untuk coba lagi`
                        : "Belum diunggah · klik untuk unggah ke Drive"
              }
              onClick={() => jalankan(`${d.slug}-drive`, uploadDailyReportToDriveAction, d.slug)}
            />
          );
        },
      },
      {
        field: "punyaGrupWa",
        headerName: "Grup",
        width: 84,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => (
          <TombolTanda
            keadaan={p.value === true ? "ya" : "tidak"}
            bisa={false}
            sibuk={false}
            judul={
              p.value === true
                ? "Paket punya grup WhatsApp"
                : "Paket BELUM punya grup WhatsApp — pengiriman tidak akan berhasil"
            }
            onClick={() => {}}
          />
        ),
      },
      {
        field: "waTerkirim",
        headerName: "WA",
        width: 72,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <TombolTanda
              keadaan={d.waTerkirim ? "ya" : "tidak"}
              bisa={d.punyaGrupWa && d.adaIsi}
              sibuk={sibuk === `${d.slug}-wa`}
              judul={
                !d.punyaGrupWa
                  ? "Paket belum punya grup WA — tidak bisa dikirim"
                  : !d.adaIsi
                    ? "Belum ada yang bisa dikirim"
                    : d.waTerkirim
                      ? `${d.waKeterangan} · klik untuk kirim ulang`
                      : "Belum dikirim · klik untuk kirim ke grup WA"
              }
              onClick={() => {
                // Kiriman ke grup PPK TIDAK bisa ditarik kembali — konfirmasi
                // wajib, dan kalimatnya menyebut status laporannya supaya
                // mengirim draf ke pejabat adalah pilihan sadar.
                const status = d.status === "belum" ? null : REPORT_STATUS_LABEL[d.status];
                const peringatan =
                  d.status === "final"
                    ? ""
                    : status
                      ? `\n\nLaporan ini berstatus "${status}" — belum dikunci, dan status itu ikut tercetak di PDF.`
                      : "\n\nBelum ada laporan harian untuk tanggal ini; yang terkirim hanya kegiatan lapangan dan fotonya.";
                const ulang = d.waTerkirim ? "\n\nRingkasan tanggal ini SUDAH pernah dikirim." : "";
                if (
                  !window.confirm(
                    `Kirim ringkasan ${d.lokasi} ke grup WhatsApp?\n\nPesan dan PDF langsung masuk ke grup paket (PPK, dinas, pejabat) dan tidak bisa ditarik kembali.${peringatan}${ulang}`,
                  )
                )
                  return;
                jalankan(`${d.slug}-wa`, sendDailyRingkasToWaAction, d.slug);
              }}
            />
          );
        },
      },
      {
        colId: "aksi",
        headerName: "Buka",
        width: 84,
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <span className="flex items-center gap-1">
              {/* `<a>` biasa, BUKAN next/link: alamat ini membangkitkan PDF,
                  dan prefetch akan memicunya diam-diam (DECISIONS 276). */}
              <a
                href={`/api/laporan/harian/${d.slug}/${dateKey}/ringkas`}
                target="_blank"
                rel="noopener"
                title="Buka Ringkasan PDF"
                className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <FileText aria-hidden className="size-4" />
                <span className="sr-only">Ringkasan PDF</span>
              </a>
              {d.driveWebLink ? (
                <a
                  href={d.driveWebLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Buka berkas di Google Drive"
                  className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <ExternalLink aria-hidden className="size-4" />
                  <span className="sr-only">Buka Drive</span>
                </a>
              ) : null}
            </span>
          );
        },
      },
    ],
    [dateKey, jalankan, sibuk],
  );

  return (
    <div className="space-y-2">
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}
      <MarlinGrid<BarisTabel>
        rowData={data}
        columnDefs={columnDefs}
        quickFilter
        csvExport
        pageSize={50}
        persistKey="status-harian"
        getRowId={(d) => d.slug}
        emptyText="Tidak ada lokasi aktif untuk tanggal ini."
      />
    </div>
  );
}

/**
 * TANDA YANG SEKALIGUS TOMBOL.
 *
 * Teguran user 2026-08-06: *"lalu mana tombol untuk kirim ke wa, drive, dsb?!
 * kolom itu ya otomatis juga jadi ada button"*.
 *
 * Benar — dan usulnya lebih baik daripada rancanganku. Tombolnya tadinya ada,
 * tapi ditumpuk di kolom "Aksi" paling kanan yang justru tergeser dari
 * pandangan. Sekarang TANDANYA SENDIRI yang jadi tombol: silang merah di kolom
 * "Di Drive" bukan cuma memberi tahu belum naik, ia juga yang menaikkannya.
 * Satu kolom menjawab DAN mengerjakan, jadi tidak ada lagi kolom terpisah yang
 * harus dicari.
 *
 * Yang tidak bisa ditindak (paket belum punya folder/grup, atau memang tidak
 * ada isinya) tetap menampilkan tandanya, tapi sebagai teks mati — bukan tombol
 * yang menjanjikan sesuatu lalu gagal. Sebabnya ada di `title`.
 */
function TombolTanda({
  keadaan,
  bisa,
  sibuk,
  judul,
  onClick,
}: {
  keadaan: "ya" | "tidak" | "gagal";
  bisa: boolean;
  sibuk: boolean;
  judul: string;
  onClick: () => void;
}) {
  const isi = sibuk ? (
    <Loader2 aria-hidden className="size-4 animate-spin" />
  ) : keadaan === "ya" ? (
    <Check aria-hidden className="size-4" strokeWidth={3} />
  ) : keadaan === "gagal" ? (
    <AlertTriangle aria-hidden className="size-4" />
  ) : (
    <X aria-hidden className="size-4" strokeWidth={3} />
  );
  const warna =
    keadaan === "ya" ? "text-success" : keadaan === "gagal" ? "text-warning" : "text-danger";
  const label = keadaan === "ya" ? "Sudah" : keadaan === "gagal" ? "Gagal" : "Belum";

  if (!bisa) {
    return (
      <span title={judul} className={`inline-flex items-center opacity-50 ${warna}`}>
        {isi}
        <span className="sr-only">{label} — tidak bisa ditindak</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sibuk}
      title={judul}
      className={`inline-flex items-center rounded p-1 transition-colors hover:bg-surface-muted ${warna}`}
    >
      {isi}
      <span className="sr-only">{judul}</span>
    </button>
  );
}
