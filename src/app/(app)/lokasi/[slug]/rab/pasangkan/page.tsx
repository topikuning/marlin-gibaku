import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, CollapsibleCard } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can, ROLE_LABEL } from "@/lib/authz";
import { formatTanggal } from "@/lib/format";
import { dataPadananAktif, type UsulanPadanan } from "@/lib/rab/padanan-aktif";
import { bolehMenyetujui } from "@/lib/rab/persetujuan-aturan";
import { akarLineage } from "@/lib/rab/padanan-draft-aturan";
import { requireLocationPage } from "../../get-location";
import {
  BarisBelum,
  BarisLuarRab,
  KartuBerlaku,
  KartuMenunggu,
  type BelumView,
  type CalonView,
  type LuarRabView,
  type UsulanView,
} from "./panel-pasangkan";

export const metadata: Metadata = { title: "Pasangkan realisasi" };
export const dynamic = "force-dynamic";

/**
 * MENU "PASANGKAN REALISASI" (DECISIONS 777).
 *
 * Permintaan user 2026-11-25: *"buat bisa dipasangkan sesudah aktivasi, menu
 * khusus. mitigasi semua resiko dan penanganannya"*.
 *
 * Pekerjaan yang sudah dilaporkan tapi tidak dipasangkan saat adendum
 * diaktifkan – hilang dari RAB, atau dinolkan – dipasangkan ke item RAB aktif
 * lewat usulan yang berlaku sesudah dua persetujuan. Tanpa rupiah: yang
 * dipindah volume, dan halaman ini juga dibuka pelaksana.
 *
 * DECISIONS 780: catatan pekerjaan di luar RAB (738) juga dipasangkan di sini,
 * langsung ke item RAB aktif. Keluhan user 2026-11-25: *"ada pekerjaan-pekerjaan
 * di luar RAB yang sudah diinput manual, itu dimana matchingkan dengan RAB
 * aktifnya?"*.
 *
 * DECISIONS 781: tujuannya SEMUA item pekerjaan RAB aktif; satuan ikut item
 * tujuan, volume yang masuk diisi orang paling banyak sebesar sisanya.
 */
