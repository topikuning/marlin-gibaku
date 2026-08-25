"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { tahanGagalKirim } from "@/lib/aksi-klien";
import { useRouter } from "next/navigation";
import { Camera, Check, Images, MapPin, MapPinOff, RotateCw, Trash2, X } from "lucide-react";
import { Banner, Button, Card, Combobox, EmptyState, HelpText, Label } from "@/components/ui";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { KameraLangsung, type PosisiJepret } from "@/components/knmp/kamera-langsung";
import { useAntreanFoto, type BarisAntrean } from "./use-antrean";
import { labelJarak, urutkanTerdekat, type LokasiBerjarak } from "@/lib/foto-cepat/jarak";
import type {
  FotoKantong,
  PilihanLokasi,
  TujuanKegiatan,
  TujuanLaporan,
} from "@/lib/foto-cepat/queries";
import {
  kelompokkanKantong,
  pangkasPilihan,
  tindakanKantong,
} from "@/lib/foto-cepat/kantong-pilihan";
import {
  hapusFotoCepatAction,
  muatTujuanAction,
  pakaiFotoAction,
  simpanFotoCepatAction,
  tetapkanLokasiAction,
  type FotoCepatState,
} from "@/lib/foto-cepat/actions";
import { putarFotoAction } from "@/lib/photo-restamp/actions";

/**
 * Workspace Foto Cepat: jepret → kantong → pakai (DECISIONS 253).
 *
 * URUTAN LAYARNYA MENGIKUTI URUTAN PEKERJAAN LAPANGAN, bukan urutan data:
 * memotret di atas (yang dilakukan sambil berdiri di lokasi, sering satu tangan,
 * sering di bawah matahari), mengolah di bawah (yang dilakukan sambil duduk).
 * Membalik keduanya berarti pelapor harus menggulung melewati daftar kerja
 * sebelum bisa menekan rana.
 */

const KOSONG: FotoCepatState = {};

/**
 * Aksi dibungkus supaya POST yang gagal (unggahan foto besar) jadi PESAN di
 * layar, bukan halaman mati yang menghapus jepretan yang belum tersimpan
 * (DECISIONS 291).
 */
const simpanFotoCepat = tahanGagalKirim(simpanFotoCepatAction);
const hapusFotoCepat = tahanGagalKirim(hapusFotoCepatAction);
const tetapkanLokasi = tahanGagalKirim(tetapkanLokasiAction);
const pakaiFoto = tahanGagalKirim(pakaiFotoAction);

export function FotoCepatWorkspace({
  lokasi,
  kantong,
  wajibGps,
}: {
  lokasi: PilihanLokasi[];
  kantong: FotoKantong[];
  wajibGps: boolean;
}) {
  const [posisi, setPosisi] = useState<{ lat: number; lng: number } | null>(null);

  /**
   * Posisi dibaca sekali, HANYA untuk memberi tahu pelapor lokasi terdekat
   * sebelum memotret. Yang menentukan lokasi foto BUKAN ini, melainkan koordinat
   * foto itu sendiri, dideteksi di server per berkas (DECISIONS 254) — posisi di
   * sini adalah saat halaman dibuka, dan itu bukan tempat memotret.
   */
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let batal = false;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!batal) setPosisi({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
    return () => {
      batal = true;
    };
  }, []);

  const terurut: LokasiBerjarak[] = useMemo(() => urutkanTerdekat(lokasi, posisi), [lokasi, posisi]);
  const terdekat = posisi ? (terurut.find((l) => l.jarakMeter != null) ?? null) : null;

  const opsiLokasi = terurut.map((l) => ({
    value: l.id,
    label: l.jarakMeter != null ? `${l.name} · ${labelJarak(l.jarakMeter)}` : l.name,
  }));

  return (
    <div className="space-y-4">
      <JepretCard wajibGps={wajibGps} terdekat={terdekat} adaPosisi={posisi != null} />
      <KantongCard kantong={kantong} opsiLokasi={opsiLokasi} />
    </div>
  );
}

/* ── 1. Jepret ───────────────────────────────────────────────────────────── */

