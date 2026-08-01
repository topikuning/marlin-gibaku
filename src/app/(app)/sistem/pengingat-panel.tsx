"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { Banner, ConfirmSubmit, StatusPill } from "@/components/ui";
import { kirimPengingatSekarangAction, type PengingatState } from "@/lib/harian/actions";
import type { PratinjauPengingat } from "@/lib/harian/pratinjau";

/**
 * Kirim pengingat laporan harian SEKARANG (DECISIONS 205).
 *
 * Tombol ini mengirim WhatsApp ke HP orang lapangan — tindakan keluar yang
 * tidak bisa ditarik. Karena itu daftar penerimanya ditampilkan LEBIH DULU,
 * lengkap dengan lokasi yang ditagih, dan penekanannya lewat konfirmasi. Tombol
 * yang mengirim pesan ke orang lain tanpa memberi tahu siapa penerimanya adalah
 * jebakan, bukan kemudahan.
 */
export function PengingatPanel({ pratinjau }: { pratinjau: PratinjauPengingat }) {
  const [state, action] = useActionState<PengingatState, FormData>(
    kirimPengingatSekarangAction,
    undefined,
  );

  const jumlah = pratinjau.akanDitagih.length;
  const totalLokasi = pratinjau.akanDitagih.reduce((s, p) => s + p.lokasi.length, 0);

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {!pratinjau.wahaSiap ? (
        <Banner
          tone="warning"
          title="WhatsApp (WAHA) belum dikonfigurasi"
          description="Tanpa itu tidak ada pesan yang bisa dikirim — baik oleh penjadwal maupun tombol ini. Atur di tab Integrasi."
        />
      ) : null}

      <div className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-[13px] text-ink-muted">
        Pengingat menagih penanggung jawab lokasi yang laporan hari ini
        (<span className="tabular font-medium text-ink">{pratinjau.dateKey}</span>) belum masuk atau
        masih draft. Yang sudah mengirim tidak diganggu. Satu orang dengan beberapa lokasi menerima
        satu pesan berisi semua lokasinya.
      </div>

      {/* Siapa yang akan menerima — ditampilkan SEBELUM tombol, bukan sesudah. */}
      {jumlah === 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-success-border bg-success-soft px-4 py-3 text-sm">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
          {/* JANGAN menyebut sebabnya kalau tidak tahu: daftar kosong bisa
              berarti semua sudah lapor, ATAU belum ada lokasi berjalan yang
              SPMK-nya tiba. Menebak salah satunya membuat halaman ini berbohong. */}
          <span>
            Tidak ada penanggung jawab yang perlu ditagih sekarang
            {pratinjau.sudahDikirim.length > 0
              ? ` — ${pratinjau.sudahDikirim.length} orang sudah menerima pengingat hari ini.`
              : "."}
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted px-4 py-2">
            <span className="text-[13px] font-medium text-ink">Akan menerima pesan</span>
            <StatusPill tone="warning" label={`${jumlah} orang · ${totalLokasi} lokasi`} />
          </div>
          <ul className="divide-y divide-border">
            {pratinjau.akanDitagih.map((p) => (
              <li key={p.nama} className="px-4 py-2.5">
                <p className="text-sm font-medium text-ink">{p.nama}</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {p.lokasi
                    .map((l, i) => `${l} (${p.adaDraft[i] ? "masih draf" : "belum ada laporan"})`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Yang TIDAK akan tertagih disebut namanya — "3 terkirim" tidak boleh
          terbaca "semua sudah ditagih". */}
      {pratinjau.tanpaNomor.length > 0 ? (
        <Banner
          tone="warning"
          title={`${pratinjau.tanpaNomor.length} penanggung jawab tidak punya nomor WA`}
          description={`Tidak akan menerima apa pun: ${pratinjau.tanpaNomor.join(", ")}. Isi nomornya di halaman Pengguna.`}
        />
      ) : null}

      {pratinjau.sudahDikirim.length > 0 ? (
        <details className="rounded-lg border border-border px-4 py-2.5">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            Sudah dikirim hari ini ({pratinjau.sudahDikirim.length}) — tidak akan dikirim ulang
          </summary>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-muted">
            {pratinjau.sudahDikirim.map((s, i) => (
              <li key={`${s.nama}-${i}`} className="flex items-center gap-2">
                {s.status === "gagal" ? (
                  <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-danger" />
                ) : null}
                <span>
                  {s.nama} — {s.lokasi} lokasi
                  {s.status === "gagal" ? " · GAGAL terkirim" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <TombolKirim jumlah={jumlah} siap={pratinjau.wahaSiap} />
    </form>
  );
}

function TombolKirim({ jumlah, siap }: { jumlah: number; siap: boolean }) {
  const { pending } = useFormStatus();
  if (!siap || jumlah === 0) {
    // Tombol yang tidak akan mengirim apa pun sengaja tidak dipasang: menekan
    // tombol lalu tidak terjadi apa-apa terbaca seperti sistem rusak.
    return (
      <p className="text-[13px] text-ink-faint">
        {siap
          ? "Tombol kirim muncul saat ada yang perlu ditagih."
          : "Tombol kirim aktif setelah WAHA dikonfigurasi."}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmSubmit
        label="Kirim pengingat sekarang"
        title={`Kirim pengingat ke ${jumlah} orang sekarang?`}
        description={`Pesan WhatsApp langsung masuk ke HP mereka dan tidak bisa ditarik kembali. Yang sudah menerima hari ini tidak akan dikirimi lagi.`}
        confirmLabel={`Ya, kirim ke ${jumlah} orang`}
        loading={pending}
      />
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
        <Send aria-hidden className="size-3.5" />
        Sama persis dengan yang dikirim penjadwal harian.
      </span>
    </div>
  );
}
