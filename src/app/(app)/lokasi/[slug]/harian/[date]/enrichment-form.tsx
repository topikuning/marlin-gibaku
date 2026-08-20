"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { Banner, Button, Input, Label, Textarea } from "@/components/ui";
import {
  fetchWeatherAction,
  saveEnrichmentAction,
  type DailyActionState,
} from "@/lib/daily-report/actions";
import type { KkpWeatherCategory } from "@/lib/weather/hourly";
import {
  SHOW_MANUAL_WEATHER_PICKER,
  WEATHER_LABEL,
  WEATHER_ORDER,
  WORKER_ROLE_LABEL,
  WORKER_ROLE_ORDER,
} from "@/lib/daily-report/constants";
import { FotoBarisPelengkap } from "@/components/knmp/foto-baris-pelengkap";
import type { WorkspaceReport } from "@/lib/daily-report/queries";
import type { PhotoView } from "@/lib/photos";

/**
 * Panel pelengkap KKP: cuaca (otomatis per jam; pemilih manual di balik
 * SHOW_MANUAL_WEATHER_PICKER), jam kerja,
 * tenaga per keahlian (grid angka), material masuk (baris dinamis),
 * peralatan (baris dinamis), catatan.
 * Diisi SM saat verifikasi (status dikirim) atau saat menyusun draft.
 */

/**
 * `key` = identitas React (baris baru pun perlu key stabil saat diurut ulang).
 * `id` = identitas BASIS DATA; kosong untuk baris yang belum tersimpan.
 * Keduanya tidak boleh disatukan: `id` ikut terkirim ke server supaya barisnya
 * diperbarui di tempat, bukan dibuat ulang — foto menempel pada `id` itu
 * (DECISIONS 304).
 */
type Row = { key: number; id: string; name: string; a: string; b: string };
let rowSeq = 1;

/**
 * Foto yang menempel pada satu baris — dibaca dari data SERVER, bukan state.
 *
 * Inilah perbaikan angka "0 foto" yang keras kepala (DECISIONS 343): jumlahnya
 * dulu disalin ke state baris saat komponen dipasang, dan state itu tidak ikut
 * diperbarui sesudah foto diunggah. Baris yang sudah punya foto tetap menulis
 * "0 foto" sampai formnya kebetulan dipasang ulang.
 */
function fotoBaris<T extends { id: string; photos: PhotoView[] }>(
  daftar: T[],
  barisId: string,
): PhotoView[] {
  if (!barisId) return [];
  return daftar.find((b) => b.id === barisId)?.photos ?? [];
}

const CATEGORY_TONE: Record<KkpWeatherCategory, string> = {
  Cerah: "bg-amber-100 text-amber-900",
  Mendung: "bg-slate-200 text-slate-700",
  Hujan: "bg-sky-200 text-sky-900",
};

/**
 * Pengambilan cuaca otomatis per jam dari koordinat lokasi + pita 07–21 supaya
 * orang lapangan bisa MEMBANDINGKAN dengan yang dia lihat sendiri. Tombol
 * terpisah (bukan otomatis saat halaman dibuka): laporan tidak boleh menunggu
 * jaringan, dan asal angka harus jelas.
 *
 * Tanggal yang diambil = TANGGAL LAPORAN, bukan hari ini — laporan yang diisi
 * mundur (mis. lupa 3 hari) tetap mendapat kondisi tanggal itu.
 */