function JepretCard({
  wajibGps,
  terdekat,
  adaPosisi,
}: {
  wajibGps: boolean;
  terdekat: LokasiBerjarak | null;
  adaPosisi: boolean;
}) {
  const router = useRouter();
  const [kameraBuka, setKameraBuka] = useState(false);
  const [state, action, pending] = useActionState(simpanFotoCepat, KOSONG);
  const { baris, ringkas, penuh, galat, kuota, online, titip, hapus, kirimSekarang } =
    useAntreanFoto();

  /**
   * Rana → SIMPAN DI PERANGKAT, bukan → kirim (DECISIONS 257).
   *
   * Pengirimannya urusan antrean. Bedanya menentukan apakah foto selamat saat
   * sinyal putus di tengah unggahan: yang tersimpan di perangkat akan dicoba
   * lagi, yang cuma ada di memori hilang bersama halamannya.
   */
  const kirim = useCallback(
    (file: File, posisi: PosisiJepret) => {
      void titip(file, posisi);
    },
    [titip],
  );

  /**
   * Kantong di bawah baru disegarkan saat kamera DITUTUP, bukan tiap jepretan.
   * Satu `router.refresh()` = satu muat ulang payload RSC; melakukannya per
   * jepretan akan menyaingi unggahan berikutnya di pipa yang sama.
   */
  const tutupKamera = useCallback(() => {
    setKameraBuka(false);
    router.refresh();
  }, [router]);

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Jepret sekarang</h2>
          <HelpText>
            Ketuk rana – foto langsung tersimpan di HP, lalu dikirim sendiri begitu ada sinyal.
            Koordinat & jamnya terekam saat rana ditekan.
          </HelpText>
        </div>

        <p className="text-[13px] text-ink-muted">
          {adaPosisi
            ? terdekat?.jarakMeter != null
              ? `Kamu ada di dekat ${terdekat.name} (${labelJarak(terdekat.jarakMeter)}). Foto yang dijepret di sini akan dikenali ke lokasi itu.`
              : "Posisi terbaca, tapi belum ada lokasi yang punya titik proyek untuk dibandingkan."
            : "Posisi belum terbaca. Izinkan akses lokasi – tanpa koordinat, lokasi fotonya harus dipilih manual belakangan."}
        </p>

        {wajibGps ? (
          <Banner
            tone="info"
            title="Setelan wajib-GPS menyala"
            description="Foto tanpa koordinat akan ditolak. Pastikan izin lokasi aktif sebelum memotret."
          />
        ) : null}

        {penuh ? <Banner tone="warning" title={penuh} /> : null}

        <PanelAntrean
          baris={baris}
          ringkas={ringkas}
          galat={galat}
          kuota={kuota}
          online={online}
          onKirim={() => void kirimSekarang()}
          onHapus={(id) => void hapus(id)}
        />

        {/*
          Kamera dirender sebagai LAPISAN LAYAR PENUH (kamera-langsung.tsx), jadi
          susunan halaman ini TIDAK berubah saat kamera dibuka/ditutup. Dulu ia
          menggantikan tombol di tengah kartu: tingginya berbeda, panel antrean
          di atasnya ikut tumbuh tiap jepretan, dan pratinjaunya bergeser
          naik-turun — keluhan user 2026-08-06.
        */}
        {kameraBuka ? (
          <KameraLangsung onFoto={kirim} onTutup={tutupKamera} menunggu={ringkas.menunggu} />
        ) : null}

        <Button type="button" onClick={() => setKameraBuka(true)} className="w-full sm:w-auto">
          <Camera aria-hidden className="size-4" />
          {ringkas.menunggu > 0 ? "Buka kamera – lanjut memotret" : "Buka kamera"}
        </Button>

        {/*
          CADANGAN, bukan jalur utama. Dipakai kalau kamera dalam aplikasi tidak
          bisa dinyalakan (izin ditolak, peramban lawas). Di sini layar "Use
          Photo" dari aplikasi kamera HP memang muncul — itu milik sistem operasi
          dan tidak bisa dimatikan halaman web.

          Jalur ini SENGAJA tidak lewat antrean: ia mengirim langsung, sama
          seperti unggahan foto di laporan harian. Membuat cadangan ikut antre
          berarti dua mesin pengirim yang harus sama-sama dijaga benar.
        */}
        <details className="rounded-md border border-border bg-surface-muted p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            Kamera dalam aplikasi tidak jalan?
          </summary>
          <div className="mt-2 space-y-3">
            {state.error ? <Banner tone="error" title={state.error} /> : null}
            {state.warning ? <Banner tone="warning" title={state.warning} /> : null}
            {state.ok ? <Banner tone="success" title={state.ok} /> : null}
            <HelpText>
              Pakai aplikasi kamera HP. Hasilnya sama; bedanya ada satu layar konfirmasi bawaan
              HP, dan fotonya dikirim saat itu juga (tidak lewat antrean).
            </HelpText>
            <form action={action} className="space-y-3">
              <PhotoSourceInput hanyaKamera />
              <Button type="submit" disabled={pending}>
                {pending ? "Menyimpan…" : "Simpan ke kantong"}
              </Button>
            </form>
          </div>
        </details>
      </div>
    </Card>
  );
}

