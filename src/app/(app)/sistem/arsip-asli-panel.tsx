"use client";

import { useState, useTransition } from "react";
import { Banner, Button, Input, Label, StatusPill } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  jalankanArsipAsliAction,
  periksaIsiArsipAction,
  setArsipAsliAction,
  setWaArsipAction,
  ujiArsipAsliAction,
  type ArsipAsliState,
} from "@/lib/system/actions";
import type { RingkasArsip } from "@/lib/arsip-asli/antrean";

/**
 * ARSIP DINGIN BERKAS ASLI — seluruh kendalinya di satu kartu.
 *
 * Foto ber-cap dan thumbnail yang dilihat orang sehari-hari TIDAK ikut pindah:
 * keduanya tetap di R2. Yang dipindahkan hanya berkas asli — besar, nyaris tak
 * pernah dibuka, dan hanya diperlukan saat cap diperbaiki atau keaslian foto
 * dipersoalkan.
 *
 * Yang sengaja ditampilkan apa adanya: berapa yang masih menunggu beserta
 * ukurannya, berapa yang sedang dalam masa tenggang (ada di dua tempat), dan
 * berapa yang berhenti dicoba karena gagal terus. Angka terakhir itu yang paling
 * mudah disembunyikan dan paling perlu dilihat.
 */
