"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { Banner, Button, Label, Textarea } from "@/components/ui";
import { pindahTanggalAction, type DailyActionState } from "@/lib/daily-report/actions";
import { formatTanggal, parseDateKey } from "@/lib/format";

/**
 * "2026-07-22" → "Rabu, 22 Juli 2026", atau null bila belum lengkap.
 *
 * `parseDateKey` menghasilkan tengah malam UTC = 07:00 WIB pada hari yang SAMA,
 * jadi menerjemahkannya ke Asia/Jakarta tidak menggeser harinya. Kalau suatu
 * saat sumbernya berubah jadi tengah malam WIB, hasilnya akan mundur sehari —
 * dan di formulir ini itu berarti salah tanggal yang diperbaiki dengan salah
 * tanggal yang lain.
 */
function ejaTanggal(v: string): string | null {
  const d = parseDateKey(v);
  return d ? formatTanggal(d, "EEEE, d MMMM yyyy") : null;
}

/**
 * PINDAHKAN LAPORAN KE TANGGAL LAIN — super admin saja (DECISIONS 415).
 *
 * User 2026-08-22, atas laporan Banjarejo yang dikembalikan dengan alasan
 * *"salah penginputan tanggal pelaksanaan sondir saya input di tanggal 21 Juli
 * 2026 yang benar tanggal 22 Juli 2026"*:
 *
 * > ini terlalu ribet untuk edit, padahal bisa sekali klik, ganti tanggal saja.
 *
 * ### Kenapa TERTUTUP, bukan tombol yang menganga
 *
 * Bentuknya sengaja sama dengan "Buka kembali laporan final": satu tautan kecil
 * yang harus diklik dulu, lalu formulir dengan alasan wajib. Menggeser tanggal
 * memindahkan volume ke hari lain — kurva-S, deviasi, dan angka kumulatif
 * laporan di antaranya ikut berubah. Itu bukan tombol yang pantas tersenggol.
 *
 * ### Akibatnya disebut SESUDAH, bukan dijanjikan sebelum
 *
 * Berapa foto yang capnya ikut salah baru diketahui setelah datanya dibaca,
 * jadi angkanya muncul di hasil. Yang bisa dikatakan di muka dikatakan di muka:
 * cuaca dibuang, penanda WA dilepas.
 */
