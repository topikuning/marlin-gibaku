"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";
import { activateDraftAction, approveRevisionAction, discardDraftAction, type RabActionState } from "../actions";

/**
 * Aktivasi / buang draft LANGSUNG dari halaman adendum — review-nya adalah
 * halaman ini sendiri (grid lama vs baru + panel diff + peringatan nilai).
 * Konfirmasi menyebut ringkasan supaya yang diaktifkan tidak pernah "kejutan".
 */
export function DraftControls({
  revisionId,
  revisionNo,
  ringkasan,
  adaPeringatan,
  persetujuan,
}: {
  revisionId: string;
  revisionNo: number;
  /** Satu kalimat: "+2 item, 1 dihapus, 3 diubah · Δ +Rp 13.000.000". */
  ringkasan: string;
  adaPeringatan: boolean;
  /** null = HPS awal (belum ada RAB aktif) → tidak menuntut empat mata. */
  persetujuan: {
    lengkap: boolean;
    kurang: string[];
    berlaku: { nama: string; peran: string; waktu: string }[];
    gugur: { nama: string; peran: string }[];
    /** Pengguna ini berhak menandatangani. */
    bolehTtd: boolean;
    /** Pengguna ini sudah menandatangani (dan masih berlaku). */
    sudahTtd: boolean;
  } | null;
}) {
  const [state, setState] = useState<RabActionState>(undefined);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (action: typeof activateDraftAction, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    const f = new FormData();
    f.append("revisionId", revisionId);
    startTransition(() => {
      void action(undefined, f).then((res) => {
        setState(res);
        if (res?.success) router.push("../rab");
      });
    });
  };

  const terkunci = persetujuan != null && !persetujuan.lengkap;

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {/* Panel EMPAT MATA (DECISIONS 234). Ditampilkan sebagai keadaan, bukan
          sebagai error yang muncul setelah tombol ditekan — orang harus tahu
          apa yang kurang SEBELUM mencoba. */}
      {persetujuan ? (
        <div
          className={`rounded-md border px-3 py-2.5 text-[13px] ${
            persetujuan.lengkap ? "border-success-border bg-success-soft" : "border-border bg-surface-muted"
          }`}
        >
          <p className="font-medium text-ink">
            Persetujuan aktivasi – butuh DUA orang berbeda: Program Director + Area/Project/Site Manager
          </p>
          {persetujuan.berlaku.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-ink-muted">
              {persetujuan.berlaku.map((p) => (
                <li key={`${p.nama}-${p.waktu}`}>
                  ✓ {p.nama} ({p.peran}) – {p.waktu}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-ink-muted">Belum ada yang menyetujui.</p>
          )}
          {persetujuan.kurang.length > 0 ? (
            <p className="mt-1 text-warning">Masih kurang: {persetujuan.kurang.join(" + ")}.</p>
          ) : null}
          {persetujuan.gugur.length > 0 ? (
            <p className="mt-1 text-warning">
              Gugur karena draft berubah setelah disetujui:{" "}
              {persetujuan.gugur.map((p) => `${p.nama} (${p.peran})`).join(", ")} – perlu menyetujui ulang.
            </p>
          ) : null}
          {persetujuan.bolehTtd ? (
            <Button
              type="button"
              size="sm"
              variant={persetujuan.sudahTtd ? "secondary" : "primary"}
              className="mt-2"
              loading={pending}
              onClick={() => {
                const f = new FormData();
                f.append("revisionId", revisionId);
                if (persetujuan.sudahTtd) f.append("cabut", "1");
                startTransition(() => {
                  void approveRevisionAction(undefined, f).then((res) => {
                    setState(res);
                    if (res?.success) router.refresh();
                  });
                });
              }}
            >
              {persetujuan.sudahTtd ? "Cabut persetujuan saya" : "Setujui aktivasi"}
            </Button>
          ) : (
            <p className="mt-1 text-ink-faint">
              Peran Anda tidak berhak menandatangani aktivasi adendum.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        loading={pending}
        disabled={terkunci}
        title={terkunci ? `Terkunci – masih kurang: ${persetujuan?.kurang.join(" + ")}` : undefined}
        onClick={() =>
          run(
            activateDraftAction,
            `Aktifkan draft revisi #${revisionNo}?\n\n${ringkasan}\n\n` +
              (adaPeringatan ? "PERHATIAN: ada peringatan nilai di halaman – pastikan sudah dibaca.\n\n" : "") +
              "Revisi aktif lama menjadi arsip (jejak tetap ada), kurva-S di-regenerate, dan realisasi tersambung otomatis via lineage.",
          )
        }
      >
        Aktifkan draft #{revisionNo}
      </Button>
      <Button
        type="button"
        variant="danger"
        loading={pending}
        onClick={() =>
          run(
            discardDraftAction,
            `Buang draft revisi #${revisionNo}? Seluruh editan draft ini hilang; revisi aktif tidak berubah.`,
          )
        }
      >
        Buang draft
      </Button>
      </div>
    </div>
  );
}