/**
 * Antrean foto yang belum sampai ke server.
 *
 * Ditampilkan TERANG-TERANGAN, bahkan saat kamera tertutup. Antrean yang
 * disembunyikan membuat orang mengira fotonya sudah aman di server padahal
 * masih di HP-nya sendiri — dan HP bisa hilang, rusak, atau datanya dibersihkan.
 */
function PanelAntrean({
  baris,
  ringkas,
  galat,
  kuota,
  online,
  onKirim,
  onHapus,
}: {
  baris: BarisAntrean[];
  ringkas: { menunggu: number; ditolak: number; rusak: number; perluPerhatian: boolean };
  /** Galat antrean terakhir — ditampilkan, karena diam membuat ini mustahil didiagnosis. */
  galat: string | null;
  /** Pemakaian penyimpanan — supaya "penuh" jadi ANGKA, bukan tebakan. */
  kuota: string | null;
  online: boolean;
  onKirim: () => void;
  onHapus: (id: string) => void;
}) {
  if (!ringkas.perluPerhatian) return null;
  const ditolak = baris.filter((b) => b.status === "ditolak");
  const sebabTerakhir = baris.find((b) => b.status !== "ditolak" && b.pesan)?.pesan;
  const rusak = baris.filter((b) => b.status === "rusak");

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {ringkas.menunggu > 0
            ? `${ringkas.menunggu} foto menunggu terkirim`
            : "Semua foto sudah terkirim"}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            online ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
          }`}
        >
          {online ? "jaringan ada" : "tidak ada jaringan"}
        </span>
      </div>

      <HelpText>
        Foto tersimpan di HP dan dikirim sendiri begitu ada sinyal – termasuk kalau halaman ini
        ditutup dan dibuka lagi nanti. Tapi ia masih di HP ini: jangan hapus data aplikasi sebelum
        antreannya habis.
      </HelpText>

      <ul className="flex gap-2 overflow-x-auto pb-1">
        {baris.map((b) => (
          <li key={b.id} className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={b.url}
              alt=""
              className={`size-14 rounded-md border object-cover ${
                b.status === "ditolak" || b.status === "rusak"
                  ? "border-danger opacity-60"
                  : "border-border"
              }`}
            />
            <span
              className={`absolute inset-x-0 bottom-0 rounded-b-md text-center text-[10px] font-medium text-white ${
                b.status === "kirim"
                  ? "bg-primary"
                  : b.status === "ditolak" || b.status === "rusak"
                    ? "bg-danger"
                    : "bg-ink/70"
              }`}
            >
              {b.status === "kirim"
                ? "kirim…"
                : b.status === "ditolak"
                  ? "ditolak"
                  : b.status === "rusak"
                    ? "rusak"
                    : "antre"}
            </span>
            {/* Buang per foto — untuk SEMUA baris, bukan hanya yang ditolak.
                Foto yang tidak mau terkirim membuat orang tersandera: tidak bisa
                dikirim, tidak bisa dihilangkan dari layar. */}
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Buang foto ini dari antrean? Fotonya hilang dari HP dan TIDAK terkirim.")) onHapus(b.id);
              }}
              aria-label="Buang foto dari antrean"
              title="Buang foto dari antrean"
              className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border border-border bg-surface text-ink-muted shadow hover:text-danger"
            >
              <X aria-hidden className="size-3" />
            </button>
          </li>
        ))}
      </ul>

      {/* Sebab percobaan terakhir — untuk baris yang BUKAN ditolak (yang ditolak
          sudah punya spanduknya sendiri di bawah). Tanpa ini, "antre" tidak
          membedakan "belum pernah dicoba" dari "sudah dicoba dan jaringannya
          tidak menjawab", dan orang di lapangan tidak punya apa pun untuk
          dilaporkan selain "stuck". */}
      {sebabTerakhir ? <p className="text-xs text-ink-muted">{sebabTerakhir}</p> : null}

      {/* Kegagalan antrean itu sendiri (simpanan HP menolak / tidak menjawab).
          Ini yang dulu sepenuhnya bisu. */}
      {galat ? <Banner tone="error" title="Antrean tersendat" description={galat} /> : null}

      {/* Foto yang bytenya hilang dari simpanan HP. Disebut TERANG-TERANGAN:
          menahannya di daftar "menunggu terkirim" berarti berbohong tentang
          foto yang tidak akan pernah terkirim. */}
      {rusak.length > 0 ? (
        <Banner
          tone="error"
          title={`${rusak.length} foto rusak di simpanan HP`}
          description={
            rusak[0].pesan ??
            "Isi fotonya hilang dari simpanan HP – tidak bisa dikirim. Buang saja lalu potret ulang."
          }
        />
      ) : null}

      {/*
        PENANDA VERSI — kecil, tapi ia yang menjawab pertanyaan pertama saat ada
        laporan "tidak berubah sama sekali": apakah HP itu benar-benar
        menjalankan kode yang baru?

        Peramban ponsel menyimpan berkas program dengan gigih. Tab yang sudah
        dibuka sejak sebelum penerapan versi baru akan terus menjalankan kode
        LAMA sampai halamannya benar-benar dimuat ulang — dan dari luar, itu
        tidak bisa dibedakan dari "perbaikannya tidak jalan". Tanpa penanda ini,
        satu-satunya cara memastikannya adalah menebak.

        Naikkan angkanya setiap kali logika antrean berubah.
      */}
      {/*
        PANEL RINCIAN TEKNIS — permintaan user 2026-08-07: *"coba buat debug
        yang lebih jelas dilayar biar kukirim masalahnya ke kamu. karena tidak
        bisa inspect element di hp"*.

        Betul, dan itu memang alat yang hilang selama ini: tiga putaran
        perbaikan dikerjakan tanpa satu pun fakta dari perangkatnya. Isinya
        sengaja teks apa adanya (bukan ikon, bukan warna) supaya terbaca utuh
        di tangkapan layar, dan tertutup secara bawaan supaya tidak mengganggu
        yang tidak membutuhkannya.
      */}
      <details className="rounded-md border border-border bg-surface-muted px-2 py-1.5">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
          Rincian teknis (untuk dilaporkan)
        </summary>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-ink">
{`antrean v8 · ${baris.length} baris · jaringan: ${online ? "ada" : "tidak"}
simpanan: ${kuota ?? "-"}
galat: ${galat ?? "-"}
` +
            baris
              .map(
                (b, i) =>
                  `${i + 1}. ${b.status} · coba ${b.percobaan}× · ${Math.round(b.bytes / 1024)} KB · umur ${Math.round(b.umurMs / 1000)} dtk\n   ${b.pesan ?? "(tanpa pesan)"}`,
              )
              .join("\n")}
        </pre>
      </details>

      {ringkas.menunggu > 0 ? (
        <Button type="button" variant="secondary" onClick={onKirim}>
          Coba kirim sekarang
        </Button>
      ) : null}

      {ditolak.length > 0 ? (
        <div className="space-y-1.5">
          <Banner
            tone="error"
            title={`${ditolak.length} foto ditolak server`}
            description={
              // Ditolak BUKAN gagal jaringan: mencoba lagi akan ditolak lagi.
              // Sebabnya ditulis supaya bisa diputuskan orangnya, bukan diulang
              // terus oleh mesin.
              ditolak[0].pesan ?? "Periksa sebabnya, lalu buang atau jepret ulang."
            }
          />
          {ditolak.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onHapus(b.id)}
              className="text-xs font-medium text-danger underline-offset-2 hover:underline"
            >
              Buang foto yang ditolak ({b.id.slice(-4)})
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── 2. Kantong + pakai ──────────────────────────────────────────────────── */

/**
 * Kantong: SEMUA foto bisa dipilih, dan tindakannya mengikuti pilihan.
 *
 * Dua cacat yang diperbaiki di sini (laporan user 2026-08-06):
 *
 * 1. *"satu foto diklik tidak terjadi apa-apa."* Betul — dan bukan karena
 *    ketukannya meleset. Foto yang lokasinya belum ketahuan dulu dirender di
 *    panel kuning sebagai gambar mati, BUKAN tombol; hanya foto yang lokasinya
 *    sudah terdeteksi yang bisa dipilih. Pelapor yang geotag-nya gagal —
 *    justru keadaan yang paling lazim di lapangan — mengetuk foto demi foto
 *    tanpa satu pun bereaksi, dan tidak ada apa pun di layar yang menjelaskan
 *    sebabnya. Sekarang setiap foto di kantong adalah tombol.
 *
 * 2. *"terlalu memaksakan untuk beberapa foto yang diambil diberi tag lokasi
 *    yang sama."* Betul juga: panel penetapan lokasi menerima SELURUH foto
 *    tanpa lokasi sekaligus dengan satu Combobox. Satu perjalanan lapangan
 *    lazimnya melewati beberapa desa, jadi memaksa satu jawaban untuk semuanya
 *    membuat penetapan yang benar mustahil — yang tersisa cuma memilih mana
 *    yang salah. Sekarang yang ditetapkan HANYA yang sedang dipilih.
 *
 * "Pilih semua" per kelompok mempertahankan kemudahan lama (satu ketukan untuk
 * seluruh isi kelompok) tanpa menjadikannya satu-satunya pilihan.
 */
function KantongCard({
  kantong,
  opsiLokasi,
}: {
  kantong: FotoKantong[];
  opsiLokasi: { value: string; label: string }[];
}) {
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [hasil, setHasil] = useState<FotoCepatState | null>(null);

  /**
   * Buang id yang sudah tidak ada di kantong (baru dipakai / dibuang).
   *
   * Tanpa ini tombolnya menghitung foto hantu: "Pakai 5 foto" padahal 3 di
   * antaranya sudah pindah ke laporan, dan server menolak sebagian tanpa
   * pelapor tahu foto mana. Disetel SAAT RENDER (pola yang sama dipakai
   * `PanelPakai`) — lint repo ini melarang setState di badan effect.
   */
  const kunciIsi = kantong.map((f) => f.id).join(",");
  const [prevKunci, setPrevKunci] = useState(kunciIsi);
  if (prevKunci !== kunciIsi) {
    setPrevKunci(kunciIsi);
    setTerpilih((s) => pangkasPilihan(kantong, s) as Set<string>);
  }

  const selesai = useCallback((s: FotoCepatState) => {
    setHasil(s);
    // Pilihan dikosongkan hanya bila memang ada yang berpindah; kegagalan total
    // membiarkan pilihannya utuh supaya bisa dicoba lagi tanpa memilih ulang.
    if (s.ok || s.warning) setTerpilih(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setTerpilih((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const pilihBanyak = useCallback((ids: string[], jadikan: boolean) => {
    setTerpilih((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (jadikan) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }, []);

  /**
   * Kelompok tampilan. Yang belum ketahuan lokasinya SELALU di atas: itu
   * satu-satunya kelompok yang menghalangi foto dipakai, dan menyelipkannya di
   * tengah daftar berarti ia tidak akan pernah dikerjakan.
   */
  const kelompok = useMemo(() => kelompokkanKantong(kantong), [kantong]);
  // Aturan "boleh diapakan" tinggal di modul murni `kantong-pilihan.ts`, bukan
  // di sini — termasuk pagar bahwa foto tanpa lokasi tidak boleh dipakai
  // sebelum lokasinya ditetapkan (DECISIONS 254).
  const tindakan = useMemo(() => tindakanKantong(kantong, terpilih), [kantong, terpilih]);

  if (kantong.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Images}
          title="Kantong masih kosong"
          description="Foto yang kamu simpan lewat tombol di atas muncul di sini, menunggu dipakai di laporan harian atau kegiatan lapangan."
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            Kantong – {kantong.length} foto belum dipakai
          </h2>
          {terpilih.size > 0 ? (
            <button
              type="button"
              onClick={() => setTerpilih(new Set())}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Batal pilih ({terpilih.size})
            </button>
          ) : null}
        </div>

        {/* Tanpa kalimat ini, "bisa dipilih" harus ditebak: petaknya tidak
            bertombol, dan satu-satunya ikon yang menonjol justru tong sampah. */}
        <HelpText>
          Ketuk foto untuk memilihnya – pilihannya boleh berapa pun dan boleh dari kelompok mana
          pun. Tindakan yang bisa dilakukan muncul di bawah, mengikuti apa yang kamu pilih.
        </HelpText>

        {hasil?.error ? <Banner tone="error" title={hasil.error} /> : null}
        {hasil?.warning ? <Banner tone="warning" title={hasil.warning} /> : null}
        {hasil?.ok ? <Banner tone="success" title={hasil.ok} /> : null}

        {kelompok.map((g) => {
          const ids = g.fotos.map((f) => f.id);
          const semua = ids.every((id) => terpilih.has(id));
          return (
            <div key={g.nama} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    g.tanpaLokasi ? "text-warning" : "text-ink-faint"
                  }`}
                >
                  {g.nama} · {g.fotos.length}
                </p>
                <button
                  type="button"
                  onClick={() => pilihBanyak(ids, !semua)}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {semua ? "Batal pilih kelompok" : "Pilih semua"}
                </button>
              </div>
              {g.tanpaLokasi ? (
                <HelpText>
                  Koordinatnya tidak ada, terlalu jauh dari semua titik proyek, atau berada di
                  antara dua lokasi yang berdekatan – sistem sengaja tidak menebak. Pilih foto yang
                  lokasinya sama, tetapkan lokasinya, lalu ulangi untuk kelompok berikutnya.
                </HelpText>
              ) : null}
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {g.fotos.map((f) => (
                  <FotoPetak key={f.id} foto={f} dipilih={terpilih.has(f.id)} onToggle={toggle} />
                ))}
              </ul>
            </div>
          );
        })}

        {tindakan.jenis === "kosong" ? null : tindakan.jenis === "tetapkan" ? (
          <PanelTetapkanLokasi
            fotos={tindakan.fotos}
            opsiLokasi={opsiLokasi}
            diabaikan={tindakan.diabaikan}
          />
        ) : tindakan.jenis === "campur_lokasi" ? (
          <Banner
            tone="warning"
            title="Foto dari lebih dari satu lokasi terpilih"
            description="Foto hanya bisa dipakai di lokasi tempat ia dipotret. Pilih foto dari satu lokasi saja."
          />
        ) : (
          <PanelPakai
            locationId={tindakan.locationId}
            photoIds={tindakan.photoIds}
            onHasil={selesai}
          />
        )}
      </div>
    </Card>
  );
}

