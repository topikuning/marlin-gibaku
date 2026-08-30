"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellValueChangedEvent } from "ag-grid-community";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { MarlinGrid, type MarlinGridApi } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import { perluTarikUlang, type RingkasUsulanAi } from "@/lib/ahsp/usulan-status";
import { kolomHarga, LABEL_KATEGORI, type Baris, type BarisHargaRow } from "./harga-kolom";
import {
  mintaUsulanHargaAiAction,
  simpanHargaSel,
  statusUsulanHargaAiAction,
  terapkanUsulanHargaAiAction,
  tolakUsulanHargaAiAction,
} from "@/lib/ahsp/hsd-actions";

/**
 * Pengisian HARGA SATUAN DASAR memakai MarlinGrid (DECISIONS 328), dengan draf
 * AI yang TERSIMPAN DI SERVER (DECISIONS 475).
 *
 * Yang berubah dari versi pertama, dan alasannya:
 *
 * - **Draf tidak lagi tinggal di `useState`** (RAPL-02). Subtab RAPL berbasis
 *   URL, jadi menekan "Ringkasan" membongkar komponen ini dan menghapus hasil
 *   yang baru ditunggu semenit lebih. Orang lalu menyetujui tanpa memeriksa,
 *   karena memeriksa berarti kehilangan.
 * - **Layar menunggu, bukan request** (RAPL-01). Permintaan hanya mencatat;
 *   halaman menarik ulang dirinya sampai drafnya muncul.
 * - **Grid menyaring ke baris yang PUNYA usulan** begitu drafnya datang
 *   (RAPL-04) — sebelumnya usulan dijatuhkan ke kolom yang harus dicari
 *   sendiri di antara ratusan baris.
 * - **Terima/tolak per baris** (RAPL-05). Persetujuan yang tidak bisa sebagian
 *   bukan persetujuan.
 */

export type { BarisHargaRow };

export type UsulanDrafRow = {
  id: string;
  kategori: string;
  nama: string;
  satuan: string;
  harga: string;
  keyakinan: string;
  alasan: string;
};

export type KeadaanUsulanView = {
  menunggu: boolean;
  terputus: boolean;
  pendingSinceMs: number | null;
  model: string | null;
  error: string | null;
  diminta: number;
  totalKosong: number;
  draf: UsulanDrafRow[];
};

const kunci = (r: { kategori: string; nama: string; satuan: string }) =>
  JSON.stringify([r.kategori, r.nama, r.satuan.trim().toLowerCase()]);

