"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Banner, Button, FileInput, HelpText, Label, Textarea } from "@/components/ui";
import { tahanGagalKirim } from "@/lib/aksi-klien";
import { formatRupiah } from "@/lib/format";
import { importHps, type BedaPratinjau, type ImportMode, type ImportState } from "./actions";

/**
 * Impor RAB 2 langkah tanpa perlu unggah ulang: file disimpan di STATE klien,
 * jadi "Simpan" memakai file yang sama dgn pratinjau. Memilih file baru otomatis
 * mereset ke mode Pratinjau (isi bisa berubah — jangan langsung simpan).
 */
export function ImportForm({
  locationId,
  adaAktif,
  modeAwal,
}: {
  locationId: string;
  /**
   * Lokasi sudah punya revisi RAB aktif — menentukan tujuan bawaan & kuncinya.
   *
   * WAJIB, tanpa nilai bawaan. Sebelumnya `= false`, dan halaman adendum lupa
   * mengisinya: pilihan "Isi DRAFT adendum" jadi terkunci dengan alasan "Belum
   * ada RAB aktif" tepat di halaman yang hanya muncul KARENA ada RAB aktif.
   * Bawaan yang diam-diam salah lebih buruk daripada tidak ada bawaan.
   */
  adaAktif: boolean;
  /** "draft" = halaman adendum: isi draft, JANGAN sentuh RAB aktif. */
  modeAwal?: ImportMode;
}) {
  /**
   * Tujuan bawaan MENGIKUTI KEADAAN, bukan konstanta (DECISIONS 232).
   *
   * Belum ada RAB aktif → satu-satunya yang masuk akal "Jadikan RAB AKTIF":
   * draft adendum disalin DARI RAB aktif, jadi tanpa RAB aktif ia tidak punya
   * dasar apa pun.
   *
   * Sudah ada RAB aktif → bawaannya "Isi DRAFT adendum". Dulu bawaannya
   * "aktifkan" dan itu pilihan yang salah untuk dipasang lebih dulu: satu
   * ketukan tanpa membaca akan MENGGANTI RAB kontrak yang berlaku dan
   * me-regenerate kurva-S. Pilihan bawaan yang merusak bukan kenyamanan.
   */
  const bawaan: ImportMode = modeAwal ?? (adaAktif ? "draft" : "aktifkan");
  const [mode, setMode] = useState<ImportMode>(bawaan);
  /**
   * Pilihan yang tidak sesuai keadaan DIKUNCI, bukan dihilangkan — permintaan
   * user 2026-08-03: "jangan dihapus, tapi kamu kunci saja, mungkin suatu saat
   * aku butuh". Menghapusnya berarti jalan yang sah (mengimpor adendum yang
   * SUDAH resmi, atau memperbaiki HPS awal yang salah) hilang tanpa jejak.
   */
  const [bukaKunci, setBukaKunci] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [state, setState] = useState<ImportState>(undefined);
  const [pending, startTransition] = useTransition();
  const preview = state?.preview;

  function run(confirm: boolean) {
    if (!file) {
      setState({ error: "Pilih file HPS/RAB (.xlsx) dulu." });
      return;
    }
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("file", file);
    fd.set("note", note);
    fd.set("mode", mode);
    if (confirm && preview) {
      fd.set("confirm", "1");
      fd.set("previewSha", preview.sha256);
    }
    startTransition(async () => {
      // DIBUNGKUS: aksi ini dipanggil telanjang, jadi kegagalan MENGIRIM
      // (bukan kegagalan impor) melempar keluar dari transisi dan meruntuhkan
      // seluruh halaman — berkas yang sudah dipilih, catatan yang sudah
      // diketik, dan pratinjau yang sudah dihitung ikut hilang. Laporan user
      // 2026-08-07 di /rab/adendum persis begitu. DECISIONS 295.
      const res = await tahanGagalKirim(importHps)(undefined, fd);
      setState(res);
      // Sukses simpan → bersihkan agar tidak tersimpan dobel.
      if (res?.success) {
        setFile(null);
        setNote("");
        setInputKey((k) => k + 1);
      }
    });
  }

  function onPilih(files: File[]) {
    // Batas ukuran diperiksa FileInput (dan pesannya tampil di sana); di sini
    // cukup mengikuti hasilnya. Berkas ditahan di state karena form ini
    // menyusun FormData sendiri untuk langkah pratinjau.
    setFile(files[0] ?? null);
    // Berkas baru → buang pratinjau lama; tombol kembali jadi "Pratinjau".
    setState(undefined);
  }

  return (
    <div className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {preview?.notice ? <Banner tone="warning" title={preview.notice} /> : null}

      <div>
        <Label htmlFor="hps-file" required>File HPS / RAB (.xlsx)</Label>
        <FileInput
          key={inputKey}
          id="hps-file"
          name="file"
          accept=".xlsx,.xls"
          required
          maxBytes={15 * 1024 * 1024}
          onPilih={onPilih}
          petunjuk={'Sheet "RAB" dibaca otomatis. Maksimal 15 MB.'}
        />
      </div>

      <fieldset className="rounded-md border border-border p-3">
        <legend className="px-1 text-[13px] font-medium text-ink">Tujuan impor</legend>
        {/* Sebelum ini hanya ada satu jalur: impor SELALU mengaktifkan. Adendum
            yang masih diajukan terpaksa diperlakukan seolah sudah sah. */}
        <div className="space-y-2">
          {(
            [
              ["draft", "Isi DRAFT adendum", "RAB aktif, progres, kurva-S, dan keuangan TIDAK berubah. Draft baru berlaku setelah diaktifkan."],
              ["aktifkan", "Jadikan RAB AKTIF sekarang", "Menggantikan RAB aktif dan me-regenerate kurva-S. Untuk HPS awal atau adendum yang SUDAH resmi."],
            ] as const
          ).map(([nilai, judul, jelas]) => {
            // Kunci mengikuti keadaan, dan alasannya SELALU disebut — pilihan
            // yang mati tanpa keterangan cuma bikin orang menebak.
            const terkunci =
              nilai === "draft"
                ? !adaAktif // tidak ada RAB untuk diadendum
                : adaAktif && !bukaKunci; // mengganti RAB kontrak yang berlaku
            const sebab =
              nilai === "draft"
                ? "Belum ada RAB aktif – draft adendum disalin dari RAB aktif, jadi belum ada yang bisa diadendum."
                : "Terkunci karena lokasi ini sudah punya RAB aktif.";
            return (
              <label
                key={nilai}
                className={`flex items-start gap-2 text-[13px] ${terkunci ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="radio"
                  name="mode"
                  className="mt-0.5"
                  checked={mode === nilai}
                  disabled={terkunci}
                  onChange={() => {
                    setMode(nilai);
                    setState(undefined); // pratinjau lama menggambarkan tujuan lain
                  }}
                />
                <span>
                  <span className="font-medium text-ink">{judul}</span>
                  <span className="block text-ink-muted">{jelas}</span>
                  {terkunci ? <span className="mt-0.5 block text-warning">{sebab}</span> : null}
                </span>
              </label>
            );
          })}
          {/* Jalan keluarnya ADA, tapi harus disengaja: satu ketukan tambahan
              plus kalimat yang menyebut akibatnya. */}
          {adaAktif && !bukaKunci ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setBukaKunci(true)}
              className="self-start"
            >
              <KeyRound aria-hidden className="size-3.5" />
              Buka kunci &quot;Jadikan RAB AKTIF sekarang&quot;
            </Button>
          ) : null}
          {adaAktif && bukaKunci ? (
            <p className="text-[13px] text-warning">
              Kunci dibuka. Menyimpan dengan tujuan ini akan MENGGANTI RAB aktif dan me-regenerate
              kurva-S. Pakai hanya bila adendumnya memang sudah resmi.
            </p>
          ) : null}
        </div>
      </fieldset>

      {preview ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
          <Banner
            tone={preview.mode === "draft" ? "info" : preview.isAdendum ? "warning" : "info"}
            title={
              preview.mode === "draft"
                ? preview.draftAda
                  ? `Isi draft adendum revisi #${preview.draftAda.revisionNo} akan DIGANTI`
                  : "Draft adendum baru akan dibuat"
                : preview.isAdendum
                  ? "Terdeteksi ADENDUM – lokasi sudah punya revisi RAB aktif"
                  : "Impor HPS awal – belum ada revisi RAB aktif"
            }
            description={
              preview.mode === "draft"
                ? "RAB aktif, progres, kurva-S, dan keuangan tidak tersentuh. Draft ini baru berlaku setelah diaktifkan lewat halaman Adendum."
                : preview.isAdendum
                  ? "Revisi baru akan menggantikan revisi aktif; realisasi item dgn lineage sama tersambung otomatis, dan baseline kurva-S di-regenerate."
                  : "Revisi #1 akan dibuat dan baseline kurva-S dibuat otomatis."
            }
          />

          {preview.beda ? <PanelBeda beda={preview.beda} /> : null}

          <div className="text-sm text-ink">
            <p className="font-medium">
              {preview.fileName}{" "}
              <span className="font-normal text-ink-muted">
                ({(preview.bytes / 1024).toFixed(0)} KB · {preview.itemCount} item pekerjaan)
              </span>
            </p>
            {/* Sumber harga WAJIB terlihat sebelum commit — lampiran negosiasi memuat
                tiga blok harga (HPS/penawaran/negosiasi) dan salah blok = nilai
                kontrak salah puluhan sampai ratusan juta. */}
            <p className="mt-1 text-ink-muted">
              Harga dibaca dari kolom{" "}
              <span className="font-semibold text-ink">{preview.priceColumnLabel}</span>
              {preview.priceSource === "hps"
                ? " – file tidak punya kolom penawaran/negosiasi."
                : " – bukan pagu HPS."}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-1.5 pr-3">Kode</th>
                  <th className="py-1.5 pr-3">Kategori</th>
                  <th className="py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.categories.map((c) => (
                  <tr key={c.code}>
                    <td className="py-1.5 pr-3 text-ink-muted">{c.code}</td>
                    <td className="py-1.5 pr-3">{c.name}</td>
                    <td className="tabular py-1.5 text-right">{formatRupiah(Number(c.total))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={2} className="py-1.5 pr-3 text-right font-semibold">
                    Grand total (pra-PPN)
                  </td>
                  <td className="tabular py-1.5 text-right font-semibold">
                    {formatRupiah(Number(preview.grandTotal))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {preview.warnings.length > 0 ? (
            <Banner
              tone="warning"
              title={`${preview.warnings.length} peringatan parsing`}
              description={
                <ul className="list-disc pl-4">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          <div>
            <Label htmlFor="hps-note">Catatan revisi (opsional)</Label>
            <Textarea
              id="hps-note"
              name="note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. Adendum CCO-01, perubahan volume revetment"
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {preview ? (
          <>
            <Button type="button" loading={pending} onClick={() => run(true)}>
              {preview.mode === "draft" ? "Simpan ke draft adendum" : "Simpan & aktifkan revisi"}
            </Button>
            <Button type="button" variant="secondary" loading={pending} onClick={() => run(false)}>
              Pratinjau ulang
            </Button>
          </>
        ) : (
          <Button type="button" loading={pending} disabled={!file} onClick={() => run(false)}>
            Pratinjau
          </Button>
        )}
      </div>
    </div>
  );
}

/** Apa yang berubah terhadap RAB aktif — ditampilkan SEBELUM ada yang ditulis. */
function PanelBeda({ beda }: { beda: BedaPratinjau }) {
  const selisih = Number(beda.totalBaru) - Number(beda.totalAktif);
  const berisiko = beda.itemHilang.filter((i) => i.realisasi > 0);
  const dibawah = beda.volumeBerubah.filter((v) => v.dibawahRealisasi);
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3 text-[13px]">
      <p className="font-medium text-ink">Perubahan terhadap RAB aktif</p>
      <p className="text-ink-muted">
        Nilai: <span className="tabular">{formatRupiah(Number(beda.totalAktif))}</span> →{" "}
        <span className="tabular font-medium text-ink">{formatRupiah(Number(beda.totalBaru))}</span>{" "}
        <span className={selisih === 0 ? "" : selisih > 0 ? "text-warning" : "text-danger"}>
          ({selisih >= 0 ? "+" : "−"}
          {formatRupiah(Math.abs(selisih))})
        </span>
      </p>
      <p className="text-ink-muted">
        {beda.itemBaru.length} item baru · {beda.volumeBerubah.length} volume berubah ·{" "}
        {beda.itemHilang.length} item hilang · {beda.jumlahTetap} tetap
      </p>

      {/* Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). Adendum
          mengubah volume; harga yang sudah disepakati seharusnya tetap. Ini
          disebut terpisah karena bisa terjadi TANPA satu pun volume berubah —
          bentuk yang paling mudah lolos dari pemeriksaan sepintas. */}
      {beda.hargaBerubah.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            Harga satuan {beda.hargaBerubah.length} item KONTRAK LAMA berubah
          </p>
          <p className="mt-0.5 text-ink-muted">
            Adendum mengubah volume – harga item yang sudah ada di kontrak seharusnya tetap. Dampak
            neto{" "}
            <span className="tabular font-medium">
              {formatRupiah(Number(beda.hargaBerubah.reduce((t, h) => t + BigInt(h.dampakRupiah), 0n)))}
            </span>{" "}
            tanpa ada pekerjaan yang bertambah.
          </p>
          <ul className="mt-1 list-disc pl-4 text-ink-muted">
            {beda.hargaBerubah.slice(0, 8).map((h) => (
              <li key={h.lineageKey}>
                {h.code} {h.name} – <span className="tabular">{h.dari ?? "–"}</span> →{" "}
                <span className="tabular">{h.ke ?? "–"}</span> (
                {Number(h.dampakRupiah) >= 0 ? "+" : "−"}
                {formatRupiah(Math.abs(Number(h.dampakRupiah)))})
              </li>
            ))}
            {beda.hargaBerubah.length > 8 ? (
              <li>+{beda.hargaBerubah.length - 8} lainnya</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {/* Yang paling mahal disebut lebih dulu: pekerjaan yang SUDAH dikerjakan
          tapi tidak ada di file baru — realisasinya lepas dari RAB. */}
      {berisiko.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            {berisiko.length} item yang SUDAH dikerjakan tidak ada di file ini
          </p>
          <ul className="mt-1 list-disc pl-4 text-ink-muted">
            {berisiko.slice(0, 8).map((i) => (
              <li key={i.code + i.name}>
                {i.code} {i.name} – realisasi {i.realisasi}
              </li>
            ))}
            {berisiko.length > 8 ? <li>+{berisiko.length - 8} lainnya</li> : null}
          </ul>
        </div>
      ) : null}

      {dibawah.length > 0 ? (
        <div className="rounded border border-danger-border bg-danger-soft px-2.5 py-2">
          <p className="font-medium text-danger">
            {dibawah.length} item volumenya turun DI BAWAH yang sudah dikerjakan
          </p>
          <ul className="mt-1 list-disc pl-4 text-ink-muted">
            {dibawah.slice(0, 8).map((v) => (
              <li key={v.code + v.name}>
                {v.code} {v.name} – {v.dari} → {v.ke}, sudah dikerjakan {v.realisasi}
              </li>
            ))}
            {dibawah.length > 8 ? <li>+{dibawah.length - 8} lainnya</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
