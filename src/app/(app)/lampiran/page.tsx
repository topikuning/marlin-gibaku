import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Inbox } from "lucide-react";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { formatTanggalWaktu } from "@/lib/format";
import {
  LAMPIRAN_KEPUTUSAN_LABEL,
  LAMPIRAN_KIND_LABEL,
  LAMPIRAN_KIND_TONE,
  LAMPIRAN_STATUS_LABEL,
} from "@/lib/surat/lifecycle";
import { BarisLampiran } from "./baris-lampiran";
import { PembersihMassal } from "./pembersih-massal";

export const metadata: Metadata = { title: "Lampiran Masuk" };
export const dynamic = "force-dynamic";

/**
 * Antrean lampiran grup WA (DECISIONS 432).
 *
 * Yang muncul di sini SENGAJA bukan semua lampiran: foto lapangan biasa
 * dikecualikan. Kalau 83 grup mengirim puluhan foto sehari, antrean berisi
 * ribuan baris dan berhenti dibaca orang — dan antrean yang tidak dibaca sama
 * saja dengan tidak ada. Foto tetap tersimpan & terlihat di galeri chat.
 *
 * Layarnya sengaja HANYA daftar (ketetapan user 2026-08-29). Tiga kartu angka
 * dan banner penjelas foto lapangan dibuang: keduanya menjelaskan hal yang
 * sudah diketahui pemakainya setiap hari, dan menyita layar di atas satu-satunya
 * yang perlu dikerjakan — barisnya.
 */
export default async function LampiranPage({
  searchParams,
}: {
  searchParams: Promise<{ semua?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "letter.manage");
  const sp = await searchParams;
  const tampilSemua = sp.semua === "1";

  const scope = packageScopeWhere(user, await accessibleLocationIds(user));

  const antre = await db.waAttachment.findMany({
      where: {
        package: scope,
        ...(tampilSemua
          ? {}
          : {
              decision: "belum",
              saranKind: { in: ["surat_kandidat", "dokumen", "media_lain"] },
              // Yang umur simpannya sudah habis tidak menunggu apa-apa lagi:
              // berkasnya tidak ada, jadi tidak ada yang bisa ditetapkan.
              status: { not: "kedaluwarsa" as const },
            }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        failReason: true,
        saranKind: true,
        saranAlasan: true,
        saranRingkas: true,
        decision: true,
        r2Key: true,
        createdAt: true,
        package: { select: { name: true } },
        message: { select: { body: true, fromName: true, timestamp: true } },
      },
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lampiran Masuk"
        description="Berkas yang dikirim ke grup WhatsApp. Sistem menduga jenisnya; Anda yang menetapkan."
      />

      <Card>
        <CardHeader
          title={tampilSemua ? "Semua lampiran" : "Perlu ditetapkan"}
          subtitle={
            tampilSemua
              ? "Termasuk yang sudah ditetapkan dan foto lapangan."
              : "Berkas dokumen & kemungkinan surat yang belum diputuskan."
          }
          action={
            <Link
              href={tampilSemua ? "/lampiran" : "/lampiran?semua=1"}
              // Menyaring di halaman yang sama — jangan memuat ulang halaman
              // dan jangan melempar pembaca ke puncak (DECISIONS 433).
              scroll={false}
              className="text-sm text-primary hover:underline"
            >
              {tampilSemua ? "Tampilkan yang perlu ditetapkan saja" : "Lihat semua lampiran"}
            </Link>
          }
        />
        <CardBody>
          {antre.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Tidak ada lampiran menunggu"
              description="Berkas baru akan muncul di sini begitu dikirim ke grup WhatsApp yang tertaut paket."
              className="py-8"
            />
          ) : (
            <PembersihMassal jumlah={antre.filter((a) => a.decision === "belum").length}>
            <ul className="space-y-3">
              {antre.map((a) => (
                <BarisLampiran
                  key={a.id}
                  id={a.id}
                  fileName={a.fileName}
                  mimeType={a.mimeType}
                  sizeBytes={a.sizeBytes}
                  statusLabel={LAMPIRAN_STATUS_LABEL[a.status]}
                  gagal={a.status === "gagal"}
                  failReason={a.failReason}
                  kindLabel={LAMPIRAN_KIND_LABEL[a.saranKind]}
                  kindTone={LAMPIRAN_KIND_TONE[a.saranKind]}
                  saranAlasan={a.saranAlasan}
                  saranRingkas={a.saranRingkas}
                  keputusanLabel={LAMPIRAN_KEPUTUSAN_LABEL[a.decision]}
                  sudahDitetapkan={a.decision !== "belum"}
                  bisaDipilih={a.decision === "belum" && a.status !== "kedaluwarsa"}
                  terarsip={!!a.r2Key}
                  paketNama={a.package?.name ?? null}
                  pengirim={a.message.fromName}
                  caption={a.message.body}
                  waktu={formatTanggalWaktu(a.message.timestamp)}
                />
              ))}
            </ul>
            </PembersihMassal>
          )}
        </CardBody>
      </Card>

    </div>
  );
}
