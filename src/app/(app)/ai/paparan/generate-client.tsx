"use client";

import { useAksi } from "@/lib/aksi-klien";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox } from "@/components/ui";
import { buatPaparanAction, type PaparanState } from "@/lib/paparan/actions";

type PaketOpsi = {
  id: string;
  name: string;
  lokasi: number;
  bolehPaket: boolean;
  lokasiPilihan: { id: string; name: string }[];
  mingguBerjalan: number;
  mingguSelesai: number;
};

/**
 * Form generate Paparan Mingguan KKP (DECISIONS 416 + 420).
 *
 * Default minggu = minggu kontrak TERAKHIR YANG SELESAI — itu yang dipaparkan
 * ke KKP. Minggu berjalan boleh dipilih tetapi selalu berlabel "belum genap".
 *
 * Lingkup: seluruh paket atau satu lokasi. "Seluruh paket" hanya muncul bila
 * user memegang SEMUA lokasi aktif paket itu; kalau tidak, lingkupnya terkunci
 * ke lokasi dan alasannya ditulis, bukan dibiarkan terbaca sebagai pilihan yang
 * hilang tanpa sebab.
 */
export function PaparanGenerateClient({
  paket,
  initialPackageId,
  initialLocationId,
  sudahAda,
}: {
  paket: PaketOpsi[];
  initialPackageId?: string;
  initialLocationId?: string;
  /** Paparan TERBARU per lingkup+minggu, untuk pengingat sebelum bikin versi baru. */
  sudahAda: { kunci: string; id: string; versi: number; status: string; diperbarui: string }[];
}) {
  const awal = paket.some((p) => p.id === initialPackageId) ? initialPackageId! : (paket[0]?.id ?? "");
  const [paketId, setPaketId] = useState(awal);
  const dipilih = useMemo(() => paket.find((p) => p.id === paketId) ?? null, [paket, paketId]);
  const [lokasiId, setLokasiId] = useState(() => {
    const p = paket.find((x) => x.id === awal);
    if (initialLocationId && p?.lokasiPilihan.some((l) => l.id === initialLocationId)) {
      return initialLocationId;
    }
    return p && !p.bolehPaket ? (p.lokasiPilihan[0]?.id ?? "") : "";
  });
  // Ganti paket → lingkup lama bisa jadi bukan milik paket baru.
  const lokasiSah = dipilih?.lokasiPilihan.some((l) => l.id === lokasiId) ?? false;
  const lokasiTerpakai = lokasiSah ? lokasiId : dipilih?.bolehPaket ? "" : (dipilih?.lokasiPilihan[0]?.id ?? "");
  const [state, formAction, pending] = useAksi<PaparanState>(buatPaparanAction, undefined);

  const opsiMinggu = useMemo(() => {
    if (!dipilih) return [];
    const daftar: { nilai: number; label: string }[] = [];
    for (let n = dipilih.mingguBerjalan; n >= 1; n--) {
      daftar.push({
        nilai: n,
        label:
          n >= dipilih.mingguBerjalan
            ? `Minggu ke-${n} (berjalan – belum genap)`
            : `Minggu ke-${n}`,
      });
    }
    return daftar;
  }, [dipilih]);
  const defaultMinggu = dipilih && dipilih.mingguSelesai >= 1 ? dipilih.mingguSelesai : dipilih?.mingguBerjalan;

  /*
   * Minggu yang dipilih dilacak di state supaya pengingat bisa ikut berubah.
   * Combobox minggu dulu tak terkendali (defaultValue) — cukup selama tak ada
   * yang bergantung padanya; sekarang ada.
   */
  const [minggu, setMinggu] = useState<string>("");
  const mingguTerpakai = minggu !== "" && opsiMinggu.some((o) => String(o.nilai) === minggu)
    ? minggu
    : String(defaultMinggu ?? 1);
  const kunci = `${paketId}|${lokasiTerpakai}|${mingguTerpakai}`;
  const lama = sudahAda.find((a) => a.kunci === kunci) ?? null;
  // Konfirmasi hanya diminta bila memang sudah ada – bukan pintu tambahan untuk
  // semua orang setiap kali.
  const [konfirmasi, setKonfirmasi] = useState(false);

  if (paket.length === 0) {
    return (
      <Banner
        tone="info"
        title="Belum ada paket yang siap dipaparkan"
        description="Paparan butuh paket berkontrak dengan SPMK dan lokasi aktif, dan seluruh lokasinya dalam akses Anda."
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title="Buat Paparan Mingguan KKP"
        subtitle="Deck PDF lanskap 16:9 – angka dihitung MARLIN pada akhir minggu terpilih; AI hanya merapikan narasi dan selalu direview sebelum final."
      />
      <CardBody>
        {state?.error ? <Banner tone="error" title={state.error} className="mb-3" /> : null}
        <form id="pp-form" action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="pp-paket" className="mb-1 block text-sm font-medium text-ink">
              Paket / kontrak
            </label>
            <Combobox id="pp-paket" name="packageId" value={paketId} onChange={setPaketId}>
              {paket.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.lokasi} lokasi)
                </option>
              ))}
            </Combobox>
          </div>
          <div className="min-w-56 flex-1">
            <label htmlFor="pp-lingkup" className="mb-1 block text-sm font-medium text-ink">
              Lingkup
            </label>
            <Combobox
              id="pp-lingkup"
              name="locationId"
              key={`${paketId}-${lokasiTerpakai}`}
              value={lokasiTerpakai}
              onChange={setLokasiId}
            >
              {dipilih?.bolehPaket ? <option value="">Seluruh paket ({dipilih.lokasi} lokasi)</option> : null}
              {(dipilih?.lokasiPilihan ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Combobox>
          </div>
          <div className="w-64">
            <label htmlFor="pp-minggu" className="mb-1 block text-sm font-medium text-ink">
              Minggu kontrak
            </label>
            {/* key= supaya default ikut berganti saat paketnya berganti */}
            <Combobox
              id="pp-minggu"
              name="weekNumber"
              key={paketId}
              value={mingguTerpakai}
              onChange={setMinggu}
            >
              {opsiMinggu.map((o) => (
                <option key={o.nilai} value={o.nilai}>
                  {o.label}
                </option>
              ))}
            </Combobox>
          </div>
          <div className="w-44">
            <label htmlFor="pp-fokus" className="mb-1 block text-sm font-medium text-ink">
              Fokus
            </label>
            <Combobox id="pp-fokus" name="focus" defaultValue="lengkap">
              <option value="lengkap">Lengkap</option>
              <option value="progres">Progres</option>
              <option value="kendala">Kendala</option>
            </Combobox>
          </div>
          {/*
            Tombol konfirmasi SENGAJA tidak menggantikan tombol pemicu di titik
            yang sama. Menukar dua tombol di posisi identik membuat satu klik
            beruntun mengenai keduanya — ketahuan dari uji e2e yang menggantung
            karena tombol kedua sudah `pending` sebelum sempat diklik. Yang
            kedua hidup di panel pengingat di bawah, memakai atribut `form`.
          */}
          {lama ? (
            <Button
              type="button"
              variant="secondary"
              className="h-10"
              disabled={konfirmasi}
              onClick={() => setKonfirmasi(true)}
            >
              Buat versi baru (v{lama.versi + 1})
            </Button>
          ) : (
            <Button type="submit" loading={pending} className="h-10">
              Buat Paparan
            </Button>
          )}
        </form>

        {lama ? (
          <div className="mt-3">
            <Banner
              tone={konfirmasi ? "warning" : "info"}
              title={
                konfirmasi
                  ? `Buat versi baru? Paparan v${lama.versi} tetap tersimpan.`
                  : `Sudah ada paparan untuk lingkup & minggu ini – v${lama.versi} (${lama.status}), diperbarui ${lama.diperbarui}.`
              }
              description={
                konfirmasi
                  ? "Versi baru dihitung ulang dari data terkini dan dimulai sebagai draf kosong suntingan – catatan yang Anda tulis di v" +
                    lama.versi +
                    " tidak ikut pindah."
                  : "Buka yang sudah ada bila hanya ingin melihat atau melanjutkan review. Versi baru dibuat hanya bila datanya memang sudah berubah."
              }
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {konfirmasi ? (
                <Button type="submit" form="pp-form" loading={pending} size="sm">
                  Ya, buat v{lama.versi + 1}
                </Button>
              ) : null}
              <Link href={`/ai/paparan/${lama.id}`} className="font-medium text-primary hover:underline">
                Buka paparan v{lama.versi}
              </Link>
              {konfirmasi ? (
                <button
                  type="button"
                  onClick={() => setKonfirmasi(false)}
                  className="font-medium text-ink-muted hover:underline"
                >
                  Batal
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-ink-muted">
          Hasilnya selalu DRAF ber-watermark – melewati review dan persetujuan dulu sebelum jadi PDF final.
          {dipilih && !dipilih.bolehPaket
            ? " Paket ini hanya bisa dipaparkan per lokasi: sebagian lokasi aktifnya di luar penugasan Anda."
            : ""}
        </p>
      </CardBody>
    </Card>
  );
}
