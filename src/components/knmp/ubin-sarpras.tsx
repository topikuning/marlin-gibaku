import Link from "next/link";
import { formatPct } from "@/lib/format";

export type UbinSarprasItem = {
  kunci: string;
  code: string;
  name: string;
  /** Progres sarana s/d hari ini (%). */
  progres: number;
  jumlahFoto: number;
  /** Foto terkini sarana ini (alamat sementara), `null` bila belum ada. */
  foto: string | null;
  href: string;
};

/**
 * Ubin sarana & prasarana – foto terkini sebagai latar, nama di bawah, progres
 * di pojok (DECISIONS 683, mengikuti tampilan kawal-knmp KKP). Dipakai di
 * Ringkasan lokasi dan tab Foto Sarpras; angka progresnya dari
 * `progresKelompokPerTanggal`, tidak dihitung di sini.
 */
export function UbinSarpras({ items }: { items: UbinSarprasItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      {items.map((s) => (
        <Link
          key={s.kunci}
          href={s.href}
          className="group relative block aspect-square overflow-hidden rounded-lg bg-surface-inset ring-1 ring-border"
        >
          {s.foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.foto}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/5" />
          <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {s.jumlahFoto > 0 ? `${s.jumlahFoto} foto` : "Belum ada foto"}
          </span>
          <span className="tabular absolute right-1.5 top-1.5 rounded bg-surface px-1.5 py-0.5 text-xs font-bold text-ink">
            {formatPct(s.progres, 1)}
          </span>
          <div className="absolute inset-x-0 bottom-0 space-y-1 p-2">
            <p className="line-clamp-2 text-[12px] font-bold uppercase leading-tight text-white">
              {s.code}. {s.name}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-white/30" aria-hidden>
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, Math.max(0, s.progres))}%` }} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
