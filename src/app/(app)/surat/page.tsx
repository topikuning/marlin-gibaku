import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { Mail } from "lucide-react";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatTanggal, jakartaToday } from "@/lib/format";
import {
  ARAH_LABEL,
  KATEGORI_SURAT_LABEL,
  PIHAK_LABEL,
  STATUS_SURAT_LABEL,
  STATUS_SURAT_TONE,
  sisaHariJawab,
} from "@/lib/surat/lifecycle";
import { CatatSurat } from "./catat-surat";
import { BarisSurat } from "./baris-surat";

export const metadata: Metadata = { title: "Surat Masuk & Keluar" };
export const dynamic = "force-dynamic";

/**
 * Register surat masuk & keluar (DECISIONS 432), tahap 1–4.
 *
 * Bukan lemari arsip: yang ditonjolkan adalah surat yang MENUNTUT JAWABAN dan
 * berapa lama ia sudah menunggu. Arsip yang rapi tapi diam tidak menolong
 * siapa pun — itu sebabnya kolom tenggat berdiri di depan.
 */
export default async function SuratPage({
  searchParams,
}: {
  searchParams: Promise<{ arah?: string; status?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "letter.view");
  const sp = await searchParams;
  const bolehKelola = can(user.role, "letter.manage");
  const hariIni = jakartaToday();

  const arah = sp.arah === "masuk" || sp.arah === "keluar" ? sp.arah : null;
  const status =
    sp.status && ["baru", "perlu_jawaban", "dijawab", "selesai", "arsip"].includes(sp.status)
      ? (sp.status as "baru" | "perlu_jawaban" | "dijawab" | "selesai" | "arsip")
      : null;

  const izin = await accessibleLocationIds(user);
  // Surat yang belum menempel ke paket tetap terlihat — kalau disembunyikan,
  // surat yang baru dicatat seolah hilang.
  const scopeSurat = {
    orgId: user.orgId,
    ...(izin
      ? { OR: [{ packageId: null }, { package: { locations: { some: { id: { in: izin } } } } }] }
      : {}),
  };

  const [daftar, perluJawaban, masuk, keluar, paket, lokasi] = await Promise.all([
    db.letter.findMany({
      where: { ...scopeSurat, ...(arah ? { direction: arah } : {}), ...(status ? { status } : {}) },
      orderBy: [{ handledDate: "desc" }, { agendaNo: "desc" }],
      take: 100,
      select: {
        id: true,
        agendaNo: true,
        agendaYear: true,
        direction: true,
        party: true,
        partyName: true,
        letterNumber: true,
        letterDate: true,
        handledDate: true,
        subject: true,
        category: true,
        status: true,
        needsReply: true,
        replyDueDate: true,
        fileR2Key: true,
        fileName: true,
        package: { select: { name: true } },
        location: { select: { name: true, slug: true } },
        _count: { select: { issues: true, findings: true } },
      },
    }),
    db.letter.count({
      where: { ...scopeSurat, needsReply: true, status: { in: ["baru", "perlu_jawaban"] } },
    }),
    db.letter.count({ where: { ...scopeSurat, direction: "masuk" } }),
    db.letter.count({ where: { ...scopeSurat, direction: "keluar" } }),
    bolehKelola
      ? db.package.findMany({
          where: izin ? { locations: { some: { id: { in: izin } } } } : { orgId: user.orgId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
    bolehKelola
      ? db.location.findMany({
          where: izin ? { id: { in: izin } } : { package: { orgId: user.orgId } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  const telat = daftar.filter(
    (l) =>
      l.needsReply &&
      l.replyDueDate != null &&
      (l.status === "baru" || l.status === "perlu_jawaban") &&
      l.replyDueDate.getTime() < hariIni.getTime(),
  ).length;

  const filterLink = (a: string | null, s: string | null) => {
    const q = new URLSearchParams();
    if (a) q.set("arah", a);
    if (s) q.set("status", s);
    const qs = q.toString();
    return qs ? `/surat?${qs}` : "/surat";
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Surat Masuk & Keluar"
        description="Register korespondensi dengan penyedia, Wakil PPK, dan pihak lain – lengkap dengan tenggat jawabannya."
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard
          label="Menunggu jawaban"
          value={perluJawaban}
          sub="surat yang menuntut balasan"
          tone={perluJawaban > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Lewat tenggat"
          value={telat}
          sub="dari daftar yang tampil"
          tone={telat > 0 ? "danger" : "default"}
        />
        <KpiCard label="Surat masuk" value={masuk} sub="seluruh register" />
        <KpiCard label="Surat keluar" value={keluar} sub="seluruh register" />
      </div>

      {bolehKelola ? <CatatSurat paket={paket} lokasi={lokasi} /> : null}

      <Card>
        <CardHeader
          title="Register surat"
          subtitle={`${daftar.length} surat ditampilkan (terbaru dulu).`}
          action={
            <span className="flex flex-wrap gap-2 text-sm">
              {[
                { label: "Semua", href: filterLink(null, null), aktif: !arah && !status },
                { label: "Masuk", href: filterLink("masuk", status), aktif: arah === "masuk" },
                { label: "Keluar", href: filterLink("keluar", status), aktif: arah === "keluar" },
                {
                  label: "Perlu jawaban",
                  href: filterLink(arah, "perlu_jawaban"),
                  aktif: status === "perlu_jawaban",
                },
              ].map((f) => (
                <Link
                  key={f.label}
                  href={f.href}
                  // Saringan sehalaman: tanpa muat ulang, tanpa loncat ke atas
                  // (DECISIONS 433).
                  scroll={false}
                  className={f.aktif ? "font-medium text-primary" : "text-ink-muted hover:text-ink"}
                >
                  {f.label}
                </Link>
              ))}
            </span>
          }
        />
        <CardBody>
          {daftar.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="Belum ada surat tercatat"
              description="Catat surat lewat tombol di atas, atau tetapkan berkas dari antrean Lampiran Masuk."
              className="py-8"
            />
          ) : (
            <ul className="space-y-2">
              {daftar.map((l) => (
                <BarisSurat
                  key={l.id}
                  id={l.id}
                  agenda={`${l.agendaNo}/${l.agendaYear}`}
                  arahLabel={ARAH_LABEL[l.direction]}
                  arah={l.direction}
                  pihak={l.partyName || PIHAK_LABEL[l.party]}
                  subject={l.subject}
                  nomor={l.letterNumber}
                  tanggalSurat={l.letterDate ? formatTanggal(l.letterDate) : null}
                  tanggalTangani={formatTanggal(l.handledDate)}
                  kategoriLabel={KATEGORI_SURAT_LABEL[l.category]}
                  statusLabel={STATUS_SURAT_LABEL[l.status]}
                  statusTone={STATUS_SURAT_TONE[l.status]}
                  status={l.status}
                  paketNama={l.package?.name ?? null}
                  lokasiNama={l.location?.name ?? null}
                  lokasiSlug={l.location?.slug ?? null}
                  punyaBerkas={Boolean(l.fileR2Key)}
                  namaBerkas={l.fileName}
                  sisaHari={l.needsReply ? sisaHariJawab(l.replyDueDate, hariIni) : null}
                  jumlahKendala={l._count.issues}
                  jumlahTemuan={l._count.findings}
                  bolehKelola={bolehKelola}
                  lokasi={lokasi}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-ink-faint">
        Surat yang lewat tenggat jawaban ikut muncul di Perlu Tindakan – supaya tidak hanya rapi di
        arsip, tapi benar-benar ditagih.
      </p>
    </div>
  );
}
