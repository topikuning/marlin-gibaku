import { formatNumber, formatPct, formatRupiah } from "@/lib/format";
import type { SimulasiRapl } from "@/lib/ahsp/rapl";
import type { KeadaanHarga } from "@/lib/ahsp/hsd";

/**
 * Lembar RAPL untuk dicetak A4 (DECISIONS 327).
 *
 * ### Kenapa cakupan ditaruh di ATAS, bukan di catatan kaki
 *
 * Lembar ini keluar dari MARLIN dan hidup sendiri: dibawa ke rapat, difoto,
 * dikirim WhatsApp. Semua peringatan di layar hilang; yang tersisa cuma angka
 * di kertas. Biaya Rp x yang tidak menyebut bahwa ia baru menutup 72% nilai RAB
 * akan dibaca sebagai biaya seluruh proyek — dan selisihnya terhadap nilai proyek
 * akan dibaca sebagai untung. Karena itu cakupan bukan lampiran; ia bagian dari
 * angkanya.
 */

const LABEL: Record<string, string> = {
  bahan: "Bahan",
  upah: "Upah / tenaga kerja",
  alat: "Peralatan",
  fasilitas: "Fasilitas",
};

export function RaplLembar({
  lokasi,
  paket,
  wilayah,
  kontrak,
  penyedia,
  sumberAhsp,
  shaAhsp,
  dicetakOleh,
  rapl,
  harga,
}: {
  lokasi: string;
  paket: string;
  wilayah: string;
  kontrak: string | null;
  penyedia: string | null;
  sumberAhsp: string;
  shaAhsp: string;
  dicetakOleh: string;
  rapl: SimulasiRapl;
  harga: KeadaanHarga;
}) {
  const pctNilai =
    rapl.nilaiRab > 0n ? (Number(rapl.dipakai.nilai) / Number(rapl.nilaiRab)) * 100 : 0;
  const pctHarga = harga.baris.length > 0 ? (harga.berharga / harga.baris.length) * 100 : 0;
  const p = harga.perbandingan;

  // Yang dicetak dibatasi 60 baris terbesar per kategori: lembar A4 yang
  // memuat 300 baris tidak terbaca, dan yang dipotong DISEBUTKAN jumlahnya —
  // bukan dihilangkan diam-diam.
  const BATAS = 60;

  return (
    <div className="text-[11px] text-black">
      <header className="mb-3 border-b-2 border-black pb-2">
        <h1 className="text-center text-[15px] font-bold uppercase">
          Rencana Anggaran Pelaksanaan Lapangan
        </h1>
        <p className="text-center text-[12px]">Kebutuhan Sumber Daya &amp; Biaya Pelaksanaan</p>
      </header>

      <table className="mb-3 w-full">
        <tbody>
          <Baris k="Lokasi" v={lokasi} k2="Paket" v2={paket} />
          <Baris k="Wilayah" v={wilayah} k2="Kontrak" v2={kontrak ?? "–"} />
          <Baris k="Penyedia jasa" v={penyedia ?? "–"} k2="Dicetak oleh" v2={dicetakOleh} />
        </tbody>
      </table>

      <section className="mb-3 border border-black p-2">
        <p className="mb-1 text-[12px] font-bold uppercase">Cakupan angka di lembar ini</p>
        <table className="w-full">
          <tbody>
            <tr>
              <td className="w-[58%] py-0.5">Nilai RAB yang masuk hitungan kebutuhan</td>
              <td className="py-0.5 text-right font-semibold">
                {formatRupiah(rapl.dipakai.nilai)} dari {formatRupiah(rapl.nilaiRab)} (
                {formatPct(pctNilai, 1)})
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Sumber daya yang sudah berharga</td>
              <td className="py-0.5 text-right font-semibold">
                {harga.berharga} dari {harga.baris.length} ({formatPct(pctHarga, 1)})
              </td>
            </tr>
          </tbody>
        </table>
        {pctNilai < 99.95 || pctHarga < 99.95 ? (
          <p className="mt-1.5 border-t border-black pt-1 leading-snug">
            <strong>Angka di lembar ini BELUM mencakup seluruh proyek.</strong> Biaya yang belum
            masuk akan MENAMBAH total dan MENGECILKAN selisih terhadap nilai RAB aktif – jadi selisih
            di bawah belum boleh dibaca sebagai keuntungan.
          </p>
        ) : null}
      </section>

      <section className="mb-3 border border-black">
          <table className="w-full">
            <tbody>
              <tr className="border-b border-black">
                <td className="w-[58%] px-2 py-1">Biaya pelaksanaan menurut RAPL</td>
                <td className="px-2 py-1 text-right font-bold">{formatRupiah(harga.totalBiaya)}</td>
              </tr>
              <tr className="border-b border-black">
                <td className="px-2 py-1">Nilai RAB aktif (pra-PPN)</td>
                <td className="px-2 py-1 text-right font-bold">{formatRupiah(p.nilaiProyek)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1">{p.keandalan.utuh ? "Potensi margin pelaksanaan" : "Selisih sementara"}</td>
                <td className="px-2 py-1 text-right font-bold">
                  {formatRupiah(p.margin)} ({formatPct(p.marginPersen, 1)})
                </td>
              </tr>
            </tbody>
          </table>
      </section>

      {harga.perKategori.map((kat) => {
        const baris = harga.baris
          .filter((b) => b.kategori === kat.kategori)
          .sort((a, b) => (b.biaya === null ? 0 : Number(b.biaya)) - (a.biaya === null ? 0 : Number(a.biaya)) || b.jumlah - a.jumlah);
        const tampil = baris.slice(0, BATAS);
        return (
          <section key={kat.kategori} className="mb-3 break-inside-avoid">
            <p className="mb-1 text-[12px] font-bold uppercase">
              {LABEL[kat.kategori] ?? kat.kategori} – {formatRupiah(kat.biaya)}
              <span className="ms-2 text-[10px] font-normal">
                ({kat.berharga} dari {kat.total} berharga)
              </span>
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-neutral-200">
                  <th className="border border-black px-1 py-0.5 text-left">Sumber daya</th>
                  <th className="border border-black px-1 py-0.5 text-right">Kebutuhan</th>
                  <th className="border border-black px-1 py-0.5 text-left">Sat.</th>
                  <th className="border border-black px-1 py-0.5 text-right">Harga satuan</th>
                  <th className="border border-black px-1 py-0.5 text-right">Biaya</th>
                </tr>
              </thead>
              <tbody>
                {tampil.map((b) => (
                  <tr key={`${b.nama}|${b.satuan}`}>
                    <td className="border border-black px-1 py-0.5">{b.nama}</td>
                    <td className="border border-black px-1 py-0.5 text-right">
                      {formatNumber(b.jumlah)}
                    </td>
                    <td className="border border-black px-1 py-0.5">{b.satuan || "–"}</td>
                    <td className="border border-black px-1 py-0.5 text-right">
                      {b.harga === null ? "–" : formatRupiah(b.harga)}
                    </td>
                    <td className="border border-black px-1 py-0.5 text-right">
                      {b.biaya === null ? "belum berharga" : formatRupiah(b.biaya)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {baris.length > tampil.length ? (
              <p className="mt-0.5 text-[10px] italic">
                {baris.length - tampil.length} baris lain tidak dicetak (lembar A4 tidak memuat).
                Daftar lengkapnya ada di unduhan Excel.
              </p>
            ) : null}
          </section>
        );
      })}

      <footer className="mt-4 border-t border-black pt-2 text-[10px] leading-snug">
        <p>
          Sumber analisa: {sumberAhsp}. Versi berkas (sha256): {shaAhsp}.
        </p>
        <p>
          Kebutuhan dihitung Σ (koefisien analisa AHSP × volume item RAB), hanya dari padanan yang
          sudah disetujui. Harga satuan dasar diisi per lokasi.
        </p>
      </footer>

      <div className="mt-8 grid grid-cols-3 gap-4 break-inside-avoid text-center text-[11px]">
        {["Disusun oleh", "Diperiksa oleh", "Disetujui oleh"].map((peran) => (
          <div key={peran}>
            <p>{peran}</p>
            <div className="h-16" />
            <p className="border-t border-black pt-1">( ………………………………… )</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Baris({ k, v, k2, v2 }: { k: string; v: string; k2: string; v2: string }) {
  return (
    <tr>
      <td className="w-[15%] py-0.5 align-top font-semibold">{k}</td>
      <td className="w-[35%] py-0.5 align-top">: {v}</td>
      <td className="w-[15%] py-0.5 align-top font-semibold">{k2}</td>
      <td className="py-0.5 align-top">: {v2}</td>
    </tr>
  );
}
