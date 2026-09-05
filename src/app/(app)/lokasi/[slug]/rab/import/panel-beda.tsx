"use client";

import { useState } from "react";
import { formatRupiah, formatRupiahSatuan } from "@/lib/format";
import type { BedaPratinjau } from "./actions";

/**
 * Panel "apa yang berubah" pada pratinjau impor RAB / adendum.
 *
 * Dipisah dari `import-form.tsx` supaya bisa DIUJI: berkas form mengimpor
 * server action `importHps`, dan ikut menyeret `db` + validasi env ke dalam
 * proses uji. Di sini yang diimpor cuma TIPE-nya (dihapus saat kompilasi),
 * jadi panelnya bisa dirender sendirian.
 */

/**
 * Daftar beda yang BISA DIBUKA SELURUHNYA.
 *
 * Keluhan user 2026-09-03: *"+31 lainnya, ini kan konyol; tujuan pratinjau itu
 * kan lihat apa-apa yang berbeda, kalau tidak bisa apa gunanya. ini soal
 * adendum, harus jelas semua agar ketahuan."*
 *
 * Betul: memotong daftar di angka 8 mengubah pratinjau audit jadi cuplikan.
 * Yang tersembunyi justru bagian yang paling mungkin luput — kalau delapan
 * teratas sudah cukup, tidak akan ada yang membuka daftarnya sama sekali.
 * Datanya memang sudah lengkap sampai ke layar; hanya penyajiannya yang
 * memotong.
 *
 * Tetap dibuka RINGKAS supaya panel tidak jadi gulungan sepanjang halaman,
 * tapi seluruh isinya selalu satu ketukan jauhnya, dengan jumlah yang disebut
 * apa adanya di tombolnya.
 */
function DaftarBeda<T>({
  items,
  kunci,
  baris,
  awal = 8,
  kelas,
}: {
  items: T[];
  kunci: (x: T, i: number) => string;
  baris: (x: T) => React.ReactNode;
  awal?: number;
  kelas?: string;
}) {
  const [semua, setSemua] = useState(false);
  const lebih = items.length > awal;
  const tampil = semua ? items : items.slice(0, awal);
  return (
    <>
      <ul
        className={`mt-1 space-y-1 text-ink-muted ${kelas ?? ""} ${
          semua && lebih ? "max-h-80 overflow-y-auto overscroll-contain pr-1" : ""
        }`}
      >
        {tampil.map((x, i) => (
          <li key={kunci(x, i)}>{baris(x)}</li>
        ))}
      </ul>
      {lebih ? (
        <button
          type="button"
          onClick={() => setSemua((v) => !v)}
          className="mt-1.5 text-[12px] font-medium text-primary hover:underline"
        >
          {semua
            ? `Ringkas – tampilkan ${awal} teratas`
            : `Lihat semua ${items.length} item (${items.length - awal} belum tampil)`}
        </button>
      ) : null}
    </>
  );
}

/**
 * Kode item BESERTA kategorinya, mis. "II · 2.d".
 *
 * Keluhan user 2026-09-05: *"2.d, 2.e itu yang mana, ada banyak kategori di
 * sini, seharusnya sekalian sebutkan parentnya, misal II 2.d, atau IV 11.c,
 * kalau gak gitu kan konyol"*. Nomor item hanya unik di dalam kategorinya;
 * berkas berdelapan-belas kategori membuat "2.d" jadi teka-teki, bukan alamat.
 */
function Jalur({ x }: { x: { jalur?: string; code: string } }) {
  return <span className="font-medium text-ink">{x.jalur || x.code}</span>;
}

