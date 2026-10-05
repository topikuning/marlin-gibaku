"use client";

import { useState, useTransition } from "react";
import { Banner, Button, ButtonLink, StatusPill } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  jalankanCadanganAction,
  putuskanAkunCadanganAction,
  setAktifCadanganAction,
  type CadanganActionState,
} from "@/lib/cadangan/actions";

/**
 * CADANGAN KE GOOGLE DRIVE (DECISIONS 650).
 *
 * Yang pertama ditanyakan orang dijawab paling atas: kapan database terakhir
 * tercadangkan, dan berapa berkas yang sudah punya salinan di Google Drive.
 */
export type CadanganPanelProps = {
  akun: { adaClient: boolean; terhubung: boolean; email: string | null; aktif: boolean; adaKunci: boolean };
  folderUrl: string | null;
  contohKunci: string;
  db: { terakhir: { pada: string; nama: string; bytes: number } | null; galat: { pada: string; galat: string } | null };
  /** Dihitung di server: cadangan database terakhir lebih tua dari 36 jam. */
  dbTerlambat: boolean;
  berkas: {
    total: number;
    sudah: number;
    bytesSudah: number;
    menunggu: number;
    satuSalinanMenunggu: number;
    gagalTerus: number;
    galatTerakhir: string | null;
    terakhirBerhasil: string | null;
    perKategori: { kategori: string; label: string; berkas: number; bytes: number }[];
  } | null;
  ruang: { terpakai: number; batas: number | null } | null;
  latar: { berjalanSejak: string | null; selesai: string | null; ringkas: string | null };
};

const waktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });

