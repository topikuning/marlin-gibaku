"use client";

import { useState, useTransition } from "react";
import { BookText, RefreshCw } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { imporAhspAction, type AhspActionState } from "@/lib/ahsp/actions";
import type { RingkasAhsp } from "@/lib/ahsp/import";

/**
 * Keadaan basis data AHSP (DECISIONS 317).
 *
 * Yang ditampilkan sengaja termasuk **sha256 berkasnya**: analisa harga yang
 * dipakai memperkirakan uang harus bisa dibuktikan versinya. "Entah berkas yang
 * mana" adalah jawaban yang tidak boleh muncul saat ada yang bertanya dari mana
 * koefisiennya.
 */
export function AhspPanel({ ringkas }: { ringkas: RingkasAhsp | null }) {
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, start] = useTransition();

  const jalankan = () => {
    setMsg(null);
    start(async () => {
      const r: AhspActionState = await imporAhspAction();
      if (r?.error) setMsg({ tone: "error", text: r.error });
      else if (r?.success) setMsg({ tone: "success", text: r.success });
    });
  };

  return (
    <div className="space-y-3">
      {msg ? <Banner tone={msg.tone} title={msg.text} /> : null}

      {ringkas?.belumSelesai ? (
        <Banner
          tone="error"
          title="Impor basis AHSP TERPUTUS – isinya belum lengkap"
          description="Percobaan sebelumnya berhenti di tengah, jadi angka di bawah belum utuh dan BELUM boleh dipakai menghitung kebutuhan bahan. Tekan tombol di bawah untuk mengulang; basis yang belum selesai tidak akan pernah dianggap mutakhir."
        />
      ) : null}

      {ringkas ? (
        <div
          className={
            ringkas.belumSelesai
              ? "rounded-lg border border-danger-border bg-danger-soft px-4 py-3"
              : "rounded-lg border border-success-border bg-success-soft px-4 py-3"
          }
        >
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <BookText
              aria-hidden
              className={
                ringkas.belumSelesai ? "size-4 shrink-0 text-danger" : "size-4 shrink-0 text-success"
              }
            />
            {ringkas.name}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-ink-muted sm:grid-cols-3">
            <div>
              <dt className="text-[12px]">Analisa</dt>
              <dd className="font-medium text-ink">{ringkas.entri.toLocaleString("id-ID")}</dd>
            </div>
            <div>
              <dt className="text-[12px]">Komponen koefisien</dt>
              <dd className="font-medium text-ink">{ringkas.komponen.toLocaleString("id-ID")}</dd>
            </div>
            <div>
              <dt className="text-[12px]">Perlu verifikasi</dt>
              <dd className="font-medium text-ink">{ringkas.perluVerifikasi.toLocaleString("id-ID")}</dd>
            </div>
            <div>
              <dt className="text-[12px]">Punya lapisan pencocokan</dt>
              <dd className="font-medium text-ink">{ringkas.punyaAlias.toLocaleString("id-ID")}</dd>
            </div>
          </dl>
          <p className="mt-2 break-all text-[12px] text-ink-muted">
            Versi berkas (sha256):{" "}
            {ringkas.belumSelesai ? (
              <span className="font-medium text-danger">belum dipasang – impor belum tuntas</span>
            ) : (
              <code className="rounded bg-surface-inset px-1">{ringkas.fileSha256}</code>
            )}
          </p>
        </div>
      ) : (
        <Banner
          tone="warning"
          title="Basis AHSP belum dimuat"
          description="Analisa harga satuan belum ada di database, jadi penurunan kebutuhan bahan/upah dari RAB belum bisa dipakai. Tekan tombol di bawah untuk memuatnya dari berkas yang ikut di repo."
        />
      )}

      <Button type="button" variant="secondary" size="sm" loading={busy} onClick={jalankan}>
        <RefreshCw aria-hidden className="size-3.5" />
        {ringkas?.belumSelesai
          ? "Ulangi impor basis AHSP"
          : ringkas
            ? "Periksa & segarkan basis AHSP"
            : "Muat basis AHSP"}
      </Button>

      <p className="text-[12px] text-ink-muted">
        Sumber: Surat Edaran Dirjen Bina Konstruksi No. 47/SE/Dk/2026, Lampiran II–VI. Aman ditekan
        berulang – berkas yang isinya sama tidak ditulis ulang, dan impor yang terputus di tengah
        selalu diulang dari awal alih-alih mengaku selesai.
      </p>
    </div>
  );
}