export function PanelBeda({ beda }: { beda: BedaPratinjau }) {
  const selisih = Number(beda.totalBaru) - Number(beda.totalAktif);
  const berisiko = beda.itemHilang.filter((i) => i.realisasi > 0);
  const dibawah = beda.volumeBerubah.filter((v) => v.dibawahRealisasi);
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3 text-[13px]">
      <p className="font-medium text-ink">Perubahan terhadap RAB aktif</p>
      <p className="text-ink-muted">
        Nilai: <span className="tabular">{formatRupiah(Number(beda.totalAktif))}</span> →{" "}
        <span className="tabular font-medium text-ink">{formatRupiah(Number(beda.totalBaru))}</span>{" "}
        <span className={selisih === 0 ? "" : selisih > 0 ? "text-warning" : "text-danger"}>
          ({selisih >= 0 ? "+" : "−"}
          {formatRupiah(Math.abs(selisih))})
        </span>
      </p>
      <p className="text-ink-muted">
        {beda.itemBaru.length} item baru · {beda.volumeBerubah.length} volume berubah ·{" "}
        {beda.itemHilang.length} item hilang · {beda.jumlahTetap} tetap
      </p>

      {/* Rincian ketiga golongan di atas. Dulu hanya ANGKANYA yang tampil:
          "12 volume berubah" tanpa satu pun cara melihat yang mana. Untuk
          adendum itu tidak cukup — yang diperiksa justru barisnya. Blok merah
          di bawah tetap ada karena tugasnya berbeda: menyorot yang berbahaya
          supaya tak mungkin terlewat, bukan menggantikan daftar lengkapnya. */}
      {beda.volumeBerubah.length > 0 ? (
        <div className="rounded border border-border px-2.5 py-2">
          <p className="font-medium text-ink">{beda.volumeBerubah.length} item volumenya berubah</p>
          <DaftarBeda
            items={beda.volumeBerubah}
            kunci={(v) => v.code + v.name}
            baris={(v) => (
              <>
                <Jalur x={v} /> {v.name} – <span className="tabular">{v.dari ?? "–"}</span> →{" "}
                <span className="tabular font-medium text-ink">{v.ke ?? "–"}</span>
                {v.realisasi > 0 ? `, sudah dikerjakan ${v.realisasi}` : null}
                {v.dibawahRealisasi ? (
                  <span className="ml-1 rounded bg-danger-soft px-1 text-danger">di bawah realisasi</span>
                ) : null}
              </>
            )}
          />
        </div>
      ) : null}

      {beda.itemBaru.length > 0 ? (
        <div className="rounded border border-border px-2.5 py-2">
          <p className="font-medium text-ink">{beda.itemBaru.length} item baru</p>
          <DaftarBeda
            items={beda.itemBaru}
            kunci={(i) => i.code + i.name}
            baris={(i) => (
              <>
                <Jalur x={i} /> {i.name}
              </>
            )}
          />
        </div>
      ) : null}

      {beda.itemHilang.length > 0 ? (
        <div className="rounded border border-border px-2.5 py-2">
          <p className="font-medium text-ink">{beda.itemHilang.length} item kontrak tidak ada di file ini</p>
          <DaftarBeda
            items={beda.itemHilang}
            kunci={(i) => i.code + i.name}
            baris={(i) => (
              <>
                <Jalur x={i} /> {i.name}
                {i.realisasi > 0 ? (
                  <span className="ml-1 rounded bg-danger-soft px-1 text-danger">
                    realisasi {i.realisasi}
                  </span>
                ) : null}
              </>
            )}
          />
        </div>
      ) : null}

      {/* Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). Adendum
          mengubah volume; harga yang sudah disepakati seharusnya tetap. Ini
          disebut terpisah karena bisa terjadi TANPA satu pun volume berubah —
          bentuk yang paling mudah lolos dari pemeriksaan sepintas. */}
      {beda.hargaBerubah.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            Harga satuan {beda.hargaBerubah.length} item KONTRAK LAMA berubah
          </p>
          <p className="mt-0.5 text-ink-muted">
            Adendum mengubah volume – harga item yang sudah ada di kontrak seharusnya tetap. Dampak
            neto{" "}
            <span className="tabular font-medium">
              {formatRupiah(Number(beda.hargaBerubah.reduce((t, h) => t + BigInt(h.dampakRupiah), 0n)))}
            </span>{" "}
            tanpa ada pekerjaan yang bertambah.
          </p>
          {/* Nama KONTRAK di samping nama FILE. Panel lama hanya mencetak nama
              dari file baru bersama harga dari item lama, jadi pasangan yang
              meleset (nomor bergeser) terbaca sebagai "harga berubah" dan tidak
              ada satu pun cara melihatnya di layar. */}
          <DaftarBeda
            items={beda.hargaBerubah}
            kunci={(h) => h.lineageKey}
            baris={(h) => (
              <>
                <span className="block">
                  <span className="text-ink-muted">Kontrak</span> <Jalur x={h} /> {h.namaLama} –{" "}
                  <span className="tabular">{formatRupiahSatuan(h.dari)}</span>
                </span>
                <span className="block">
                  <span className="text-ink-muted">File</span> <Jalur x={h} /> {h.name} –{" "}
                  <span className="tabular font-medium text-ink">{formatRupiahSatuan(h.ke)}</span>{" "}
                  <span className={Number(h.dampakRupiah) >= 0 ? "text-warning" : "text-danger"}>
                    ({Number(h.dampakRupiah) >= 0 ? "+" : "−"}
                    {formatRupiah(Math.abs(Number(h.dampakRupiah)))})
                  </span>
                  {h.namaLama !== h.name ? (
                    <span className="ml-1 rounded bg-danger-soft px-1 text-danger">
                      nama berbeda
                    </span>
                  ) : null}
                </span>
              </>
            )}
          />
        </div>
      ) : null}

      {/* Nilai item KONTRAK LAMA yang bergeser SENDIRI: volume tetap, harga
          tetap, kolom JUMLAH berbeda. Berkas RAB memakai kolom JUMLAH apa
          adanya (DECISIONS 212), jadi ini menggeser nilai kontrak tanpa satu
          pun volume atau harga bergerak – bentuk yang sebelumnya terhitung
          "tetap" dan tidak muncul di daftar mana pun. */}
      {beda.nilaiBergeser.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            Nilai {beda.nilaiBergeser.length} item KONTRAK LAMA bergeser tanpa volume atau harga berubah
          </p>
          <p className="mt-0.5 text-ink-muted">
            Kolom JUMLAH di file berbeda dari kontrak padahal volume dan harga satuannya sama. Selisih neto{" "}
            <span className="tabular font-medium">
              {formatRupiah(Number(beda.nilaiBergeser.reduce((t, h) => t + BigInt(h.selisih), 0n)))}
            </span>
            .
          </p>
          <DaftarBeda
            items={beda.nilaiBergeser}
            kunci={(h) => h.lineageKey}
            baris={(h) => (
              <>
                <Jalur x={h} /> {h.name} – <span className="tabular">{formatRupiah(Number(h.dari))}</span> →{" "}
                <span className="tabular font-medium text-ink">{formatRupiah(Number(h.ke))}</span>{" "}
                <span className={Number(h.selisih) >= 0 ? "text-warning" : "text-danger"}>
                  ({Number(h.selisih) >= 0 ? "+" : "\u2212"}
                  {formatRupiah(Math.abs(Number(h.selisih)))})
                </span>
              </>
            )}
          />
        </div>
      ) : null}

      {/* Yang paling mahal disebut lebih dulu: pekerjaan yang SUDAH dikerjakan
          tapi tidak ada di file baru — realisasinya lepas dari RAB. */}
      {berisiko.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            {berisiko.length} item yang SUDAH dikerjakan tidak ada di file ini
          </p>
          <DaftarBeda
            items={berisiko}
            kelas="list-disc pl-4"
            kunci={(i) => i.code + i.name}
            baris={(i) => (
              <>
                <Jalur x={i} /> {i.name} – realisasi {i.realisasi}
              </>
            )}
          />
        </div>
      ) : null}

      {dibawah.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            {dibawah.length} item volumenya turun DI BAWAH yang sudah dikerjakan
          </p>
          <DaftarBeda
            items={dibawah}
            kelas="list-disc pl-4"
            kunci={(v) => v.code + v.name}
            baris={(v) => (
              <>
                <Jalur x={v} /> {v.name} – {v.dari} → {v.ke}, sudah dikerjakan {v.realisasi}
              </>
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
