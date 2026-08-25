"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, BellOff, BellRing, CheckCircle2, RefreshCw, Send } from "lucide-react";
import { Banner, Button, ConfirmSubmit, StatusPill } from "@/components/ui";
import {
  kirimPengingatSatuOrangAction,
  kirimPengingatSekarangAction,
  setPengingatAktifAction,
  type PengingatState,
} from "@/lib/harian/actions";
import type { PratinjauPengingat, RiwayatHariIni } from "@/lib/harian/pratinjau";
import { LABEL_STATUS_KIRIM, NADA_STATUS_KIRIM } from "@/lib/waha/status-kirim";

/**
 * Nasib kiriman apa adanya (DECISIONS 380).
 *
 * Sebelum ini layar hanya bisa mengatakan "ada ID pesan", karena memang itu
 * satu-satunya yang diketahui. Sejak DECISIONS 374 nasib sebenarnya tercatat di
 * outbox dan diperbarui `message.ack` — dan pengingat yang DITOLAK WhatsApp
 * (mis. error 463) selama ini tetap tampil "ada ID pesan", yang terbaca seperti
 * baik-baik saja.
 *
 * Urutan bacanya: outbox lebih tahu daripada `DailyReminderLog.status`, yang
 * ditulis "sukses" SEBELUM pesannya berangkat.
 */
function labelRiwayat(r: Pick<RiwayatHariIni, "status" | "adaBukti" | "statusKirim">): string {
  if (r.statusKirim) return LABEL_STATUS_KIRIM[r.statusKirim];
  if (r.status === "gagal") return "GAGAL terkirim";
  return r.adaBukti ? "ada ID pesan" : "tanpa ID pesan (tidak bisa dipastikan sampai)";
}

function nadaRiwayat(
  r: Pick<RiwayatHariIni, "status" | "adaBukti" | "statusKirim">,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (r.statusKirim) return NADA_STATUS_KIRIM[r.statusKirim];
  if (r.status === "gagal") return "danger";
  return r.adaBukti ? "neutral" : "warning";
}

/**
 * Kirim pengingat laporan harian SEKARANG (DECISIONS 205/207/260).
 *
 * Tombol di sini mengirim WhatsApp ke HP orang lapangan — tindakan keluar yang
 * tidak bisa ditarik. Yang dicegah adalah pengiriman yang TIDAK DISENGAJA:
 * daftar penerimanya (beserta nomor tujuannya) tampil lebih dulu, dan
 * konfirmasinya menyebut berapa orang akan menerima pesan kedua hari ini.
 *
 * Yang TIDAK dicegah adalah admin mengirim ulang. Pesan pertama yang tidak
 * sampai adalah keadaan nyata; halaman yang menjawab "sudah dikirim hari ini"
 * pada keadaan itu memutuskan sesuatu yang bukan haknya (DECISIONS 207).
 *
 * ### Kenapa bukan satu `<form>` lagi
 *
 * Versi sebelumnya membungkus seluruh panel dalam satu form. Sekarang ada tiga
 * tindakan berbeda — sakelar, kirim massal, kirim per orang — dan form HTML
 * tidak boleh bersarang. Masing-masing punya formnya sendiri, dan hasilnya
 * dipisah supaya "sakelar tersimpan" tidak terbaca seperti "pesan terkirim".
 */
