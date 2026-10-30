import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileSignature } from "lucide-react";
import { Banner, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatRupiah, formatTanggal, jakartaDateKey } from "@/lib/format";
import {
  JENIS_SURAT_TERSEDIA,
  KEPADA_BAWAAN,
  LABEL_JENIS_SURAT,
  lampiranBawaan,
} from "@/lib/surat-penyedia/aturan";
import { muatTerminSurat } from "@/lib/surat-penyedia/data";
import { AMBANG_TERMIN_PCT } from "@/lib/kesiapan/rules";
import { BarisSurat, BuatSuratForm, DataSuratForm, JadwalTerminForm, type BarisTermin } from "./termin-forms";

export const metadata: Metadata = { title: "Termin & Surat" };
export const dynamic = "force-dynamic";

/**
 * TERMIN & SURAT PENYEDIA (DECISIONS 716): jadwal termin menurut SSKK, data
 * surat (rekening, pola nomor), dan surat berkop penyedia untuk pengajuan
 * termin – permohonan pembayaran, invoice, kwitansi – sebagai PDF dan Word.
 */
export default async function TerminPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;
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
    const ke = i + 1;
    const t = tersimpan.get(ke);
    return {
      terminKe: ke,
      // Jadwal kosong diusulkan dari ambang kesiapan (25/50/80/100); persen bayarnya tetap diisi orang.
      ambangPct: t?.ambangPct ?? (d.termin.length === 0 ? (AMBANG_TERMIN_PCT[i] ?? null) : null),
      bayarPct: t?.bayarPct ?? null,
      nilai: t ? formatRupiah(t.nilai) : null,
    };
  });

  const kurang: string[] = [];
  if (!k.contractorSignerName?.trim()) kurang.push("nama penanda tangan penyedia (Kontrak & Adendum › Penanda tangan)");
  if (!v.npwp?.trim()) kurang.push("NPWP perusahaan (Master › Perusahaan)");
  if (!(k.bankNama && k.bankRekening && k.bankAtasNama)) kurang.push("rekening bank (Data surat di bawah)");
  if (d.termin.length === 0) kurang.push("jadwal termin (di bawah)");
  const adaPotongan = Number(k.advancePercent ?? 0) > 0 || Number(k.retentionPercent ?? 0) > 0;

  const lampiran: Record<string, string[]> = {};
  for (const j of JENIS_SURAT_TERSEDIA) for (const t of d.termin) lampiran[`${j}:${t.terminKe}`] = lampiranBawaan(j, t.terminKe);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Termin & surat penyedia"
          subtitle={`Surat berkop ${v.name} untuk pengajuan termin: permohonan pembayaran, invoice, dan kwitansi, dalam PDF dan Word. Nilai kontrak berjalan ${formatRupiah(d.nilaiKontrak)}.`}
        />
        <CardBody className="space-y-2">
          {kurang.length > 0 ? (
            <Banner tone="warning" title="Belum lengkap untuk menyusun surat" description={`Lengkapi: ${kurang.join("; ")}.`} />
          ) : null}
          {adaPotongan ? (
            <Banner
              tone="info"
              title="Kontrak ini mencatat uang muka atau retensi"
              description="Potongan uang muka dan retensi belum dihitung di surat. Nilai di surat = persen bayar × nilai kontrak. Periksa nilainya sebelum dikirim."
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

      <Card>
        <CardHeader title="Jadwal termin" subtitle="Menurut Syarat-Syarat Khusus Kontrak (SSKK)." />
        <CardBody>
          {boleh ? (
            <JadwalTerminForm contractId={k.id} baris={baris} />
          ) : (
            <p className="text-sm text-ink-muted">Hanya yang mengelola kontrak yang bisa mengubah jadwal termin.</p>
          )}
        </CardBody>
      </Card>

      {boleh ? (
        <Card>
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
        <CardHeader title="Surat" subtitle="Angka uang selalu dihitung ulang dari kontrak dan jadwal termin saat diunduh." />
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
          {boleh && d.termin.length > 0 ? (
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
              />
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