function FotoPetak({
  foto,
  dipilih,
  onToggle,
}: {
  foto: FotoKantong;
  dipilih: boolean;
  onToggle: (id: string) => void;
}) {
  const [state, action, pending] = useActionState(hapusFotoCepat, KOSONG);
  const [putarState, putarAction, putarPending] = useActionState(putarFotoAction, undefined);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onToggle(foto.id)}
        aria-pressed={dipilih}
        aria-label={`${dipilih ? "Batal pilih" : "Pilih"} foto ${foto.waktuLabel}`}
        className={`block w-full overflow-hidden rounded-md border text-left transition ${
          dipilih ? "border-primary ring-2 ring-primary" : "border-border"
        }`}
      >
        {/* Lingkaran centang: "bisa dipilih" harus terlihat SEBELUM diketuk.
            Cincin biru saja hanya menjawab sesudahnya, dan itu terlambat bagi
            orang yang belum tahu petaknya bisa diketuk sama sekali. */}
        <span
          aria-hidden
          className={`absolute left-1 top-1 z-10 grid size-5 place-items-center rounded-full border shadow ${
            dipilih ? "border-primary bg-primary text-white" : "border-border bg-surface/90 text-transparent"
          }`}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
        <span className="block aspect-square bg-surface-inset">
          {foto.thumbUrl ? (
            // Foto R2 ber-presigned URL: next/image tidak dipakai di seluruh
            // aplikasi ini karena host-nya berganti tiap deploy & URL-nya
            // berumur pendek.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </span>
        <span className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-ink-muted">
          {foto.gpsAsli ? (
            <MapPin aria-hidden className="size-3 shrink-0 text-success" />
          ) : (
            <MapPinOff aria-hidden className="size-3 shrink-0 text-warning" />
          )}
          <span className="truncate">{foto.waktuLabel}</span>
        </span>
      </button>
      <div className="absolute right-1 top-1 flex flex-col gap-1">
        <form action={action}>
          <input type="hidden" name="photoId" value={foto.id} />
          <button
            type="submit"
            disabled={pending}
            aria-label="Buang foto ini dari kantong"
            title={state.error ?? "Buang dari kantong"}
            className="rounded-full bg-surface/90 p-1 text-ink-muted shadow hover:text-danger"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </form>
        {/*
          PUTAR di kantong Foto Cepat (DECISIONS 424b).
          Foto miring paling sering LAHIR di sini – kamera dalam aplikasi tanpa
          EXIF. Sebelumnya tombol putar hanya ada di galeri laporan/kegiatan,
          jadi jalan memperbaikinya justru absen di tempat masalahnya muncul.
        */}
        <form action={putarAction}>
          <input type="hidden" name="photoId" value={foto.id} />
          <input type="hidden" name="arah" value="kanan" />
          <button
            type="submit"
            disabled={putarPending}
            aria-label="Putar foto ini 90 derajat"
            title={putarState?.error ?? "Putar 90°"}
            className="rounded-full bg-surface/90 p-1 text-ink-muted shadow hover:text-primary"
          >
            <RotateCw aria-hidden className="size-3.5" />
          </button>
        </form>
      </div>
    </li>
  );
}

