import { susunKartu } from "@/lib/daily-report/kkp-lampiran-susun";
import type { KkpDailyData } from "./kkp-daily-report";

/**
 * DOKUMENTASI PEKERJAAN — versi HTML dari `lib/pdf/harian-kkp-lampiran.ts`.
 *
 * Dua kartu berdampingan per halaman, tiap kartu memuat kop pelaksana, nama
 * pekerjaan + bangunannya, lalu maksimal 3 foto dengan kolom bobot. Pembagian
 * kartunya memakai `susunKartu` yang SAMA dengan PDF — kalau layar
 * mengelompokkan sendiri, cepat atau lambat urutan fotonya berbeda dari
 * dokumen yang dikirim.
 *
 * Tidak menggambar apa pun bila tidak ada foto: halaman kosong berjudul
 * "DOKUMENTASI PEKERJAAN" hanya membuat pembaca mengira fotonya hilang.
 */

const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type FotoCetak = {
  url: string;
  pekerjaan: string | null;
  kategori: string | null;
  bobot: number | null;
};

export function KkpDailyPhotos({ d, foto }: { d: KkpDailyData; foto: FotoCetak[] }) {
  const kartu = susunKartu(foto);
  if (kartu.length === 0) return null;

  const halaman: FotoCetak[][][] = [];
  for (let i = 0; i < kartu.length; i += 2) halaman.push(kartu.slice(i, i + 2));

  return (
    <>
      {halaman.map((pasangan, i) => (
        <section
          key={`dok${i}`}
          className="mt-6 grid grid-cols-2 items-start gap-4 break-before-page text-slate-900"
        >
          {pasangan.map((k, j) => (
            <Kartu
              key={`k${i}-${j}`}
              kartu={k}
              vendor={{ nama: d.contractorFirm, alamat: d.contractorAddress }}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function Kartu({
  kartu,
  vendor,
}: {
  kartu: FotoCetak[];
  vendor: { nama?: string | null; alamat?: string | null };
}) {
  return (
    <div className="break-inside-avoid text-[9px]">
      {/* Kop pelaksana — sama di tiap kartu, seperti contoh KKP. */}
      <div className="flex min-h-[34px] items-center gap-2 border border-slate-500 px-1.5 py-1">
        <div className="min-w-0">
          <div className="text-[8px] leading-tight font-bold uppercase">{vendor.nama ?? ""}</div>
          {vendor.alamat ? (
            <div className="text-[6.5px] leading-tight text-ink-muted">{vendor.alamat}</div>
          ) : null}
        </div>
      </div>

      <div className="border-x border-b border-slate-500 bg-slate-50 px-1.5 py-1 text-center text-[10px] font-bold uppercase">
        Dokumentasi Pekerjaan
      </div>
      <Baris label="Pekerjaan" isi={kartu[0]?.pekerjaan ?? "(tanpa item pekerjaan)"} tebal />
      <Baris label="Bangunan" isi={kartu[0]?.kategori ?? "—"} />

      {kartu.map((f, i) => (
        <div key={`f${i}`}>
          <div className="flex border-x border-b border-slate-500 bg-slate-50 text-[7px] font-semibold uppercase">
            <div className="flex-[4.2] border-r border-slate-500 px-1 py-0.5 text-center">
              {f.pekerjaan ?? "Dokumentasi lapangan"}
            </div>
            <div className="flex-1 px-1 py-0.5 text-center">Bobot (%)</div>
          </div>
          <div className="flex border-x border-b border-slate-500">
            <div className="flex flex-[4.2] items-center justify-center border-r border-slate-500 p-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt="" className="max-h-[46mm] w-auto max-w-full object-contain" />
            </div>
            {/* Bobot DIISI bila diketahui — angkanya sudah ada di sistem, jadi
                mengosongkannya justru menyuruh orang menghitung ulang. */}
            <div className="flex flex-1 items-center justify-center px-1 text-[9px] font-bold tabular-nums">
              {f.bobot != null ? pctFmt.format(f.bobot) : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Baris({ label, isi, tebal }: { label: string; isi: string; tebal?: boolean }) {
  return (
    <div className="flex border-x border-b border-slate-500">
      <div className="flex-[1.1] border-r border-slate-500 px-1.5 py-0.5">{label}</div>
      <div className={`flex-[3.4] px-1.5 py-0.5${tebal ? " font-semibold" : ""}`}>{isi}</div>
    </div>
  );
}
