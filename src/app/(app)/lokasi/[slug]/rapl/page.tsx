import type { Metadata } from "next";
import { Download, Printer } from "lucide-react";
import {
  Banner,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  KpiCard,
  SubTabs,
} from "@/components/ui";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { keadaanPadanan } from "@/lib/ahsp/padanan";
import { hitungTahap, kelompokkanPerUraian } from "@/lib/ahsp/kelompok";
import { keadaanItemRapl, simulasiRapl } from "@/lib/ahsp/rapl";
import { keadaanHarga } from "@/lib/ahsp/hsd";
import { keadaanUsulanAi } from "@/lib/ahsp/hsd-usulan";
import { analisaKontrakLokasi } from "@/lib/ahsp/analisa-kontrak";
import { requireLocationPage } from "../get-location";
import { PadananPanel, type BarisUraianRow } from "./padanan-panel";
import { SimulasiKebutuhan } from "./simulasi-kebutuhan";
import { Stepper, type TahapView } from "./stepper";
import { HargaPanel, RingkasBiaya, type BarisHargaRow } from "./harga-panel";
import { RincianPanel, type ItemRaplRow } from "./rincian-panel";
import { AnalisaAiPanel } from "./analisa-ai-panel";
import { keadaanAnalisaAi } from "@/lib/ahsp/analisa-ai-keadaan";
import { Kenapa } from "./kenapa";

export const metadata: Metadata = { title: "RAPL" };
export const dynamic = "force-dynamic";

/**
 * RAPL — Rencana Anggaran Pelaksanaan Lapangan (DECISIONS 319–326, 441, 473).
 *
 * Halaman ini disusun sebagai TAHAPAN, bukan tumpukan tabel: Petakan → Setujui
 * → Kebutuhan → Harga. Susunan lamanya menumpuk empat tabel sekaligus dan orang
 * harus menebak sendiri mulai dari mana; keluhan user 2026-08-16 ("tidak ui/ux
 * friendly") sah, dan cacat terbesarnya bukan selera: daftarnya menyodorkan
 * 1.616 baris RAB untuk 480 keputusan.
 *
 * ### Siapa boleh melihat UANGNYA (RAPL-07, DECISIONS 475)
 *
 * Breakdown kebutuhan (volume bahan/upah/alat) memakai `rab.view` — ia bagian
 * dari memahami pekerjaan. Tetapi HARGA, BIAYA, dan MARGIN menuntut
 * `rapl.view`. Sebelumnya seluruh halaman hanya dijaga `rab.view`, yang
 * dimiliki KEDELAPAN role — termasuk `wakil_ppk`, verifikator pihak pemberi
 * kerja. Artinya perkiraan biaya internal pelaksana beserta marginnya bisa
 * dibuka dan dicetak oleh lawan bicaranya sendiri saat negosiasi dan
 * pemeriksaan termin.
 *
 * Versi pertama memakai `finance.view`, dan itu keliru: capability itu milik
 * menu Keuangan yang sedang DITAHAN karena layarnya belum siap, jadi meminjamnya
 * membuat penahanan satu menu ikut mematikan RAPL untuk semua orang kecuali
 * super_admin. Sejak koreksi user 2026-08-29, RAPL punya pintunya sendiri:
 * `rapl.view` (Project Manager ke atas + exec_viewer) untuk melihat uangnya,
 * `rapl.manage` (Site Manager ke atas) untuk mengisinya.
 */
