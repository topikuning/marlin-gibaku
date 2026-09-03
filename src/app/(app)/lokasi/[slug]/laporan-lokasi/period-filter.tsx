"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Label, Combobox } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Filter laporan periodik KKP. Alur (audit UX #7): user pilih Jenis → periode →
 * klik "Tampilkan" (set show=1) baru laporan digenerate; default belum tampil.
 * Input periode WAJIB (audit UX #6) — highlight merah bila kosong/di luar rentang,
 * bukan bubble bawaan browser.
 *
 * ### "Tampilkan" harus mengaku sedang bekerja (DECISIONS 400)
 *
 * Dulu `<form method="GET">` polos: peramban berpindah halaman dan React tidak
 * punya apa pun untuk ditandai. **Diukur 8,9 detik** pada satu lokasi contoh —
 * membangun laporan periodik berarti membaca RAB, baseline kurva-S, dan seluruh
 * laporan harian dalam periode itu. Selama itu tombolnya tetap tampak biasa,
 * jadi orang menekannya lagi.
 *
 * Sekarang perpindahannya lewat `router.push` di dalam `useTransition`:
 * `pending`-nya menutup seluruh masa server bekerja, bukan sekadar sampai
 * permintaannya dikirim.
 */

export function PeriodFilter({
  slug,
  kind,
  n,
  maxMinggu,
  maxBulan,
}: {
  slug: string;
  /** Jenis yang SEDANG TAMPIL (dari URL) — bukan yang sedang dipilih di layar. */
  kind: "mingguan" | "bulanan";
  n: number;
  maxMinggu: number;
  maxBulan: number;
}) {
  const [nErr, setNErr] = useState<string | null>(null);
  const router = useRouter();
  const [menyiapkan, mulai] = useTransition();
  /*
   * JENIS YANG DIPILIH, bukan jenis yang sedang tampil.
   *
   * Keberatan user 2026-09-03: *"laporan bulanan tapi sampingnya minggu,
   * sedikit tidak pas saja."* Betul — dan sebabnya label ini dulu mengikuti
   * `kind` dari URL, yaitu jenis laporan yang SUDAH digenerate. Begitu orang
   * mengganti dropdown ke "Bulanan", labelnya masih "Minggu ke (1–20)" sampai
   * "Tampilkan" ditekan: dua bagian dari satu baris form menyebut dua hal
   * berbeda, tepat pada saat orang sedang memutuskan mau mengisi berapa.
   *
   * Batasnya ikut berubah karena memang berbeda: 20 minggu bukan 20 bulan.
   * Kedua angkanya dikirim dari server sekaligus supaya label dan `max` tidak
   * perlu menunggu satu perjalanan bolak-balik untuk jadi benar.
   */
  const [jenis, setJenis] = useState<"mingguan" | "bulanan">(kind);
  const maxN = jenis === "mingguan" ? maxMinggu : maxBulan;
  /*
   * Nilai periode ikut dikendalikan supaya bisa DIJEPIT saat jenisnya berganti.
   * Minggu ke-18 tidak punya arti pada laporan bulanan proyek 5 bulan; tanpa
   * penjepitan, form terkirim dengan angka di luar rentang lalu ditolak
   * server — kesalahan yang dibuat oleh layar, bukan oleh pemakainya.
   */
  const [nilaiN, setNilaiN] = useState<number>(n);

  return (
    <form
      method="GET"
      onSubmit={(e) => {
        /*
         * `method="GET"` DIPERTAHANKAN sebagai jaring: kalau JS-nya belum
         * termuat, tombolnya tetap bekerja seperti dulu. Yang diambil alih
         * hanya jalur normalnya, supaya ada yang bisa mengatakan "sedang
         * disiapkan".
         */
        const f = e.currentTarget;
        if (!f.checkValidity()) return; // biarkan `onInvalid` yang bicara
        e.preventDefault();
        const q = new URLSearchParams(new FormData(f) as unknown as Record<string, string>);
        mulai(() => router.push(`?${q.toString()}`, { scroll: false }));
      }}
      className="flex flex-wrap items-end gap-3 text-sm"
    >
      {/* show=1 menandai "generate eksplisit" */}
      <input type="hidden" name="show" value="1" />

      <div>
        <Label htmlFor="lp-kind">Jenis laporan</Label>
        <Combobox
          id="lp-kind"
          name="kind"
          value={jenis}
          onChange={(v) => {
            const baru = v === "bulanan" ? "bulanan" : "mingguan";
            setJenis(baru);
            const batas = baru === "mingguan" ? maxMinggu : maxBulan;
            if (batas > 0 && nilaiN > batas) setNilaiN(batas);
            setNErr(null);
          }}
          className="w-40"
        >
          <option value="mingguan">Mingguan</option>
          <option value="bulanan">Bulanan</option>
        </Combobox>
      </div>

      <div>
        <Label htmlFor="lp-n" required>
          {jenis === "mingguan" ? `Minggu ke (1–${maxN})` : `Bulan ke (1–${maxN})`}
        </Label>
        <input
          id="lp-n"
          type="number"
          name="n"
          min={1}
          max={maxN}
          value={nilaiN}
          onChange={(e) => setNilaiN(Number.parseInt(e.target.value, 10) || 1)}
          required
          aria-invalid={nErr ? true : undefined}
          aria-describedby={nErr ? "lp-n-err" : undefined}
          onInvalid={(e) => {
            e.preventDefault();
            const el = e.currentTarget;
            setNErr(
              el.validity.valueMissing
                ? "Periode wajib diisi."
                : `Isi antara 1 dan ${maxN}.`,
            );
          }}
          onInput={() => nErr && setNErr(null)}
          className={cn(
            "tabular h-9 w-28 rounded-md border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600",
            nErr ? "border-danger" : "border-border",
          )}
        />
        <FieldError id="lp-n-err">{nErr}</FieldError>
      </div>

      <Button type="submit" loading={menyiapkan}>
        {menyiapkan ? "Menyiapkan laporan…" : "Tampilkan"}
      </Button>

      {/* Cetak & Unduh TIDAK lagi di sini — keduanya ada di menu berkas di
          bawah laporan (DECISIONS 334). Dua tombol "Cetak" dan dua "Unduh
          Excel" yang menuju berkas yang sama persis adalah kebingungan yang
          saya buat sendiri; keberatan user 2026-08-16: *"jelas-jelas
          memberikan data dan hal yang sama, kenapa kamu double, rapikan."* */}
    </form>
  );
}
