import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { headers } from "next/headers";
import { Card, CardHeader, CardBody, KpiCard, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { env } from "@/lib/env";
import { isR2Configured } from "@/lib/r2";
import { getWahaConfigDisplay, getWahaHits } from "@/lib/waha/config";
import { ringkasAntreanWa } from "@/lib/waha/antrean";
import { ringkasPengiriman } from "@/lib/waha/gateway";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { driveRedirectUriFrom } from "@/lib/gdrive/origin";
import { parseAkar } from "@/lib/akar";
import { AhspPanel } from "./ahsp-panel";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { GDrivePanel } from "./gdrive-panel";
import { GDriveOtomatisPanel } from "./gdrive-otomatis-panel";
import { getGDriveOtomatisAktif } from "@/lib/gdrive/setelan";
import { ringkasAntrean } from "@/lib/gdrive/antrean";
import { db } from "@/lib/db";
import { formatTanggal, formatTanggalWaktu, jakartaToday } from "@/lib/format";
import { getBranding, BRAND_DEFAULTS } from "@/lib/branding";
import { getPolicy } from "@/lib/policy";
import { statusPeta } from "@/lib/peta/sumber";
import { getKelompokBawaan } from "@/lib/peta/setelan";
import { PetaPanel } from "./peta-panel";
import { PenyimpananPanel } from "./penyimpanan-panel";
import { ArsipAsliPanel } from "./arsip-asli-panel";
import { PindahBerkasPanel } from "./pindah-berkas-panel";
import { CadanganPanel, type CadanganPanelProps } from "./cadangan-panel";
import { PolicyCard } from "./policy-card";
import { LokasiKembarPanel } from "./lokasi-kembar-panel";
import { laporanLokasiKembar } from "@/lib/package/lokasi-kembar";
import { getPhotoStampConfig } from "@/lib/photo-stamp/config";
import { getActivityKinds } from "@/lib/field-activity/kinds";
import { aiSecretStorageStatus, getAiConfigDisplay, getAiPengaman } from "@/lib/ai/config";
import { AlarmAiBanner } from "@/components/knmp/alarm-ai-banner";
import { AiPengamanPanel } from "./ai-pengaman";
import { getAiGuardConfig, getAiPricing } from "@/lib/ai-hub/guard";
import { AiGuardPanel } from "./ai-guard-panel";
import { listPrompts } from "@/lib/ai/prompts";
import { PromptPanel } from "./prompt-panel";
import { PengingatPanel } from "./pengingat-panel";
import { MingguanPanel } from "./mingguan-panel";
import { PengingatGrupPanel } from "./pengingat-grup-panel";
import { getMingguanAktif } from "@/lib/mingguan/setelan";
import { getPengingatGrupAktif } from "@/lib/harian/setelan-grup";
import { pratinjauPengingat } from "@/lib/harian/pratinjau";
import { CAPABILITIES, ROLE_CAPABILITIES, ROLE_LABEL, ALL_ROLES, type Capability } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";
import {
  R2TestPanel,
  ResetPanel,
  RebuildSnapshotPanel,
  BrandingPanel,
  WahaConfigPanel,
  WahaWebhookPanel,
  PhotoStampPanel,
  ActivityKindsPanel,
  AiProvidersPanel,
  SettingsTabs,
} from "./sistem-client";

export const metadata: Metadata = { title: "Pengaturan Sistem" };
export const dynamic = "force-dynamic";

/* ── helper presentasional (server) ─────────────────────────────────────── */

function HealthRow({
  label,
  detail,
  tone,
  status,
}: {
  label: string;
  detail: string;
  tone: "success" | "warning" | "neutral" | "danger";
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">{detail}</p>
      </div>
      <StatusPill tone={tone} label={status} />
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function IntegrationHeader({
  code,
  title,
  desc,
  tone,
  status,
}: {
  code: string;
  title: string;
  desc: string;
  tone: "success" | "warning" | "neutral";
  status: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-10 flex-none place-items-center rounded-lg bg-primary-50 text-sm font-bold text-primary">
        {code}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <StatusPill tone={tone} label={status} />
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">{desc}</p>
      </div>
    </div>
  );
}

/** Kelompok kapabilitas untuk matriks hak akses (read-only). */
const CAPABILITY_GROUPS: { title: string; match: (c: Capability) => boolean }[] = [
  { title: "Portofolio & Paket", match: (c) => /^(portfolio|package|prospect|contract|amendment)\./.test(c) },
  {
    title: "Lokasi & Pelaksanaan",
    match: (c) => /^(location|rab|baseline|weekly_plan|daily_report|field_activity|progress|issue)\./.test(c),
  },
  { title: "Keuangan & Dokumen", match: (c) => /^(finance|document|compliance|report)\./.test(c) },
  { title: "Sistem & Akses", match: (c) => /^(wa|user|system|audit)\./.test(c) },
];

/* ── halaman ─────────────────────────────────────────────────────────────── */

export default async function SistemPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "system.manage");

  const todayStart = jakartaToday();
  const lokasiKembar = await laporanLokasiKembar(user.orgId);
  const [auditLogs, sessionCount, branding, wahaDisplay, photoStamp, activeUsers, auditToday, roleCounts] =
    await Promise.all([
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          createdAt: true,
          user: { select: { username: true, fullName: true } },
        },
      }),
      db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      getBranding(),
      getWahaConfigDisplay(),
      getPhotoStampConfig(),
      db.user.count({ where: { isActive: true } }),
      db.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
    ]);
  const activityKinds = await getActivityKinds();
  const policy = await getPolicy();
  const maintenanceLocations = await db.location.findMany({
    where: { package: { orgId: user.orgId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const gdriveDisplay = await getGDriveConfigDisplay();
  const aiConfig = await getAiConfigDisplay();
  const aiPengaman = await getAiPengaman();
  const aiGuard = await getAiGuardConfig();
  const aiPricing = await getAiPricing();
  const aiSecretStatus = aiSecretStorageStatus();

  const r2On = isR2Configured();
  // Arsip dingin berkas asli — sakelar, masa tenggang, dan antreannya. Dibaca
  // di server supaya kartunya sudah berisi angka saat halaman dibuka.
  const { arsipAktif, tenggangHari, waArsipAktif, waArsipTujuan } = await import(
    "@/lib/arsip-asli/setelan"
  );
  const { keadaanArsipLatar, ringkasArsipAsli } = await import("@/lib/arsip-asli/antrean");
  const latarArsip = keadaanArsipLatar();
  const arsipAsli = {
    aktif: await arsipAktif(),
    tenggang: await tenggangHari(),
    waAktif: await waArsipAktif(),
    waTujuan: (await waArsipTujuan()) ?? "",
    terkonfigurasi: Boolean(env.ORIGINAL_ARCHIVE_URL && env.ORIGINAL_ARCHIVE_TOKEN),
    ringkas: await ringkasArsipAsli(),
    latar: {
      berjalanSejak: latarArsip.berjalanSejak?.toISOString() ?? null,
      terakhir: latarArsip.terakhir
        ? {
            selesai: latarArsip.terakhir.selesai.toISOString(),
            dikirim: latarArsip.terakhir.dikirim,
            dibuangDariR2: latarArsip.terakhir.dibuangDariR2,
            gagal: latarArsip.terakhir.gagal,
            galat: latarArsip.terakhir.galat.slice(0, 2),
          }
        : null,
    },
  };
  // Pemindahan berkas R2 → Lenovo (DECISIONS 645): setelan, ukuran R2
  // terakhir, dan apa saja yang sudah di Lenovo.
  const { setelanPindah, ukuranR2Terakhir } = await import("@/lib/penyimpanan/setelan");
  const { keadaanPindahLatar, ringkasPindah, LABEL_KATEGORI } = await import("@/lib/penyimpanan/pindah");
  const [setelanP, ukuranR2, ringkasP] = await Promise.all([setelanPindah(), ukuranR2Terakhir(), ringkasPindah()]);
  const latarPindah = keadaanPindahLatar();
  const pindahBerkas = {
    ...setelanP,
    terkonfigurasi: Boolean(env.ORIGINAL_ARCHIVE_URL && env.ORIGINAL_ARCHIVE_TOKEN),
    ukuranR2: ukuranR2 ? { bytes: ukuranR2.bytes, pada: ukuranR2.pada } : null,
    perKategori: ringkasP.perKategori.map((k) => ({ ...k, label: LABEL_KATEGORI[k.kategori] ?? k.kategori })),
    gagalTerus: ringkasP.gagalTerus,
    galatTerakhir: ringkasP.galatTerakhir,
    latar: {
      berjalanSejak: latarPindah.berjalanSejak?.toISOString() ?? null,
      terakhir: latarPindah.terakhir
        ? {
            selesai: latarPindah.terakhir.selesai.toISOString(),
            dipindah: latarPindah.terakhir.dipindah,
            bytesDipindah: latarPindah.terakhir.bytesDipindah,
            gagal: latarPindah.terakhir.gagal,
            galat: latarPindah.terakhir.galat.slice(0, 2),
            alasan: latarPindah.terakhir.alasan,
          }
        : null,
    },
  };
  // Cadangan ke Google Drive (DECISIONS 650). Ruang Drive dibaca langsung dari
  // Google – gagal membacanya tidak boleh merobohkan halaman Sistem.
  const cadangan = await (async (): Promise<CadanganPanelProps> => {
    const { tampilanAkunCadangan } = await import("@/lib/cadangan/akun");
    const { keadaanDb } = await import("@/lib/cadangan/database");
    const { ringkasBerkas } = await import("@/lib/cadangan/berkas");
    const { keadaanCadanganLatar } = await import("@/lib/cadangan/jalankan");
    const { alamatFolder, ruangDrive } = await import("@/lib/cadangan/drive");
    const { randomBytes } = await import("node:crypto");
    const akun = await tampilanAkunCadangan();
    const [dbKeadaan, berkas, ruang] = await Promise.all([
      keadaanDb(),
      ringkasBerkas().catch(() => null),
      akun.terhubung ? ruangDrive().catch(() => null) : Promise.resolve(null),
    ]);
    const latarC = keadaanCadanganLatar();
    const t = latarC.terakhir;
    return {
      akun,
      folderUrl: akun.folderId ? await alamatFolder(akun.folderId) : null,
      contohKunci: randomBytes(32).toString("base64"),
      db: { terakhir: dbKeadaan.terakhir, galat: dbKeadaan.galat },
      dbTerlambat: dbKeadaan.terlambat,
      berkas: berkas
        ? { ...berkas, terakhirBerhasil: berkas.terakhirBerhasil?.toISOString() ?? null }
        : null,
      ruang,
      latar: {
        berjalanSejak: latarC.berjalanSejak?.toISOString() ?? null,
        selesai: t?.selesai.toISOString() ?? null,
        ringkas: t
          ? [
              t.db.dibuat ? "database tercadangkan" : t.db.galat ? `database gagal (${t.db.galat})` : null,
              t.berkas ? `${t.berkas.disalin} berkas disalin${t.berkas.gagal ? `, ${t.berkas.gagal} gagal` : ""}` : null,
              t.berkas?.berhenti ?? null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null,
      },
    };
  })();
  /*
   * Foto yang kuncinya masih .heic/.heif = yang terlanjur masuk lewat jalur
   * simpan-mentah sebelum dekoder HEVC ada (DECISIONS 547). Dihitung di server
   * supaya tombol perbaikannya cuma muncul kalau memang ada yang perlu.
   */
  const fotoHeic = await db.photo.count({
    where: { OR: [{ r2Key: { endsWith: ".heic" } }, { r2Key: { endsWith: ".heif" } }] },
  });
  const wahaConfigured = wahaDisplay.hasApiKey && wahaDisplay.baseUrl.length > 0;
  // Integrasi terhubung: R2, WAHA, Database (selalu terhubung — query barusan sukses).
  const activeIntegrations = (r2On ? 1 : 0) + (wahaConfigured ? 1 : 0) + 1;

  // Webhook inbound WAHA: URL (origin dari header) + token secret + statistik tangkapan.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
  const webhookUrl = wahaDisplay.webhookSecret
    ? `${origin}/api/waha/webhook?token=${encodeURIComponent(wahaDisplay.webhookSecret)}`
    : null;
  // Keadaan sumber peta (peta dasar di R2 + citra satelit) — dibaca di server.
  const peta = await statusPeta();
  const kelompokPeta = await getKelompokBawaan();
  const [waCapturedCount, waLast, waHits, antreanWa, kirimWa] = await Promise.all([
    db.waMessage.count(),
    db.waMessage.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    getWahaHits(),
    ringkasAntreanWa(),
    ringkasPengiriman(),
  ]);
  const waHitsFmt = waHits.map((hit) => ({ ...hit, at: formatTanggalWaktu(new Date(hit.at)) }));

  // Pekerjaan harian: siapa yang akan ditagih bila tombol ditekan sekarang, dan
  // apakah penjadwal luarnya sudah bisa masuk sama sekali (DECISIONS 205).
  const pratinjau = await pratinjauPengingat(user.orgId);
  const cronSecretSiap = (process.env.CRON_SECRET ?? "").length > 0;

  /*
   * Keadaan SUPER_ADMIN_UTAMA (DECISIONS 315). Yang dibedakan bukan cuma
   * "diisi / tidak", tapi juga nama yang DICANTUMKAN TAPI AKUNNYA BELUM ADA —
   * itu kursi kosong: siapa pun yang bisa membuat super admin akan ditolak saat
   * memakai nama itu, dan tanpa baris ini penolakannya terbaca seperti bug.
   */
  // Password bootstrap yang tertinggal tidak pernah memberi tahu dirinya
  // sendiri — ia cuma duduk di Variables. Lihat DEPLOY_RAILWAY §5.4.
  const bootstrapTertinggal = (process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "").length > 0;

  const daftarAkar = parseAkar(env.SUPER_ADMIN_UTAMA);
  const akarAda =
    daftarAkar.length === 0
      ? []
      : await db.user.findMany({
          where: { username: { in: daftarAkar }, role: "super_admin", orgId: user.orgId },
          select: { username: true, isActive: true },
        });
  const akarKosong = daftarAkar.filter((u) => !akarAda.some((a) => a.username === u));
  const akarInfo =
    daftarAkar.length === 0
      ? {
          tone: "warning" as const,
          status: "Belum diatur",
          detail:
            "Tanpa ini, akun super admin jadi pintu satu arah: bisa dibuat, tidak bisa dinonaktifkan atau diturunkan oleh siapa pun. Isi SUPER_ADMIN_UTAMA dengan username-nya (boleh lebih dari satu, dipisah koma).",
        }
      : akarKosong.length > 0
        ? {
            tone: "warning" as const,
            status: `${akarAda.length} aktif, ${akarKosong.length} belum ada`,
            detail: `Tercantum tapi belum punya akun super admin: ${akarKosong.join(", ")}. Kursi itu hanya boleh diisi oleh super admin utama yang sudah ada.`,
          }
        : {
            tone: "success" as const,
            status: akarAda.map((a) => a.username).join(", "),
            detail:
              "Ditetapkan dari variabel lingkungan, jadi akun yang bocor tidak bisa mengangkat dirinya sendiri. Akun ini tidak bisa disentuh dari layar mana pun – ubah variabelnya lebih dulu.",
          };

  const roleCountMap = new Map<UserRole, number>(roleCounts.map((r) => [r.role, r._count._all]));
  const securityLogs = auditLogs
    .filter((l) => /^(user|auth|session|system)\./.test(l.action) || /password|login|masuk/i.test(l.action))
    .slice(0, 12);

  /* ── PANEL: Ringkasan ─────────────────────────────────────────────────── */
  const overviewPanel: ReactNode = (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Kesehatan Layanan" subtitle="Status komponen inti sistem" />
        <CardBody>
          <HealthRow
            label="Environment"
            detail="Mode aplikasi berjalan"
            tone={env.APP_ENV === "production" ? "success" : "warning"}
            status={env.APP_ENV}
          />
          <HealthRow label="Database PostgreSQL" detail="Koneksi & query aktif" tone="success" status="Terhubung" />
          <HealthRow
            label="Cloudflare R2"
            detail="Penyimpanan dokumen & foto"
            tone={r2On ? "success" : "neutral"}
            status={r2On ? "Terkonfigurasi" : "Belum diatur"}
          />
          <HealthRow
            label="WhatsApp (WAHA)"
            detail="Gateway kirim & tangkap pesan"
            tone={wahaConfigured ? "success" : "neutral"}
            status={wahaConfigured ? "Terkonfigurasi" : "Belum diatur"}
          />
          <HealthRow
            label="Super admin utama"
            detail={akarInfo.detail}
            tone={akarInfo.tone}
            status={akarInfo.status}
          />
          {bootstrapTertinggal && (
            <HealthRow
              label="BOOTSTRAP_ADMIN_PASSWORD"
              detail="Password super admin dalam bentuk terbaca masih tersimpan di Variables. Nilainya sudah tidak berlaku sejak password diganti saat login pertama, jadi tidak ada gunanya. Tapi ia tetap terlihat oleh siapa pun yang bisa membaca konfigurasi, dan akan membuat ulang super admin dengan password itu bila database pernah kosong (mis. kloning staging). HAPUS lalu redeploy."
              tone="warning"
              status="Masih terpasang"
            />
          )}
          <HealthRow label="Sesi aktif" detail="Login pengguna berjalan" tone="neutral" status={String(sessionCount)} />
          {/*
            PETA — teguran user 2026-09-06: *"tahu darimana aku kalau itu
            beneran sudah beres atau belum. kasih instruksi yang jelas!"*
            Selama keadaan peta hanya bisa ditebak dari layar peta yang kosong,
            setiap orang yang memasangnya harus bertanya ke pembuatnya. Di sini
            keadaannya disebut apa adanya, LENGKAP DENGAN langkah berikutnya.
          */}
          {/* Isi berkasnya ikut disebut: "ada" tidak sama dengan "bisa
              digambar". Berkas yang salah jenis atau salah skema menghasilkan
              peta abu-abu, dan itu harus terbaca DI SINI, bukan ditebak dari
              layar peta (teguran user 2026-09-06). */}
          <HealthRow
            label="Peta dasar (vektor)"
            detail={
              peta.dasar.ada && peta.dasar.isi?.masalah
                ? peta.dasar.isi.masalah
                : peta.dasar.ada
                  ? `${peta.dasar.lokasi} (${peta.dasar.alasanLokasi})${peta.dasar.lokasiDiVolume ? "" : " – BUKAN volume, hilang tiap deploy; isi PETA_DIR bila lingkungan ini punya volume"} · ${peta.dasar.ukuranMb} MB${peta.dasar.isi?.sah ? ` · ubin ${peta.dasar.isi.jenisUbin} ${peta.dasar.isi.zoom} · wilayah ${peta.dasar.isi.wilayah} · ${peta.dasar.isi.lapisanCocok} lapisan cocok dengan gaya` : ""}${peta.dasar.diperbarui ? ` · diperbarui ${formatTanggal(peta.dasar.diperbarui)}` : ""}`
                  : peta.dasar.sebab
            }
            tone={
              peta.dasar.ada
                ? peta.dasar.isi?.masalah
                  ? "danger"
                  : "success"
                : peta.dasar.sedangUnduh
                  ? "neutral"
                  : "warning"
            }
            status={
              peta.dasar.ada
                ? peta.dasar.isi?.masalah
                  ? "Tidak terpakai"
                  : "Terpasang"
                : peta.dasar.sedangUnduh
                  ? "Mengunduh"
                  : "Belum ada"
            }
          />
          <HealthRow
            label="Citra satelit"
            detail={
              peta.satelit.ada
                ? `Sumber: ${peta.satelit.sumber} · atribusi: ${peta.satelit.atribusi}`
                : "Tidak aktif. Isi PETA_SATELIT_URL (atau kosongkan untuk memakai bawaan); nilai \"mati\" mematikannya."
            }
            tone={peta.satelit.ada ? "success" : "neutral"}
            status={peta.satelit.ada ? "Aktif" : "Mati"}
          />
          {/* Penyiapannya di sini, bukan di CI: volume dev dan produksi
              berbeda, jadi yang tahu volume mana yang perlu diisi adalah
              aplikasi yang sedang berjalan di atasnya. */}
          {!peta.dimatikan ? (
            <PetaPanel
              sudahAda={peta.dasar.ada}
              sedangUnduh={peta.dasar.sedangUnduh}
              sumberBawaan={peta.sumberBawaan}
              kelompokBawaan={kelompokPeta}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Konfigurasi Penting" subtitle="Parameter global (read-only)" />
        <CardBody>
          <ConfigRow label="Zona waktu" value="Asia/Jakarta (WIB/WITA/WIT)" />
          <ConfigRow label="Locale" value="id-ID (Bahasa Indonesia)" />
          <ConfigRow label="Mata uang" value="IDR – Rupiah (BigInt)" />
          <ConfigRow label="Retensi audit" value="Append-only (permanen)" />
          <ConfigRow label="Owner agency" value="KKP" />
        </CardBody>
      </Card>

      {/* Kebijakan pengendalian — saklar pemisahan tugas & wajib-GPS
          (DECISIONS 218). Ditaruh di panel Ringkasan supaya keadaannya
          TERBACA setiap kali halaman Sistem dibuka, bukan tersembunyi di tab. */}
      <PolicyCard nilai={policy} />

      <Card className="lg:col-span-2">
        <CardHeader title="Perubahan Terbaru" subtitle="6 perubahan terakhir" />
        <CardBody>
          {auditLogs.slice(0, 6).map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px]">{l.action}</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {l.user ? l.user.fullName : "–"} · {l.resourceType}
                </p>
              </div>
              <span className="tabular flex-none text-[13px] whitespace-nowrap text-ink-muted">
                {formatTanggalWaktu(l.createdAt)}
              </span>
            </div>
          ))}
        </CardBody>
      </Card>

      {/*
        Lokasi ganda: `Location` tidak punya kunci alami yang unik (indeks itu
        hanya ada di `MasterLocation`), jadi yang terlanjur kembar tidak akan
        muncul sendiri di mana pun. Guard di addTargetLocation/pindahkanLokasi
        cuma menutup pintu ke depan – sisanya butuh tempat untuk dilihat.
      */}
      <Card className="lg:col-span-2">
        <CardHeader
          title="Lokasi kembar"
          subtitle="Lokasi yang terdaftar dua kali dengan nama sama di paket dan desa yang sama"
        />
        <CardBody>
          <LokasiKembarPanel laporan={lokasiKembar} />
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Integrasi ─────────────────────────────────────────────────── */
  const integrationsPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Diagnostik R2 & Foto" subtitle="Round-trip R2 (PUT→GET→presign→DELETE) + tes SHARP" />
        <CardBody className="space-y-4">
          <IntegrationHeader
            code="R2"
            title="Cloudflare R2 Storage"
            desc="Penyimpanan objek untuk dokumen, foto, dan lampiran."
            tone={r2On ? "success" : "neutral"}
            status={r2On ? "Terkonfigurasi" : "Belum diatur"}
          />
          <R2TestPanel configured={r2On} />
        </CardBody>
      </Card>

      {/*
        ISI penyimpanan, bukan cuma apakah ia hidup. Kartu di atas menjawab "R2
        jalan?"; yang ini menjawab "10 GB itu isinya apa?" — pertanyaan user
        2026-09-09, yang jawabannya sempat berupa perintah terminal dan ditolak:
        alat pemeliharaan yang menuntut orang membuka console produksi bukan
        alat, ia pekerjaan rumah yang dititipkan.
      */}
      <Card>
        <CardHeader
          title="Arsip dingin berkas asli"
          subtitle="Berkas asli foto dipindah ke penyimpanan sendiri. Foto ber-cap tetap di R2."
        />
        <CardBody>
          <ArsipAsliPanel {...arsipAsli} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Pindahkan berkas ke Lenovo"
          subtitle="Berkas lama disimpan di server Lenovo supaya R2 tidak penuh. Link-nya tetap sama."
        />
        <CardBody>
          <PindahBerkasPanel {...pindahBerkas} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cadangan ke Google Drive"
          subtitle="Salinan database dan berkas di akun Google cadangan, supaya data tidak hanya ada di R2 dan server Lenovo"
        />
        <CardBody>
          <CadanganPanel {...cadangan} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Isi penyimpanan R2"
          subtitle="Lihat berapa yang terpakai dan berapa yang sampah, lalu buang sampahnya"
        />
        <CardBody>
          <PenyimpananPanel configured={r2On} fotoHeic={fotoHeic} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="WhatsApp (WAHA)" subtitle="Server WAHA (URL + API key + sesi) & cek status login" />
        <CardBody className="space-y-4">
          <IntegrationHeader
            code="WA"
            title="WhatsApp Gateway"
            desc="Kirim laporan/kegiatan & tangkap percakapan grup. Panduan: docs/WAHA_SETUP.md."
            tone={wahaConfigured ? "success" : "neutral"}
            status={wahaConfigured ? "Terkonfigurasi" : "Belum diatur"}
          />
          <WahaConfigPanel initial={wahaDisplay} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Arsip Percakapan WhatsApp (webhook)"
          subtitle="Simpan pesan grup yang ditautkan ke paket, sebagai bahan ringkasan dan pencarian oleh AI"
        />
        <CardBody>
          <WahaWebhookPanel
            webhookUrl={webhookUrl}
            hasSecret={!!wahaDisplay.webhookSecret}
            capturedCount={waCapturedCount}
            lastCapturedAt={waLast ? formatTanggalWaktu(waLast.createdAt) : null}
            hits={waHitsFmt}
            antrean={antreanWa}
            pengiriman={{
              per: kirimWa.per,
              gagalTerbaru: kirimWa.gagalTerbaru.map((g) => ({
                ...g,
                createdAt: formatTanggalWaktu(g.createdAt),
              })),
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Google Drive"
          subtitle="Unggah PDF/Excel laporan harian & mingguan ke folder Drive tiap paket (pemberian KKP)"
        />
        <CardBody className="space-y-4">
          <IntegrationHeader
            code="GD"
            title="Google Drive"
            desc="OAuth akun Gmail yang jadi editor folder KKP. Folder per paket diatur di halaman paket."
            tone={gdriveDisplay.connected ? "success" : "neutral"}
            status={gdriveDisplay.connected ? "Terhubung" : "Belum terhubung"}
          />
          <GDrivePanel initial={gdriveDisplay} redirectUri={driveRedirectUriFrom(h)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Basis data AHSP"
          subtitle="Analisa Harga Satuan Pekerjaan SE DJBK 47/2026 – dasar menghitung kebutuhan bahan, upah, dan alat dari RAB"
        />
        <CardBody>
          <AhspPanel ringkas={await ringkasAhsp()} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Unggah otomatis ke Drive KKP"
          subtitle="Laporan harian final & laporan mingguan tiap lokasi terunggah otomatis, sedikit demi sedikit supaya tidak diblokir Google"
        />
        <CardBody>
          <GDriveOtomatisPanel
            aktif={await getGDriveOtomatisAktif()}
            terhubung={gdriveDisplay.connected}
            antrean={await ringkasAntrean()}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="PostgreSQL Database" subtitle="Dikelola di Railway" />
        <CardBody>
          <IntegrationHeader
            code="DB"
            title="PostgreSQL 16"
            desc="Sumber data utama. Migrasi via Prisma; backup & skala dikelola di dashboard Railway."
            tone="success"
            status="Terhubung"
          />
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Akses & Keamanan ──────────────────────────────────────────── */
  const accessPanel: ReactNode = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ringkasan Pengguna" subtitle="Jumlah akun per peran" />
          <CardBody>
            {ALL_ROLES.map((role) => (
              <ConfigRow key={role} label={ROLE_LABEL[role]} value={String(roleCountMap.get(role) ?? 0)} />
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Aktivitas Keamanan" subtitle="Perubahan terkait akun, sesi & sistem" />
          <CardBody>
            {securityLogs.length === 0 ? (
              <p className="text-sm text-ink-muted">Belum ada aktivitas keamanan tercatat.</p>
            ) : (
              securityLogs.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[13px]">{l.action}</p>
                    <p className="mt-0.5 text-[13px] text-ink-muted">{l.user ? l.user.fullName : "–"}</p>
                  </div>
                  <span className="tabular flex-none text-[13px] whitespace-nowrap text-ink-muted">
                    {formatTanggalWaktu(l.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Hak Akses per Peran"
          subtitle="Daftar hak akses tiap peran (hanya bisa dilihat). Sumber: src/lib/authz.ts"
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Kapabilitas</th>
                  {ALL_ROLES.map((role) => (
                    <th key={role} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                      {ROLE_LABEL[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAPABILITY_GROUPS.map((group) => {
                  const caps = CAPABILITIES.filter(group.match);
                  return (
                    <Fragment key={group.title}>
                      <tr className="bg-surface-inset">
                        <td
                          colSpan={ALL_ROLES.length + 1}
                          className="px-2 py-1.5 text-xs font-semibold text-ink-muted"
                        >
                          {group.title}
                        </td>
                      </tr>
                      {caps.map((cap) => (
                        <tr key={cap} className="border-b border-border">
                          <td className="py-1.5 pr-3 font-mono text-[13px]">{cap}</td>
                          {ALL_ROLES.map((role) => (
                            <td key={role} className="px-2 py-1.5 text-center">
                              {ROLE_CAPABILITIES[role].has(cap) ? (
                                <span className="text-success" aria-label="ya">
                                  ●
                                </span>
                              ) : (
                                <span className="text-border-strong" aria-label="tidak">
                                  ·
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-ink-muted">
            Hak akses ini ditetapkan di kode program dan belum bisa diubah dari layar ini.
          </p>
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Prompt AI ─────────────────────────────────────────────────── */
  // Teks perintah SEMUA aksi AI, bisa disetel admin tanpa deploy (DECISIONS 180).
  const promptPanel: ReactNode = (
    <Card>
      <CardHeader
        title="Prompt AI"
        subtitle="Teks perintah untuk AI Hub, laporan eksekutif WA, ringkasan chat grup, dan perapian teks kegiatan"
      />
      <CardBody>
        <PromptPanel items={await listPrompts()} />
      </CardBody>
    </Card>
  );

  /* ── PANEL: AI ────────────────────────────────────────────────────────── */
  const aiPanel: ReactNode = (
    <div className="space-y-4">
      <AlarmAiBanner orgId={user.orgId} />
      <Card>
        <CardHeader
          title="Provider AI"
          subtitle="Atur Claude, ChatGPT (OpenAI), Mistral, Grok – pilih satu yang aktif untuk fitur AI"
        />
        <CardBody>
          <AiProvidersPanel activeProvider={aiConfig.activeProvider} providers={aiConfig.providers} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Pengaman AI"
          subtitle="Provider cadangan bila provider aktif gagal, dan siapa yang diberi tahu bila AI gagal berkali-kali (DECISIONS 635)"
        />
        <CardBody>
          <AiPengamanPanel
            providers={aiConfig.providers.map((p) => ({ id: p.id, label: p.label, hasApiKey: p.hasApiKey }))}
            activeProvider={aiConfig.activeProvider}
            fallbackProvider={aiPengaman.fallbackProvider}
            alertChatId={aiPengaman.alertChatId}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Kontrol AI Hub"
          subtitle="Tombol mati, batas pemakaian, batas ukuran, dan harga token untuk seluruh fitur AI (DECISIONS 133)"
        />
        <CardBody>
          <AiGuardPanel
            enabled={aiGuard.enabled}
            maxRunsPerUserPerHour={aiGuard.maxRunsPerUserPerHour}
            maxRunsPerOrgPerDay={aiGuard.maxRunsPerOrgPerDay}
            maxLocationsPerRun={aiGuard.maxLocationsPerRun}
            maxInputChars={aiGuard.maxInputChars}
            maxOutputTokens={aiGuard.maxOutputTokens}
            pricing={aiPricing}
            secretStatus={aiSecretStatus}
          />
        </CardBody>
      </Card>
    </div>
  );

  // URL sementara logo pemilik pekerjaan untuk pratinjau di form (R2 privat).
  let ownerLogoUrl: string | null = null;
  if (branding.ownerLogoKey) {
    try {
      const { alamatBerkas } = await import("@/lib/penyimpanan/berkas");
      ownerLogoUrl = await alamatBerkas(branding.ownerLogoKey, 600);
    } catch {
      ownerLogoUrl = null; // R2 belum siap — form tetap tampil tanpa pratinjau
    }
  }

  /* ── PANEL: Branding & Photo Stamp ────────────────────────────────────── */
  const brandingPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Identitas Merek" subtitle="Identitas produk (global) + konteks proyek (tambahan)" />
        <CardBody>
          <BrandingPanel initial={branding} defaults={BRAND_DEFAULTS} ownerLogoUrl={ownerLogoUrl} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cap Foto – Warna Aksen & Tata Letak"
          subtitle="Warna aksen cap foto, kepekatan latar teks, ukuran, dan elemen yang ditampilkan"
        />
        <CardBody>
          <PhotoStampPanel initial={photoStamp} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Jenis Kegiatan Lapangan"
          subtitle="Daftar pilihan jenis kegiatan saat mencatat kegiatan lapangan (survei awal, PCM, dst.)"
        />
        <CardBody>
          <ActivityKindsPanel kinds={activityKinds} />
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Audit Trail ───────────────────────────────────────────────── */
  const harianPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Pengingat laporan harian"
          subtitle="Kirim sekarang tanpa menunggu jadwal. Penerimanya dihitung sama seperti kiriman terjadwal."
        />
        <CardBody>
          <PengingatPanel pratinjau={pratinjau} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Pengingat harian → grup WA paket"
          subtitle="Mengingatkan di grup tiap paket yang laporannya belum lengkap, berjeda satu menit antar grup"
        />
        <CardBody>
          <PengingatGrupPanel aktif={await getPengingatGrupAktif()} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Laporan progres mingguan → grup WA"
          subtitle="Dikirim pada hari terakhir minggu kontrak tiap paket, mengikuti cara hitung minggu di kontraknya (Senin–Minggu atau 7 hari sejak SPMK)"
        />
        <CardBody>
          <MingguanPanel aktif={await getMingguanAktif()} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Penjadwal otomatis" subtitle="Dijalankan dari luar: sekali sehari, ditambah antrean Drive tiap jam" />
        <CardBody className="space-y-3 text-[13px] text-ink-muted">
          <p>
            Pekerjaan harian (aktivasi SPMK yang jatuh tempo + pengingat WA) dijalankan oleh penjadwal
            di LUAR aplikasi yang memanggil <code className="rounded bg-surface-inset px-1 py-0.5">POST /api/cron/harian</code>{" "}
            dengan header <code className="rounded bg-surface-inset px-1 py-0.5">x-cron-secret</code>.
            Repo ini menyertakan workflow GitHub Actions{" "}
            <code className="rounded bg-surface-inset px-1 py-0.5">.github/workflows/cron-harian.yml</code>{" "}
            yang berjalan tiap hari 11.00 UTC (18.00 WIB).
          </p>
          <p>
            Antrean unggah Drive punya rute sendiri –{" "}
            <code className="rounded bg-surface-inset px-1 py-0.5">POST /api/cron/gdrive</code>{" "}
            (<code className="rounded bg-surface-inset px-1 py-0.5">.github/workflows/cron-gdrive.yml</code>,
            tiap jam). Ini bukan pemborosan. Tiap kali jalan, jumlah unggahannya sengaja dibatasi
            supaya akun Google tidak diblokir. Jadi tumpukan besar dihabiskan dengan jalan lebih
            SERING, bukan dengan mengunggah lebih banyak sekaligus. Tanpa jadwal itu antrean tetap
            jalan, tapi hanya sekali sehari bersama pekerjaan harian.
          </p>
          <HealthRow
            label="CRON_SECRET"
            detail={
              cronSecretSiap
                ? "Terisi – endpoint penjadwal menerima permintaan yang membawa rahasia yang benar."
                : "KOSONG – endpoint penjadwal menolak SEMUA permintaan, jadi pekerjaan harian tidak berjalan."
            }
            tone={cronSecretSiap ? "success" : "warning"}
            status={cronSecretSiap ? "Terisi" : "Belum diisi"}
          />
          <p>
            Tanpa penjadwal, tombol di atas tetap bisa dipakai, hanya saja harus ditekan sendiri tiap
            hari.
          </p>
        </CardBody>
      </Card>
    </div>
  );

  const auditPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Log Aktivitas" subtitle="100 perubahan terakhir (tidak bisa diubah atau dihapus)" />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                  <th className="py-2 pr-3 font-medium">Waktu</th>
                  <th className="py-2 pr-3 font-medium">Pengguna</th>
                  <th className="py-2 pr-3 font-medium">Aksi</th>
                  <th className="py-2 font-medium">Resource</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="tabular py-1.5 pr-3 whitespace-nowrap">{formatTanggalWaktu(l.createdAt)}</td>
                    <td className="py-1.5 pr-3">{l.user ? `${l.user.fullName} (@${l.user.username})` : "–"}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{l.action}</td>
                    <td className="py-1.5 text-xs text-ink-muted">
                      {l.resourceType}
                      {l.resourceId ? ` · ${l.resourceId.slice(0, 8)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Pemeliharaan data"
          subtitle="Betulkan angka di cetakan laporan final tanpa mengubah status atau data yang diisi"
        />
        <CardBody>
          <RebuildSnapshotPanel locations={maintenanceLocations} />
        </CardBody>
      </Card>

      {env.APP_ENV !== "production" && (
        <Card className="border-danger/40">
          <CardHeader title="Zona Berbahaya (development)" subtitle="Tidak tersedia di production" />
          <CardBody>
            <ResetPanel />
          </CardBody>
        </Card>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengaturan Sistem</h1>
          <p className="mt-1 text-sm text-ink-muted">Integrasi, akses &amp; keamanan, branding, dan audit trail.</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-[13px] text-ink-muted">Environment</span>
            <StatusPill tone={env.APP_ENV === "production" ? "success" : "warning"} label={env.APP_ENV} />
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">Asia/Jakarta · id-ID · IDR</p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Layanan Aktif" value={`${activeIntegrations}/3`} sub="Integrasi terhubung" />
        <KpiCard label="Pengguna Aktif" value={activeUsers} sub="Akun yang bisa login" />
        <KpiCard label="Sesi Aktif" value={sessionCount} sub="Login berjalan" />
        <KpiCard label="Audit Hari Ini" value={auditToday} sub="Perubahan tercatat" />
      </div>

      <SettingsTabs
        tabs={[
          { key: "overview", label: "Ringkasan" },
          { key: "integrations", label: "Integrasi" },
          { key: "ai", label: "AI" },
          { key: "prompt", label: "Prompt AI" },
          { key: "access", label: "Akses & Keamanan" },
          { key: "branding", label: "Branding & Photo Stamp" },
          { key: "harian", label: "Pekerjaan Harian" },
          { key: "audit", label: "Audit Trail" },
        ]}
        panels={{
          overview: overviewPanel,
          integrations: integrationsPanel,
          ai: aiPanel,
          prompt: promptPanel,
          access: accessPanel,
          branding: brandingPanel,
          harian: harianPanel,
          audit: auditPanel,
        }}
      />
    </div>
  );
}