export function PengingatPanel({ pratinjau }: { pratinjau: PratinjauPengingat }) {
  const [sakelar, aksiSakelar] = useActionState<PengingatState, FormData>(
    setPengingatAktifAction,
    undefined,
  );
  const [massal, aksiMassal] = useActionState<PengingatState, FormData>(
    kirimPengingatSekarangAction,
    undefined,
  );
  const [satuan, aksiSatuan] = useActionState<PengingatState, FormData>(
    kirimPengingatSatuOrangAction,
    undefined,
  );

  const jumlah = pratinjau.akanDitagih.length;
  const totalLokasi = pratinjau.akanDitagih.reduce((s, p) => s + p.lokasi.length, 0);
  const ulang = pratinjau.akanDitagih.filter((p) => p.riwayat).length;

  return (
    <div className="space-y-4">
      <SakelarOtomatis aktif={pratinjau.otomatisAktif} aksi={aksiSakelar} state={sakelar} />

      {massal?.error ? <Banner tone="error" title={massal.error} /> : null}
      {massal?.success ? <Banner tone="success" title={massal.success} /> : null}
      {satuan?.error ? <Banner tone="error" title={satuan.error} /> : null}
      {satuan?.success ? <Banner tone="success" title={satuan.success} /> : null}

      {/* Hasil per orang: "berhasil atau tidak" dijawab dengan ID pesan dari
          WhatsApp, bukan dengan kata "sukses". */}
      {(massal?.rincian?.length ?? 0) > 0 ? (
        <HasilKirim rincian={massal!.rincian!} />
      ) : null}

      {!pratinjau.wahaSiap ? (
        <Banner
          tone="warning"
          title="WhatsApp (WAHA) belum dikonfigurasi"
          description="Tanpa itu tidak ada pesan yang bisa dikirim – baik oleh penjadwal maupun tombol di halaman ini. Atur di tab Integrasi."
        />
      ) : pratinjau.sesiStatus !== "WORKING" ? (
        /* Keterangan, BUKAN pagar. Status sesi berguna untuk membaca hasil,
           tetapi menjadikannya syarat berarti satu bacaan yang meleset bisa
           menghentikan pengiriman yang sebenarnya sehat (DECISIONS 207). */
        <Banner
          tone="warning"
          title={`Status sesi WhatsApp: ${pratinjau.sesiStatus}`}
          description="Di luar WORKING, pesan bisa saja tidak sampai walau WAHA menjawab 2xx. Tombol kirim tetap bisa dipakai – hasil per orang ditampilkan setelahnya, lengkap dengan ada/tidaknya ID pesan."
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
              ? ` – ${pratinjau.sudahDikirim.length} orang sudah menerima pengingat hari ini.`
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
              <li key={p.userId} className="px-4 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-ink">{p.nama}</span>
                      {/* Nomor tujuan ditampilkan: "terkirim tapi tidak sampai"
                          paling sering berarti nomornya, dan itu hanya kelihatan
                          kalau nomornya ikut ditulis. */}
                      <span className="tabular text-[13px] text-ink-faint">{p.tujuan}</span>
                      {p.riwayat ? (
                        <StatusPill
                          tone={nadaRiwayat(p.riwayat)}
                          label={`${p.riwayat.attempts}× hari ini · ${labelRiwayat(p.riwayat)}`}
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
                  </div>
                  {/* Tombol per orang (permintaan user 2026-08-05): yang gagal
                      biasanya satu-dua orang. Tanpa ini, menagih ulang satu
                      mandor berarti mengirimi ulang semua orang. */}
                  <TombolSatuOrang
                    aksi={aksiSatuan}
                    userId={p.userId}
                    nama={p.nama}
                    tujuan={p.tujuan}
                    sudah={p.riwayat?.attempts ?? 0}
                  />
                </div>
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
                {nadaRiwayat(s) === "danger" || !s.adaBukti ? (
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
                ) : null}
                <span>
                  {s.nama} – {s.lokasi} lokasi · {s.attempts}× ·{" "}
                  <span className="tabular">{s.tujuan ?? "nomor tidak tercatat"}</span>
                  {` · ${labelRiwayat(s)}`}
                  {s.error ? <span className="text-danger"> – {s.error}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <form action={aksiMassal}>
        <TombolKirim jumlah={jumlah} ulang={ulang} />
      </form>
    </div>
  );
}

/**
 * Sakelar penjadwal (DECISIONS 260).
 *
 * Keadaannya ditulis sebagai KALIMAT, bukan cuma warna: admin yang membuka
 * halaman ini setelah dua minggu harus bisa tahu kenapa lapangan tidak
 * ditagih tanpa membaca kode atau log cron.
 */
function SakelarOtomatis({
  aktif,
  aksi,
  state,
}: {
  aktif: boolean;
  aksi: (payload: FormData) => void;
  state: PengingatState;
}) {
  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div
        className={
          aktif
            ? "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-3"
            : "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
        }
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {aktif ? (
            <BellRing aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <BellOff aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">
              Pengingat harian otomatis: {aktif ? "NYALA" : "MATI"}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {aktif
                ? "Penjadwal menagih penanggung jawab sekali sehari. Mematikannya menghentikan penjadwal saja – tombol kirim di halaman ini tetap bisa dipakai."
                : "Penjadwal tidak mengirim apa pun. Tombol kirim di halaman ini TETAP bekerja, dan aktivasi SPMK jatuh tempo juga tetap berjalan."}
            </p>
          </div>
        </div>
        <form action={aksi} className="shrink-0">
          <input type="hidden" name="aktif" value={aktif ? "0" : "1"} />
          <TombolSakelar aktif={aktif} />
        </form>
      </div>
    </div>
  );
}

function TombolSakelar({ aktif }: { aktif: boolean }) {
  const { pending } = useFormStatus();
  // Mematikan = menghentikan tagihan ke seluruh lapangan. Itu pantas
  // dikonfirmasi; menyalakannya kembali tidak.
  if (aktif) {
    return (
      <ConfirmSubmit
        label="Matikan"
        variant="secondary"
        confirmVariant="danger"
        title="Matikan pengingat harian otomatis?"
        description="Penjadwal berhenti menagih laporan harian ke seluruh lapangan sampai dinyalakan lagi. Tombol kirim manual di halaman ini tetap bisa dipakai, dan aktivasi SPMK jatuh tempo tidak terpengaruh."
        confirmLabel="Ya, matikan"
        loading={pending}
      />
    );
  }
  return (
    <Button type="submit" size="sm" loading={pending}>
      Nyalakan
    </Button>
  );
}

function TombolSatuOrang({
  aksi,
  userId,
  nama,
  tujuan,
  sudah,
}: {
  aksi: (payload: FormData) => void;
  userId: string;
  nama: string;
  tujuan: string;
  sudah: number;
}) {
  return (
    <form action={aksi} className="shrink-0">
      <input type="hidden" name="userId" value={userId} />
      <KirimSatu nama={nama} tujuan={tujuan} sudah={sudah} />
    </form>
  );
}

function KirimSatu({ nama, tujuan, sudah }: { nama: string; tujuan: string; sudah: number }) {
  const { pending } = useFormStatus();
  return (
    <ConfirmSubmit
      label={sudah > 0 ? "Kirim ulang" : "Kirim"}
      variant="secondary"
      title={`Kirim pengingat ke ${nama}?`}
      description={
        sudah > 0
          ? `Pesan WhatsApp langsung masuk ke ${tujuan} dan tidak bisa ditarik kembali. Orang ini SUDAH menerima ${sudah}× pengingat hari ini.`
          : `Pesan WhatsApp langsung masuk ke ${tujuan} dan tidak bisa ditarik kembali.`
      }
      confirmLabel={`Ya, kirim ke ${nama}`}
      loading={pending}
    />
  );
}

function HasilKirim({
  rincian,
}: {
  rincian: { nama: string; tujuan: string; ok: boolean; waMessageId: string | null; error?: string }[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-surface-muted px-4 py-2 text-[13px] font-medium text-ink">
        Hasil pengiriman barusan
      </div>
      <ul className="divide-y divide-border">
        {rincian.map((r, i) => (
          <li key={`${r.nama}-${i}`} className="px-4 py-2.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-ink">{r.nama}</span>
              <span className="tabular text-ink-faint">{r.tujuan}</span>
              {/* SENGAJA bukan "terkirim": WAHA menjawab 2xx juga saat sesinya
                  belum login, dan penolakan WhatsApp datang sesudah id terbit
                  (DECISIONS 374). Status sampai/dibaca menyusul lewat ack. */}
              {r.ok && r.waMessageId ? (
                <StatusPill tone="info" label="diterima WAHA + ID pesan" />
              ) : r.ok ? (
                <StatusPill tone="warning" label="tanpa ID pesan" />
              ) : (
                <StatusPill tone="danger" label="gagal" />
              )}
            </div>
            {r.error ? <p className="mt-1 text-danger">{r.error}</p> : null}
            {r.ok && !r.waMessageId ? (
              <p className="mt-1 text-ink-muted">
                WAHA menerima permintaannya tetapi tidak memberi ID pesan – tidak bisa dipastikan
                sampai.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TombolKirim({ jumlah, ulang }: { jumlah: number; ulang: number }) {
  const { pending } = useFormStatus();
  if (jumlah === 0) {
    // Tombol yang tidak akan mengirim apa pun sengaja tidak dipasang: menekan
    // tombol lalu tidak terjadi apa-apa terbaca seperti sistem rusak.
    return (
      <p className="text-[13px] text-ink-faint">Tombol kirim muncul saat ada yang perlu ditagih.</p>
    );
  }
  // Kirim ulang BUKAN kesalahan — tapi harus disebut, supaya menekan tombol
  // kedua kali adalah pilihan sadar, bukan kecelakaan.
  const adaUlang = ulang > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmSubmit
        label={adaUlang ? "Kirim ulang ke semua" : "Kirim ke semua sekarang"}
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