export function HargaPanel({
  locationId,
  slug,
  rows,
  canInput,
  canUseAi,
  usulan,
}: {
  locationId: string;
  slug: string;
  rows: BarisHargaRow[];
  canInput: boolean;
  canUseAi: boolean;
  usulan: KeadaanUsulanView;
}) {
  const router = useRouter();
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [, mulaiSimpan] = useTransition();
  /*
   * Berapa simpanan harga yang sedang di jalan.
   *
   * Sel AG Grid bersifat optimis: angka yang diketik sudah tampil sebelum
   * server menjawab, jadi "tersimpan" dan "sedang menyimpan" terlihat persis
   * sama. Pada kolom uang itu bukan perkara rasa — orang berpindah sel cepat,
   * dan tanpa penanda ia tidak punya cara tahu apakah yang barusan diketik
   * sudah mendarat.
   *
   * Ref-nya dipakai untuk keputusan di dalam penangan (nilai state di sana
   * sudah basi karena tertutup closure); state-nya untuk merender penandanya.
   */
  const simpanBerjalan = useRef(0);
  const [menyimpan, setMenyimpan] = useState(0);
  const [aiPending, mulaiAi] = useTransition();
  const [putusanPending, mulaiPutusan] = useTransition();
  const [dicentang, setDicentang] = useState<Baris[]>([]);
  const grid = useRef<MarlinGridApi>(null);

  /**
   * Melepas centang di GRID sekaligus di hitungan React — keduanya, selalu.
   *
   * Pilihan barisnya dipegang AG Grid; mengosongkan `dicentang` saja hanya
   * mengubah angka di tombol. Karena baris dikenali `getRowId`, centangnya
   * bertahan melewati penyegaran data, dan yang tersisa adalah baris menyala
   * dengan tombol mati di atasnya. Dijadikan satu penolong supaya tidak ada
   * jalur yang cuma mengerjakan separuhnya; dijaga
   * `tests/unit/grid-pilihan-dilepas.test.ts`.
   */
  const lepasCentang = () => {
    grid.current?.kosongkanPilihan();
    setDicentang([]);
  };
  const [hanyaUsulan, setHanyaUsulan] = useState(true);
  const [detik, setDetik] = useState(0);
  const jumlahDraf = usulan.draf.length;

  /*
   * Menunggu di layar, bukan di dalam request (pola DECISIONS 455).
   *
   * Yang berdenyut tiap 3 detik adalah PENENGOKAN status, bukan penarikan
   * seluruh halaman. Versi pertama memanggil `router.refresh()` tanpa syarat,
   * dan itu menjalankan ulang keenam kueri `RaplPage` — termasuk perhitungan
   * RAPL atas ratusan baris RAB — dua puluh kali per menit hanya untuk membaca
   * satu boolean. Sekarang halaman ditarik ulang hanya ketika status ringkasnya
   * memang berubah; aturannya di `perluTarikUlang`, diuji terpisah.
   *
   * Detiknya dihitung dari `pendingSinceMs` supaya tetap benar bila halaman
   * ditinggal lalu dibuka lagi.
   */
  useEffect(() => {
    if (!usulan.menunggu || usulan.pendingSinceMs == null) return;
    const pending = usulan.pendingSinceMs;
    const hitung = () => setDetik(Math.max(0, Math.round((Date.now() - pending) / 1000)));
    hitung();
    const jam = setInterval(hitung, 1000);

    /*
     * Pembanding diambil dari yang SEDANG dirender layar. `jumlahDraf` dan
     * `terputus` ikut jadi dependensi supaya sesudah penarikan ulang,
     * pembandingnya ikut disegarkan — kalau tidak, denyut berikutnya masih
     * membandingkan dengan keadaan lama dan menarik ulang berulang-ulang.
     */
    const semula: RingkasUsulanAi = {
      menunggu: usulan.menunggu,
      terputus: usulan.terputus,
      jumlahDraf,
    };
    let berhenti = false;
    const tarik = setInterval(() => {
      void statusUsulanHargaAiAction({ locationId }).then((hasil) => {
        // Penengokan yang gagal diabaikan diam-diam: ia akan diulang 3 detik
        // lagi, dan spanduk galat yang berkedip tiap denyut lebih menakutkan
        // daripada gangguan jaringan yang sebenarnya terjadi.
        if (berhenti || !hasil.ok) return;
        if (perluTarikUlang(semula, hasil.status)) router.refresh();
      });
    }, 3000);

    return () => {
      berhenti = true;
      clearInterval(jam);
      clearInterval(tarik);
    };
  }, [
    usulan.menunggu,
    usulan.terputus,
    usulan.pendingSinceMs,
    jumlahDraf,
    locationId,
    router,
  ]);

  const drafPerKunci = useMemo(
    () => new Map(usulan.draf.map((u) => [kunci(u), u])),
    [usulan.draf],
  );

  const baris: Baris[] = useMemo(
    () =>
      rows.map((r) => {
        const d = drafPerKunci.get(kunci(r));
        return {
          ...r,
          hargaNum: r.harga === null ? null : Number(r.harga),
          biayaNum: r.biaya === null ? null : Number(r.biaya),
          rekomendasiTeks: r.rekomendasi
            .map((k) => `${formatRupiahShort(BigInt(k.harga))} · ${k.lokasi}${k.seKabupaten ? " (sekab.)" : ""}`)
            .join("  |  "),
          usulanId: d?.id ?? null,
          usulanAiNum: d ? Number(d.harga) : null,
          keyakinanAi: d?.keyakinan ?? "",
          alasanAi: d?.alasan ?? "",
        };
      }),
    [rows, drafPerKunci],
  );

  const adaDraf = usulan.draf.length > 0;
  /*
   * Saringan bawaan mengikuti pekerjaan yang sedang berjalan: begitu draf
   * datang, yang perlu dilihat orang adalah 25 baris itu — bukan 300 baris
   * tempat 25 itu bersembunyi.
   */
  const tampil = useMemo(
    () => (adaDraf && hanyaUsulan ? baris.filter((b) => b.usulanId !== null) : baris),
    [adaDraf, hanyaUsulan, baris],
  );

  const kolom = useMemo(() => kolomHarga({ canInput, adaDraf }), [canInput, adaDraf]);

  const belum = rows.filter((r) => r.harga === null).length;
  const centangBerdraf = dicentang.filter((d) => d.usulanId !== null);
  const centangKosong = dicentang.filter((d) => d.harga === null);

  const putuskan = (
    ids: string[],
    aksi: typeof terapkanUsulanHargaAiAction | typeof tolakUsulanHargaAiAction,
  ) => {
    setPesan(null);
    mulaiPutusan(async () => {
      const hasil = await aksi({ locationId, slug, ids });
      if (!hasil.ok) {
        setPesan({ tone: "error", teks: hasil.error });
        return;
      }
      lepasCentang();
      setPesan({
        tone: "success",
        teks:
          "tersimpan" in hasil
            ? `${hasil.tersimpan.length} usulan diterima dan masuk kalkulasi RAPL${hasil.dilewat > 0 ? ` – ${hasil.dilewat} dilewati karena sudah berharga` : ""}.`
            : `${hasil.ditolak} usulan ditolak dan tidak akan ditawarkan lagi.`,
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}

      {usulan.menunggu ? (
        <Banner
          tone="info"
          title={`Draf harga sedang disusun – ${detik} detik`}
          description="Permintaannya sudah tercatat, jadi halaman ini boleh ditinggal. Hasilnya muncul di sini sendiri saat siap, dan tetap ada saat kamu kembali."
        />
      ) : null}

      {usulan.terputus ? (
        <Banner
          tone="warning"
          title="Permintaan draf harga sebelumnya tidak selesai"
          description="Prosesnya berhenti sebelum menjawab – bisa karena aplikasi di-deploy ulang. Silakan minta lagi."
        />
      ) : null}

      {!usulan.menunggu && usulan.error ? (
        <Banner tone="error" title="Permintaan draf harga gagal" description={usulan.error} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-inset px-3 py-2">
        <p className="min-w-[240px] flex-1 text-[13px] text-ink-muted">
          {canInput ? (
            <>Klik sel <strong>Harga satuan</strong> untuk input manual. Enter berpindah ke baris berikutnya.</>
          ) : (
            <>Harga hanya dapat diubah oleh pengguna dengan hak input keuangan.</>
          )}
        </p>

        {menyimpan > 0 ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-[13px] text-ink-muted"
          >
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Menyimpan {menyimpan} harga…
          </p>
        ) : null}

        {canInput && canUseAi && belum > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={aiPending}
            disabled={usulan.menunggu}
            onClick={() => {
              setPesan(null);
              const dipilih = centangKosong.map((d) => kunci(d));
              mulaiAi(async () => {
                const hasil = await mintaUsulanHargaAiAction({ locationId, slug, dipilih });
                if (!hasil.ok) {
                  setPesan({ tone: "error", teks: hasil.error });
                  return;
                }
                lepasCentang();
                setPesan({
                  tone: "success",
                  teks: `Permintaan ${hasil.diminta} draf harga tercatat${
                    hasil.totalKosong > hasil.diminta
                      ? ` – ${hasil.totalKosong - hasil.diminta} sumber daya lain belum ikut dimintakan`
                      : ""
                  }.`,
                });
                router.refresh();
              });
            }}
          >
            <Sparkles aria-hidden className="size-3.5" />
            {centangKosong.length > 0
              ? `Minta estimasi AI (${centangKosong.length} dicentang)`
              : "Minta estimasi AI"}
          </Button>
        ) : null}

        {canInput && adaDraf ? (
          <>
            <Button
              type="button"
              size="sm"
              loading={putusanPending}
              disabled={centangBerdraf.length === 0}
              onClick={() =>
                putuskan(
                  centangBerdraf.map((d) => d.usulanId as string),
                  terapkanUsulanHargaAiAction,
                )
              }
            >
              <Check aria-hidden className="size-3.5" />
              Pakai {centangBerdraf.length} yang dicentang
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={putusanPending}
              disabled={centangBerdraf.length === 0}
              onClick={() =>
                putuskan(
                  centangBerdraf.map((d) => d.usulanId as string),
                  tolakUsulanHargaAiAction,
                )
              }
            >
              <X aria-hidden className="size-3.5" />
              Tolak {centangBerdraf.length}
            </Button>
          </>
        ) : null}
      </div>

      {adaDraf ? (
        <Banner
          tone="warning"
          title={`${usulan.draf.length} draf ${usulan.model ?? "AI"} menunggu keputusanmu – belum tersimpan`}
          description={
            `Periksa kolom Usulan AI, Keyakinan, dan Dasar usulan, lalu centang yang kamu setujui. ` +
            `Angka ini bukan survei pasar atau penawaran pemasok. ` +
            (usulan.totalKosong > usulan.diminta
              ? `Permintaan lalu mencakup ${usulan.diminta} dari ${usulan.totalKosong} sumber daya yang belum berharga – yang menahan nilai RAB terbesar didahulukan.`
              : "")
          }
        />
      ) : null}

      {adaDraf ? (
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={hanyaUsulan}
            onChange={(e) => setHanyaUsulan(e.target.checked)}
            className="size-3.5"
          />
          Tampilkan hanya baris yang ada usulannya ({usulan.draf.length})
        </label>
      ) : null}

      <MarlinGrid<Baris>
        ref={grid}
        rowData={tampil}
        columnDefs={kolom}
        quickFilter
        csvExport
        pageSize={50}
        height="60vh"
        persistKey="rapl-harga"
        editMode={canInput}
        rowSelection={canInput ? "multi" : undefined}
        onSelectionChanged={canInput ? setDicentang : undefined}
        isRowSelectable={(d: Baris) => (adaDraf ? d.usulanId !== null : d.harga === null)}
        getRowId={(d: Baris) => `${d.kategori}|${d.nama}|${d.satuan}`}
        emptyText="Belum ada kebutuhan – setujui padanan AHSP lebih dulu."
        onCellValueChanged={(e: CellValueChangedEvent<Baris>) => {
          if (e.colDef.field !== "hargaNum") return;
          const d = e.data;
          const teks = e.newValue == null || e.newValue === "" ? "" : String(e.newValue);
          simpanBerjalan.current += 1;
          setMenyimpan(simpanBerjalan.current);
          // Kabar lama hanya dihapus kalau tidak ada simpanan lain yang sedang
          // berjalan – kalau tidak, sel kedua menghapus kegagalan sel pertama.
          if (simpanBerjalan.current === 1) setPesan(null);
          mulaiSimpan(async () => {
            try {
              const hasil = await simpanHargaSel({
                locationId,
                slug,
                kategori: d.kategori,
                nama: d.nama,
                satuan: d.satuan,
                harga: teks,
              });
              if (!hasil.ok) {
                setPesan({ tone: "error", teks: hasil.error });
                return;
              }
              /*
               * Keberhasilan TIDAK menimpa kegagalan. Dua sel yang disimpan
               * beruntun selesai sesuai kecepatan jaringan, bukan sesuai urutan
               * ketikan; tanpa penjagaan ini, sel kedua yang berhasil menghapus
               * kabar bahwa sel pertama gagal — dan harganya tidak tersimpan
               * tanpa seorang pun tahu.
               */
              setPesan((sebelumnya) =>
                sebelumnya?.tone === "error"
                  ? sebelumnya
                  : {
                      tone: "success",
                      teks:
                        hasil.harga === null
                          ? `Harga "${d.nama}" dikosongkan.`
                          : `Harga "${d.nama}" disimpan.`,
                    },
              );
              router.refresh();
            } finally {
              simpanBerjalan.current -= 1;
              setMenyimpan(simpanBerjalan.current);
            }
          });
        }}
      />

      <p className="text-[12px] text-ink-muted">
        {belum} dari {rows.length} sumber daya belum berharga. Kolom &ldquo;Harga di lokasi
        lain&rdquo; hanya bahan pertimbangan – sekabupaten disebut lebih dulu.
      </p>
    </div>
  );
}

/**
 * Ringkasan biaya per kategori + peringatan keandalannya.
 *
 * Sengaja SATU blok setinggi dua baris, bukan empat kartu di atas satu kotak
 * tiga kolom. Susunan lamanya mengulang dua angka yang sudah berdiri sebagai
 * KpiCard beberapa piksel di atasnya — "Nilai RAB aktif" dan "Potensi margin"
 * — lalu memakai ±260px layar untuk mengulanginya. Akibatnya tabel yang
 * menjadi pekerjaan sebenarnya terdorong seluruhnya ke bawah lipatan, dan
 * keluhan user 2026-08-30 tepat: "tampilan pandangan pertama user habis di
 * balon".
 *
 * Yang TIDAK ikut dimampatkan adalah paragraf keandalannya. Ia satu-satunya
 * tempat yang mengatakan angka ini belum boleh dibaca sebagai keuntungan, dan
 * memendekkannya berarti memendekkan peringatannya.
 *
 * `tampilkanMargin=false` untuk pemegang `rapl.manage` tanpa `rapl.view` —
 * Site Manager yang MENGISI harga tapi tidak membaca angka menawarnya. Biaya
 * yang ia susun sendiri tetap terlihat; menyembunyikannya berarti menyuruh
 * orang mengisi dengan mata tertutup.
 */
export function RingkasBiaya({
  totalBiaya,
  berharga,
  belumBerharga,
  perKategori,
  perbandingan,
  tampilkanMargin = true,
}: {
  totalBiaya: string;
  berharga: number;
  belumBerharga: number;
  perKategori: { kategori: string; biaya: string; berharga: number; total: number }[];
  perbandingan: { cakupanNilai: number; cakupanHarga: number; utuh: boolean };
  tampilkanMargin?: boolean;
}) {
  const berhatiHati = tampilkanMargin && !perbandingan.utuh;
  return (
    <div
      className={cn(
        "rounded-lg border",
        berhatiHati ? "border-warning-border bg-warning-soft" : "border-line bg-surface",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
        <p className="text-[12px] tracking-wide text-ink-muted uppercase">Biaya RAPL</p>
        <p className="tabular text-lg font-semibold text-ink">
          {formatRupiah(BigInt(totalBiaya))}
        </p>
        <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-ink-muted">
          {perKategori.map((k) => (
            <li key={k.kategori}>
              {LABEL_KATEGORI[k.kategori] ?? k.kategori}{" "}
              <span className="tabular font-medium text-ink">
                {formatRupiahShort(BigInt(k.biaya))}
              </span>{" "}
              <span className="text-[12px]">
                ({k.berharga}/{k.total} berharga)
              </span>
            </li>
          ))}
        </ul>
      </div>

      {!tampilkanMargin ? (
        <p className="border-t border-line px-3 py-2 text-[13px] text-ink-muted">
          {belumBerharga > 0
            ? `${belumBerharga} sumber daya masih kosong harganya – biaya di atas akan bertambah setelah diisi.`
            : `Seluruh ${berharga} sumber daya sudah berharga.`}{" "}
          Perbandingan terhadap nilai RAB tidak ditampilkan untuk peranmu.
        </p>
      ) : !perbandingan.utuh ? (
        <p className="border-t border-warning-border px-3 py-2 text-[13px] text-ink">
          <strong>Selisih terhadap nilai RAB BELUM bisa dibaca sebagai keuntungan.</strong> Ia
          dihitung dari {formatPct(perbandingan.cakupanNilai, 1)} nilai RAB yang masuk hitungan
          kebutuhan, dan baru {formatPct(perbandingan.cakupanHarga, 1)} sumber daya yang berharga
          {belumBerharga > 0 ? ` (${belumBerharga} masih kosong)` : ""}. Biaya yang belum masuk akan
          MENGECILKAN selisihnya, bukan membesarkan.
        </p>
      ) : (
        <p className="border-t border-line px-3 py-2 text-[13px] text-ink-muted">
          Seluruh nilai RAB masuk hitungan dan seluruh {berharga} sumber daya sudah berharga. Angka
          ini adalah potensi margin pelaksanaan, bukan profit neto setelah pajak dan biaya lain di
          luar breakdown RAPL.
        </p>
      )}
    </div>
  );
}
