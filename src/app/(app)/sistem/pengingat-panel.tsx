"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from "lucide-react";
import { Banner, ConfirmSubmit, StatusPill } from "@/components/ui";
import { kirimPengingatSekarangAction, type PengingatState } from "@/lib/harian/actions";
import type { PratinjauPengingat } from "@/lib/harian/pratinjau";

/**
 * Kirim pengingat laporan harian SEKARANG (DECISIONS 205/207).
 *
 * Tombol ini mengirim WhatsApp ke HP orang lapangan — tindakan keluar yang
 * tidak bisa ditarik. Yang dicegah adalah pengiriman yang TIDAK DISENGAJA:
 * daftar penerimanya (beserta nomor tujuannya) tampil lebih dulu, dan
 * konfirmasinya menyebut berapa orang akan menerima pesan kedua hari ini.
 *
 * Yang TIDAK dicegah adalah admin mengirim ulang. Pesan pertama yang tidak
 * sampai adalah keadaan nyata; halaman yang menjawab "sudah dikirim hari ini"
 * pada keadaan itu memutuskan sesuatu yang bukan haknya (DECISIONS 207).
 */
export function PengingatPanel({ pratinjau }: { pratinjau: PratinjauPengingat }) {
  const [state, action] = useActionState<PengingatState, FormData>(
    kirimPengingatSekarangAction,
    undefined,
  );

  const jumlah = pratinjau.akanDitagih.length;
  const totalLokasi = pratinjau.akanDitagih.reduce((s, p) => s + p.lokasi.length, 0);
  const ulang = pratinjau.akanDitagih.filter((p) => p.riwayat).length;

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {/* Hasil per orang: "berhasil atau tidak" dijawab dengan ID pesan dari
          WhatsApp, bukan dengan kata "sukses". */}
      {state?.rincian?.length ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-surface-muted px-4 py-2 text-[13px] font-medium text-ink">
            Hasil pengiriman barusan
          </div>
          <ul className="divide-y divide-border">
            {state.rincian.map((r, i) => (
              <li key={`${r.nama}-${i}`} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-ink">{r.nama}</span>
                  <span className="tabular text-ink-faint">{r.tujuan}</span>
                  {r.ok && r.waMessageId ? (
                    <StatusPill tone="success" label="terkirim + ID pesan" />
                  ) : r.ok ? (
                    <StatusPill tone="warning" label="tanpa ID pesan" />
                  ) : (
                    <StatusPill tone="danger" label="gagal" />
                  )}
                </div>
                {r.error ? <p className="mt-1 text-danger">{r.error}</p> : null}
                {r.ok && !r.waMessageId ? (
                  <p className="mt-1 text-ink-muted">
                    WAHA menerima permintaannya tetapi tidak memberi ID pesan — tidak bisa
                    dipastikan sampai.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!pratinjau.wahaSiap ? (
        <Banner
          tone="warning"
          title="WhatsApp (WAHA) belum dikonfigurasi"
          description="Tanpa itu tidak ada pesan yang bisa dikirim — baik oleh penjadwal maupun tombol ini. Atur di tab Integrasi."
        />
      ) : pratinjau.sesiStatus !== "WORKING" ? (
        /* Keterangan, BUKAN pagar. Status sesi berguna untuk membaca hasil,
           tetapi menjadikannya syarat berarti satu bacaan yang meleset bisa
           menghentikan pengiriman yang sebenarnya sehat (DECISIONS 207). */
        <Banner
          tone="warning"
          title={`Status sesi WhatsApp: ${pratinjau.sesiStatus}`}
          description="Di luar WORKING, pesan bisa saja tidak sampai walau WAHA menjawab 2xx. Tombol kirim tetap bisa dipakai — hasil per orang ditampilkan setelahnya, lengkap dengan ada/tidaknya ID pesan."
        />
      ) : null}

      <div className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-[13px] text-ink-muted">
        Pengingat menagih penanggung jawab lokasi yang laporan hari ini
        (<span className="tabular font-medium text-ink">{pratinjau.dateKey}</span>) belum masuk atau
        masih draft. Yang sudah mengirim tidak diganggu. Satu orang dengan beberapa lokasi menerima
        satu pesan berisi semua lokasinya. Boleh dikirim berkali-kali.
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
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ink">{p.nama}</span>
                  {/* Nomor tujuan ditampilkan: "terkirim tapi tidak sampai"
                      paling sering berarti nomornya, dan itu hanya kelihatan
                      kalau nomornya ikut ditulis. */}
                  <span className="tabular text-[13px] text-ink-faint">{p.tujuan}</span>
                  {p.riwayat ? (
                    <StatusPill
                      tone={p.riwayat.status === "gagal" ? "danger" : "neutral"}
                      label={
                        p.riwayat.status === "gagal"
                          ? `${p.riwayat.attempts}× hari ini · GAGAL`
                          : p.riwayat.adaBukti
                            ? `${p.riwayat.attempts}× hari ini · ada ID pesan`
                            : `${p.riwayat.attempts}× hari ini · tanpa ID pesan`
                      }
                    />
                  ) : null}
                </div>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {p.lokasi
                    .map((l, i) => `${l} (${p.adaDraft[i] ? "masih draf" : "belum ada laporan"})`)
                    .join(" · ")}
                </p>
                {p.riwayat?.error ? (
                  <p className="mt-1 text-[13px] text-danger">{p.riwayat.error}</p>
                ) : null}
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
            Jejak pengiriman hari ini ({pratinjau.sudahDikirim.length})
          </summary>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-muted">
            {pratinjau.sudahDikirim.map((s, i) => (
              <li key={`${s.nama}-${i}`} className="flex items-start gap-2">
                {s.status === "gagal" || !s.adaBukti ? (
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
                ) : null}
                <span>
                  {s.nama} — {s.lokasi} lokasi · {s.attempts}× ·{" "}
                  <span className="tabular">{s.tujuan ?? "nomor tidak tercatat"}</span>
                  {s.status === "gagal"
                    ? " · GAGAL terkirim"
                    : s.adaBukti
                      ? " · ada ID pesan"
                      : " · tanpa ID pesan (tidak bisa dipastikan sampai)"}
                  {s.error ? <span className="text-danger"> — {s.error}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <TombolKirim jumlah={jumlah} ulang={ulang} />
    </form>
  );
}

function TombolKirim({ jumlah, ulang }: { jumlah: number; ulang: number }) {
  const { pending } = useFormStatus();
  if (jumlah === 0) {
    // Tombol yang tidak akan mengirim apa pun sengaja tidak dipasang: menekan
    // tombol lalu tidak terjadi apa-apa terbaca seperti sistem rusak.
    return (
      <p className="text-[13px] text-ink-faint">
        Tombol kirim muncul saat ada yang perlu ditagih.
      </p>
    );
  }
  // Kirim ulang BUKAN kesalahan — tapi harus disebut, supaya menekan tombol
  // kedua kali adalah pilihan sadar, bukan kecelakaan.
  const adaUlang = ulang > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmSubmit
        label={adaUlang ? "Kirim ulang pengingat" : "Kirim pengingat sekarang"}
        title={`Kirim pengingat ke ${jumlah} orang sekarang?`}
        description={
          adaUlang
            ? `Pesan WhatsApp langsung masuk ke HP mereka dan tidak bisa ditarik kembali. ${ulang} dari ${jumlah} orang SUDAH menerima pengingat hari ini dan akan menerima pesan lagi.`
            : "Pesan WhatsApp langsung masuk ke HP mereka dan tidak bisa ditarik kembali."
        }
        confirmLabel={adaUlang ? `Ya, kirim (ulang) ke ${jumlah} orang` : `Ya, kirim ke ${jumlah} orang`}
        loading={pending}
      />
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
        {adaUlang ? (
          <RefreshCw aria-hidden className="size-3.5" />
        ) : (
          <Send aria-hidden className="size-3.5" />
        )}
        {adaUlang
          ? "Boleh diulang sebanyak yang perlu."
          : "Sama persis dengan yang dikirim penjadwal harian."}
      </span>
    </div>
  );
}