export default async function PasangkanPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const q = await searchParams;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const { aktif, calon, belum, luarRab, usulan } = await dataPadananAktif(location.id);

  const bolehKelola = can(user.role, "rab.manage");
  const bolehSetujui = bolehMenyetujui(user.role);
  const tgl = (d: Date | null) => (d ? formatTanggal(d, "d MMM yyyy") : "");

  const belumView: BelumView[] = belum.map((b) => ({
    lineageKey: b.lineageKey,
    name: b.name,
    unit: b.unit,
    jalur: [b.kategori, b.jalur.split(" · ").slice(1).join(" · ")].filter(Boolean).join(" · "),
    kategori: b.kategori,
    akar: akarLineage(b.lineageKey),
    jenis: b.jenis === "dinolkan" ? "dinolkan" : "hilang",
    volume: b.volume,
    jumlahLaporan: b.jumlahLaporan,
    rentang: b.pertama ? (tgl(b.pertama) === tgl(b.terakhir) ? tgl(b.pertama) : `${tgl(b.pertama)} – ${tgl(b.terakhir)}`) : null,
    keterangan: b.keterangan,
    saran: b.saran,
    pilihan: b.pilihan,
    terhalang: b.terhalang,
  }));
  const calonView: CalonView[] = calon.map((c) => ({
    value: c.lineageKey,
    label: `${c.jalur} ${c.name} – ${c.unit ?? "tanpa satuan"}, sisa ${fmt(c.sisa)}`,
    name: c.name,
    unit: c.unit,
    akar: c.akar,
    sisa: c.sisa,
  }));
  const rentang = (a: string | null, z: string | null) => {
    if (!a) return null;
    const d = (k: string) => formatTanggal(new Date(`${k}T00:00:00.000Z`), "d MMM yyyy");
    return a === z || !z ? d(a) : `${d(a)} – ${d(z)}`;
  };
  const luarView: LuarRabView[] = luarRab.map((k) => ({
    kunci: k.kunci,
    uraian: k.uraian,
    satuan: k.satuan,
    catatanIds: k.catatanIds,
    volume: k.volume,
    jumlahLaporan: k.jumlahLaporan,
    rentang: rentang(k.pertama, k.terakhir),
    tertahan: !k.tertahan
      ? null
      : k.catatanIds.length > 0
        ? `${k.tertahan.jumlah} catatan lain ada di laporan yang belum dikirim (${k.tertahan.tanggal}), jadi belum ikut. Kirim laporannya dulu.`
        : `${k.tertahan.jumlah} catatan ada di laporan yang belum dikirim (${k.tertahan.tanggal}). Kirim laporannya dulu, baru bisa dipasangkan.`,
    asalDraft: k.asalDraft,
    saran: k.saran,
    pilihan: k.pilihan,
  }));

  const keUsulan = (u: UsulanPadanan): UsulanView => ({
    id: u.id,
    jenis: u.jenis,
    namaLama: u.namaLama,
    namaBaru: u.namaBaru,
    jalurBaru: u.jalurBaru,
    unit: u.unit,
    volume: u.volume,
    volumeAsal: u.volumeAsal,
    unitAsal: u.unitAsal,
    dipotong: u.dipotong,
    baris: u.baris,
    catatan: u.luarRabIds.length,
    alasan: u.alasan,
    diajukan: `diajukan ${u.diajukanOleh.nama}, ${tgl(u.diajukanPada)}`,
    suara: u.suara.map((s) => `${s.nama} (${ROLE_LABEL[s.role]})`),
    kurang: u.kurang,
    revisiBerganti: u.revisiBerganti,
    keterangan:
      u.keadaan === "berlaku"
        ? `Berlaku sejak ${tgl(u.berlakuPada)}`
        : u.keadaan === "dilepas"
          ? `Dilepas ${tgl(u.dilepasPada)}: ${u.alasanLepas ?? ""}`
          : u.keadaan === "ditutup"
            ? `${u.alasanTutup ?? "Ditutup"} (${tgl(u.ditutupPada)})`
            : null,
    sudahSaya: u.suara.some((s) => s.userId === user.id),
  });
  const kabar = kabarAksi(q, usulan);
  const menunggu = usulan.filter((u) => u.keadaan === "diajukan").map(keUsulan);
  const berlaku = usulan.filter((u) => u.keadaan === "berlaku").map(keUsulan);
  const riwayat = usulan.filter((u) => u.keadaan === "ditutup" || u.keadaan === "dilepas").map(keUsulan);

  return (
    <div className="max-w-4xl space-y-4">
      {kabar ? <Banner tone="success" title={kabar} /> : null}
      <Card>
        <CardHeader
          title="Pasangkan realisasi"
          subtitle="Pekerjaan yang sudah dilaporkan tapi tidak terhitung: item yang hilang atau dinolkan sejak adendum diaktifkan, dan catatan pekerjaan di luar RAB. Pasangkan ke item di RAB aktif supaya realisasinya terhitung."
          action={
            <ButtonLink href={`/lokasi/${slug}/rab`} variant="ghost" size="sm">
              <ArrowLeft aria-hidden className="size-3.5" />
              Kembali ke RAB
            </ButtonLink>
          }
        />
        <CardBody className="space-y-2 text-[13px] text-ink-muted">
          {!aktif ? (
            <Banner tone="info" title="Lokasi ini belum punya RAB aktif" />
          ) : (
            <>
              <p>
                Pemasangan berlaku sesudah disetujui <strong className="text-ink">Program Director</strong> dan{" "}
                <strong className="text-ink">Area Manager, Project Manager, atau Site Manager</strong>, sama seperti
                aktivasi adendum. Sebelum itu tidak ada angka yang berubah.
              </p>
              <p>
                Saat berlaku, baris laporan item lama pindah ke item tujuan. Tanggal, pelapor, dan fotonya tetap. Untuk
                item yang dinolkan, volumenya dikembalikan ke angka sebelum aktivasi. Catatan di luar RAB menjadi baris
                laporan item tujuan pada tanggal aslinya, dengan fotonya. RAB aktif, kurva-S, dan dokumen CCO tidak
                berubah. Pasangan bisa dilepas lagi selama RAB aktifnya belum berganti.
              </p>
              <p>
                Semua item pekerjaan RAB aktif bisa dipilih, apa pun kategori dan satuannya. Satuannya mengikuti item
                tujuan: isi volume yang masuk, paling banyak sebesar sisanya. Volume itu dibagi ke laporan-laporannya
                sesuai angka yang dicatat, dan angka aslinya kembali bila pasangan dilepas.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      {menunggu.length > 0 ? (
        <Card>
          <CardHeader title={`Menunggu persetujuan (${menunggu.length})`} />
          <CardBody>
            <ul className="divide-y divide-border rounded-md border border-border">
              {menunggu.map((u) => (
                <KartuMenunggu key={u.id} u={u} bolehSetujui={bolehSetujui} bolehKelola={bolehKelola} />
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {aktif ? (
        <Card>
          <CardHeader
            title={`Belum dipasangkan (${belumView.length})`}
            subtitle={
              belumView.length > 0
                ? "Hilang = itemnya tidak ada lagi di RAB aktif, volumenya tidak terhitung. Dinolkan = itemnya masih ada dengan volume 0, laporannya diturunkan jadi 0 saat aktivasi."
                : undefined
            }
          />
          <CardBody>
            {belumView.length === 0 ? (
              <Banner
                tone="success"
                title="Tidak ada pekerjaan terlapor yang tertinggal"
                description={`Semua yang sudah dilaporkan terhitung di RAB aktif (revisi #${aktif.revisionNo}), atau sudah diusulkan.`}
              />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {belumView.map((b) => (
                  <BarisBelum key={b.lineageKey} slug={slug} b={b} calon={calonView} bolehAjukan={bolehKelola} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {aktif ? (
        <Card>
          <CardHeader
            title={`Pekerjaan di luar RAB (${luarView.length})`}
            subtitle={
              luarView.length > 0
                ? "Dicatat pelaksana di laporan harian karena itemnya belum ada di RAB. Catatan yang uraian dan satuannya sama dikelompokkan."
                : undefined
            }
          />
          <CardBody>
            {luarView.length === 0 ? (
              <Banner
                tone="success"
                title="Tidak ada catatan pekerjaan di luar RAB yang menunggu"
                description="Yang sudah dipasangkan ada di bawah, yang dipadankan ke draft adendum ada di halaman Adendum."
              />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {luarView.map((k) => (
                  <BarisLuarRab key={k.kunci} slug={slug} k={k} calon={calonView} bolehAjukan={bolehKelola} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {berlaku.length > 0 ? (
        <Card>
          <CardHeader title={`Sudah dipasangkan (${berlaku.length})`} />
          <CardBody>
            <ul className="divide-y divide-border rounded-md border border-border">
              {berlaku.map((u) => (
                <KartuBerlaku key={u.id} u={u} bolehKelola={bolehKelola} />
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {riwayat.length > 0 ? (
        <CollapsibleCard title={`Riwayat usulan (${riwayat.length})`} subtitle="Yang ditolak, dibatalkan, atau dilepas.">
          <ul className="divide-y divide-border rounded-md border border-border">
            {riwayat.map((u) => (
              <li key={u.id} className="space-y-0.5 px-3 py-2.5 text-[13px]">
                <p className="font-medium text-ink">
                  {u.namaLama} → {u.namaBaru}
                </p>
                <p className="text-ink-muted">{u.keterangan}</p>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      ) : null}
    </div>
  );
}

const fmt = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(v);

/**
 * Kalimat hasil aksi terakhir, disusun dari data usulannya – alamat hanya
 * membawa kode dan id (lihat `actions.ts`). Id dari lokasi lain atau kode
 * yang tidak cocok dengan keadaan usulan = tidak ada kabar.
 */
function kabarAksi(q: Record<string, string | string[] | undefined>, usulan: UsulanPadanan[]): string | null {
  const kode = typeof q.kabar === "string" ? q.kabar : null;
  const u = typeof q.id === "string" ? usulan.find((x) => x.id === q.id) : undefined;
  if (!kode || !u) return null;
  const v = `${fmt(u.volume)}${u.unit ? ` ${u.unit}` : ""}`;
  const blanko = typeof q.blanko === "string" && /^\d+$/.test(q.blanko) ? Number(q.blanko) : 0;
  const tambahanBlanko = blanko > 0 ? ` ${blanko} blanko harian final ikut diperbarui.` : "";
  const potong = u.dipotong > 0 ? ` ${fmt(u.dipotong)}${u.unit ? ` ${u.unit}` : ""} tidak ikut masuk.` : "";
  const asal = u.jenis === "luar_rab" ? `${u.luarRabIds.length} catatan "${u.namaLama}"` : `"${u.namaLama}"`;
  if (kode === "diajukan" && u.keadaan === "diajukan") {
    return `Usulan dikirim: ${v} dari ${asal} ke "${u.namaBaru}".${potong} Berlaku sesudah disetujui Program Director dan Area Manager, Project Manager, atau Site Manager.`;
  }
  if (kode === "setuju" && u.keadaan === "diajukan") {
    return `Persetujuan Anda tercatat. Masih menunggu ${u.kurang.join(" dan ")}.`;
  }
  if ((kode === "berlaku" || kode === "setuju") && u.keadaan === "berlaku") {
    return (
      (u.jenis === "luar_rab"
        ? `Pemasangan berlaku: ${asal} masuk ke "${u.namaBaru}" di ${u.baris} laporan, ${v}`
        : `Pemasangan berlaku: ${u.baris} baris laporan "${u.namaLama}" pindah ke "${u.namaBaru}", ${v}` +
          (u.jenis === "dinolkan" ? `, dengan volume yang dulu dinolkan dikembalikan` : "")) +
      `.${potong} Progres sudah menghitungnya.${tambahanBlanko}`
    );
  }
  if (kode === "ditutup" && u.keadaan === "ditutup") {
    return `${u.alasanTutup?.startsWith("Ditolak") ? "Usulan ditolak" : "Usulan dibatalkan"}. ${u.jenis === "luar_rab" ? `Catatan "${u.namaLama}"` : `"${u.namaLama}"`} kembali ke daftar yang belum dipasangkan.`;
  }
  if (kode === "dilepas" && u.keadaan === "dilepas") {
    return (
      (u.jenis === "luar_rab"
        ? `Pasangan dilepas: catatan "${u.namaLama}" kembali menunggu dipasangkan, baris laporannya kembali seperti sebelum dipasangkan.`
        : `Pasangan dilepas: laporan "${u.namaLama}" kembali ke item lamanya, persis seperti sesudah aktivasi.`) + tambahanBlanko
    );
  }
  return null;
}