/**
 * Tetapkan lokasi untuk foto TERPILIH yang geotag-nya tidak cukup memutuskan.
 *
 * Yang ditetapkan hanya yang sedang dipilih, bukan seluruh isi kelompok. Satu
 * perjalanan lapangan lazim melewati beberapa desa; memaksa satu jawaban untuk
 * semua foto tanpa lokasi membuat penetapan yang benar mustahil — yang tersisa
 * cuma memilih mana yang salah. Keluhan user 2026-08-06.
 */
function PanelTetapkanLokasi({
  fotos,
  opsiLokasi,
  diabaikan,
}: {
  fotos: FotoKantong[];
  opsiLokasi: { value: string; label: string }[];
  /** Foto terpilih yang lokasinya SUDAH diketahui — tidak ikut di langkah ini. */
  diabaikan: number;
}) {
  const [state, action, pending] = useActionState(tetapkanLokasi, KOSONG);
  const [locationId, setLocationId] = useState("");

  return (
    <div className="rounded-md border border-warning-border bg-warning-soft p-3">
      <p className="text-sm font-semibold text-ink">
        Tetapkan lokasi untuk {fotos.length} foto terpilih
      </p>
      <HelpText>
        Hanya foto yang kamu pilih yang ditetapkan. Foto lain di kelompok ini tidak tersentuh, jadi
        satu perjalanan yang melewati beberapa desa bisa dikerjakan sekelompok demi sekelompok.
        {diabaikan > 0
          ? ` ${diabaikan} foto terpilih lainnya sudah punya lokasi dan dilewati di langkah ini.`
          : ""}
      </HelpText>

      {state.error ? <Banner tone="error" title={state.error} className="mt-2" /> : null}
      {state.warning ? <Banner tone="warning" title={state.warning} className="mt-2" /> : null}
      {state.ok ? <Banner tone="success" title={state.ok} className="mt-2" /> : null}

      <ul className="my-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fotos.map((f) => (
          <li key={f.id} className="overflow-hidden rounded-md border border-border">
            <span className="block aspect-square bg-surface-inset">
              {f.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />
              ) : null}
            </span>
            <span className="block px-1.5 py-1 text-[11px] text-ink-muted">{f.waktuLabel}</span>
          </li>
        ))}
      </ul>

      <form action={action} className="space-y-2">
        {fotos.map((f) => (
          <input key={f.id} type="hidden" name="photoIds" value={f.id} />
        ))}
        <div>
          <Label htmlFor="fc-tetapkan">Lokasi untuk {fotos.length} foto terpilih</Label>
          <Combobox
            id="fc-tetapkan"
            name="locationId"
            value={locationId}
            onChange={setLocationId}
            options={opsiLokasi}
            placeholder="Pilih lokasi…"
          />
        </div>
        <Button type="submit" disabled={pending || !locationId}>
          {pending ? "Menetapkan…" : "Tetapkan lokasi"}
        </Button>
      </form>
    </div>
  );
}

