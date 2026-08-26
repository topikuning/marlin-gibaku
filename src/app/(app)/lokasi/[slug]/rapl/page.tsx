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
import { simulasiRapl } from "@/lib/ahsp/rapl";
import { keadaanHarga } from "@/lib/ahsp/hsd";
import { requireLocationPage } from "../get-location";
import { PadananPanel, type BarisUraianRow } from "./padanan-panel";
import { SimulasiKebutuhan } from "./simulasi-kebutuhan";
import { Stepper, type TahapView } from "./stepper";
import { HargaPanel, RingkasBiaya, type BarisHargaRow } from "./harga-panel";
import { Kenapa } from "./kenapa";

export const metadata: Metadata = { title: "RAPL" };
export const dynamic = "force-dynamic";

/**
 * RAPL — Rencana Anggaran Pelaksanaan Lapangan (DECISIONS 319–326).
 *
 * Halaman ini disusun sebagai TAHAPAN, bukan tumpukan tabel: Petakan → Setujui
 * → Kebutuhan → Harga. Susunan lamanya menumpuk empat tabel sekaligus dan orang
 * harus menebak sendiri mulai dari mana; keluhan user 2026-08-16 ("tidak ui/ux
 * friendly") sah, dan cacat terbesarnya bukan selera: daftarnya menyodorkan
 * 1.616 baris RAB untuk 480 keputusan.
 *
 * Penjelasan panjang yang dulu ditempel di mana-mana sekarang dilipat di balik
 * "Kenapa begini?" — tetap ada karena angkanya memang perlu dijelaskan, tapi
 * tidak lagi menutupi pekerjaannya.
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
  const bagian = ["ringkasan", "kebutuhan", "validasi"].includes(query.bagian ?? "")
    ? (query.bagian as "ringkasan" | "kebutuhan" | "validasi")
    : "ringkasan";
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const canManage = can(user.role, "rab.manage");
  const canExport = can(user.role, "report.export");

  const canInput = can(user.role, "finance.input");
  const canUseAi = can(user.role, "ai.generate");

  const [basis, { baris, cakupan }, rapl, harga] = await Promise.all([
    ringkasAhsp(),
    keadaanPadanan(location.id),
    simulasiRapl(location.id),
    keadaanHarga(location.id),
  ]);

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
   * Urutan pengisian harga: yang BELUM berharga lebih dulu, lalu dari kebutuhan
   * terbesar. Mengisi 20 baris teratas biasanya sudah menutup sebagian besar
   * nilai; daftar tanpa urutan membuat orang berhenti di baris kesepuluh.
   */
  const barisHarga: BarisHargaRow[] = [...harga.baris]
    .sort(
      (a, b) =>
        Number(a.harga !== null) - Number(b.harga !== null) || b.jumlah - a.jumlah,
    )
    .map((h) => ({
      kategori: h.kategori,
      nama: h.nama,
      satuan: h.satuan,
      jumlah: h.jumlah,
      harga: h.harga === null ? null : h.harga.toString(),
      biaya: h.biaya === null ? null : h.biaya.toString(),
      sumber: h.sumber,
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

  const pctHarga = harga.baris.length > 0 ? (harga.berharga / harga.baris.length) * 100 : 0;
  const p = harga.perbandingan;
  const ringkasanBiaya = (
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
    />
  );

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
        <KpiCard label="Nilai RAB aktif" value={formatRupiah(p.nilaiProyek)} sub="nilai proyek pra-PPN" />
        <KpiCard
          label="Breakdown kebutuhan"
          value={formatPct(pctBreakdown, 1)}
          sub={`${rapl.dipakai.baris} dari ${rapl.barisRab} baris RAB masuk hitungan`}
          tone={pctBreakdown >= 99.95 ? "success" : "warning"}
        />
        <KpiCard
          label="Harga terisi"
          value={formatPct(pctHarga, 1)}
          sub={`${harga.berharga} dari ${harga.baris.length} komponen`}
          tone={pctHarga >= 99.95 ? "success" : "warning"}
        />
        <KpiCard
          label={p.keandalan.utuh ? "Potensi margin" : "Selisih sementara"}
          value={formatRupiah(p.margin)}
          sub={p.keandalan.utuh ? `${formatPct(p.marginPersen, 1)} dari nilai RAB` : "belum boleh dibaca sebagai profit"}
          tone={p.keandalan.utuh ? (p.margin >= 0n ? "success" : "danger") : "warning"}
        />
      </div>

      <Card>
        <SubTabs
          active={bagian}
          label="Bagian RAPL"
          items={[
            { key: "ringkasan", label: "Ringkasan estimasi", labelPendek: "Ringkasan", href: `/lokasi/${slug}/rapl?bagian=ringkasan` },
            { key: "kebutuhan", label: "Kebutuhan & harga", labelPendek: "Harga", href: `/lokasi/${slug}/rapl?bagian=kebutuhan`, badge: harga.belumBerharga || undefined },
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
                  <ButtonLink href={`/cetak/rapl/${slug}?dari=/lokasi/${slug}/rapl`} variant="secondary" size="sm">
                    <Printer aria-hidden className="size-3.5" />
                    Cetak A4
                  </ButtonLink>
                  {canExport ? (
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
              {ringkasanBiaya}
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/lokasi/${slug}/rapl?bagian=kebutuhan`}>
                  Buka kebutuhan & isi harga
                </ButtonLink>
                {(tahapan[0]?.sisa ?? 0) + (tahapan[1]?.sisa ?? 0) > 0 ? (
                  <ButtonLink href={`/lokasi/${slug}/rapl?bagian=validasi`} variant="secondary">
                    Lengkapi breakdown yang tertahan
                  </ButtonLink>
                ) : null}
              </div>
            </CardBody>
          </>
        ) : null}

        {bagian === "kebutuhan" ? (
          <>
            <CardHeader
              title="Kebutuhan proyek & harga satuan"
              subtitle={`${harga.baris.length} komponen dari RAB aktif · input manual atau minta draf estimasi AI untuk harga yang masih kosong.`}
              action={
                canExport ? (
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
                komponen yang kosong dan tidak masuk kalkulasi sebelum kamu menekan tombol persetujuan.
                Harga lokasi lain juga hanya referensi. Semua sumber harga terlihat di grid.
              </Kenapa>
              <HargaPanel
                locationId={location.id}
                slug={slug}
                canInput={canInput}
                canUseAi={canUseAi}
                rows={barisHarga}
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
