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
import { formatPct, formatRupiah } from "@/lib/format";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { keadaanPadanan } from "@/lib/ahsp/padanan";
import { hitungTahap, kelompokkanPerUraian } from "@/lib/ahsp/kelompok";
import { keadaanItemRapl, simulasiRapl } from "@/lib/ahsp/rapl";
import { keadaanHarga } from "@/lib/ahsp/hsd";
import { keadaanUsulanAi } from "@/lib/ahsp/hsd-usulan";
import { requireLocationPage } from "../get-location";
import { PadananPanel, type BarisUraianRow } from "./padanan-panel";
import { SimulasiKebutuhan } from "./simulasi-kebutuhan";
import { Stepper, type TahapView } from "./stepper";
import { HargaPanel, RingkasBiaya, type BarisHargaRow } from "./harga-panel";
import { RincianPanel, type ItemRaplRow } from "./rincian-panel";
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

  const [basis, { baris, cakupan }, rapl, harga, usulan, perItem] = await Promise.all([
    ringkasAhsp(),
    keadaanPadanan(location.id),
    simulasiRapl(location.id),
    canSeeMoney ? keadaanHarga(location.id) : Promise.resolve(null),
    canSeeMoney && canInput ? keadaanUsulanAi(location.id) : Promise.resolve(null),
    canSeeMoney ? keadaanItemRapl(location.id) : Promise.resolve(null),
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
      komponen: i.komponen.map((k) => ({
        kategori: k.kategori,
        nama: k.nama,
        satuan: k.satuan,
        jumlah: k.jumlah,
        dariAhsp: k.dariAhsp,
        harga: k.harga === null ? null : k.harga.toString(),
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
          nilaiProyek: p.nilaiProyek.toString(),
          margin: p.margin.toString(),
          marginPersen: p.marginPersen,
          cakupanNilai: p.keandalan.cakupanNilai,
          cakupanHarga: p.keandalan.cakupanHarga,
          utuh: p.keandalan.utuh,
        }}
        tampilkanMargin={canSeeMargin}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {!basis ? (
        <Banner
          tone="warning"
          title="Basis analisa AHSP belum dimuat"
          description="Tanpa basis AHSP, RAB tidak bisa diturunkan jadi kebutuhan bahan/upah. Muat dulu di halaman Sistem."
        />
      ) : basis.belumSelesai ? (
        <Banner
          tone="error"
          title="Basis AHSP belum lengkap – impornya terputus"
          description="Angka di halaman ini belum bisa dipercaya. Buka halaman Sistem dan ulangi impor basis AHSP lebih dulu."
        />
      ) : null}

      {cakupan.item === 0 ? (
        <Banner
          tone="info"
          title="Belum ada revisi RAB aktif"
          description="RAPL bekerja dari RAB yang berlaku. Aktifkan revisi RAB lokasi ini lebih dulu."
        />
      ) : null}

      {cakupan.putus > 0 ? (
        <Banner
          tone="warning"
          title={`${cakupan.putus} baris kehilangan padanannya saat basis AHSP diganti`}
          description="Ini bukan keputusan siapa pun – analisa yang dulu dipilih tidak ada lagi di terbitan sekarang. Tekan “Petakan otomatis” untuk menyambungnya kembali."
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
              sub={p.keandalan.utuh ? `${formatPct(p.marginPersen, 1)} dari nilai RAB` : "belum boleh dibaca sebagai profit"}
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
              subtitle="RAB aktif diurai menjadi material, tenaga, alat, dan fasilitas; harga melahirkan biaya serta potensi margin."
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
                  title="Biaya dan margin tidak ditampilkan untuk peranmu"
                  description="Halaman ini memperlihatkan breakdown kebutuhan RAB. Harga satuan, biaya pelaksanaan, dan potensi margin hanya untuk pengguna berhak akses keuangan."
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
              <Kenapa judul="AHSP pembantu, bukan gerbang">
                Analisa AHSP mengisi rincian tiap item, tetapi tidak lagi menentukan item mana yang
                boleh masuk hitungan. Bila satuannya tidak sepadan, nyatakan faktor konversinya
                beserta alasannya. Bila pekerjaannya tidak punya analisa, rinci sendiri
                komponennya. Bila memang disubkan, nyatakan harga borongannya. Koefisien yang
                berasal dari AHSP sendiri terkunci – ia angka resmi yang harus bisa dipertahankan
                saat diperiksa.
              </Kenapa>
              <RincianPanel
                locationId={location.id}
                slug={slug}
                items={itemRows}
                canInput={canInput}
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
              subtitle={`${harga.baris.length} komponen dari RAB aktif · input manual atau minta draf estimasi AI untuk harga yang masih kosong.`}
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
                Harga manual langsung tersimpan sebagai HSD lokasi. AI hanya membuat draf untuk
                komponen yang kosong; drafnya tersimpan di server – tidak hilang saat kamu
                berpindah tab – dan tidak masuk kalkulasi sebelum kamu mencentangnya lalu menekan
                Pakai. Harga lokasi lain juga hanya referensi. Semua sumber harga terlihat di grid.
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
              subtitle={`${rows.length} uraian RAB · ruang teknis untuk memastikan breakdown kebutuhan dapat dipertanggungjawabkan.`}
            />
            <CardBody className="space-y-4">
              {cakupan.item > 0 ? <Stepper tahapan={tahapView} /> : null}
              <Kenapa judul="Kenapa ada pekerjaan yang belum masuk breakdown?">
                Kebutuhan hanya diturunkan dari padanan AHSP yang sudah disetujui, punya koefisien,
                satuannya sepadan, dan volumenya tersedia. Lubang data tetap ditampilkan agar estimasi
                biaya tidak terlihat lengkap padahal belum.
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