export function PindahTanggalForm({
  reportId,
  tanggalSekarang,
  hariIni,
}: {
  reportId: string;
  /** `YYYY-MM-DD` – tanggal laporan sekarang. */
  tanggalSekarang: string;
  /** `YYYY-MM-DD` Asia/Jakarta – batas atas, sama seperti pembuatan laporan. */
  hariIni: string;
}) {
  const [buka, setBuka] = useState(false);
  /*
   * Tanggal DAN alasan dipegang state, bukan dibiarkan tak terkendali.
   *
   * React mengosongkan medan formulir yang tak terkendali setiap kali aksi
   * server selesai — termasuk saat aksinya DITOLAK. Akibatnya penolakan
   * ("tanggal tujuan sudah punya laporan") menghapus alasan yang barusan
   * diketik, dan orang harus mengetiknya lagi untuk sekadar mencoba tanggal
   * yang lain. Ketahuan waktu menjalankannya di peramban sungguhan, bukan dari
   * membaca kode.
   */
  const [pilihan, setPilihan] = useState(tanggalSekarang);
  const [alasan, setAlasan] = useState("");
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    pindahTanggalAction,
    undefined,
  );

  if (state?.pindah) return <HasilPindah pindah={state.pindah} />;

  if (!buka) {
    return (
      <button
        type="button"
        onClick={() => setBuka(true)}
        className="text-[13px] font-medium text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
      >
        Salah tanggal? Pindahkan laporan ini (super admin)
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-warning-border bg-warning-soft p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <CalendarRange aria-hidden className="size-4" />
        Pindahkan laporan ke tanggal lain
      </h3>
      <p className="text-[12px] text-ink-muted">
        Seluruh isinya ikut pindah – item, foto, tenaga kerja, material, alat, dan kendala. Tidak ada
        yang perlu diunggah atau diketik ulang. Yang <strong>tidak</strong> ikut benar sendiri:{" "}
        <strong>cuaca otomatis dibuang</strong> (cuaca hari lain bukan fakta hari ini – ambil ulang
        setelah pindah), dan <strong>penanda &quot;sudah dikirim WA&quot; dilepas</strong> karena yang
        terlanjur terkirim bertanggal lama.
      </p>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`pt-tgl-${reportId}`} required>
            Tanggal yang benar
          </Label>
          {/*
            Kalender bawaan peramban, bukan Combobox: yang dipilih di sini
            TANGGAL, dan aturan "semua dropdown pakai Combobox" bicara soal
            daftar pilihan, bukan soal pemilih tanggal. `max` memagari tanggal
            yang belum terjadi di layar; servernya memagari lagi.
          */}
          <input
            id={`pt-tgl-${reportId}`}
            type="date"
            name="tanggalBaru"
            required
            value={pilihan}
            onChange={(e) => setPilihan(e.target.value)}
            max={hariIni}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
          />
          {/*
            Tanggalnya DIEJA ulang di bawah kotaknya, dan itu bukan hiasan:
            `<input type="date">` menampilkan urutan angka menurut bahasa
            PERAMBAN, bukan menurut aplikasi. Di peramban berbahasa Inggris
            08/09/2026 berarti 8 September; di peramban berbahasa Indonesia
            berarti 9 Agustus. Angka yang sama, dua hari yang berbeda — pada
            formulir yang justru ada karena tanggalnya pernah salah.
          */}
          <p className="mt-1 text-[12px] text-ink-muted">
            {ejaTanggal(pilihan) ?? "Pilih tanggal dulu."}
          </p>
        </div>
      </div>
      <div>
        <Label htmlFor={`pt-alasan-${reportId}`} required>
          Alasan pemindahan
        </Label>
        <Textarea
          id={`pt-alasan-${reportId}`}
          name="alasan"
          rows={2}
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="mis. salah input tanggal pelaksanaan sondir – seharusnya 22 Juli 2026"
        />
      </div>
      <input type="hidden" name="reportId" value={reportId} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          Pindahkan laporan
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setBuka(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}

/**
 * Hasilnya, dengan akibat yang DISEBUT ANGKANYA.
 *
 * Halaman yang sedang dibuka bertanggal LAMA dan sekarang kosong – tanpa tautan
 * ke tanggal baru, orang ditinggal menatap "Belum ada laporan" dan menyangka
 * laporannya hilang.
 */
function HasilPindah({
  pindah,
}: {
  pindah: NonNullable<Extract<DailyActionState, { pindah?: unknown }>["pindah"]>;
}) {
  const catatan: string[] = [];
  if (pindah.lewatFinal) {
    catatan.push(
      "Laporan dibuka dari final, dipindah, lalu difinalkan ulang – snapshot cetaknya dibangun ulang di tanggal baru.",
    );
  }
  if (pindah.cuacaDibuang) catatan.push("Cuaca otomatis dibuang – ambil ulang untuk tanggal yang baru.");
  if (pindah.waDilepas) {
    catatan.push(
      "Penanda “sudah dikirim WA” dilepas – yang terlanjur terkirim bertanggal lama, jadi kirim ulang.",
    );
  }
  if (pindah.snapshotDibangunUlang > 0) {
    catatan.push(
      `${pindah.snapshotDibangunUlang} laporan final lain ikut dihitung ulang angka kumulatifnya.`,
    );
  }
  if (pindah.fotoPerluCapUlang > 0) {
    catatan.push(
      `${pindah.fotoPerluCapUlang} foto capnya masih menulis tanggal lama (foto tanpa waktu jepret sendiri) – perbaiki lewat halaman foto.` +
        (pindah.fotoTakBisaDiperbaiki > 0
          ? ` ${pindah.fotoTakBisaDiperbaiki} di antaranya tidak bisa diperbaiki lagi karena arsip aslinya sudah dihapus.`
          : ""),
    );
  }

  return (
    <Banner
      tone="success"
      title={`Laporan dipindah ke ${pindah.ke}.`}
      description={
        <div className="space-y-2">
          {catatan.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4">
              {catatan.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          <Link
            href={`/lokasi/${pindah.slug}/harian/${pindah.ke}`}
            className="inline-block font-medium text-primary hover:underline"
          >
            Buka laporan di tanggal barunya →
          </Link>
        </div>
      }
    />
  );
}
