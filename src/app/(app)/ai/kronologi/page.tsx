import type { Metadata } from "next";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { KronologiGarisWaktu } from "@/components/knmp/kronologi-garis-waktu";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getActiveAiConfig } from "@/lib/ai/config";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { resolveAiScope } from "@/lib/ai-hub/source";
import { ambilKronologi } from "@/lib/kronologi/queries";
import { jakartaToday } from "@/lib/format";
import { PemilihKronologi } from "./pemilih";

export const metadata: Metadata = { title: "AI Intelligence – Kronologi Lokasi" };
export const dynamic = "force-dynamic";

/**
 * KRONOLOGI LOKASI — permintaan user 2026-08-31.
 *
 * Garis waktunya DETERMINISTIK: kendala dan kegiatan lapangan satu lokasi,
 * berurutan, ditutup kondisi terkininya. Ia tampil penuh tanpa memanggil
 * provider AI sama sekali — sama seperti Portfolio Pulse, dan karena alasan yang
 * sama (DECISIONS 133): angka dan urutan adalah aturan, bukan gaya bahasa.
 *
 * AI menambahkan SATU hal di atasnya: merangkai peristiwa jadi babak cerita yang
 * bisa dibaca pimpinan. Itu dijalankan lewat run `kronologi` — bersnapshot,
 * berkuota, dan bergrounding seperti jenis run lain — dan hanya ketika tombolnya
 * ditekan.
 */
export default async function AiKronologiPage({
  searchParams,
}: {
  searchParams: Promise<{ lokasi?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");
  const sp = await searchParams;

  const [scope, aiCfg, guard] = await Promise.all([
    resolveAiScope(user, []),
    getActiveAiConfig(),
    getAiGuardConfig(),
  ]);

  const lokasi = await db.location.findMany({
    where: { id: { in: scope.ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Alamat "?lokasi=…" tidak boleh jadi pintu belakang: hanya id yang lolos
  // scope resmi yang dilayani.
  const dipilih = lokasi.some((l) => l.id === sp.lokasi) ? sp.lokasi! : null;
  const sampai = jakartaToday().toISOString().slice(0, 10);
  const k = dipilih ? await ambilKronologi(dipilih, { sampai, hari: 90, batas: 60 }) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Kronologi lokasi"
          subtitle="Kendala dan kegiatan lapangan satu lokasi, berurutan, lalu kondisi terkininya."
        />
        <CardBody className="space-y-3">
          <PemilihKronologi
            lokasi={lokasi.map((l) => ({ id: l.id, nama: l.name }))}
            terpilih={dipilih}
            bisaNarasi={can(user.role, "ai.generate")}
            aiSiap={guard.enabled && !!aiCfg}
          />
          {!guard.enabled ? (
            <Banner
              tone="warning"
              title="Fitur AI sedang dinonaktifkan admin (kill switch)"
              description="Garis waktu di bawah tetap berlaku – ia tidak memakai AI."
            />
          ) : !aiCfg ? (
            <Banner
              tone="info"
              title="Provider AI belum dikonfigurasi (Sistem → AI)"
              description="Garis waktu tetap berfungsi; narasinya saja yang nonaktif."
            />
          ) : null}
          {lokasi.length === 0 ? (
            <Banner
              tone="info"
              title="Belum ada lokasi dalam hak akses Anda"
              description="Kronologi disusun per lokasi, jadi tidak ada yang bisa ditampilkan."
            />
          ) : null}
        </CardBody>
      </Card>

      {k ? (
        <KronologiGarisWaktu k={k} judul={`${k.lokasi.nama} – ${k.lokasi.wilayah}`} />
      ) : lokasi.length > 0 ? (
        <Card>
          <CardBody className="py-6 text-sm text-ink-muted">
            Pilih satu lokasi untuk melihat kronologinya. Kronologi lintas lokasi tidak disusun –
            digabung begitu saja ia berhenti jadi cerita dan berubah jadi tumpukan.
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
