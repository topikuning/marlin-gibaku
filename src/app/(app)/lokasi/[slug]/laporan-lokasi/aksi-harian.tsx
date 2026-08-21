"use client";

import {
  Download,
  FileText,
  HardDriveUpload,
  MessageCircle,
  MoreHorizontal,
  Printer,
} from "lucide-react";
import { Button, ButtonLink, MenuBerkas, useAksiKlik, type PilihanBerkas } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { sendDailyReportPdfToWaAction, type WaActionState } from "@/lib/waha/actions";
import { uploadDailyReportToDriveAction, type GDriveActionState } from "@/lib/gdrive/actions";

/**
 * AKSI SATU LAPORAN HARIAN — TOMBOL LANGSUNG, MERINGKAS SENDIRI (DECISIONS 406).
 *
 * Permintaan user 2026-08-21: *"tombol-tombolnya boleh muncul langsung, tapi
 * jika window kecil makan menyesuaikan."*
 *
 * Dua tampilan, SATU keadaan. Yang lebar memasang tombolnya berjejer; yang
 * sempit melipatnya jadi satu menu. Pergantiannya murni CSS (`xl:`), bukan
 * pengukuran lebar di JavaScript — dan itu disengaja: mengukur lebar berarti
 * render pertama menebak, lalu berkedip mengganti bentuk begitu tebakannya
 * ketahuan salah. Di daftar tiga puluh baris, kedipan itu terjadi tiga puluh
 * kali sekaligus.
 *
 * Keadaan sibuk WhatsApp/Drive DIPEGANG DI SINI, satu kali, lalu diteruskan ke
 * kedua tampilan. Kalau masing-masing memegang sendiri, menekan di satu bentuk
 * tidak akan terlihat di bentuk yang lain — dan orang yang mengubah ukuran
 * jendela di tengah kiriman akan melihat tombol yang seolah bebas ditekan lagi.
 *
 * Yang TIDAK dibagi: penanda sibuk unduhan PDF, karena `MenuBerkas` dan
 * `ButtonLink unduhan` masing-masing memegang mesin unduhannya sendiri. Hanya
 * satu dari keduanya yang terlihat pada satu waktu, jadi akibatnya sebatas ini:
 * mengubah lebar jendela DI TENGAH unduhan membuat penandanya tidak ikut pindah.
 * Disebut apa adanya, bukan didiamkan.
 */

