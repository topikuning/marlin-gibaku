import type { Metadata } from "next";
import { Download, Printer } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
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
export default async function RaplPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const canManage = can(user.role, "rab.manage");
  const canExport = can(user.role, "report.export");

  const canInput = can(user.role, "finance.input");

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

  const pctNilai =
    cakupan.nilaiTotal > 0n
      ? (Number(cakupan.nilaiDisetujui) / Number(cakupan.nilaiTotal)) * 100
      : 0;

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
          title="Basis AHSP belum lengkap — impornya terputus"
          description="Angka di halaman ini belum bisa dipercaya. Buka halaman Sistem dan ulangi impor basis AHSP lebih dulu."
        />
      ) : null}

      {cakupan.item === 0 ? (
        <Banner
          tone="info"
          title="Belum ada revisi RAB aktif"
          description="RAPL bekerja dari RAB yang berlaku. Aktifkan revisi RAB lokasi ini lebih dulu."
        />
      ) : (
        <Stepper tahapan={tahapView} />
      )}

      {cakupan.putus > 0 ? (
        <Banner
          tone="warning"
          title={`${cakupan.putus} baris kehilangan padanannya saat basis AHSP diganti`}
          description="Ini bukan keputusan siapa pun — analisa yang dulu dipilih tidak ada lagi di terbitan sekarang. Tekan “Petakan otomatis” untuk menyambungnya kembali."
        />
      ) : null}

      <Card>
        <CardHeader
          title="1–2 · Petakan & setujui"
          subtitle={`${rows.length} uraian · satu keputusan berlaku untuk semua baris RAB yang uraiannya sama, di lokasi mana pun.`}
        />
        <CardBody>
          <Kenapa judul="Kenapa harus disetujui dulu?">
            Mesin mencocokkan uraian RAB dengan analisa AHSP, tapi tiga dari empat padanan otomatis
            berstatus &ldquo;beda tipis&rdquo; — unggul cuma sedikit dari kandidat kedua. Karena
            itu usulan mesin TIDAK pernah dipakai menghitung kebutuhan sebelum ada yang
            menyetujuinya. Skor tetap ditampilkan setelah disetujui supaya jejaknya tidak hilang.
          </Kenapa>
          <div className="mt-3">
            <PadananPanel
              locationId={location.id}
              slug={slug}
              rows={rows}
              canManage={canManage}
              basisAda={basis !== null && !basis.belumSelesai}
              saringAwal={saringAwal}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="3 · Kebutuhan sumber daya"
          subtitle={`Dari padanan yang sudah disetujui — menutup ${formatPct(pctNilai, 1)} nilai RAB (${formatRupiah(cakupan.nilaiDisetujui)}).`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href={`/cetak/rapl/${slug}?dari=/lokasi/${slug}/rapl`} variant="secondary" size="sm">
                <Printer aria-hidden className="size-3.5" />
                Cetak A4
              </ButtonLink>
              {canExport ? (
                <ButtonLink href={`/lokasi/${slug}/rapl/kebutuhan`} variant="secondary" size="sm" unduhan>
                  <Download aria-hidden className="size-3.5" />
                  Unduh Excel
                </ButtonLink>
              ) : null}
            </div>
          }
        />
        <CardBody>
          <Kenapa judul="Kenapa angkanya belum mencakup seluruh proyek?">
            Kebutuhan dihitung Σ (koefisien analisa × volume item). Satu baris RAB hanya ikut kalau
            padanannya sudah disetujui, analisanya punya koefisien terstruktur, satuannya sepadan
            dengan satuan analisa, dan volumenya ada. Yang tidak memenuhi dikeluarkan dan
            dilaporkan lengkap dengan nilai rupiahnya — bukan disembunyikan.
          </Kenapa>
          <div className="mt-3">
            <SimulasiKebutuhan
              kebutuhan={rapl.kebutuhan}
              dilewat={rapl.dilewat.map((d) => ({
                code: d.code,
                uraian: d.uraian,
                amount: d.amount.toString(),
                alasan: d.alasan,
                rinci: d.rinci,
              }))}
              nilaiDipakai={rapl.dipakai.nilai.toString()}
              barisDipakai={rapl.dipakai.baris}
              nilaiRab={rapl.nilaiRab.toString()}
              barisRab={rapl.barisRab}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="4 · Harga satuan dasar & biaya"
          subtitle={`${harga.berharga} dari ${harga.baris.length} sumber daya sudah berharga · biaya RAPL ${formatRupiah(harga.totalBiaya)}.`}
        />
        <CardBody>
          <Kenapa judul="Kenapa harganya per lokasi, dan kenapa selisihnya belum boleh disebut untung?">
            Harga pasir di Demak dan di Sumenep memang berbeda — itu justru yang membuat RAPL
            berguna. Harga dari lokasi lain hanya ditawarkan sebagai bahan pertimbangan, tidak
            pernah dipakai sendiri. Dan selisih terhadap nilai kontrak baru berarti apa adanya
            kalau DUA cakupan penuh: seluruh nilai RAB masuk hitungan kebutuhan, dan seluruh sumber
            daya sudah berharga. Selama belum, biaya yang belum masuk akan mengecilkan selisihnya.
          </Kenapa>

          <div className="mt-3 space-y-4">
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
              perbandingan={
                harga.perbandingan
                  ? {
                      nilaiKontrak: harga.perbandingan.nilaiKontrak.toString(),
                      selisih: harga.perbandingan.selisih.toString(),
                      selisihPersen: harga.perbandingan.selisihPersen,
                      cakupanNilai: harga.perbandingan.keandalan.cakupanNilai,
                      cakupanHarga: harga.perbandingan.keandalan.cakupanHarga,
                      utuh: harga.perbandingan.keandalan.utuh,
                    }
                  : null
              }
            />
            <HargaPanel
              locationId={location.id}
              slug={slug}
              canInput={canInput}
              rows={barisHarga}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
