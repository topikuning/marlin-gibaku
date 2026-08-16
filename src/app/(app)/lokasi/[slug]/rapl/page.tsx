import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatPct, formatRupiah } from "@/lib/format";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { keadaanPadanan } from "@/lib/ahsp/padanan";
import { hitungTahap, kelompokkanPerUraian } from "@/lib/ahsp/kelompok";
import { simulasiRapl } from "@/lib/ahsp/rapl";
import { requireLocationPage } from "../get-location";
import { PadananPanel, type BarisUraianRow } from "./padanan-panel";
import { SimulasiKebutuhan } from "./simulasi-kebutuhan";
import { Stepper, type TahapView } from "./stepper";
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

  const [basis, { baris, cakupan }, rapl] = await Promise.all([
    ringkasAhsp(),
    keadaanPadanan(location.id),
    simulasiRapl(location.id),
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
            canExport ? (
              <ButtonLink href={`/lokasi/${slug}/rapl/kebutuhan`} variant="secondary" size="sm" unduhan>
                <Download aria-hidden className="size-3.5" />
                Unduh Excel
              </ButtonLink>
            ) : null
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
          title="4 · Harga"
          subtitle="Belum dikerjakan — harga satuan dasar per lokasi dan perbandingan biaya RAPL vs nilai kontrak."
        />
        <CardBody>
          <p className="text-[13px] text-ink-muted">
            Angka di tahap 3 masih VOLUME kebutuhan, belum biaya. Setelah harga satuan dasar per
            lokasi bisa diisi, tahap ini akan membandingkan total biaya pelaksanaan dengan nilai
            kontrak — dan perbandingan itu akan selalu ditampilkan bersama angka cakupannya, tidak
            pernah sebagai total yang seolah lengkap.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
