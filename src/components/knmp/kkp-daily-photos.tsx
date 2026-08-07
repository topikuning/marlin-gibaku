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
 * ### Satu tabel, bukan tumpukan baris flex
 *
 * Teguran user 2026-08-07: *"kamu bikin garis antara kolom gambar dan bobot
 * saja tidak lurus."* Versi pertama menyusun tiap baris sebagai `flex`
 * tersendiri dengan rasio yang sama (4,2 : 1). Rasionya memang sama, tapi flex
 * membagi SISA ruang, dan sisa ruang tiap baris berbeda karena padding serta
 * lebar-minimum isinya berbeda — baris judul berisi teks yang bisa membungkus,
 * baris foto berisi gambar dengan lebar intrinsik. Hasilnya batas kolom
 * bergeser beberapa piksel antar baris, dan pada dokumen bergaris itu langsung
 * terlihat ceroboh.
 *
 * Sekarang satu `<table class="table-fixed">` dengan SATU `<colgroup>`: batas
 * kolom dihitung sekali untuk seluruh kartu, jadi tidak ada lagi baris yang
 * bisa menghitungnya sendiri. Alasan yang sama dengan blanko harian, yang juga
 * memakai satu tabel supaya semua garisnya bertemu.
 *
 * Tidak menggambar apa pun bila tidak ada foto: halaman kosong berjudul
 * "DOKUMENTASI PEKERJAAN" hanya membuat pembaca mengira fotonya hilang.
 */

const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Tiga kolom untuk DUA batas, sama persis dengan PDF:
 *   batas label  (kolom 1 | 2+3) = 1,1 : 3,4  → 24,444%
 *   batas bobot  (kolom 1+2 | 3) = 4,2 : 1    → 80,769%
 */
const KOL = ["24.444%", "56.325%", "19.231%"];

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
    <table className="w-full table-fixed border-collapse break-inside-avoid text-[9px]">
      <colgroup>
        {KOL.map((w) => (
          <col key={w} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {/* Kop pelaksana — sama di tiap kartu, seperti contoh KKP. */}
        <tr>
          <Sel colSpan={3} tengah className="h-[34px]">
            <div className="text-[8px] leading-tight font-bold uppercase">{vendor.nama ?? ""}</div>
            {vendor.alamat ? (
              <div className="text-[6.5px] leading-tight text-ink-muted">{vendor.alamat}</div>
            ) : null}
          </Sel>
        </tr>
        <tr>
          <Sel colSpan={3} className="bg-slate-50 text-center text-[10px] font-bold uppercase">
            Dokumentasi Pekerjaan
          </Sel>
        </tr>
        <tr>
          <Sel>Pekerjaan</Sel>
          <Sel colSpan={2} className="font-semibold">
            {kartu[0]?.pekerjaan ?? "(tanpa item pekerjaan)"}
          </Sel>
        </tr>
        <tr>
          <Sel>Bangunan</Sel>
          <Sel colSpan={2}>{kartu[0]?.kategori ?? "—"}</Sel>
        </tr>

        {kartu.map((f, i) => (
          <FotoBaris key={`f${i}`} f={f} />
        ))}
      </tbody>
    </table>
  );
}

/** Judul + gambar satu foto. Dipisah supaya kedua barisnya tidak terpisah halaman. */
function FotoBaris({ f }: { f: FotoCetak }) {
  return (
    <>
      <tr>
        <Sel colSpan={2} className="bg-slate-50 text-center text-[7px] font-semibold uppercase">
          {f.pekerjaan ?? "Dokumentasi lapangan"}
        </Sel>
        <Sel className="bg-slate-50 text-center text-[7px] font-semibold uppercase">Bobot (%)</Sel>
      </tr>
      <tr>
        <Sel colSpan={2} tengah className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.url} alt="" className="mx-auto max-h-[46mm] w-auto max-w-full object-contain" />
        </Sel>
        {/* Bobot DIISI bila diketahui — angkanya sudah ada di sistem, jadi
            mengosongkannya justru menyuruh orang menghitung ulang. */}
        <Sel tengah className="text-center text-[9px] font-bold tabular-nums">
          {f.bobot != null ? pctFmt.format(f.bobot) : ""}
        </Sel>
      </tr>
    </>
  );
}

/**
 * `tengah` memilih `align-middle`, bukan menumpuknya di atas `align-top`.
 * Dua utility Tailwind untuk properti yang sama tidak ditentukan urutan
 * penulisannya di atribut class, melainkan urutan di stylesheet — menumpuk
 * keduanya berarti menyerahkan hasilnya pada kebetulan.
 */
function Sel({
  children,
  colSpan,
  tengah,
  className = "",
}: {
  children?: React.ReactNode;
  colSpan?: number;
  tengah?: boolean;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border border-slate-500 px-1.5 py-0.5 ${tengah ? "align-middle" : "align-top"} ${className}`}
    >
      {children}
    </td>
  );
}