function WeatherAuto({ report }: { report: WorkspaceReport }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    fetchWeatherAction,
    undefined,
  );
  const hours = report.weatherHourly;
  const isManual = report.weatherSource === "manual";
  const rainHours = hours?.filter((h) => h.category === "Hujan").length ?? 0;

  return (
    // Satu baris, bukan kotak bergaris putus-putus setinggi lima baris.
    // Permintaan user 2026-08-02: "ambil cuaca, langsung merusak tampilan
    // mobile". Penyebabnya paragraf tiga baris yang menjelaskan cara kerja di
    // sebelah satu tombol — penjelasan yang hanya perlu dibaca sekali seumur
    // hidup tidak boleh memakan ruang setiap hari. Isinya dipindah ke `title`
    // tombol dan diringkas jadi satu baris pendek.
    <div className="mb-2 space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `type="button"`, BUKAN submit — dan ini perbaikan cacat, bukan selera
          (DECISIONS 342).

          Tombol submit PERTAMA di sebuah form adalah "default button"-nya:
          menekan Enter di kolom mana pun akan menekan tombol itu. Karena
          tombol cuaca berada paling awal, Enter di kolom "Diterima" material
          memanggil AMBIL CUACA, bukan menyimpan — dan karena aksi itu memasang
          ulang badan form, angka yang baru diketik ikut hilang tanpa pesan apa
          pun. Diukur di peramban: mengetik 41 lalu Enter mengembalikan 40.

          Lebih buruk lagi bila cuaca sudah diisi manual dari lapangan: form ini
          membawa `overwriteManual`, jadi satu ketukan Enter yang tidak disengaja
          bisa MENIMPA pengamatan orang lapangan dengan data otomatis — persis
          yang dilarang DECISIONS 176 ("isian manual lapangan selalu menang").

          Aksinya tetap sama, hanya pemicunya yang dipindah ke onClick: FormData
          dirakit dari form yang sama, jadi `reportId` & `overwriteManual` tetap
          ikut. Sesudah ini satu-satunya tombol submit di form adalah "Simpan
          Pelengkap" — jadi Enter MENYIMPAN, seperti yang diharapkan orang.
        */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={(e) => {
            const form = e.currentTarget.form;
            if (!form) return;
            formAction(new FormData(form));
          }}
          disabled={pending}
          title="Diambil dari koordinat lokasi, mengikuti TANGGAL laporan ini (bukan hari ini) – laporan yang diisi mundur tetap dapat cuaca tanggalnya."
        >
          {pending ? "Mengambil…" : hours ? "Muat ulang cuaca" : "Ambil cuaca otomatis"}
        </Button>
        <span className="min-w-0 text-xs text-ink-muted">
          {hours
            ? `${hours.length} jam terisi${rainHours > 0 ? ` · ${rainHours} jam hujan` : " · tanpa hujan"}`
            : "Sesuai tanggal laporan & koordinat lokasi."}
        </span>
      </div>
      {isManual ? (
        <input type="hidden" name="overwriteManual" value="1" />
      ) : null}
      {hours ? (
        <div className="overflow-x-auto">
          <div className="flex gap-0.5">
            {hours.map((h) => (
              <div key={h.hour} className="w-9 shrink-0 text-center">
                <div className="text-[10px] text-ink-muted">{String(h.hour).padStart(2, "0")}</div>
                <div className={`rounded px-1 py-0.5 text-[10px] font-medium ${CATEGORY_TONE[h.category]}`}>
                  {h.category === "Mendung" ? "Mdg" : h.category === "Hujan" ? "Hjn" : "Crh"}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {isManual && hours == null ? (
        <p className="text-xs text-ink-muted">
          Cuaca sudah diisi manual dari lapangan. Menekan tombol di atas akan menggantinya dengan data
          otomatis.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Kenapa `useActionState` ada DI SINI, bukan di badan form.
 *
 * Badan form sengaja dipasang ulang (lihat `key` di bawah) supaya id baris
 * material/alat yang baru dibuat server masuk ke input tersembunyi — tanpa itu
 * penyimpanan berikutnya akan mengirim id kosong dan membuat ulang barisnya,
 * yang berarti fotonya lepas (DECISIONS 304).
 *
 * Tapi pemasangan ulang juga MENGHAPUS state aksi. Akibatnya persis pada saat
 * yang paling penting — pertama kali orang mengisi material atau alat, saat
 * daftar id berubah dari kosong menjadi terisi — kotak "tersimpan" ikut musnah
 * sebelum sempat terbaca. Yang dilihat orang: menekan Simpan, lalu tidak ada
 * apa pun. Persis keluhan lapangan 2026-08-08: "sudah input material dan alat,
 * tapi sama sekali tidak muncul apa pun".
 *
 * Jadi state aksi ditaruh di komponen luar yang TIDAK ikut dipasang ulang,
 * dan badan form yang ber-`key` menerimanya sebagai prop.
 */
export function EnrichmentForm({
  report,
  locationId,
  fotoAktif,
}: {
  report: WorkspaceReport;
  /** Dipakai pemilih kantong Foto Cepat — kantong disaring per lokasi. */
  locationId: string;
  /** false = R2 mati / laporan tidak lagi bisa ditambahi foto. */
  fotoAktif: boolean;
}) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    saveEnrichmentAction,
    undefined,
  );
  const tandaTangan = [
    report.weather,
    report.workStart,
    report.workEnd,
    ...report.materials.map((m) => m.id),
    ...report.equipment.map((e) => e.id),
  ].join("|");

  return (
    <BadanForm
      key={tandaTangan}
      report={report}
      locationId={locationId}
      fotoAktif={fotoAktif}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function BadanForm({
  report,
  locationId,
  fotoAktif,
  state,
  formAction,
  pending,
}: {
  report: WorkspaceReport;
  locationId: string;
  fotoAktif: boolean;
  state: DailyActionState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const workerMap = new Map(report.workers.map((w) => [w.role, w.count]));
  const [materials, setMaterials] = useState<Row[]>(
    report.materials.length
      ? report.materials.map((m) => ({
          key: rowSeq++,
          id: m.id,
          name: m.name,
          a: m.unit ?? "",
          b: m.qty != null ? String(m.qty) : "",
        }))
      : [{ key: rowSeq++, id: "", name: "", a: "", b: "" }],
  );
  const [equipment, setEquipment] = useState<Row[]>(
    report.equipment.length
      ? report.equipment.map((e) => ({
          key: rowSeq++,
          id: e.id,
          name: e.name,
          a: String(e.count),
          b: "",
        }))
      : [{ key: rowSeq++, id: "", name: "", a: "1", b: "" }],
  );

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">Pelengkap laporan KKP</h2>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={report.id} />

      {/* Cuaca */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Cuaca</legend>
        <WeatherAuto report={report} />
        {/* Pemilih manual dimatikan sejak cuaca otomatis per jam berjalan
            (DECISIONS 177). Saat mati, form TIDAK mengirim field `weather`
            sama sekali sehingga server tahu harus membiarkan isian cuaca apa
            adanya — bukan mengosongkannya. */}
        {SHOW_MANUAL_WEATHER_PICKER ? (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {WEATHER_ORDER.map((w) => (
              <label
                key={w}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary-50 has-checked:font-medium"
              >
                <input
                  type="radio"
                  name="weather"
                  value={w}
                  defaultChecked={report.weather === w}
                  className="accent-primary"
                />
                {WEATHER_LABEL[w]}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      {/* Jam kerja */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="en-start">Jam mulai</Label>
          <Input id="en-start" name="workStart" type="time" defaultValue={report.workStart ?? ""} />
        </div>
        <div>
          <Label htmlFor="en-end">Jam selesai</Label>
          <Input id="en-end" name="workEnd" type="time" defaultValue={report.workEnd ?? ""} />
        </div>
      </div>

      {/* Tenaga per keahlian */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Tenaga kerja (per keahlian)</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WORKER_ROLE_ORDER.map((role) => (
            <div key={role}>
              <Label htmlFor={`w-${role}`} className="text-xs font-normal text-ink-muted">
                {WORKER_ROLE_LABEL[role]}
              </Label>
              <Input
                id={`w-${role}`}
                name={`worker_${role}`}
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={workerMap.get(role) ?? 0}
                className="tabular-nums"
              />
            </div>
          ))}
        </div>
      </fieldset>

      {/* Material masuk */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Pemasukan bahan / material</legend>
        <div className="space-y-2">
          {materials.map((row, idx) => (
            <div
              key={row.key}
              data-baris="material"
              className="space-y-1.5 rounded-md border border-border/70 bg-surface-muted/40 p-2"
            >
              {/* Nama mengambil BARIS SENDIRI di ponsel. Sebelumnya ia berbagi
                  satu baris dengan satuan + jumlah + tombol hapus, dan pada
                  layar 390px sisanya cuma ±100px: "Semen PCC 50kg" terbaca
                  "Seme". Nama material yang terpotong bukan kosmetik — itu yang
                  dipakai orang mencocokkan dengan surat jalan. */}
              <div className="flex flex-wrap items-end gap-2">
              {/* Larik di server sejajar per INDEKS, jadi tiap baris wajib
                  memancarkan id-nya — termasuk yang kosong (baris baru). */}
              <input type="hidden" name="materialId" value={row.id} />
              <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                <Label className="text-xs font-normal text-ink-muted">Nama</Label>
                <Input name="materialName" defaultValue={row.name} placeholder="mis. Semen 50kg" />
              </div>
              <div className="w-20">
                {/* Label di SETIAP baris, bukan cuma yang pertama: tiap baris
                    kini kartu tersendiri, dan "20" tanpa keterangan di kartu
                    ketiga tidak bisa dibaca sebagai apa pun. */}
                <Label className="text-xs font-normal text-ink-muted">Sat</Label>
                <Input name="materialUnit" defaultValue={row.a} placeholder="zak" />
              </div>
              <div className="min-w-0 flex-1 sm:w-24 sm:flex-none">
                {/* "Diterima" adalah kata BLANKO KKP, dan di sana ia berpasangan
                    dengan kolom "Ditolak" sehingga artinya jelas. Di layar input
                    pasangannya tidak ada, jadi "Diterima" berdiri sendiri dan
                    rancu — keluhan user 2026-08-17. Cetakan KKP TETAP memakai
                    "Diterima"/"Ditolak" karena blankonya begitu; yang diganti
                    hanya kata di layar. */}
                <Label className="text-xs font-normal text-ink-muted">Qty/Volume</Label>
                <Input name="materialQty" type="number" inputMode="decimal" step="0.001" min="0" defaultValue={row.b} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Hapus baris material"
                onClick={() => setMaterials((rows) => rows.filter((r) => r.key !== row.key))}
              >
                <X aria-hidden className="size-4" />
              </Button>
              </div>
              {/* Tiga sumber foto LANGSUNG di barisnya, dan fotonya ikut
                  "Simpan Pelengkap" — tanpa tombol antara, tanpa aksi
                  tersendiri (DECISIONS 343). */}
              {fotoAktif ? (
                <FotoBarisPelengkap
                  awalan={`m${idx}_`}
                  locationId={locationId}
                  label={row.name}
                  foto={fotoBaris(report.materials, row.id)}
                  bolehHapus={fotoAktif}
                  sunyiIzin={idx > 0}
                />
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMaterials((rows) => [...rows, { key: rowSeq++, id: "", name: "", a: "", b: "" }])}
          >
            <Plus aria-hidden className="size-4" />
            Tambah material
          </Button>
        </div>
      </fieldset>

      {/* Peralatan */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Peralatan</legend>
        <div className="space-y-2">
          {equipment.map((row, idx) => (
            <div
              key={row.key}
              data-baris="alat"
              className="space-y-1.5 rounded-md border border-border/70 bg-surface-muted/40 p-2"
            >
              <div className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="equipmentId" value={row.id} />
              <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                <Label className="text-xs font-normal text-ink-muted">Nama alat</Label>
                <Input name="equipmentName" defaultValue={row.name} placeholder="mis. Molen beton" />
              </div>
              <div className="min-w-0 flex-1 sm:w-24 sm:flex-none">
                <Label className="text-xs font-normal text-ink-muted">Jumlah</Label>
                <Input name="equipmentCount" type="number" inputMode="numeric" min={1} defaultValue={row.a || "1"} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Hapus baris alat"
                onClick={() => setEquipment((rows) => rows.filter((r) => r.key !== row.key))}
              >
                <X aria-hidden className="size-4" />
              </Button>
              </div>
              {fotoAktif ? (
                <FotoBarisPelengkap
                  awalan={`a${idx}_`}
                  locationId={locationId}
                  label={row.name}
                  foto={fotoBaris(report.equipment, row.id)}
                  bolehHapus={fotoAktif}
                  sunyiIzin
                />
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEquipment((rows) => [...rows, { key: rowSeq++, id: "", name: "", a: "1", b: "" }])}
          >
            <Plus aria-hidden className="size-4" />
            Tambah alat
          </Button>
        </div>
      </fieldset>

      {/* Catatan */}
      <div>
        <Label htmlFor="en-notes">Catatan / keterangan</Label>
        <Textarea id="en-notes" name="notes" maxLength={2000} defaultValue={report.notes ?? ""} />
      </div>

      {/* Kabar hasil DIULANG di sisi tombol. Formulir ini panjang: di ponsel,
          tombol Simpan ada di dasar layar sementara kotak kabar di puncaknya
          berada belasan layar ke atas — tidak akan terbaca tanpa menggulung
          balik. Kabar harus muncul di tempat mata sedang memandang. */}
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        Simpan Pelengkap
      </Button>
    </form>
  );
}
