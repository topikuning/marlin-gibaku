"use client";

import { Fragment, startTransition } from "react";
import { Lock } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  kembalikanBawaanHakAksesAction,
  ubahHakAksesAction,
  type HakAksesState,
} from "@/lib/hak-akses/actions";
import type { UserRole } from "@/generated/prisma/enums";

export type SelHakAkses = {
  role: UserRole;
  /** Hak yang berlaku sekarang (bawaan + pengaturan + jenjang). */
  berlaku: boolean;
  bawaan: boolean;
  /** Alasan sel tidak bisa diubah; null = bisa. */
  kunci: string | null;
};

export type BarisHakAksesView = { cap: string; label: string; kelompok: string; sel: SelHakAkses[] };

/**
 * MATRIKS HAK AKSES PER PERAN yang bisa diatur Super Admin (DECISIONS 793).
 *
 * Satu centang = satu perubahan, langsung tersimpan dan tercatat di jejak
 * audit. Jenjang ikut dijaga: memberi ke satu peran ikut berlaku untuk
 * atasannya; mencabut ikut mencabut dari bawahannya – yang terakhir ini
 * disebut dulu sebelum terjadi.
 */
export function MatriksHakAkses({
  peran,
  tangga,
  baris,
  bolehUbah,
  jumlahDiatur,
}: {
  peran: { role: UserRole; label: string }[];
  /** Tangga jenjang dari bawah ke atas (`TANGGA_PERAN`). */
  tangga: UserRole[];
  baris: BarisHakAksesView[];
  bolehUbah: boolean;
  jumlahDiatur: number;
}) {
  const [state, kirim, pending] = useAksi<HakAksesState>(ubahHakAksesAction, undefined);
  const [stateBawaan, kirimBawaan, pendingBawaan] = useAksi<HakAksesState>(kembalikanBawaanHakAksesAction, undefined);
  const hasil = stateBawaan ?? state;
  const label = new Map(peran.map((p) => [p.role, p.label]));

  const ubah = (b: BarisHakAksesView, s: SelHakAkses) => {
    const boleh = !s.berlaku;
    if (!boleh) {
      // Mencabut dari satu peran ikut mencabut dari bawahannya yang memegangnya.
      const i = tangga.indexOf(s.role);
      const ikut =
        i < 0
          ? []
          : tangga
              .slice(0, i)
              .filter((r) => b.sel.find((x) => x.role === r)?.berlaku && !b.sel.find((x) => x.role === r)?.kunci);
      const pesan =
        `Cabut "${b.label}" dari ${label.get(s.role)}?` +
        (ikut.length > 0
          ? ` Karena atasan selalu memegang hak bawahannya, hak ini juga dicabut dari ${ikut.map((r) => label.get(r)).join(", ")}.`
          : "");
      if (!window.confirm(pesan)) return;
    }
    const fd = new FormData();
    fd.set("role", s.role);
    fd.set("capability", b.cap);
    fd.set("boleh", boleh ? "1" : "0");
    startTransition(() => kirim(fd));
  };

  const kelompok = [...new Set(baris.map((b) => b.kelompok))];
  return (
    <div className="space-y-3">
      {hasil?.error ? <Banner tone="error" title={hasil.error} /> : null}
      {hasil?.success ? <Banner tone="success" title={hasil.success} /> : null}
      <p className="text-[13px] text-ink-muted">
        {bolehUbah
          ? "Centang untuk memberi, hapus centang untuk mencabut. Perubahan langsung berlaku (paling lambat 30 detik di semua layar) dan tercatat di jejak audit. Atasan selalu memegang hak bawahannya."
          : "Hanya Super Admin yang bisa mengubah hak akses."}{" "}
        Sel berwarna kuning berbeda dari bawaan program; sel bergembok tidak bisa diubah.
      </p>
      {/* Judul kolom dan nama kewenangan tetap terlihat saat tabel panjang ini digulir. */}
      <div className="max-h-[75vh] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="sticky top-0 left-0 z-20 border-b border-border bg-surface py-2 pr-3 pl-2 font-medium">
                Kewenangan
              </th>
              {peran.map((p) => (
                <th
                  key={p.role}
                  className="sticky top-0 z-10 border-b border-border bg-surface px-2 py-2 text-center font-medium whitespace-nowrap"
                >
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kelompok.map((k) => (
              <Fragment key={k}>
                <tr className="bg-surface-inset">
                  <td colSpan={peran.length + 1} className="sticky left-0 px-2 py-1.5 text-xs font-semibold text-ink-muted">
                    {k}
                  </td>
                </tr>
                {baris
                  .filter((b) => b.kelompok === k)
                  .map((b) => (
                    <tr key={b.cap} className="border-b border-border">
                      <td className="sticky left-0 z-[5] bg-surface py-1.5 pr-3 pl-2 text-[13px] text-ink" title={b.cap}>
                        {b.label}
                      </td>
                      {b.sel.map((s) => {
                        const diatur = s.berlaku !== s.bawaan;
                        const judul = s.kunci
                          ? s.kunci
                          : diatur
                            ? `Diubah dari bawaan (bawaan: ${s.bawaan ? "boleh" : "tidak"})`
                            : undefined;
                        return (
                          <td
                            key={s.role}
                            className={`px-2 py-1.5 text-center ${diatur ? "bg-warning-soft" : ""}`}
                            title={judul}
                          >
                            {s.kunci || !bolehUbah ? (
                              <span className="inline-flex items-center gap-0.5">
                                {s.berlaku ? (
                                  <span className="text-success" aria-label="boleh">
                                    ●
                                  </span>
                                ) : (
                                  <span className="text-border-strong" aria-label="tidak">
                                    ·
                                  </span>
                                )}
                                {s.kunci ? <Lock aria-label="tidak bisa diubah" className="size-3 text-ink-faint" /> : null}
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                className="size-4 cursor-pointer align-middle"
                                checked={s.berlaku}
                                disabled={pending || pendingBawaan}
                                aria-label={`${b.label} – ${label.get(s.role)}`}
                                onChange={() => ubah(b, s)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {bolehUbah && jumlahDiatur > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={pendingBawaan}
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Kembalikan SEMUA hak akses ke bawaan program? Semua pengaturan di tabel ini dibuang.")) return;
            startTransition(() => kirimBawaan(new FormData()));
          }}
        >
          Kembalikan semua ke bawaan ({jumlahDiatur} pengaturan)
        </Button>
      ) : null}
    </div>
  );
}