function PanelPakai({
  locationId,
  photoIds,
  onHasil,
}: {
  locationId: string;
  photoIds: string[];
  onHasil: (s: FotoCepatState) => void;
}) {
  const [state, action, pending] = useActionState(pakaiFoto, KOSONG);
  const [tujuan, setTujuan] = useState<"kegiatan" | "laporan">("laporan");
  const [kegiatanId, setKegiatanId] = useState("");
  const [reportId, setReportId] = useState("");
  const [reportItemId, setReportItemId] = useState("");
  const [data, setData] = useState<{ kegiatan: TujuanKegiatan[]; laporan: TujuanLaporan[] } | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, mulaiMuat] = useTransition();

  // Ganti lokasi → buang tujuan lokasi lama. Disetel SAAT RENDER, bukan di
  // dalam effect: menyetel state di badan effect memicu render kaskade, dan
  // lint repo ini memang melarangnya (pola yang sama dipakai bottom-nav).
  const [prevLoc, setPrevLoc] = useState(locationId);
  if (prevLoc !== locationId) {
    setPrevLoc(locationId);
    setData(null);
    setGalat(null);
    setKegiatanId("");
    setReportId("");
    setReportItemId("");
  }

  useEffect(() => {
    let batal = false;
    mulaiMuat(async () => {
      const hasil = await muatTujuanAction(locationId);
      if (batal) return;
      if ("error" in hasil) setGalat(hasil.error);
      else setData(hasil);
    });
    return () => {
      batal = true;
    };
  }, [locationId]);

  // Hasilnya diangkat ke induk. Kalau bannernya dirender DI SINI, ia lenyap
  // seketika: foto yang berhasil dipakai hilang dari kantong sesudah
  // revalidasi, panel ini ikut tidak terpasang lagi, dan pelapor tidak pernah
  // sempat membaca konfirmasinya — termasuk peringatan "cap tetap dasar".
  useEffect(() => {
    if (state.ok || state.warning || state.error) onHasil(state);
  }, [state, onHasil]);

  const laporanTerpilih = data?.laporan.find((l) => l.id === reportId) ?? null;

  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <p className="mb-2 text-sm font-semibold text-ink">Pakai {photoIds.length} foto di…</p>

      {galat ? <Banner tone="error" title={galat} className="mb-2" /> : null}

      <form action={action} className="space-y-3">
        {photoIds.map((id) => (
          <input key={id} type="hidden" name="photoIds" value={id} />
        ))}
        <input type="hidden" name="tujuan" value={tujuan} />

        <div className="flex gap-2">
          {(["laporan", "kegiatan"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTujuan(t)}
              aria-pressed={tujuan === t}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                tujuan === t
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-ink-muted"
              }`}
            >
              {t === "laporan" ? "Laporan Harian" : "Kegiatan Lapangan"}
            </button>
          ))}
        </div>

        {memuat ? (
          <p className="text-sm text-ink-muted">Memuat tujuan…</p>
        ) : tujuan === "laporan" ? (
          data && data.laporan.length > 0 ? (
            <div className="space-y-2">
              <div>
                <Label htmlFor="fc-laporan">Tanggal laporan</Label>
                <Combobox
                  id="fc-laporan"
                  value={reportId}
                  onChange={(v) => {
                    setReportId(v);
                    setReportItemId("");
                  }}
                  options={data.laporan.map((l) => ({ value: l.id, label: l.label }))}
                  placeholder="Pilih laporan…"
                />
              </div>
              {laporanTerpilih ? (
                <div>
                  <Label htmlFor="fc-item">Item pekerjaan</Label>
                  <Combobox
                    id="fc-item"
                    name="reportItemId"
                    value={reportItemId}
                    onChange={setReportItemId}
                    options={laporanTerpilih.items.map((i) => ({ value: i.id, label: i.label }))}
                    placeholder="Pilih item…"
                  />
                  {laporanTerpilih.items.length === 0 ? (
                    <HelpText>
                      Laporan ini belum punya item pekerjaan. Isi itemnya dulu di Hari Ini, baru
                      fotonya bisa ditempelkan.
                    </HelpText>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <HelpText>
              Tidak ada laporan harian yang masih bisa disunting di lokasi ini. Laporan yang sudah
              dikirim atau disetujui sengaja tidak ditawarkan – menambah lampiran ke sana berarti
              mengubah berkas yang sudah disahkan orang lain.
            </HelpText>
          )
        ) : data && data.kegiatan.length > 0 ? (
          <div>
            <Label htmlFor="fc-kegiatan">Kegiatan</Label>
            <Combobox
              id="fc-kegiatan"
              name="kegiatanId"
              value={kegiatanId}
              onChange={setKegiatanId}
              options={data.kegiatan.map((k) => ({ value: k.id, label: k.label }))}
              placeholder="Pilih kegiatan…"
            />
          </div>
        ) : (
          <HelpText>
            Tidak ada kegiatan lapangan berstatus draft di lokasi ini. Buat kegiatannya dulu di
            workspace lokasi.
          </HelpText>
        )}

        <Button
          type="submit"
          disabled={pending || memuat || (tujuan === "laporan" ? !reportItemId : !kegiatanId)}
        >
          {pending ? "Memproses…" : "Pakai foto"}
        </Button>
        <HelpText>
          Waktu & koordinat foto TIDAK berubah – yang ditambahkan hanya nama lokasi, perusahaan,
          bangunan, dan item pekerjaannya ke capnya.
        </HelpText>
      </form>
    </div>
  );
}
