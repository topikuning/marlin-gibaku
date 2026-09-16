import Link from "next/link";
import type { KelompokLokasiKembar, LaporanLokasiKembar } from "@/lib/package/lokasi-kembar";
import { usulNamaPembeda } from "@/lib/package/lokasi-kembar";

/**
 * Daftar lokasi ganda yang TERLANJUR ada, beserta cara memperbaikinya.
 *
 * Bukan tombol "rapikan otomatis": dua lokasi untuk satu desa masing-masing
 * membawa RAB, laporan final, dan foto ber-cap dengan riwayat sendiri, dan
 * menggabungkannya diam-diam persis melanggar aturan proyek soal angka yang
 * diunggah orang. Yang disajikan di sini adalah BUKTI — mana yang berisi, mana
 * yang kosong — supaya keputusannya bisa diambil dengan mata terbuka.
 */

function isiRingkas(a: KelompokLokasiKembar["anggota"][number]): string {
  if (a.kosong) return "kosong – belum ada RAB, laporan, maupun foto";
  const bagian: string[] = [];
  if (a.punyaRab) bagian.push("RAB aktif");
  if (a.laporan > 0) bagian.push(`${a.laporan} laporan`);
  if (a.foto > 0) bagian.push(`${a.foto} foto`);
  return bagian.join(" · ");
}

function Kelompok({
  g,
  sarankanNama,
}: {
  g: KelompokLokasiKembar;
  sarankanNama: boolean;
}) {
  return (
    <li className="rounded-lg border border-line bg-surface-muted p-3">
      <ul className="space-y-2">
        {g.anggota.map((a) => (
          <li key={a.id} className="text-[13px]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link href={`/lokasi/${a.slug}`} className="font-medium text-brand hover:underline">
                {a.name}
              </Link>
              <span className="text-ink-muted">{a.packageName}</span>
            </div>
            <div className="text-ink-muted">
              {[a.village, a.district, a.regency].filter(Boolean).join(", ")}
            </div>
            <div className="text-ink-muted">{isiRingkas(a)}</div>
            {sarankanNama ? (
              <div className="text-ink-muted">
                Usul nama pembeda: <span className="font-medium">{usulNamaPembeda(a)}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function LokasiKembarPanel({ laporan }: { laporan: LaporanLokasiKembar }) {
  const bersih = laporan.sePaket.length === 0 && laporan.desaGanda.length === 0;
  if (bersih) {
    return (
      <p className="text-[13px] text-ink-muted">
        Tidak ada lokasi kembar. Nama desa yang sama di paket berbeda tidak dihitung sebagai
        kembar – itu lumrah dan tidak mengganggu apa pun.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {laporan.sePaket.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">
            Nama kembar di satu paket ({laporan.sePaket.length})
          </h3>
          <p className="text-[13px] text-ink-muted">
            Berkas Google Drive dipilah ke lokasi lewat NAMA, dari daftar lokasi satu paket. Dua
            nama kembar membuatnya memilih salah satu tanpa dasar – berkas lapangan bisa terarsip
            di lokasi yang salah. Perbaikannya murah: buka lokasinya, ubah namanya jadi berbeda.
            Tidak ada angka yang bergerak.
          </p>
          <ul className="space-y-2">
            {laporan.sePaket.map((g) => (
              <Kelompok key={`p-${g.kunci}-${g.anggota[0].id}`} g={g} sarankanNama />
            ))}
          </ul>
        </section>
      ) : null}

      {laporan.desaGanda.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">
            Satu desa terdaftar dua kali ({laporan.desaGanda.length})
          </h3>
          <p className="text-[13px] text-ink-muted">
            Desa yang sama dijalankan sebagai dua lokasi, jadi angkanya terpecah dan tidak ada satu
            layar pun yang menjumlahkannya. Sistem tidak menggabungkannya sendiri – RAB, laporan
            final, dan foto ber-cap masing-masing punya riwayat. Yang kosong aman dilepas; kalau
            keduanya berisi, putuskan mana yang dipertahankan lalu pindahkan sisanya lewat jalur
            yang sudah ada.
          </p>
          <ul className="space-y-2">
            {laporan.desaGanda.map((g) => (
              <Kelompok key={`d-${g.kunci}-${g.anggota[0].id}`} g={g} sarankanNama={false} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
