"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Images, MapPin, MapPinOff } from "lucide-react";
import { Banner, Button, HelpText } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  muatKantongLokasiAction,
  pakaiFotoAction,
  type FotoCepatState,
} from "@/lib/foto-cepat/actions";
import type { FotoKantong } from "@/lib/foto-cepat/queries";

/**
 * AMBIL FOTO DARI KANTONG FOTO CEPAT — dari layar yang sedang diisi.
 *
 * Keluhan user 2026-08-06: *"di sisi inputan laporan harian maupun kegiatan
 * lapangan pun, perlu untuk bisa mengambil dari hasil foto cepat ini, kalau
 * tidak, akan percuma fitur ini."*
 *
 * Sebelumnya foto di kantong hanya bisa dipakai dari halaman /foto-cepat. Arah
 * itu benar untuk orang yang baru pulang dari lapangan dengan sekantong foto,
 * tapi salah untuk orang yang sedang MENGISI laporan: dia harus meninggalkan
 * formulir yang belum tersimpan, mencari fotonya, memilih ulang tanggal + item
 * yang sedang terbuka di layar sebelumnya, lalu kembali dan mencari lagi sampai
 * mana tadi. Yang benar-benar terjadi bukan itu — melainkan memotret ulang dari
 * layar laporan, dengan koordinat seadanya, sementara foto yang koordinatnya
 * justru benar menumpuk tak terpakai di kantong.
 *
 * Berkasnya berisi TIGA bagian yang sengaja terpisah:
 *
 * - `TombolAmbilDariKantong` — pemicunya, sebaris dengan aksi foto lain.
 * - `PemilihKantong` — petak fotonya saja, TANPA form. Ini yang membuatnya bisa
 *   dipakai di dalam formulir item yang belum disimpan (form tidak boleh
 *   bersarang), sehingga foto kantong bisa dipilih SEBELUM item ada.
 * - `AmbilDariKantong` — pembungkus form + tombol kirim, untuk item yang SUDAH
 *   tersimpan. Memakai `pakaiFotoAction` yang SAMA dengan halaman /foto-cepat —
 *   bukan jalur penautan kedua.
 */

type Tujuan =
  | { tujuan: "laporan"; reportItemId: string }
  | { tujuan: "kegiatan"; kegiatanId: string };

const KOSONG: FotoCepatState = {};

/**
 * Pemicunya DIPISAH dari panelnya, dan sengaja.
 *
 * Panel ini berisi petak-petak foto: ia butuh lebar penuh. Tombolnya sebaliknya
 * — tempatnya sebaris dengan aksi foto lain, supaya "ambil yang sudah dijepret"
 * dan "potret baru" terbaca sebagai dua pilihan setara, bukan dua lapis menu.
 * Kalau keduanya satu komponen, panelnya ikut jadi anak baris flex dan petaknya
 * terjepit di sisa lebar satu baris tombol.
 */
export function TombolAmbilDariKantong({
  onClick,
  aktif,
  jumlahTerpilih,
}: {
  onClick: () => void;
  /** Panelnya sedang terbuka — tombolnya ditandai, bukan disembunyikan. */
  aktif?: boolean;
  /** Sudah ada yang dipilih tapi panelnya ditutup — jumlahnya tetap terbaca. */
  jumlahTerpilih?: number;
}) {
  return (
    <Button
      type="button"
      variant={aktif || (jumlahTerpilih ?? 0) > 0 ? "secondary" : "ghost"}
      size="sm"
      className="px-2"
      onClick={onClick}
      aria-expanded={aktif ?? false}
    >
      <Images aria-hidden className="size-4" />
      Foto Cepat
      {(jumlahTerpilih ?? 0) > 0 ? ` (${jumlahTerpilih})` : ""}
    </Button>
  );
}

/**
 * UBIN "Foto Cepat" — kembaran visual ubin Kamera/Galeri (DECISIONS 341).
 *
 * Dipakai di baris sumber foto `PhotoSourceInput`, lewat prop `slotKetiga`.
 * Bentuknya sengaja SAMA PERSIS dengan dua ubin di sebelahnya: mengambil dari
 * kantong Foto Cepat bukan pilihan kelas dua — untuk foto yang dijepret di
 * lapangan lewat /foto-cepat, koordinat dan jamnya justru yang paling benar
 * (DECISIONS 253). Yang membedakannya cuma satu: ia membuka panel pemilih,
 * bukan pemilih berkas perangkat.
 */
