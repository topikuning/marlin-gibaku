"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";
import { activateDraftAction, discardDraftAction, type RabActionState } from "../actions";

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
}: {
  revisionId: string;
  revisionNo: number;
  /** Satu kalimat: "+2 item, 1 dihapus, 3 diubah · Δ +Rp 13.000.000". */
  ringkasan: string;
  adaPeringatan: boolean;
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <Button
        type="button"
        loading={pending}
        onClick={() =>
          run(
            activateDraftAction,
            `Aktifkan draft revisi #${revisionNo}?\n\n${ringkasan}\n\n` +
              (adaPeringatan ? "PERHATIAN: ada peringatan nilai di halaman — pastikan sudah dibaca.\n\n" : "") +
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
  );
}