export function CadanganPanel(p: CadanganPanelProps) {
  const [state, aksi, pending] = useAksi<CadanganActionState>(setAktifCadanganAction, undefined);
  const [pesan, setPesan] = useState<CadanganActionState>(undefined);
  const [jalan, mulai] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Tiap malam database disalin ke Google Drive dalam keadaan tersandi. Foto asli, foto ber-cap, dokumen, surat,
        dan lampiran juga disalin satu per satu, dimulai dari yang sekarang hanya tersimpan di server Lenovo. Salinan
        di Drive tidak pernah dihapus otomatis.
      </p>

      {!p.akun.adaClient ? (
        <Banner
          tone="info"
          title="Isi dulu client ID dan secret Google"
          description="Cadangan memakai aplikasi Google yang sama dengan kartu Google Drive di bawah. Isi client ID dan secret di sana, lalu kembali ke sini."
        />
      ) : null}

      {!p.akun.adaKunci ? (
        <Banner
          tone="warning"
          title="BACKUP_ENCRYPTION_KEY belum diisi di Railway"
          description={
            <span className="space-y-1">
              <span className="block">
                Tanpa kunci ini database tidak dicadangkan. Berkas tetap disalin. Isi variabel{" "}
                <code>BACKUP_ENCRYPTION_KEY</code> di Railway dengan kalimat sandi buatan Anda sendiri (minimal 12
                karakter), atau salin kunci acak di bawah. Simpan juga di luar Railway: tanpa kunci ini cadangan
                database tidak bisa dibuka.
              </span>
              <code className="block break-all rounded bg-surface-inset px-2 py-1 text-xs">{p.contohKunci}</code>
            </span>
          }
        />
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        <Angka
          label="Database"
          nilai={p.db.terakhir ? waktu(p.db.terakhir.pada) : "Belum pernah"}
          sub={p.db.terakhir ? `${ukuran(p.db.terakhir.bytes)} · simpan 30 hari + 12 bulanan` : "sekali sehari"}
          tone={!p.db.terakhir ? undefined : p.dbTerlambat ? "danger" : "success"}
        />
        <Angka
          label="Berkas tercadangkan"
          nilai={p.berkas ? `${p.berkas.sudah.toLocaleString("id-ID")} / ${p.berkas.total.toLocaleString("id-ID")}` : "–"}
          sub={p.berkas ? `${ukuran(p.berkas.bytesSudah)} di Google Drive` : "belum dihitung"}
          tone={p.berkas && p.berkas.menunggu === 0 && p.berkas.total > 0 ? "success" : undefined}
        />
        {p.ruang ? (
          <Angka
            label="Ruang Google Drive"
            nilai={ukuran(p.ruang.terpakai)}
            sub={p.ruang.batas ? `dari ${ukuran(p.ruang.batas)}` : "tanpa batas"}
          />
        ) : null}
      </div>

      {p.berkas && p.berkas.satuSalinanMenunggu > 0 ? (
        <p className="text-xs text-warning">
          {p.berkas.satuSalinanMenunggu.toLocaleString("id-ID")} berkas yang sekarang hanya ada di server Lenovo masih
          menunggu – dikerjakan paling dulu.
        </p>
      ) : null}
      {p.berkas && p.berkas.perKategori.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {p.berkas.perKategori.map((k) => (
            <li key={k.kategori}>
              {k.label}: <span className="tabular-nums text-ink">{k.berkas.toLocaleString("id-ID")}</span> berkas ·{" "}
              <span className="tabular-nums text-ink">{ukuran(k.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {p.db.galat ? (
        <Banner tone="warning" title="Cadangan database terakhir gagal" description={`${waktu(p.db.galat.pada)}: ${p.db.galat.galat}`} />
      ) : null}
      {p.berkas && p.berkas.gagalTerus > 0 && p.berkas.galatTerakhir ? (
        <Banner
          tone="warning"
          title={`${p.berkas.gagalTerus} berkas gagal disalin berkali-kali`}
          description={`Penyebab terakhir: ${p.berkas.galatTerakhir}. Dicoba lagi otomatis 6 jam kemudian.`}
        />
      ) : null}

      {state?.error || pesan?.error ? <Banner tone="error" title="Gagal" description={state?.error ?? pesan?.error} /> : null}
      {state?.success || pesan?.success ? (
        <Banner tone="success" title="Beres" description={pesan?.success ?? state?.success} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill
          tone={p.akun.terhubung ? "success" : "neutral"}
          label={p.akun.terhubung ? `Tersambung: ${p.akun.email ?? "akun Google"}` : "Akun cadangan belum tersambung"}
        />
        {p.folderUrl ? (
          <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-primary underline">
            Buka folder di Google Drive
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {p.akun.adaClient ? (
          <ButtonLink href="/api/gdrive/auth?tujuan=cadangan" variant={p.akun.terhubung ? "secondary" : "primary"} size="sm">
            {p.akun.terhubung ? "Ganti akun Google" : "Sambungkan akun Google"}
          </ButtonLink>
        ) : null}
        {p.akun.terhubung ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={jalan}
              onClick={() =>
                mulai(async () => {
                  setPesan(await jalankanCadanganAction());
                })
              }
            >
              {p.latar.berjalanSejak ? "Sedang berjalan" : "Cadangkan sekarang"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={jalan}
              onClick={() => {
                if (!window.confirm("Putuskan akun Google cadangan? Berkas yang sudah tersalin tetap ada di Drive.")) return;
                mulai(async () => {
                  setPesan(await putuskanAkunCadanganAction());
                });
              }}
            >
              Putuskan
            </Button>
          </>
        ) : null}
      </div>

      {p.akun.terhubung ? (
        <form action={aksi} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="aktif" defaultChecked={p.akun.aktif} className="size-4" />
            <span>Cadangan aktif</span>
          </label>
          <Button type="submit" loading={pending} variant="secondary" size="sm">
            Simpan
          </Button>
        </form>
      ) : null}

      <p className="text-xs text-ink-muted">
        {p.latar.berjalanSejak
          ? `Sedang berjalan sejak ${waktu(p.latar.berjalanSejak)}.`
          : p.latar.selesai
            ? `Putaran terakhir selesai ${waktu(p.latar.selesai)}${p.latar.ringkas ? `: ${p.latar.ringkas}` : ""}.`
            : "Berjalan otomatis tiap jam lewat GitHub Actions (cron-cadangan)."}{" "}
        Kalau cadangan database terlambat lebih dari 36 jam, peringatan dikirim lewat WhatsApp ke nomor peringatan arsip.
      </p>
    </div>
  );
}

function ukuran(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toLocaleString("id-ID", { maximumFractionDigits: 2 })} TB`;
  if (b >= 1e9) return `${(b / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} GB`;
  if (b >= 1e6) return `${(b / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  return `${Math.round(b / 1000).toLocaleString("id-ID")} KB`;
}

function Angka({ label, nilai, sub, tone }: { label: string; nilai: string; sub: string; tone?: "danger" | "success" }) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"
        }`}
      >
        {nilai}
      </p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </div>
  );
}