export default async function RaplPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ bagian?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const canManage = can(user.role, "rab.manage");
  const canExport = can(user.role, "report.export");

  const canInput = can(user.role, "rapl.manage");
  const canUseAi = can(user.role, "ai.generate");
  /**
   * MARGIN — biaya dibandingkan nilai RAB. Angka menawar, berhenti di kantor.
   * Bukan "menu disembunyikan": datanya tidak diambil.
   */
  const canSeeMargin = can(user.role, "rapl.view");
  /**
   * HARGA & BIAYA. Yang mengisi harus melihat yang diisinya — Site Manager
   * memegang `rapl.manage` justru karena dialah yang tahu harga bahan di
   * lapangan. Yang tidak ia lihat cuma marginnya.
   */
  const canSeeMoney = canSeeMargin || canInput;

  const diminta = ["ringkasan", "rincian", "kebutuhan", "validasi"].includes(query.bagian ?? "")
    ? (query.bagian as "ringkasan" | "rincian" | "kebutuhan" | "validasi")
    : "ringkasan";
  // Alamat "?bagian=…" tidak boleh jadi pintu belakang ke angka uang.
  const bagian =
    (diminta === "kebutuhan" || diminta === "rincian") && !canSeeMoney ? "ringkasan" : diminta;

  const [basis, { baris, cakupan }, rapl, harga, usulan, perItem, analisaAi] = await Promise.all([
    ringkasAhsp(),
    keadaanPadanan(location.id),
    simulasiRapl(location.id),
    canSeeMoney ? keadaanHarga(location.id) : Promise.resolve(null),
    canSeeMoney && canInput ? keadaanUsulanAi(location.id) : Promise.resolve(null),
    canSeeMoney ? keadaanItemRapl(location.id) : Promise.resolve(null),
    // Draf analisa AI tampil di "Rincian per item" – ikut pintu uang yang sama.
    canSeeMoney && bagian === "rincian" ? keadaanAnalisaAi(location.id) : Promise.resolve(null),
  ]);

  /*
   * Rincian per item — bentuk yang sebenarnya dipakai orang saat menawar
   * (RAPL-08). BigInt diserialisasi di sini; komponen klien tidak boleh
   * menerimanya mentah.
   */
  const itemRows: ItemRaplRow[] = (perItem?.item ?? []).map((i) => {
    return {
      lineageKey: i.lineageKey,
      code: i.code,
      uraian: i.uraian,
      satuan: i.satuan,
      volume: i.volume,
      nilaiRab: i.nilaiRab.toString(),
      cara: i.cara,
      sumberAnalisa: i.sumberAnalisa,
      komponen: i.komponen.map((k) => ({
        kategori: k.kategori,
        nama: k.nama,
        satuan: k.satuan,
        jumlah: k.jumlah,
        dariAhsp: k.dariAhsp,
        harga: k.harga === null ? null : k.harga.toString(),
        hargaDariKontrak: k.hargaDariKontrak,
        biaya: k.biaya === null ? null : k.biaya.toString(),
      })),
      biaya: i.biaya.toString(),
      komponenBelumBerharga: i.komponenBelumBerharga,
      lengkap: i.lengkap,
      margin: i.margin === null ? null : i.margin.toString(),
      marginPersen: i.marginPersen,
      alasanLewat: i.alasanLewat,
      rinciLewat: i.rinciLewat,
      faktorKonversi: i.faktorKonversi,
      catatanKonversi: i.catatanKonversi,
      hargaBorongan: i.hargaBorongan === null ? null : i.hargaBorongan.toString(),
    };
  });

  // Item yang memakai analisa dari berkas kontrak (keputusan user 2026-10-06)
  // – tidak ikut daftar padanan AHSP, tapi tetap dihitung di RAPL.
  const itemKontrak = (await analisaKontrakLokasi(location.id)).size;
  const adaRab = cakupan.item > 0 || rapl.barisRab > 0;

  const uraian = kelompokkanPerUraian(baris);
  const tahapan = hitungTahap(uraian);
  const aktif = tahapan.find((t) => t.aktif)?.tahap ?? "kebutuhan";

  const tahapView: TahapView[] = tahapan.map((t) => ({
    tahap: t.tahap,
    judul: t.judul,
    sisa: t.sisa,
    selesai: t.selesai,
    nilaiSisa: t.nilaiSisa.toString(),
    aktif: t.aktif,
    ajakan: t.ajakan,
  }));

  const rows: BarisUraianRow[] = uraian.map((u) => ({
    tanda: u.tanda,
    uraian: u.uraian,
    unit: u.unit,
    kodeContoh: u.kodeContoh,
    jumlahBaris: u.jumlahBaris,
    volume: u.volume,
    nilai: u.nilai.toString(),
    keadaan: u.keadaan,
    skor: u.skor,
    meyakinkan: u.meyakinkan,
    catatan: u.catatan,
    petunjuk: u.petunjuk,
    ahspKode: u.ahsp?.kode ?? null,
    ahspUraian: u.ahsp?.uraian ?? null,
    ahspSatuan: u.ahsp?.satuan ?? null,
    ahspTanpaKomponen: u.ahsp ? u.ahsp.jumlahKomponen === 0 : false,
    ahspPerluVerifikasi: u.ahsp?.perluVerifikasi ?? false,
  }));

  /*
   * Urutan pengisian harga: yang BELUM berharga lebih dulu, lalu dari NILAI RAB
   * YANG TERTAHAN — bukan dari kuantitas. Mengisi 20 baris teratas dengan
   * urutan ini menutup sebagian besar nilai proyek; dengan urutan kuantitas ia
   * menutup baris yang kebetulan cacahannya besar (RAPL-03).
   */
  const barisHarga: BarisHargaRow[] = [...(harga?.baris ?? [])]
    .sort(
      (a, b) =>
        Number(a.harga !== null) - Number(b.harga !== null) ||
        (b.nilaiTertahan > a.nilaiTertahan ? 1 : b.nilaiTertahan < a.nilaiTertahan ? -1 : 0) ||
        b.jumlah - a.jumlah,
    )
    .map((h) => ({
      kategori: h.kategori,
      nama: h.nama,
      satuan: h.satuan,
      jumlah: h.jumlah,
      harga: h.harga === null ? null : h.harga.toString(),
      biaya: h.biaya === null ? null : h.biaya.toString(),
      sumber: h.sumber,
      nilaiTertahan: h.nilaiTertahan.toString(),
      rekomendasi: h.rekomendasi.map((r) => ({
        harga: r.harga.toString(),
        lokasi: r.lokasi,
        kabupaten: r.kabupaten,
        seKabupaten: r.seKabupaten,
      })),
    }));

  // Saringan pembuka mengikuti tahap yang sedang aktif — bukan tebakan yang
  // sering membuka ke daftar kosong.
  const saringAwal =
    aktif === "petakan" ? "kerjakan" : aktif === "setujui" ? "menunggu" : "kerjakan";

  const pctBreakdown =
    rapl.nilaiRab > 0n
      ? (Number(rapl.dipakai.nilai) / Number(rapl.nilaiRab)) * 100
      : 0;

  const pctHarga =
    harga && harga.baris.length > 0 ? (harga.berharga / harga.baris.length) * 100 : 0;
  const p = harga?.perbandingan ?? null;
  const ringkasanBiaya =
    harga && p ? (
      <RingkasBiaya
        totalBiaya={harga.totalBiaya.toString()}
        berharga={harga.berharga}
        belumBerharga={harga.belumBerharga}
        perKategori={harga.perKategori.map((k) => ({
          kategori: k.kategori,
          biaya: k.biaya.toString(),
          berharga: k.berharga,
          total: k.total,
        }))}
        perbandingan={{
          cakupanNilai: p.keandalan.cakupanNilai,
          cakupanHarga: p.keandalan.cakupanHarga,
          utuh: p.keandalan.utuh,
        }}
        tampilkanMargin={canSeeMargin}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {itemKontrak > 0 ? (
        <Banner
          tone="info"
          title={`${itemKontrak} item memakai analisa dari berkas kontrak`}
          description={
            cakupan.item > 0
              ? `Koefisiennya diambil dari sheet ANALISA berkas RAB. Padanan AHSP hanya dipakai untuk ${cakupan.item} item lain yang tidak punya analisa di berkas.`
              : "Koefisiennya diambil dari sheet ANALISA berkas RAB. Semua item sudah punya analisa, jadi tidak ada yang perlu dicarikan padanan AHSP."
          }
        />
      ) : null}

      {!basis && cakupan.item > 0 ? (
        <Banner
          tone="warning"
          title="Basis analisa AHSP belum dimuat"
          description="Tanpa basis AHSP, item yang tidak punya analisa di berkas kontrak belum bisa diurai menjadi kebutuhan bahan dan upah. Muat dulu di halaman Sistem."
        />
      ) : basis?.belumSelesai ? (
        <Banner
          tone="error"
          title="Basis AHSP belum lengkap karena impornya terputus"
          description="Angka di halaman ini belum bisa dipercaya. Buka halaman Sistem, lalu ulangi impor basis AHSP."
        />
      ) : null}

      {!adaRab ? (
        <Banner
          tone="info"
          title="Belum ada revisi RAB aktif"
          description="RAPL dihitung dari RAB yang berlaku. Aktifkan dulu revisi RAB lokasi ini."
        />
      ) : null}

      {cakupan.putus > 0 ? (
        <Banner
          tone="warning"
          title={`${cakupan.putus} baris kehilangan padanannya saat basis AHSP diganti`}
          description="Ini bukan keputusan siapa pun. Analisa yang dulu dipilih sudah tidak ada di basis AHSP yang baru."
          /* Peringatan ini muncul di SETIAP kunjungan sampai seseorang
             menyambungnya, dan tombol penyambungnya ada di subtab lain. Menyuruh
             orang mencarinya sendiri membuat spanduknya jadi perabot: dibaca
             sekali, lalu dilewati selamanya. */
          action={
            bagian === "validasi" ? undefined : (
              <ButtonLink
                href={`/lokasi/${slug}/rapl?bagian=validasi`}
                variant="secondary"
                size="sm"
              >
                Sambungkan ulang
              </ButtonLink>
            )
          }
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Nilai RAB aktif"
          value={formatRupiah(rapl.nilaiRab)}
          sub="nilai proyek pra-PPN"
        />
        <KpiCard
          label="Breakdown kebutuhan"
          value={formatPct(pctBreakdown, 1)}
          sub={`${rapl.dipakai.baris} dari ${rapl.barisRab} baris RAB masuk hitungan`}
          tone={pctBreakdown >= 99.95 ? "success" : "warning"}
        />
        {harga && p ? (
          <>
            <KpiCard
              label="Harga terisi"
              value={formatPct(pctHarga, 1)}
              sub={`${harga.berharga} dari ${harga.baris.length} komponen`}
              tone={pctHarga >= 99.95 ? "success" : "warning"}
            />
            {canSeeMargin ? (
            <KpiCard
              label={p.keandalan.utuh ? "Potensi margin" : "Selisih sementara"}
              value={formatRupiah(p.margin)}
              sub={p.keandalan.utuh ? `${formatPct(p.marginPersen, 1)} dari nilai RAB` : "belum bisa dianggap keuntungan"}
              tone={p.keandalan.utuh ? (p.margin >= 0n ? "success" : "danger") : "warning"}
            />
            ) : null}
          </>
        ) : null}
      </div>

      <Card>
        <SubTabs
          active={bagian}
          label="Bagian RAPL"
          items={[
            { key: "ringkasan", label: "Ringkasan estimasi", labelPendek: "Ringkasan", href: `/lokasi/${slug}/rapl?bagian=ringkasan` },
            ...(canSeeMoney
              ? [
                  {
                    key: "rincian",
                    label: "Rincian per item",
                    labelPendek: "Per item",
                    href: `/lokasi/${slug}/rapl?bagian=rincian`,
                    badge: perItem?.jumlahRugi || undefined,
                  },
                  {
                    key: "kebutuhan",
                    label: "Kebutuhan & harga",
                    labelPendek: "Harga",
                    href: `/lokasi/${slug}/rapl?bagian=kebutuhan`,
                    badge: harga?.belumBerharga || undefined,
                  },
                ]
              : []),
            { key: "validasi", label: "Validasi breakdown", labelPendek: "Validasi", href: `/lokasi/${slug}/rapl?bagian=validasi`, badge: ((tahapan[0]?.sisa ?? 0) + (tahapan[1]?.sisa ?? 0)) || undefined },
          ]}
        />

        {bagian === "ringkasan" ? (
          <>
            <CardHeader
              title="Estimasi biaya pelaksanaan proyek"
              subtitle="RAB aktif diurai menjadi material, tenaga, alat, dan fasilitas. Dari harganya dihitung biaya dan potensi margin."
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {canSeeMargin ? (
                    <ButtonLink href={`/cetak/rapl/${slug}?dari=/lokasi/${slug}/rapl`} variant="secondary" size="sm">
                      <Printer aria-hidden className="size-3.5" />
                      Cetak A4
                    </ButtonLink>
                  ) : null}
                  {canExport && canSeeMargin ? (
                    <ButtonLink href={`/lokasi/${slug}/rapl/kebutuhan`} variant="secondary" size="sm" unduhan labelSibuk="Menyiapkan Excel…">
                      <Download aria-hidden className="size-3.5" />
                      Unduh Excel
                    </ButtonLink>
                  ) : null}
                </div>
              }
            />
            <CardBody className="space-y-4">
              {cakupan.item > 0 ? <Stepper tahapan={tahapView} /> : null}
              {ringkasanBiaya ?? (
                <Banner
                  tone="info"
                  title="Biaya dan margin tidak ditampilkan untuk peran Anda"
                  description="Halaman ini menampilkan rincian kebutuhan dari RAB. Harga satuan, biaya pelaksanaan, dan potensi margin hanya bisa dilihat oleh yang berwenang di bagian keuangan."
                />
              )}
              <div className="flex flex-wrap gap-2">
                {canSeeMoney ? (
                  <ButtonLink href={`/lokasi/${slug}/rapl?bagian=kebutuhan`}>
                    Buka kebutuhan & isi harga
                  </ButtonLink>
                ) : null}
                {(tahapan[0]?.sisa ?? 0) + (tahapan[1]?.sisa ?? 0) > 0 ? (
                  <ButtonLink href={`/lokasi/${slug}/rapl?bagian=validasi`} variant="secondary">
                    Lengkapi breakdown yang tertahan
                  </ButtonLink>
                ) : null}
              </div>
            </CardBody>
          </>
        ) : null}

        {bagian === "rincian" && perItem ? (
          <>
            <CardHeader
              title="Rincian pelaksanaan per item RAB"
              subtitle={`${itemRows.length} item · biaya dan margin dihitung per item, bukan hanya sebagai total lokasi.`}
            />
            <CardBody className="space-y-4">
              <Kenapa judul="Dari mana rincian tiap item?">
                Urutan dasar rincian tiap item: analisa di berkas kontrak, lalu padanan AHSP yang
                disetujui, lalu draf analisa AI yang Anda terima. Ketiganya disebut terpisah di kolom
                Cara hitung. Bila satuannya tidak sepadan, nyatakan faktor konversinya
                beserta alasannya. Bila pekerjaannya tidak punya analisa, rinci sendiri
                komponennya. Bila memang disubkan, nyatakan harga borongannya. Koefisien yang
                berasal dari AHSP terkunci, karena itu angka resmi yang harus bisa
                dipertanggungjawabkan saat diperiksa.
              </Kenapa>
              {analisaAi ? (
                <AnalisaAiPanel
                  locationId={location.id}
                  slug={slug}
                  canInput={canInput}
                  canUseAi={canUseAi}
                  tampilkanMargin={canSeeMargin}
                  k={{
                    menunggu: analisaAi.menunggu,
                    terputus: analisaAi.terputus,
                    pendingSinceMs: analisaAi.pendingSinceMs,
                    model: analisaAi.model,
                    error: analisaAi.error,
                    jumlahTanpa: analisaAi.jumlahTanpa,
                    nilaiTanpa: analisaAi.nilaiTanpa.toString(),
                    draf: analisaAi.draf.map((d) => ({
                      ...d,
                      nilaiRab: d.nilaiRab.toString(),
                      biaya: d.biaya.toString(),
                      margin: d.margin === null ? null : d.margin.toString(),
                      komponen: d.komponen.map((c) => ({
                        ...c,
                        harga: c.harga === null ? null : c.harga.toString(),
                        biaya: c.biaya === null ? null : c.biaya.toString(),
                      })),
                    })),
                    diterima: analisaAi.diterima.map((d) => ({
                      id: d.id,
                      code: d.code,
                      uraian: d.uraian,
                      komponen: d.komponen,
                      pada: formatTanggal(d.pada, "d MMM yyyy HH.mm"),
                      oleh: d.oleh,
                    })),
                  }}
                />
              ) : null}
              <RincianPanel
                locationId={location.id}
                slug={slug}
                items={itemRows}
                canInput={canInput}
                canUseAi={canUseAi}
                tampilkanMargin={canSeeMargin}
                ringkas={{
                  biayaLengkap: perItem.biayaLengkap.toString(),
                  nilaiRabLengkap: perItem.nilaiRabLengkap.toString(),
                  jumlahLengkap: perItem.jumlahLengkap,
                  jumlahRugi: perItem.jumlahRugi,
                }}
              />
            </CardBody>
          </>
        ) : null}

        {bagian === "kebutuhan" && harga ? (
          <>
            <CardHeader
              title="Kebutuhan proyek & harga satuan"
              subtitle={`${harga.baris.length} komponen dari RAB aktif · isi harga sendiri, atau minta draf perkiraan AI untuk harga yang masih kosong.`}
              action={
                // Unduhannya memuat kolom margin – ikut `rapl.view`, bukan hanya export.
                canExport && canSeeMargin ? (
                  <ButtonLink href={`/lokasi/${slug}/rapl/kebutuhan`} variant="secondary" size="sm" unduhan labelSibuk="Menyiapkan Excel…">
                    <Download aria-hidden className="size-3.5" />
                    Unduh Excel
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody className="space-y-4">
              {ringkasanBiaya}
              <Kenapa judul="Bagaimana harga manual, AI, dan rekomendasi dipakai?">
                Harga yang Anda isi langsung tersimpan sebagai HSD lokasi. AI hanya membuat draf untuk
                komponen yang kosong. Drafnya tersimpan di server, jadi tidak hilang saat Anda pindah
                tab, dan baru masuk hitungan setelah Anda mencentangnya lalu menekan Pakai. Harga dari
                lokasi lain juga hanya referensi. Semua sumber harga terlihat di tabel.
              </Kenapa>
              <HargaPanel
                locationId={location.id}
                slug={slug}
                canInput={canInput}
                canUseAi={canUseAi}
                rows={barisHarga}
                usulan={{
                  menunggu: usulan?.menunggu ?? false,
                  terputus: usulan?.terputus ?? false,
                  pendingSinceMs: usulan?.pendingSinceMs ?? null,
                  model: usulan?.model ?? null,
                  error: usulan?.error ?? null,
                  diminta: usulan?.diminta ?? 0,
                  totalKosong: usulan?.totalKosong ?? 0,
                  // BigInt tidak boleh menyeberang ke komponen klien.
                  draf: (usulan?.draf ?? []).map((d) => ({
                    ...d,
                    harga: d.harga.toString(),
                  })),
                }}
              />
            </CardBody>
          </>
        ) : null}

        {bagian === "validasi" ? (
          <>
            <CardHeader
              title="Validasi breakdown RAB ke AHSP"
              subtitle={`${rows.length} uraian RAB · tempat memeriksa bahwa rincian kebutuhan bisa dipertanggungjawabkan.`}
            />
            <CardBody className="space-y-4">
              {cakupan.item > 0 ? <Stepper tahapan={tahapView} /> : null}
              <Kenapa judul="Kenapa ada pekerjaan yang belum masuk breakdown?">
                Kebutuhan hanya diturunkan dari padanan AHSP yang sudah disetujui, punya koefisien,
                satuannya sepadan, dan volumenya tersedia. Data yang masih kosong tetap ditampilkan
                supaya perkiraan biaya tidak terlihat lengkap padahal belum.
              </Kenapa>
              <PadananPanel
                locationId={location.id}
                slug={slug}
                rows={rows}
                canManage={canManage}
                basisAda={basis !== null && !basis.belumSelesai}
                saringAwal={saringAwal}
              />
              <SimulasiKebutuhan
                kebutuhan={rapl.kebutuhan.map((k) => ({ kategori: k.kategori, nama: k.nama, satuan: k.satuan, jumlah: k.jumlah, dariBaris: k.dariBaris, janggal: k.janggal }))}
                dilewat={rapl.dilewat.map((d) => ({ code: d.code, uraian: d.uraian, amount: d.amount.toString(), alasan: d.alasan, rinci: d.rinci }))}
                nilaiDipakai={rapl.dipakai.nilai.toString()}
                barisDipakai={rapl.dipakai.baris}
                nilaiRab={rapl.nilaiRab.toString()}
                barisRab={rapl.barisRab}
              />
            </CardBody>
          </>
        ) : null}
      </Card>
    </div>
  );
}
