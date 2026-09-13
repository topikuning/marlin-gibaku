"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { tautanKirimWa, type KeadaanVerifikasi } from "@/lib/waha/verifikasi-aturan";
import {
  bacaKeadaanAction,
  konfirmasiKodeAction,
  lewatiVerifikasiAction,
  mulaiVerifikasiAction,
  type VerifikasiState,
} from "./actions";

/**
 * Tiga tahap di satu layar, dan hanya SATU yang terlihat sekali waktu.
 *
 * Menampilkan ketiganya sekaligus membuat orang mengetik kode sebelum
 * mengirim pesannya, lalu menyimpulkan sistemnya rusak karena kolomnya menolak
 * apa pun yang diketik. DECISIONS 570.
 */
export function VerifikasiWaForm({
  awal,
  nomorTujuan,
  nomorTercatat,
}: {
  awal: KeadaanVerifikasi;
  nomorTujuan: string | null;
  nomorTercatat: string | null;
}) {
  const router = useRouter();
  /*
   * Keadaan TURUNAN, bukan salinan yang disinkronkan.
   *
   * Jawaban aksi terbaru selalu menang; `lokal` hanya menampung yang datang
   * dari tombol "Mulai" dan dari penengokan berkala. Menyalin keadaan aksi ke
   * useState lewat useEffect membuat satu render tambahan tiap balasan — dan
   * satu sumber kebenaran berubah jadi dua yang harus dijaga tetap sama.
   */
  const [lokal, setLokal] = useState<KeadaanVerifikasi | null>(null);
  const [mulaiPending, mulai] = useTransition();
  const [lewatiPending, lewati] = useTransition();
  const [kodeState, kirimKode, kodePending] = useAksi<VerifikasiState>(konfirmasiKodeAction, undefined);

  const keadaan: KeadaanVerifikasi = kodeState?.keadaan ?? lokal ?? awal;
  const tautan = keadaan.tahap === "menunggu-pesan" ? tautanKirimWa(nomorTujuan, keadaan.frasa) : null;

  /*
   * Menunggu pesannya masuk: layar yang MENENGOK sendiri.
   *
   * Tanpa ini orang harus menebak kapan harus menekan "muat ulang" — dan yang
   * mereka lakukan sebenarnya adalah menekan tombol kirim WhatsApp berkali-kali
   * karena mengira pesannya tidak sampai.
   */
  useEffect(() => {
    if (keadaan.tahap !== "menunggu-pesan") return;
    const t = setInterval(() => {
      void bacaKeadaanAction().then((r) => {
        if (r?.keadaan) setLokal(r.keadaan);
      });
    }, 3000);
    return () => clearInterval(t);
  }, [keadaan.tahap]);

  if (keadaan.tahap === "selesai") {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <Banner
          tone="success"
          title="Nomor WhatsApp terverifikasi"
          description={`${keadaan.nomor ?? "Nomor Anda"} sudah terbukti milik Anda. Tidak perlu diulang.`}
        />
        <Button type="button" onClick={() => router.push("/")} className="w-full">
          Lanjut ke MARLIN
        </Button>
      </div>
    );
  }

  const tombolLewati = (
    <Button
      type="button"
      variant="ghost"
      className="w-full"
      loading={lewatiPending}
      onClick={() => lewati(() => void lewatiVerifikasiAction())}
    >
      Lewati dulu
    </Button>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      {nomorTercatat ? (
        <p className="text-sm text-ink-muted">
          Nomor yang tercatat sekarang: <span className="font-medium text-ink">{nomorTercatat}</span> –
          belum terverifikasi. Kalau nomor Anda sudah berganti, verifikasi ini sekaligus memperbaruinya.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Nomor WhatsApp Anda belum tercatat. Verifikasi ini sekaligus mengisinya.
        </p>
      )}

      {kodeState?.error ? <Banner tone="error" title={kodeState.error} /> : null}
      {kodeState?.success ? <Banner tone="success" title={kodeState.success} /> : null}

      {keadaan.tahap === "belum" ? (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            <li>MARLIN memberi satu frasa singkat.</li>
            <li>Kirim frasa itu lewat WhatsApp dari nomor Anda sendiri.</li>
            <li>MARLIN membalas kode; ketikkan kodenya di sini.</li>
          </ol>
          <Button
            type="button"
            className="w-full"
            loading={mulaiPending}
            onClick={() =>
              mulai(() =>
                void mulaiVerifikasiAction().then((r) => {
                  if (r?.keadaan) setLokal(r.keadaan);
                }),
              )
            }
          >
            Mulai verifikasi
          </Button>
          {tombolLewati}
        </>
      ) : null}

      {keadaan.tahap === "menunggu-pesan" ? (
        <>
          {/*
            * SATU KETUKAN, bukan empat langkah.
            *
            * Tombol ini membuka WhatsApp dengan tujuan DAN isi pesannya sudah
            * terisi – orangnya tinggal menekan kirim. Frasanya tetap
            * ditampilkan di bawah sebagai jalan cadangan, bukan sebagai cara
            * utama: menyalin, membuka WhatsApp, mencari nomor MARLIN, lalu
            * mengetik ulang adalah empat kesempatan gagal untuk satu langkah.
            */}
          {tautan ? (
            <>
              <a
                href={tautan}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                <Send className="size-4" aria-hidden />
                Buka WhatsApp & kirim
              </a>
              <p className="text-center text-xs text-ink-muted">
                Pesannya sudah terisi – Anda tinggal menekan kirim di WhatsApp.
              </p>
            </>
          ) : (
            <Banner
              tone="warning"
              title="Nomor tujuan belum bisa dibaca"
              description="Sesi WhatsApp MARLIN sedang tidak tersambung, jadi tombol kirimnya belum bisa disiapkan. Kirim frasa di bawah ke nomor MARLIN yang biasa Anda pakai, atau tanyakan ke admin."
            />
          )}

          <details className="text-sm text-ink-muted">
            <summary className="cursor-pointer">Tombolnya tidak jalan? Kirim manual</summary>
            <p className="mt-2">Kirim pesan berikut lewat WhatsApp:</p>
            <p className="mt-1 rounded border border-border bg-surface-muted px-3 py-2 text-center text-lg font-semibold tracking-widest text-ink">
              {keadaan.frasa}
            </p>
            {nomorTujuan ? (
              <p className="mt-1">
                Tujuan: <span className="font-medium text-ink">{nomorTujuan}</span> – nomor WhatsApp MARLIN.
              </p>
            ) : null}
          </details>

          <p className="text-sm text-ink-muted">
            Menunggu pesan Anda masuk… halaman ini berpindah sendiri begitu diterima. Tidak perlu
            mengirim dua kali.
          </p>
          {tombolLewati}
        </>
      ) : null}

      {keadaan.tahap === "menunggu-kode" ? (
        <form action={kirimKode} className="space-y-3">
          <Banner
            tone="success"
            title="Pesan Anda diterima"
            description={`Dari ${keadaan.nomor ?? "nomor Anda"}. Kode sudah dibalas ke WhatsApp yang sama.`}
          />
          <div>
            <Label htmlFor="kode">Kode dari WhatsApp</Label>
            <Input
              id="kode"
              name="kode"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 angka"
              className="text-center text-lg tracking-widest"
            />
          </div>
          <p className="text-xs text-ink-muted">Sisa percobaan: {keadaan.sisaPercobaan}.</p>
          <Button type="submit" className="w-full" loading={kodePending}>
            Verifikasi
          </Button>
          {tombolLewati}
        </form>
      ) : null}
    </div>
  );
}
