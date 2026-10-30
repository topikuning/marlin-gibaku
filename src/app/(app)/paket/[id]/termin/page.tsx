import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileSignature } from "lucide-react";
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatPct, formatRupiah, formatTanggal, formatTanggalWaktu, jakartaDateKey } from "@/lib/format";
import {
  CARA_RAPAT_BAWAAN,
  JENIS_SURAT_TERSEDIA,
  KEPADA_BAWAAN,
  LABEL_JENIS_SURAT,
  PIMPINAN_RAPAT_BAWAAN,
  TEMPAT_LENGKAPI,
  lampiranBawaan,
  persenSurat,
  pesertaRapatBawaan,
  tautanLengkapi,
  type TujuanLengkapi,
} from "@/lib/surat-penyedia/aturan";
import { muatTerminSurat } from "@/lib/surat-penyedia/data";
import {
  BarisSurat,
  BuatSuratForm,
  DaftarKekurangan,
  DataSuratForm,
  JadwalTerminForm,
  ProgresKonsultanForm,
  type BarisTermin,
  type ProgresTerminKlien,
} from "./termin-forms";

export const metadata: Metadata = { title: "Termin & Surat" };
export const dynamic = "force-dynamic";

/**
 * TERMIN & SURAT PENYEDIA (DECISIONS 716/717): jadwal termin (bawaan KKP atau
 * milik kontrak), progres dari laporan konsultan, data surat, dan surat berkop
 * penyedia untuk pengajuan termin – permohonan pemeriksaan, BA pembahasan
 * kemajuan, permohonan pembayaran, invoice, kwitansi – sebagai PDF dan Word.
 */