export function UbinAmbilDariKantong({
  onClick,
  aktif,
  jumlahTerpilih,
  ringkas = false,
}: {
  onClick: () => void;
  aktif?: boolean;
  jumlahTerpilih?: number;
  /** Bentuk ringkas, seragam dengan `PhotoSourceInput ringkas` (DECISIONS 344). */
  ringkas?: boolean;
}) {
  const dipilih = (jumlahTerpilih ?? 0) > 0;
  const nyala = aktif || dipilih;
  if (ringkas) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={aktif ?? false}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium",
          nyala
            ? "border-primary bg-primary-50 text-ink"
            : "border-border bg-surface text-ink hover:border-primary hover:bg-primary-50",
        )}
      >
        <Images aria-hidden className="size-3.5 text-ink-muted" />
        Foto Cepat
        {/* Jumlah terpilih tetap terbaca walau keterangannya dibuang — itu
            satu-satunya penanda bahwa ada foto yang menunggu disimpan. */}
        {dipilih ? ` (${jumlahTerpilih})` : ""}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={aktif ?? false}
      className={cn(
        "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center",
        nyala
          ? "border-primary bg-primary-50 text-ink"
          : "border-border bg-surface text-ink hover:border-primary hover:bg-primary-50",
      )}
    >
      <Images aria-hidden className="size-5 text-ink-muted" />
      <span className="text-[13px] font-semibold">Foto Cepat</span>
      <span className="text-[10px] leading-tight text-ink-muted">
        {dipilih ? `${jumlahTerpilih} dipilih` : "Sudah dijepret"}
      </span>
    </button>
  );
}

/**
 * PETAK PEMILIH — tanpa form, tanpa tombol kirim.
 *
 * Pemuatan kantong dipicu ulang lewat `muatUlangKunci`: nilainya berubah →
 * daftarnya ditarik lagi dari server. Itu yang dipakai pemanggil untuk
 * memastikan daftar tidak basi sesudah sebagian fotonya terpakai di tempat lain.
 */
