"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AlertTriangle, Check, ExternalLink, FileText, Loader2, Send, Upload, X } from "lucide-react";
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
 * Teguran user 2026-08-06 (putaran kedua):
 *
 *   *"mana tombol uploadnya? lalu buat apa unduh csv? filter laporan belum dan
 *   sudah/final saja kenapa harus ketik2 manual. buat yang simple"*
 *
 * Ketiganya benar, dan ketiganya kesalahanku:
 *
 * 1. **Tombolnya tidak terbaca sebagai tombol.** Aku memakai ikon 16px polos —
 *    bentuk yang PERSIS sama dengan kolom "Folder" dan "Grup" yang justru mati.
 *    Kalau yang bisa diketuk dan yang tidak digambar sama, tak ada yang bisa
 *    menebak mana yang mana. Sekarang aksinya bertuliskan kata kerjanya sendiri
 *    — **Unggah** / **Kirim** — berkotak dan berwarna.
 * 2. **Kolom prasyarat dilebur.** "Folder" dan "Grup" tidak pernah bisa
 *    ditindak; ia cuma alasan kenapa unggahan mustahil. Alasan itu kini tampil
 *    DI TOMBOLNYA ("Tanpa folder"), jadi dua kolom hilang tanpa satu pun
 *    informasi hilang.
 * 3. **Unduh CSV dibuang.** Papan ini dipakai untuk MENINDAK hari ini, bukan
 *    untuk diarsipkan; berkas ekspor yang tak pernah dibuka cuma menambah
 *    tombol yang harus dilewati mata.
 *
 * Menyaring BUKAN urusan komponen ini. Bilah saring (`bilah-saring.tsx`)
 * dikembalikan sesudah teguran *"kamu di awal sudah benar... kenapa malah
 * berubah semua"* — saringannya di alamat halaman, jadi hasilnya bisa dikirim
 * ke orang lain lewat WA. Grid di sini cuma menampilkan apa yang diberikan.
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
   * terlihat dari tombolnya sendiri yang berubah sesudah `router.refresh()`.
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
        // Saringnya sudah jadi chip di atas grid — menu saring per kolom cuma
        // cara KEDUA untuk hal yang sama, dan dua cara berarti dua tempat untuk
        // salah paham.
        filter: false,
        valueFormatter: (p) =>
          p.value === "belum"
            ? "Belum lapor"
            : REPORT_STATUS_LABEL[p.value as keyof typeof REPORT_STATUS_LABEL],
      },
      { field: "item", headerName: "Item", type: "numericColumn", width: 84, filter: false },
      { field: "foto", headerName: "Foto", type: "numericColumn", width: 84, filter: false },
      { field: "kegiatan", headerName: "Keg.", type: "numericColumn", width: 84, filter: false },
      {
        field: "diDrive",
        headerName: "Drive",
        width: 124,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => {
          const d = p.data;
          if (!d) return null;
          const halangan = !d.punyaFolderDrive
            ? "Tanpa folder"
            : !d.adaIsi
              ? "Kosong"
              : null;
          return (
            <TombolAksi
              keadaan={d.diDrive === "Sudah" ? "ya" : d.diDrive === "Gagal" ? "gagal" : "tidak"}
              halangan={halangan}
              sibuk={sibuk === `${d.slug}-drive`}
              ikon={Upload}
              label={d.diDrive === "Sudah" ? "Sudah" : d.diDrive === "Gagal" ? "Ulangi" : "Unggah"}
              judul={
                halangan === "Tanpa folder"
                  ? "Paket belum punya folder Google Drive — tidak bisa diunggah"
                  : halangan === "Kosong"
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
        field: "waTerkirim",
        headerName: "WhatsApp",
        width: 116,
        filter: false,
        cellRenderer: (p: ICellRendererParams<BarisTabel>) => {
          const d = p.data;
          if (!d) return null;
          const halangan = !d.punyaGrupWa ? "Tanpa grup" : !d.adaIsi ? "Kosong" : null;
          return (
            <TombolAksi
              keadaan={d.waTerkirim ? "ya" : "tidak"}
              belumNada="info"
              halangan={halangan}
              sibuk={sibuk === `${d.slug}-wa`}
              ikon={Send}
              label={d.waTerkirim ? "Sudah" : "Kirim"}
              judul={
                halangan === "Tanpa grup"
                  ? "Paket belum punya grup WhatsApp — tidak bisa dikirim"
                  : halangan === "Kosong"
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
        pageSize={50}
        persistKey="status-harian"
        getRowId={(d) => d.slug}
        emptyText="Tidak ada lokasi yang cocok dengan saringan ini."
        className="min-w-0"
      />
    </div>
  );
}

/**
 * TOMBOL AKSI YANG BERTULISKAN KATA KERJANYA.
 *
 * Teguran user 2026-08-06: *"mana tombol uploadnya?"* — pertanyaan yang tidak
 * mungkin muncul kalau tombolnya kelihatan. Sebelumnya aksinya cuma ikon 16px
 * tanpa kotak, seukuran dan sebentuk dengan tanda status yang justru MATI di
 * kolom sebelahnya. Tidak ada yang bisa menebak mana yang bisa diketuk.
 *
 * Sekarang: berkotak, berwarna sesuai keadaan, dan **bertuliskan apa yang akan
 * terjadi** — "Unggah", "Kirim", "Ulangi". Yang sudah beres tetap bisa diketuk
 * (unggah/kirim ulang) tapi bernada tenang, supaya mata langsung jatuh ke yang
 * merah.
 *
 * Yang terhalang (paket belum punya folder/grup, atau memang tidak ada isinya)
 * BUKAN tombol — ia teks mati bersilang merah yang menyebut halangannya, karena
 * tombol yang menjanjikan lalu gagal lebih buruk daripada tidak ada tombol.
 */
function TombolAksi({
  keadaan,
  belumNada = "danger",
  halangan,
  sibuk,
  ikon: Ikon,
  label,
  judul,
  onClick,
}: {
  keadaan: "ya" | "tidak" | "gagal";
  /**
   * Nada saat BELUM dikerjakan.
   *
   * Merah dipakai untuk yang memang tertinggal — berkas belum ada di Drive
   * berarti bukti hari itu belum terarsip, dan itu memang perlu dikejar.
   * "Kirim ke WA" beda: mengirim ke grup PPK adalah keputusan sadar yang boleh
   * saja belum diambil (laporannya belum final, misalnya), bukan kelalaian.
   * Mewarnainya merah menuduh sesuatu yang belum tentu salah — permintaan user
   * 2026-08-07: *"untuk button kirim sharusnya bukan merah, tapi biru"*.
   */
  belumNada?: "danger" | "info";
  halangan: string | null;
  sibuk: boolean;
  ikon: typeof Upload;
  label: string;
  judul: string;
  onClick: () => void;
}) {
  if (halangan) {
    return (
      <span
        title={judul}
        className="inline-flex items-center gap-1 text-[12px] text-danger opacity-70"
      >
        <X aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
        {halangan}
      </span>
    );
  }

  const nada =
    keadaan === "ya"
      ? "border-success-border bg-success-soft text-success"
      : keadaan === "gagal"
        ? "border-warning-border bg-warning-soft text-warning"
        : belumNada === "info"
          ? "border-info-border bg-info-soft text-info"
          : "border-danger-border bg-danger-soft text-danger";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sibuk}
      title={judul}
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 ${nada}`}
    >
      {sibuk ? (
        <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />
      ) : keadaan === "ya" ? (
        <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
      ) : keadaan === "gagal" ? (
        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <Ikon aria-hidden className="size-3.5 shrink-0" />
      )}
      {label}
      <span className="sr-only"> — {judul}</span>
    </button>
  );
}