export default async function TerminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ termin?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;
  const terminDiminta = Number((await searchParams).termin) || undefined;
  const boleh = can(user.role, "contract.manage");

  const d = await muatTerminSurat(id, user);
  if (d === null) {
    return (
      <EmptyState
        icon={FileSignature}
        title="Belum ada kontrak"
        description="Jadwal termin dan surat penyedia baru bisa disusun setelah paket ini punya kontrak."
      />
    );
  }
  if (!d.kontrak) notFound();
  const k = d.kontrak;
  const v = k.vendor;

  const tersimpan = new Map(d.termin.map((t) => [t.terminKe, t]));
  const jumlahBaris = Math.min(6, Math.max(4, d.termin.length + 1));
  const baris: BarisTermin[] = Array.from({ length: jumlahBaris }, (_, i) => {
    const t = tersimpan.get(i + 1);
    return {
      terminKe: i + 1,
      ambangPct: t?.ambangPct ?? null,
      bayarPct: t?.bayarPct ?? null,
      retensiPct: t?.retensiPct ?? null,
      nilai: t
        ? t.retensi > 0n
          ? `${formatRupiah(t.dibayar)} (${formatRupiah(t.bruto)} − retensi ${formatRupiah(t.retensi)})`
          : formatRupiah(t.dibayar)
        : null,
    };
  });

  const butirKurang: [string, TujuanLengkapi][] = [];
  if (!k.contractorSignerName?.trim()) butirKurang.push(["nama penanda tangan penyedia", "penanda_tangan"]);
  if (!v.npwp?.trim()) butirKurang.push(["NPWP perusahaan, untuk invoice dan kwitansi", "npwp"]);
  if (!(k.bankNama && k.bankRekening && k.bankAtasNama)) butirKurang.push(["rekening bank, untuk invoice dan kwitansi", "rekening"]);
  if (!d.konsultan.firma) butirKurang.push(["nama firma konsultan pengawas", "penanda_tangan"]);
  if (!d.konsultan.nama) butirKurang.push(["nama Koordinator Team Leader atau Team Leader konsultan, untuk BA", "penanda_tangan"]);
  const kurang = butirKurang.map(([teks, tujuan]) => ({
    teks,
    tempat: TEMPAT_LENGKAPI[tujuan],
    href: tautanLengkapi(tujuan, { packageId: id, vendorId: v.id }),
  }));

  const lampiran: Record<string, string[]> = {};
  for (const j of JENIS_SURAT_TERSEDIA) for (const t of d.termin) lampiran[`${j}:${t.terminKe}`] = lampiranBawaan(j, t.terminKe);

  const progres: ProgresTerminKlien[] = d.progres.map((p) => ({
    terminKe: p.terminKe,
    ambangPct: p.ambangPct,
    ambangTeks: persenSurat(p.ambangPct),
    progresPct: p.tersimpan?.progresPct ?? null,
    mingguKe: p.tersimpan?.mingguKe ?? null,
    diubah: p.tersimpan ? formatTanggalWaktu(p.tersimpan.diubah) : null,
    tertimbangTeks: p.tertimbangKonsultan === null ? null : formatPct(p.tertimbangKonsultan),
    lokasi: p.lokasi.map((l) => ({
      locationId: l.locationId,
      nama: l.nama,
      nomor: l.nomor,
      tanggal: l.tanggal,
      mingguKe: l.mingguKe,
      persen: l.persen,
      marlinTeks:
        l.marlinPct === null
          ? "belum ada data"
          : `${formatPct(l.marlinPct)}${l.marlinMinggu ? ` · minggu ke-${l.marlinMinggu}` : ""}${l.tanggal ? ` · s.d. ${formatTanggal(new Date(`${l.tanggal}T00:00:00Z`))}` : " · hari ini"}`,
    })),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Termin & surat penyedia"
          subtitle={`Surat berkop ${v.name} untuk pengajuan termin, dari permohonan pemeriksaan sampai kwitansi, dalam PDF dan Word. Nilai kontrak berjalan ${formatRupiah(d.nilaiKontrak)}.`}
        />
        <CardBody className="space-y-2">
          {kurang.length > 0 ? (
            <Banner tone="warning" title="Belum lengkap untuk semua surat" description={<DaftarKekurangan kurang={kurang} />} />
          ) : null}
          {Number(k.advancePercent ?? 0) > 0 ? (
            <Banner
              tone="info"
              title="Kontrak ini mencatat uang muka"
              description="Potongan pengembalian uang muka belum dihitung di surat. Periksa nilainya sebelum dikirim."
            />
          ) : null}
          {!v.kopKey ? (
            <p className="text-[13px] text-ink-muted">
              Kop surat disusun dari nama, alamat, dan logo perusahaan. Unggah gambar kop jadi di Master › Perusahaan bila
              ingin kop persis seperti kertas surat perusahaan.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card id="jadwal-termin" className="scroll-mt-20">
        <CardHeader
          title="Jadwal termin"
          subtitle="Menurut Syarat-Syarat Khusus Kontrak (SSKK)."
          action={d.jadwalBawaan ? <Badge tone="info">Jadwal bawaan KKP</Badge> : <Badge tone="neutral">Jadwal kontrak ini</Badge>}
        />
        <CardBody>
          {boleh ? (
            <JadwalTerminForm contractId={k.id} baris={baris} />
          ) : (
            <p className="text-sm text-ink-muted">Hanya yang mengelola kontrak yang bisa mengubah jadwal termin.</p>
          )}
        </CardBody>
      </Card>

      {boleh ? (
        <Card id="progres-konsultan" className="scroll-mt-20">
          <CardHeader
            title="Progres laporan konsultan"
            subtitle="Untuk surat permohonan pemeriksaan dan BA pembahasan kemajuan. Diisi per termin."
          />
          <CardBody>
            {progres.length > 0 && progres[0].lokasi.length > 0 ? (
              <ProgresKonsultanForm
                key={terminDiminta ?? "bawaan"}
                contractId={k.id}
                termin={progres}
                hariIni={jakartaDateKey(new Date())}
                terminAwal={terminDiminta}
              />
            ) : (
              <p className="text-sm text-ink-muted">Paket ini belum punya lokasi aktif.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {boleh ? (
        <Card id="data-surat" className="scroll-mt-20">
          <CardHeader title="Data surat" subtitle="Rekening penerima pembayaran, pola nomor surat, dan kota penulisan." />
          <CardBody>
            <DataSuratForm
              contractId={k.id}
              awal={{
                bankNama: k.bankNama ?? "",
                bankRekening: k.bankRekening ?? "",
                bankAtasNama: k.bankAtasNama ?? "",
                polaNomorSurat: v.polaNomorSurat ?? "",
                kotaSurat: v.kotaSurat ?? "",
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Surat" subtitle="Angka uang dan progres selalu diambil ulang dari kontrak, jadwal termin, dan progres konsultan saat diunduh." />
        <CardBody className="space-y-4">
          {d.surat.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada surat.</p>
          ) : (
            <ul className="space-y-2">
              {d.surat.map((s) => (
                <BarisSurat
                  key={s.id}
                  id={s.id}
                  judul={`${LABEL_JENIS_SURAT[s.jenis]} – Termin ${s.terminKe}`}
                  keterangan={`Nomor ${s.nomor} · ${s.kota}, ${formatTanggal(s.tanggal, "d MMMM yyyy")} · dibuat ${s.dibuatOleh.fullName}`}
                  bolehHapus={boleh}
                />
              ))}
            </ul>
          )}
          {boleh ? (
            <div className="border-t border-border pt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink">Buat surat</h3>
              <BuatSuratForm
                contractId={k.id}
                jenis={JENIS_SURAT_TERSEDIA.map((j) => ({ value: j, label: LABEL_JENIS_SURAT[j] }))}
                termin={d.termin.map((t) => t.terminKe)}
                lampiranBawaan={lampiran}
                kepadaBawaan={KEPADA_BAWAAN}
                kotaBawaan={v.kotaSurat ?? ""}
                usulanNomor={d.usulanNomor}
                hariIni={jakartaDateKey(new Date())}
                rapatBawaan={{
                  pimpinan: PIMPINAN_RAPAT_BAWAAN,
                  peserta: pesertaRapatBawaan(v.name, d.konsultan.firma),
                  cara: CARA_RAPAT_BAWAAN,
                }}
              />
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