export function AksiHarian({
  slug,
  dateKey,
  hasGroup,
  hasDrive,
  wahaOn,
  driveOn,
  sudahWa,
  sudahDrive,
}: {
  slug: string;
  dateKey: string;
  hasGroup: boolean;
  hasDrive: boolean;
  wahaOn: boolean;
  driveOn: boolean;
  sudahWa: boolean;
  sudahDrive: boolean;
}) {
  const [wa, kirimWa, waPending] = useAksiKlik<WaActionState>(sendDailyReportPdfToWaAction, undefined);
  const [drive, kirimDrive, drivePending] = useAksiKlik<GDriveActionState>(
    uploadDailyReportToDriveAction,
    undefined,
  );

  const fd = () => {
    const f = new FormData();
    f.set("slug", slug);
    f.set("dateKey", dateKey);
    return f;
  };

  const alasanWa = !wahaOn
    ? "WhatsApp belum dikonfigurasi"
    : !hasGroup
      ? "Paket belum punya grup WA"
      : null;
  const alasanDrive = !driveOn
    ? "Google Drive belum terhubung"
    : !hasDrive
      ? "Paket belum punya folder Drive"
      : null;

  const pesan = wa ?? drive;
  const hrefPdf = `/api/laporan/harian/${slug}/${dateKey}/pdf`;
  const hrefCetak = `/cetak/harian/${slug}/${dateKey}`;
  const hrefBuka = `/lokasi/${slug}/harian/${dateKey}`;

  // Sudah pernah terkirim → tombolnya berkata "ulang". Label yang sama untuk
  // kiriman pertama dan kiriman kedua membuat orang mengirim dobel tanpa sadar.
  const labelWa = sudahWa ? "Kirim ulang WA" : "Kirim WA";
  const labelDrive = sudahDrive ? "Upload ulang" : "Upload ke Drive";

  const unduhPdf: PilihanBerkas = {
    label: "Unduh PDF",
    icon: <Download aria-hidden className="size-3.5" />,
    href: hrefPdf,
    jenis: "berkas",
    labelSibuk: "Menyiapkan PDF…",
  };
  const tanpaSampul: PilihanBerkas = {
    label: "Unduh PDF tanpa sampul",
    icon: <Download aria-hidden className="size-3.5" />,
    href: `${hrefPdf}?sampul=0`,
    jenis: "berkas",
    labelSibuk: "Menyiapkan PDF…",
    hint: "Untuk yang sudah memegang berkas mingguannya",
  };
  const kirimWaPilihan: PilihanBerkas = {
    label: labelWa,
    icon: <MessageCircle aria-hidden className="size-3.5" />,
    onSelect: () => kirimWa(fd()),
    disabledReason: alasanWa,
    loading: waPending,
    labelSibuk: "Mengirim ke WhatsApp…",
  };
  const kirimDrivePilihan: PilihanBerkas = {
    label: labelDrive,
    icon: <HardDriveUpload aria-hidden className="size-3.5" />,
    onSelect: () => kirimDrive(fd()),
    disabledReason: alasanDrive,
    loading: drivePending,
    labelSibuk: "Mengunggah ke Drive…",
  };

  return (
    <div className="flex flex-col items-start gap-1 xl:items-end">
      {/* SEMPIT: satu menu. Badan tombolnya langsung mengunduh PDF – yang paling
          sering dipakai tetap satu ketukan. */}
      <div className="xl:hidden">
        <MenuBerkas
          label="Laporan Harian"
          icon={<FileText aria-hidden className="size-4" />}
          utama={unduhPdf}
          pilihan={[
            { label: "Buka laporan", icon: <FileText aria-hidden className="size-3.5" />, href: hrefBuka, jenis: "tab" },
            unduhPdf,
            tanpaSampul,
            { label: "Buka untuk dicetak", icon: <Printer aria-hidden className="size-3.5" />, href: hrefCetak, jenis: "tab" },
            kirimDrivePilihan,
            kirimWaPilihan,
          ]}
        />
      </div>

      {/* LEBAR: tombolnya langsung terlihat, tanpa perlu dibuka dulu. */}
      <div className="hidden flex-wrap items-center justify-end gap-1.5 xl:flex">
        <ButtonLink href={hrefBuka} variant="secondary" size="sm">
          Buka
        </ButtonLink>
        <a
          href={hrefCetak}
          target="_blank"
          rel="noopener"
          className={buttonClass("secondary", "sm")}
          title="Buka versi cetak di tab baru"
        >
          <Printer aria-hidden className="size-3.5" />
          Cetak
        </a>
        <ButtonLink href={hrefPdf} unduhan labelSibuk="Menyiapkan PDF…" variant="secondary" size="sm">
          <Download aria-hidden className="size-3.5" />
          PDF
        </ButtonLink>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => kirimDrive(fd())}
          loading={drivePending}
          disabled={!!alasanDrive}
          title={alasanDrive ?? labelDrive}
        >
          {drivePending ? (
            "Mengunggah…"
          ) : (
            <>
              <HardDriveUpload aria-hidden className="size-3.5" />
              {sudahDrive ? "Drive ulang" : "Drive"}
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => kirimWa(fd())}
          loading={waPending}
          disabled={!!alasanWa}
          title={alasanWa ?? labelWa}
        >
          {waPending ? (
            "Mengirim…"
          ) : (
            <>
              <MessageCircle aria-hidden className="size-3.5" />
              {sudahWa ? "WA ulang" : "WA"}
            </>
          )}
        </Button>
        <MenuBerkas
          label="Lainnya"
          icon={<MoreHorizontal aria-hidden className="size-4" />}
          pilihan={[tanpaSampul]}
        />
      </div>

      {pesan?.error ? <span className="text-[12px] text-danger">{pesan.error}</span> : null}
      {pesan?.success ? <span className="text-[12px] text-success">{pesan.success}</span> : null}
    </div>
  );
}