export function ArsipAsliPanel({
  aktif,
  tenggang,
  waAktif,
  waTujuan,
  terkonfigurasi,
  ringkas,
  latar,
}: {
  aktif: boolean;
  tenggang: number;
  /** Peringatan WhatsApp: sakelarnya sendiri, lihat `setWaArsipAction`. */
  waAktif: boolean;
  waTujuan: string;
  /** ORIGINAL_ARCHIVE_URL + _TOKEN sudah diisi di lingkungan ini? */
  terkonfigurasi: boolean;
  ringkas: RingkasArsip;
  /** Putaran latar di proses aplikasi ini (DECISIONS 615). */
  latar: {
    berjalanSejak: string | null;
    terakhir: { selesai: string; dikirim: number; dibuangDariR2: number; gagal: number; galat: string[] } | null;
  };
}) {
  const [state, aksi, pending] = useAksi<ArsipAsliState>(setArsipAsliAction, undefined);
  const [waState, waAksi, waPending] = useAksi<ArsipAsliState>(setWaArsipAction, undefined);
  const [pesanJalan, setPesanJalan] = useState<string | null>(null);
  const [jalan, mulai] = useTransition();
  const [uji, setUji] = useState<ArsipAsliState>(undefined);
  const [menguji, mulaiUji] = useTransition();
  const [bukti, setBukti] = useState<ArsipAsliState>(undefined);
  const [memeriksa, mulaiPeriksa] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Memindahkan <span className="font-medium text-ink">berkas asli</span> foto ke penyimpanan sendiri.
        Foto ber-cap dan thumbnail tetap di R2 – yang dilihat orang sehari-hari tidak berubah sama sekali.
      </p>

      {!terkonfigurasi ? (
        <Banner
          tone="info"
          title="Alamat arsip belum diisi"
          description="Isi ORIGINAL_ARCHIVE_URL dan ORIGINAL_ARCHIVE_TOKEN di Railway (plus sepasang CF Access bila mesinnya di balik Cloudflare Access). Langkah lengkapnya di docs/ARSIP_DINGIN_SETUP.md. Sakelar di bawah tetap bisa disimpan, tapi tidak ada yang dipindahkan sampai alamatnya ada."
        />
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        {/*
         * PERTANYAAN PERTAMA ORANG, DIJAWAB DULUAN.
         *
         * Pertanyaan user 2026-09-13: "berapa yang sudah di server lenovo?"
         * Sebelumnya layar ini tidak menyebutnya di mana pun — ia menampilkan
         * tiga keadaan SALINAN R2, dan angka yang dicari harus dijumlahkan
         * sendiri dari dua kartu. Dua kartu itu tetap ada, tapi sesudahnya:
         * mereka menjelaskan RINCIANNYA, bukan menggantikan jawabannya.
         */}
        <Angka
          label="Sudah di mesin arsip"
          nilai={String(ringkas.sudahDiArsip)}
          sub={`${ukuran(ringkas.bytesSudahDiArsip)} · dari ${ringkas.sudahDiArsip + ringkas.menunggu} berkas asli`}
          tone={ringkas.sudahDiArsip > 0 ? "success" : undefined}
        />
        <Angka label="Menunggu dipindahkan" nilai={String(ringkas.menunggu)} sub={ukuran(ringkas.bytesMenunggu)} />
        <Angka
          label="Masa tenggang"
          nilai={String(ringkas.masaTenggang)}
          sub="sudah di arsip, salinan R2 masih ada"
        />
        <Angka label="Selesai pindah" nilai={String(ringkas.terarsip)} sub="salinan R2 sudah dibuang" />
        {ringkas.gagalTerus > 0 ? (
          <Angka label="Berhenti dicoba" nilai={String(ringkas.gagalTerus)} sub="gagal berulang" tone="danger" />
        ) : null}
      </div>

      {ringkas.gagalTerus > 0 && ringkas.galatTerakhir ? (
        <Banner
          tone="warning"
          title={`${ringkas.gagalTerus} berkas berhenti dicoba`}
          description={`Sebab terakhir: ${ringkas.galatTerakhir}. Berkasnya tetap aman di R2 – yang berhenti hanya pemindahannya, supaya satu berkas bermasalah tidak menyumbat antrean.`}
        />
      ) : null}

      {state?.error ? <Banner tone="error" title="Gagal menyimpan" description={state.error} /> : null}
      {state?.success ? <Banner tone="success" title="Tersimpan" description={state.success} /> : null}
      {pesanJalan ? <Banner tone="info" title="Putaran arsip" description={pesanJalan} /> : null}
      {uji?.success ? (
        <Banner tone="success" title="Uji sambungan berhasil" description={uji.success} />
      ) : null}
      {uji?.error ? (
        <Banner tone="error" title="Uji sambungan gagal" description={uji.error} />
      ) : null}
      {bukti?.success ? (
        <Banner tone="success" title="Isi arsip terbukti" description={bukti.success} />
      ) : null}
      {bukti?.error ? (
        <Banner tone="error" title="Isi arsip tidak sesuai catatan" description={bukti.error} />
      ) : null}

      <form action={aksi} className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="aktif" defaultChecked={aktif} className="size-4" />
          <span>Aktifkan pemindahan</span>
        </label>
        <div>
          <Label htmlFor="tenggang">Masa tenggang (hari)</Label>
          <Input id="tenggang" name="tenggang" type="number" min={0} max={365} defaultValue={tenggang} className="w-28" />
        </div>
        <Button type="submit" loading={pending} variant="secondary">
          Simpan
        </Button>
        <StatusPill tone={aktif ? "success" : "neutral"} label={aktif ? "Aktif" : "Mati"} />
      </form>

      {waState?.error ? <Banner tone="error" title="Gagal menyimpan" description={waState.error} /> : null}
      {waState?.success ? (
        <Banner tone="success" title="Peringatan tersimpan" description={waState.success} />
      ) : null}

      <form action={waAksi} className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="waAktif" defaultChecked={waAktif} className="size-4" />
          <span>Peringatan WhatsApp</span>
        </label>
        <div>
          <Label htmlFor="waTujuan">Tujuan (chatId grup / nomor)</Label>
          <Input id="waTujuan" name="waTujuan" defaultValue={waTujuan} className="w-72" />
        </div>
        <Button type="submit" loading={waPending} variant="secondary">
          Simpan
        </Button>
      </form>

      <p className="text-xs text-ink-muted">
        Peringatan hanya dikirim untuk yang TIDAK bisa dibereskan sistem sendiri – berkas yang hilang
        dari mesin arsip, pemindahan yang macet lebih dari sehari, atau sisa disk menipis. Kegagalan
        biasa (arsip mati sesaat, jaringan putus) ditangani sendiri: tidak ada salinan R2 yang dibuang,
        dan berkasnya dicoba lagi otomatis.
      </p>

      <p className="text-xs text-ink-muted">
        Selama masa tenggang berkasnya ada di dua tempat sekaligus – itu jaring pengaman kalau arsipnya
        ternyata bermasalah. Karena itu pemakaian R2 baru mulai turun setelah tenggangnya lewat, bukan
        seketika. Isi 0 kalau ingin salinan R2 dibuang segera.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          Uji sambungan sengaja BERDIRI SENDIRI dari sakelarnya, dan bisa ditekan
          walau pemindahannya masih mati. Urutan memasangnya memang begitu:
          pasang mesin, buktikan tersambung, BARU nyalakan. Tombol yang cuma
          hidup sesudah sakelarnya menyala akan memaksa orang menyalakan dulu
          sesuatu yang belum ia percayai.
        */}
        <Button
          variant="secondary"
          loading={menguji}
          onClick={() => mulaiUji(async () => setUji(await ujiArsipAsliAction()))}
        >
          Uji sambungan
        </Button>
        {/*
          Angka di atas dibaca dari basis data – ia menyatakan MARLIN merasa
          sudah mengirim. Tombol ini bertanya ke MESINNYA. Keduanya sama selama
          tidak ada yang salah, dan berbeda tepat ketika ada yang salah.
        */}
        <Button
          variant="secondary"
          loading={memeriksa}
          onClick={() => mulaiPeriksa(async () => setBukti(await periksaIsiArsipAction()))}
        >
          Periksa isi arsip
        </Button>
        <Button
          variant="secondary"
          loading={jalan}
          onClick={() =>
            mulai(async () => {
              const r = await jalankanArsipAsliAction();
              setPesanJalan(r?.success ?? r?.error ?? null);
            })
          }
        >
          {latar.berjalanSejak ? "Sedang berjalan" : "Jalankan pemindahan sekarang"}
        </Button>
        {latar.berjalanSejak ? (
          <StatusPill
            tone="info"
            label={`Berjalan sejak ${new Date(latar.berjalanSejak).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}`}
          />
        ) : latar.terakhir ? (
          <span className="text-xs text-ink-muted">
            Putaran terakhir: {latar.terakhir.dikirim} dipindahkan · {latar.terakhir.dibuangDariR2} salinan R2
            dibuang
            {latar.terakhir.gagal > 0 ? ` · ${latar.terakhir.gagal} gagal (${latar.terakhir.galat.join("; ")})` : ""}
          </span>
        ) : null}
        {ringkas.terakhirBerhasil ? (
          <span className="text-xs text-ink-muted">
            Terakhir berhasil: {new Date(ringkas.terakhirBerhasil).toLocaleString("id-ID")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Angka({
  label,
  nilai,
  sub,
  tone,
}: {
  label: string;
  nilai: string;
  sub: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"
        }`}
      >
        {nilai}
      </p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </div>
  );
}

function ukuran(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
