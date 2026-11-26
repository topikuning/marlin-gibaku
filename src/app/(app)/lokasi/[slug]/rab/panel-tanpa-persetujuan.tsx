"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Input } from "@/components/ui";
import { konfirmasiKoreksi, konfirmasiTanpaPersetujuan } from "@/lib/rab/persetujuan-aturan";
import { activateDraftAction, type RabActionState } from "./actions";

/** Dua jalan pintas super admin utama atas draft (DECISIONS 682/728). */
export type CaraTanpaPersetujuan = "aktifkan" | "koreksi";

/**
 * Yang akan dilakukan "Terapkan sebagai koreksi", dihitung server sebelum orang
 * mengetik konfirmasi (DECISIONS 790): sub/grup yang pindah tempat bersama
 * laporannya, kunci lama item yang ikut pindah, dan baris berlaporan yang akan
 * hilang (koreksi ditolak bila ada).
 */
export type PratinjauKoreksiView = { pindah: string[]; kunciPindah: string[]; terhalang: string[] };

/**
 * Item terlapor yang belum dipasangkan, untuk panel jalan pintas. Untuk koreksi,
 * item yang ikut pindah bersama sub/grupnya tidak dihitung: laporannya ikut
 * (DECISIONS 790).
 */
export function belumUntuk<T extends { lineageKey: string }>(
  cara: CaraTanpaPersetujuan | null,
  belum: readonly T[],
  pratinjau: PratinjauKoreksiView | null,
): T[] {
  if (cara !== "koreksi" || !pratinjau) return [...belum];
  const pindah = new Set(pratinjau.kunciPindah);
  return belum.filter((b) => !pindah.has(b.lineageKey));
}

/**
 * Draft TANPA dua persetujuan – hanya ditampilkan untuk super admin UTAMA.
 * `aktifkan` = draft berlaku sebagai adendum (MC-0/CCO); `koreksi` = isinya
 * menimpa RAB aktif di tempat. Pemanggil yang memutuskan kapan panel ini
 * muncul; aksinya tetap memeriksa ulang di server.
 */
export function PanelTanpaPersetujuan({
  cara,
  revisionId,
  revisionNo,
  kurang,
  belumDipetakan = 0,
  pratinjauKoreksi = null,
  onBatal,
  onBerhasil,
}: {
  cara: CaraTanpaPersetujuan;
  revisionId: string;
  revisionNo: number;
  /** Persetujuan yang belum ada – disebut supaya jelas apa yang dilewati. */
  kurang: string[];
  /**
   * Item terlapor yang belum dipasangkan (DECISIONS 754). Daftarnya tampil di
   * atas panel ini; mengetik kalimat konfirmasi sekaligus mengonfirmasinya.
   */
  belumDipetakan?: number;
  /** Hanya dipakai untuk `koreksi`. */
  pratinjauKoreksi?: PratinjauKoreksiView | null;
  onBatal: () => void;
  onBerhasil?: (pesan: string) => void;
}) {
  const [ketik, setKetik] = useState("");
  const [state, action, pending] = useAksi<RabActionState>(async (prev: RabActionState, fd: FormData) => {
    const r = await activateDraftAction(prev, fd);
    if (r?.success) onBerhasil?.(r.success);
    return r;
  }, undefined);
  const koreksi = cara === "koreksi";
  const wajib = koreksi ? konfirmasiKoreksi(revisionNo) : konfirmasiTanpaPersetujuan(revisionNo);
  const pindah = koreksi ? (pratinjauKoreksi?.pindah ?? []) : [];
  const terhalang = koreksi ? (pratinjauKoreksi?.terhalang ?? []) : [];
  return (
    <div className="ml-auto max-w-md space-y-2 rounded-md border border-warning-border bg-warning-soft p-3 text-left text-[13px]">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="font-semibold text-ink">
        {koreksi
          ? `Terapkan draft #${revisionNo} sebagai koreksi RAB aktif`
          : `Aktifkan draft #${revisionNo} sebagai adendum tanpa menunggu persetujuan`}
      </p>
      <p className="text-ink">
        Pilihan ini hanya untuk super admin utama.{" "}
        {koreksi
          ? "Isi RAB aktif ditimpa dengan isi draft ini, lalu draftnya habis terpakai. Tidak ada revisi baru dan tidak dihitung sebagai MC-0/CCO. Laporan harian yang diinput terhadap draft ikut menjadi resmi."
          : "Draft ini langsung berlaku sebagai perubahan kontrak (MC-0/CCO) dan menggantikan RAB aktif. Kurva-S tidak diubah."}
        {kurang.length > 0 ? ` Yang dilewati: ${kurang.join(" + ")}.` : ""} Tindakan ini tercatat di jejak audit atas
        nama Anda.
      </p>
      {pindah.length > 0 ? (
        <div className="text-ink">
          <p>
            Dikenali sebagai pekerjaan yang sama – isinya sama persis, hanya letak atau nomornya yang berbeda. Laporan
            hariannya ikut, jadi tidak perlu dipasangkan:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {pindah.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {terhalang.length > 0 ? (
        <div className="text-danger">
          <p>
            Koreksi ini akan ditolak: {terhalang.length} baris yang sudah dipakai laporan tidak ada lagi di draft. Biarkan
            baris itu tetap ada (volumenya boleh dinolkan), atau pindahkan dulu laporannya.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {terhalang.slice(0, 8).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {belumDipetakan > 0 ? (
        <p className="text-warning">
          {belumDipetakan} item yang sudah dilaporkan belum dipasangkan (daftarnya di atas). Realisasinya tidak dihitung
          di progres sesudah {koreksi ? "koreksi ini" : "aktivasi"}.
        </p>
      ) : null}
      <form action={action} className="space-y-2">
        <input type="hidden" name="revisionId" value={revisionId} />
        <input type="hidden" name="tanpaPersetujuan" value="1" />
        <input type="hidden" name="cara" value={cara} />
        {belumDipetakan > 0 ? <input type="hidden" name="konfirmasiBelumDipetakan" value="1" /> : null}
        <label className="block text-ink" htmlFor={`tanpa-ttd-${cara}-${revisionId}`}>
          Ketik <span className="font-semibold">{wajib}</span> untuk konfirmasi
        </label>
        <Input
          id={`tanpa-ttd-${cara}-${revisionId}`}
          name="konfirmasi"
          autoComplete="off"
          value={ketik}
          onChange={(e) => setKetik(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            variant="danger"
            loading={pending}
            disabled={terhalang.length > 0 || ketik.trim().replace(/\s+/g, " ").toUpperCase() !== wajib}
          >
            {koreksi ? "Terapkan sebagai koreksi" : `Aktifkan revisi #${revisionNo}`}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onBatal}>
            Batal
          </Button>
        </div>
      </form>
    </div>
  );
}