export function PemilihKantong({
  locationId,
  terpilih,
  onUbah,
  muatUlangKunci,
}: {
  locationId: string;
  terpilih: ReadonlySet<string>;
  onUbah: (ids: ReadonlySet<string>) => void;
  muatUlangKunci?: number;
}) {
  const [fotos, setFotos] = useState<FotoKantong[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, mulaiMuat] = useTransition();

  const muat = useCallback(() => {
    mulaiMuat(async () => {
      const hasil = await muatKantongLokasiAction(locationId);
      if ("error" in hasil) {
        setGalat(hasil.error);
        setFotos([]);
      } else {
        setGalat(null);
        setFotos(hasil.fotos);
      }
    });
  }, [locationId]);

  useEffect(() => {
    if (fotos == null && !memuat) muat();
  }, [fotos, memuat, muat]);

  // Kunci berubah → paksa muat ulang. Lewat timeout, bukan sinkron di badan
  // effect: lint repo ini melarang setState sinkron di effect.
  useEffect(() => {
    if (muatUlangKunci == null) return;
    const t = window.setTimeout(() => setFotos(null), 0);
    return () => window.clearTimeout(t);
  }, [muatUlangKunci]);

  const toggle = (id: string) => {
    const n = new Set(terpilih);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onUbah(n);
  };

  if (galat) return <Banner tone="error" title={galat} />;
  if (memuat && fotos == null) return <p className="text-sm text-ink-muted">Memuat kantong…</p>;
  if ((fotos?.length ?? 0) === 0)
    return (
      <HelpText>
        Belum ada foto kantong untuk lokasi ini. Foto yang lokasinya belum ketahuan tidak ditawarkan
        di sini — tetapkan lokasinya dulu di menu Foto Cepat.
      </HelpText>
    );

  return (
    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {fotos!.map((f) => {
        const dipilih = terpilih.has(f.id);
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => toggle(f.id)}
              aria-pressed={dipilih}
              aria-label={`${dipilih ? "Batal pilih" : "Pilih"} foto ${f.waktuLabel}`}
              className={`relative block w-full overflow-hidden rounded-md border text-left transition ${
                dipilih ? "border-primary ring-2 ring-primary" : "border-border"
              }`}
            >
              <span
                aria-hidden
                className={`absolute left-1 top-1 z-10 grid size-5 place-items-center rounded-full border shadow ${
                  dipilih
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-surface/90 text-transparent"
                }`}
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
              <span className="block aspect-square bg-surface-inset">
                {f.thumbUrl ? (
                  // Foto R2 ber-presigned URL berumur pendek — next/image tidak
                  // dipakai di seluruh aplikasi ini karena hostnya berganti tiap
                  // deploy.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />
                ) : null}
              </span>
              <span className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-ink-muted">
                {f.gpsAsli ? (
                  <MapPin aria-hidden className="size-3 shrink-0 text-success" />
                ) : (
                  <MapPinOff aria-hidden className="size-3 shrink-0 text-warning" />
                )}
                <span className="truncate">{f.waktuLabel}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AmbilDariKantong({
  locationId,
  target,
  onTutup,
}: {
  locationId: string;
  target: Tujuan;
  onTutup: () => void;
}) {
  const router = useRouter();
  const [terpilih, setTerpilih] = useState<ReadonlySet<string>>(new Set());
  const [state, action, pending] = useActionState(pakaiFotoAction, KOSONG);

  /*
   * `onTutup` disimpan di ref, TIDAK dijadikan dependensi effect.
   *
   * Pemanggil lazim mengopernya sebagai arrow inline, jadi identitasnya berubah
   * tiap render. Kalau ia jadi dependensi, effect di bawah dijadwal ulang tiap
   * render — dan karena effect itu memanggil `router.refresh()` yang MEMICU
   * render, jadwal ulangnya bisa memicu penyegaran berkali-kali untuk satu
   * keberhasilan.
   */
  const tutupRef = useRef(onTutup);
  useEffect(() => {
    tutupRef.current = onTutup;
  }, [onTutup]);

  /**
   * Berhasil → panelnya DITUTUP, bukan dibiarkan terbuka dengan sisa fotonya.
   *
   * Keluhan user 2026-08-07: *"saat kemudian user input item pekerjaan baru,
   * lalu berhasil, tampilan pilihan dari kantong harusnya menutup. karena jika
   * tidak, user kemudian memilih foto untuk item pekerjaan dari sisa foto yang
   * sebelumnya... padahal sudah dipilih di item lain."*
   *
   * Betul, dan bahayanya bukan sekadar berantakan: panel yang tetap terbuka itu
   * terikat pada item LAMA. Pelapor yang baru saja menyimpan pekerjaan baru
   * akan memakai panel terdekat yang kebetulan masih terbuka, dan fotonya
   * mendarat di pekerjaan yang salah — tanpa satu pun pesan galat, karena
   * secara aturan penautannya memang sah.
   *
   * `router.refresh()` mengurus galeri item di halaman ini; `pakaiFotoAction`
   * sendiri hanya merevalidasi /foto-cepat dan /foto.
   */
  useEffect(() => {
    if (!state.ok && !state.warning) return;
    const t = window.setTimeout(() => {
      setTerpilih(new Set());
      router.refresh();
      tutupRef.current();
    }, 0);
    return () => window.clearTimeout(t);
  }, [state.ok, state.warning, router]);

  const ids = useMemo(() => [...terpilih], [terpilih]);

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">Foto di kantong lokasi ini</span>
        <button
          type="button"
          onClick={onTutup}
          className="text-[12px] font-medium text-ink-muted hover:underline"
        >
          Tutup
        </button>
      </div>

      {state.error ? <Banner tone="error" title={state.error} /> : null}
      {state.warning ? <Banner tone="warning" title={state.warning} /> : null}

      <form action={action} className="space-y-2">
        {ids.map((id) => (
          <input key={id} type="hidden" name="photoIds" value={id} />
        ))}
        <input type="hidden" name="tujuan" value={target.tujuan} />
        {target.tujuan === "laporan" ? (
          <input type="hidden" name="reportItemId" value={target.reportItemId} />
        ) : (
          <input type="hidden" name="kegiatanId" value={target.kegiatanId} />
        )}

        <PemilihKantong locationId={locationId} terpilih={terpilih} onUbah={setTerpilih} />

        <Button type="submit" size="sm" loading={pending} disabled={ids.length === 0}>
          {ids.length === 0 ? "Pilih foto dulu" : `Pakai ${ids.length} foto`}
        </Button>
        <HelpText>
          Waktu & koordinat foto TIDAK berubah — yang ditambahkan hanya nama lokasi, perusahaan,
          bangunan, dan item pekerjaannya ke capnya.
        </HelpText>
      </form>
    </div>
  );
}
