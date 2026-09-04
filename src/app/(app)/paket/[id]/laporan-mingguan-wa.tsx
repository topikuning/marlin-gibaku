"use client";

import { useState } from "react";
import { Send, Eye } from "lucide-react";
import { Banner, Button, Combobox, Label } from "@/components/ui";
import {
  kirimMingguanAction,
  pratinjauMingguanAction,
  type MingguanState,
} from "@/lib/mingguan/actions";
import { useAksi } from "@/lib/aksi-klien";

/**
 * Kirim LAPORAN PROGRES MINGGUAN paket ini ke grup WhatsApp-nya (DECISIONS 311).
 *
 * ### Kenapa pratinjau dipisah dari kirim, bukan satu tombol
 *
 * Tujuannya grup berisi PPK dan konsultan, dan pesan WhatsApp tidak bisa
 * ditarik kembali setelah lewat beberapa menit. Tombol tunggal "kirim" berarti
 * satu ketukan salah langsung jadi laporan resmi yang keliru di depan pemberi
 * kerja. Pratinjau menampilkan teks yang PERSIS akan dikirim — disusun oleh
 * fungsi yang sama, bukan tiruannya — jadi yang dibaca di layar memang yang
 * berangkat.
 *
 * ### Kenapa minggunya bisa DIPILIH (DECISIONS 357)
 *
 * Permintaan user 2026-08-17: *"itu saat ini kirim minggu berjalan, padahal
 * kadang kita butuh kirim minggu terakhir"*. Minggu berjalan baru berisi
 * sebagian hari; yang biasanya dilaporkan ke PPK adalah minggu yang sudah
 * tuntas.
 *
 * Bawaannya TETAP minggu berjalan — kebiasaan yang sudah jalan tidak diubah
 * diam-diam, dan penjadwal otomatis pun tetap mengirim minggu berjalan pada
 * hari terakhirnya. Yang bertambah hanyalah pilihan.
 *
 * Pemilihnya berada DI LUAR kedua form dan dititipkan ke masing-masing lewat
 * input tersembunyi: kalau ia berada di dalam salah satu form, "Lihat dulu" dan
 * "Kirim" bisa memakai minggu yang berbeda — dan pratinjau yang tidak sama
 * dengan yang dikirim justru membatalkan gunanya pratinjau.
 */

export type PilihanMinggu = { nilai: number; label: string };

export function LaporanMingguanWa({
  packageId,
  punyaGrup,
  pilihanMinggu = [],
}: {
  packageId: string;
  /** false = paket belum ditautkan ke grup WA; tombol kirim tidak ada gunanya. */
  punyaGrup: boolean;
  /**
   * Minggu yang boleh dipilih, terbaru dulu. Kosong (kontrak belum ber-SPMK)
   * = pemilihnya tidak ditampilkan dan perilakunya persis seperti sebelumnya.
   */
  pilihanMinggu?: PilihanMinggu[];
}) {
  const [minggu, setMinggu] = useState<string>(
    pilihanMinggu.length > 0 ? String(pilihanMinggu[0].nilai) : "",
  );
  const [statePratinjau, aksiPratinjau, sedangPratinjau] = useAksi<MingguanState>(pratinjauMingguanAction,
    undefined,
  );
  const [stateKirim, aksiKirim, sedangKirim] = useAksi<MingguanState>(kirimMingguanAction,
    undefined,
  );

  // Teks terakhir yang ada — hasil kirim mengalahkan hasil pratinjau, supaya
  // yang terbaca di layar adalah yang benar-benar terjadi paling akhir.
  const body = stateKirim?.body ?? statePratinjau?.body;

  return (
    <div className="space-y-3">
      {!punyaGrup ? (
        <Banner
          tone="warning"
          title="Paket ini belum ditautkan ke grup WhatsApp"
          description="Tetapkan grupnya di panel “Grup WhatsApp paket” dulu – tanpa itu tidak ada tujuan kirim."
        />
      ) : null}

      {[statePratinjau, stateKirim].map((s, i) =>
        s?.error ? <Banner key={i} tone="error" title={s.error} /> : null,
      )}
      {stateKirim?.success ? <Banner tone="success" title={stateKirim.success} /> : null}
      {statePratinjau?.info ? <Banner tone="info" title={statePratinjau.info} /> : null}

      {body ? (
        // `whitespace-pre-wrap` — teks WhatsApp itu baris demi baris; menampilkannya
        // sebagai paragraf mengalir akan menyembunyikan persis hal yang sedang
        // diperiksa orang sebelum menekan kirim.
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-muted p-3 font-sans text-[13px] leading-relaxed text-ink">
          {body}
        </pre>
      ) : null}

      {pilihanMinggu.length > 0 ? (
        <div className="max-w-xs">
          <Label htmlFor="lm-minggu">Minggu yang dilaporkan</Label>
          <Combobox id="lm-minggu" value={minggu} onChange={setMinggu}>
            {pilihanMinggu.map((p) => (
              <option key={p.nilai} value={String(p.nilai)}>
                {p.label}
              </option>
            ))}
          </Combobox>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <form action={aksiPratinjau}>
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="mingguKe" value={minggu} />
          <Button type="submit" variant="secondary" size="sm" loading={sedangPratinjau}>
            <Eye aria-hidden className="size-4" />
            Lihat dulu
          </Button>
        </form>
        <form action={aksiKirim}>
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="mingguKe" value={minggu} />
          <Button type="submit" size="sm" loading={sedangKirim} disabled={!punyaGrup}>
            <Send aria-hidden className="size-4" />
            Kirim ke grup sekarang
          </Button>
        </form>
      </div>
    </div>
  );
}
