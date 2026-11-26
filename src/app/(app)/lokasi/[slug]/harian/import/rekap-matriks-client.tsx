"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { Badge, Banner, Button, Card, CardBody, CardHeader, Combobox, ConfirmSubmit, useAksiKlik } from "@/components/ui";
import { formatNumber, formatTanggal } from "@/lib/format";
import { masukanRencana, type BahanPratinjau } from "@/lib/daily-report/rekap-matriks/masukan";
import { susunRencana, type PerubahanSel, type RencanaItem } from "@/lib/daily-report/rekap-matriks/rencana";
import type { ModeImpor, PilihanBentrok } from "@/lib/daily-report/rekap-matriks/jenis";
import { pratinjauRekapMatriksAction, simpanRekapMatriksAction, type RekapMatriksState } from "./actions";

/**
 * IMPOR REKAP HARIAN – sheet "REKAP HARIAN" (matriks pekerjaan × tanggal),
 * DECISIONS 782.
 *
 * Rencana disusun DI LAYAR dari bahan pratinjau tiap kali orang mengubah mode,
 * item tujuan, atau pilihan bentrok – berkasnya tidak diunggah ulang. Saat
 * menyimpan, server menyusunnya ulang dan menolak bila hasilnya berbeda dari
 * yang dilihat di sini.
 */

const tgl = (k: string) => formatTanggal(new Date(`${k}T00:00:00.000Z`), "d MMM yyyy");
const sat = (u: string | null) => (u ? ` ${u}` : "");

const LABEL_PILIHAN: Record<PilihanBentrok, string> = {
  lewati: "Lewati – biarkan seperti di MARLIN",
  excel: "Ikuti Excel – tanggal yang hanya ada di MARLIN dinolkan, fotonya tetap",
  jumlahkan: "Jumlahkan – angka Excel ditambahkan, yang di MARLIN tetap",
  potong: "Ikuti Excel, dipotong rata sampai volume kontrak",
};

const LABEL_AKSI: Record<PerubahanSel["aksi"], string> = { tambah: "Ditambah", ubah: "Disesuaikan", nolkan: "Dinolkan" };

function Sel({ p, unit, fotoPindah }: { p: PerubahanSel; unit: string | null; fotoPindah: number }) {
  const fotoTinggal = p.foto - fotoPindah;
  return (
    <li className={p.ditahan ? "text-ink-faint" : "text-ink"}>
      <span className="tabular-nums">{tgl(p.tanggal)}</span> · {LABEL_AKSI[p.aksi]}{" "}
      <span className="tabular-nums">
        {p.dari == null ? "" : `${formatNumber(p.dari)} → `}
        {formatNumber(p.ke)}
        {sat(unit)}
      </span>
      {p.aksi === "nolkan" ? (
        <span className="text-ink-muted">
          {" "}
          (barisnya tetap{fotoTinggal > 0 ? `, ${fotoTinggal} foto tetap di tempatnya` : ""})
        </span>
      ) : null}
      {p.catatan && !p.ditahan ? <span className="text-ink-muted"> – {p.catatan}</span> : null}
      {p.ditahan ? <span className="text-warning"> – ditahan: {p.ditahan}</span> : null}
    </li>
  );
}

function KartuItem({
  it,
  nilai,
  pilih,
}: {
  it: RencanaItem;
  /** Pilihan yang sedang dipakai untuk item bentrok. */
  nilai: PilihanBentrok | null;
  pilih: (v: PilihanBentrok) => void;
}) {
  return (
    <li className="space-y-1.5 px-3 py-3 text-[13px]">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {it.jalur ? <span className="text-xs text-ink-muted">{it.jalur}</span> : null}
          {it.bentrok.length > 0 ? <Badge tone="warning">Bentrok</Badge> : null}
          {it.ditahanSemua ? <Badge tone="neutral">Ditahan</Badge> : null}
        </div>
        <p className="font-medium text-ink">{it.nama}</p>
        <p className="text-xs text-ink-muted">
          Baris Excel {it.excelRows.join(", ")} · Excel {formatNumber(it.totalExcel)}
          {sat(it.unit)} · di MARLIN sekarang {formatNumber(it.totalSekarang)}
          {sat(it.unit)} · sesudah impor {formatNumber(it.totalSesudah)}
          {sat(it.unit)}
          {it.volumeKontrak != null ? ` · kontrak ${formatNumber(it.volumeKontrak)}${sat(it.unit)}` : ""}
        </p>
      </div>
      {it.bentrok.includes("beda_tanggal") ? (
        <p className="text-xs text-warning">
          Excel mencatat {it.hanyaExcel.map(tgl).join(", ")}, MARLIN mencatat {it.hanyaMarlin.map(tgl).join(", ")}. Tanggalnya
          berbeda: bisa jadi pekerjaan yang sama dicatat di hari yang berbeda.
        </p>
      ) : null}
      {it.bentrok.includes("melebihi_kontrak") ? (
        <p className="text-xs text-warning">
          Kalau diterapkan begitu saja hasilnya {formatNumber(it.totalBawaan)}
          {sat(it.unit)}, di atas volume kontrak {formatNumber(it.volumeKontrak ?? 0)}
          {sat(it.unit)}.
        </p>
      ) : null}
      {it.bentrok.length > 0 ? (
        <fieldset className="space-y-1">
          <legend className="sr-only">Pilihan untuk {it.nama}</legend>
          {it.pilihanTersedia.map((v) => (
            <label key={v} className="flex items-start gap-2 text-xs text-ink">
              <input
                type="radio"
                name={`pilihan-${it.lineageKey}`}
                value={v}
                checked={nilai === v}
                onChange={() => pilih(v)}
                className="mt-0.5"
              />
              <span>{LABEL_PILIHAN[v]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {it.ditahanSemua ? <p className="text-xs text-warning">{it.ditahanSemua}</p> : null}
      {it.perubahan.length > 0 ? (
        <ul className="space-y-0.5 text-xs">
          {it.perubahan.map((p) => (
            <Sel
              key={p.tanggal}
              p={p}
              unit={it.unit}
              fotoPindah={it.pindahFoto.filter((f) => f.dari === p.tanggal).reduce((t, f) => t + f.jumlah, 0)}
            />
          ))}
        </ul>
      ) : it.bentrok.length === 0 ? (
        <p className="text-xs text-ink-muted">Sudah sama dengan Excel – tidak ada yang berubah.</p>
      ) : null}
      {it.pindahFoto.map((f) => (
        <p key={`${f.dari}-${f.ke}`} className="text-xs text-ink">
          {f.jumlah} foto pindah dari {tgl(f.dari)} ke {tgl(f.ke)}.
        </p>
      ))}
      {it.fotoTetap.map((f) => (
        <p key={`${f.dari}-${f.sebab}`} className="text-xs text-ink-muted">
          {f.jumlah} foto tetap di {tgl(f.dari)}: {f.sebab}.
        </p>
      ))}
      {it.catatan.map((c) => (
        <p key={c} className="text-xs text-ink-muted">
          {c}
        </p>
      ))}
    </li>
  );
}

export function RekapMatriksClient({ locationId, slug, hasRab }: { locationId: string; slug: string; hasRab: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  // Berkas yang terakhir dibaca. Pratinjau hanya berlaku untuk berkas itu:
  // memilih berkas lain menyembunyikannya sampai berkas baru dibaca.
  const [fileDibaca, setFileDibaca] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ModeImpor>("tambah");
  const [pindahFoto, setPindahFoto] = useState(false);
  const [tujuan, setTujuan] = useState<Record<number, string>>({});
  const [pilihan, setPilihan] = useState<Record<string, PilihanBentrok>>({});
  const gagal = (pesan: string): RekapMatriksState => ({ ok: false, error: pesan });
  const [baca, aksiBaca, membaca] = useAksiKlik<RekapMatriksState>(pratinjauRekapMatriksAction, undefined, gagal);
  const [simpan, aksiSimpan, menyimpan] = useAksiKlik<RekapMatriksState>(simpanRekapMatriksAction, undefined, gagal);

  const selesai = simpan?.ok && simpan.fase === "selesai" ? simpan.hasil : null;
  const berkasSama = file != null && file === fileDibaca;
  const bahan: BahanPratinjau | null = berkasSama && baca?.ok && baca.fase === "pratinjau" && !selesai ? baca.bahan : null;
  const rencana = useMemo(
    () => (bahan ? susunRencana(masukanRencana(bahan, { mode, tujuan, pilihan, pindahFoto })) : null),
    [bahan, mode, tujuan, pilihan, pindahFoto],
  );
  const opsiItem = useMemo(
    () => [
      { value: "lewati", label: "Lewati baris ini" },
      ...(bahan?.daun ?? []).map((d) => ({ value: d.lineageKey, label: `${d.jalur} ${d.name}${d.unit ? ` – ${d.unit}` : ""}` })),
    ],
    [bahan],
  );

  const formDasar = () => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("locationId", locationId);
    fd.set("slug", slug);
    return fd;
  };

  if (!hasRab) return <Banner tone="warning" title="Lokasi ini belum punya RAB aktif, jadi rekap belum bisa dicocokkan." />;

  if (selesai) {
    return (
      <Card>
        <CardHeader title="Rekap harian tersimpan" />
        <CardBody className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-success">
            <CheckCircle2 aria-hidden className="size-5" />
            {selesai.tambah} ditambah, {selesai.ubah} disesuaikan, {selesai.nolkan} dinolkan
            {selesai.laporanBaru > 0 ? `, ${selesai.laporanBaru} laporan baru dikirim untuk verifikasi` : ""}
            {selesai.fotoDipindah > 0 ? `, ${selesai.fotoDipindah} foto dipindah ke tanggal Excel` : ""}
            {selesai.nihilDibatalkan > 0 ? `, ${selesai.nihilDibatalkan} pernyataan "tidak ada kegiatan" dibatalkan` : ""}.
          </p>
          {selesai.blankoDibangunUlang > 0 ? (
            <p className="text-ink-muted">{selesai.blankoDibangunUlang} blanko harian final ikut diperbarui.</p>
          ) : null}
          {selesai.laporanBaruTetapDraft.length > 0 ? (
            <Banner
              tone="warning"
              title={`${selesai.laporanBaruTetapDraft.length} laporan baru tetap draft`}
              description={selesai.laporanBaruTetapDraft.map((x) => `${tgl(x.tanggal)}: ${x.sebab}`).join(" · ")}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link href={`/lokasi/${slug}/harian`} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800">
              Ke Pelaksanaan Harian
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  const perluDipilih = bahan
    ? bahan.baris.filter((b) => {
        const t = tujuan[b.excelRow];
        if (t === "lewati") return false;
        return !(t ?? bahan.cocok[b.excelRow]?.lineageKey);
      })
    : [];
  const bentrok = rencana?.item.filter((i) => i.bentrok.length > 0) ?? [];
  const berubah = rencana?.item.filter((i) => i.bentrok.length === 0 && i.perubahan.length > 0) ?? [];
  const sama = rencana?.item.filter((i) => i.bentrok.length === 0 && i.perubahan.length === 0).length ?? 0;
  const jumlahTulis = rencana ? rencana.ringkas.tambah + rencana.ringkas.ubah + rencana.ringkas.nolkan : 0;

  return (
    <Card>
      <CardHeader
        title="Rekap harian dari Excel (sheet REKAP HARIAN)"
        subtitle="Satu baris per pekerjaan, satu kolom per tanggal. Hanya kolom dan baris yang terlihat yang dibaca."
      />
      <CardBody className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setTujuan({});
              setPilihan({});
            }}
          />
          <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            <FileUp aria-hidden className="size-3.5" /> Pilih berkas Excel…
          </Button>
          {file ? (
            <span className="min-w-0 max-w-64 truncate text-xs text-ink-muted">{file.name}</span>
          ) : (
            <span className="text-xs text-ink-muted">Belum ada berkas</span>
          )}
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-[13px] font-medium text-ink">Cara memasukkan</legend>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="radio" name="mode-rekap" checked={mode === "tambah"} onChange={() => setMode("tambah")} className="mt-1" />
            <span>
              <strong className="text-ink">Tambah</strong>
              <span className="text-ink-muted">
                {" "}
                – angka di MARLIN tetap. Tanggal yang belum ada ditambahkan, tanggal yang sama disesuaikan ke Excel.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="radio" name="mode-rekap" checked={mode === "timpa"} onChange={() => setMode("timpa")} className="mt-1" />
            <span>
              <strong className="text-ink">Timpa</strong>
              <span className="text-ink-muted">
                {" "}
                – Excel jadi patokan untuk pekerjaan yang ada angkanya di Excel. Tanggal yang hanya ada di MARLIN (sampai
                tanggal terakhir di Excel) dinolkan. Barisnya tidak dihapus.
              </span>
            </span>
          </label>
        </fieldset>

        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={pindahFoto} onChange={(e) => setPindahFoto(e.target.checked)} className="mt-1" />
          <span>
            <strong className="text-ink">Pindahkan foto ke tanggal Excel</strong>
            <span className="text-ink-muted">
              {" "}
              – foto di baris yang dinolkan ikut ke tanggal Excel pekerjaan yang sama yang paling dekat dengan waktu
              jepretnya. Cap tanggal di foto tidak berubah. Tanpa centang, foto tetap di tanggal lamanya.
            </span>
          </span>
        </label>

        <div className="space-y-1.5 border-t border-border pt-3">
          <Button
            type="button"
            size="sm"
            variant={bahan ? "secondary" : "primary"}
            loading={membaca}
            disabled={!file}
            onClick={() => {
              setFileDibaca(file);
              aksiBaca(formDasar());
            }}
          >
            <Upload aria-hidden className="size-3.5" /> Baca berkas
          </Button>
          <p className="text-xs text-ink-muted">
            {bahan
              ? "Cara memasukkan dan pilihan foto bisa diganti kapan saja – pratinjau di bawah langsung ikut berubah, berkas tidak perlu dibaca lagi."
              : file
                ? "Belum ada yang disimpan. Pratinjau muncul di bawah, lalu Anda yang memutuskan."
                : "Pilih berkas Excel dulu."}
          </p>
        </div>

        {berkasSama && baca && !baca.ok ? <Banner tone="error" title={baca.error} /> : null}
        {berkasSama && simpan && !simpan.ok ? <Banner tone="error" title={simpan.error} /> : null}

        {bahan && rencana ? (
          <div className="space-y-4">
            <p className="text-ink-muted">
              Sheet &quot;{bahan.sheet}&quot;: {bahan.kolomTanggal} kolom tanggal terlihat mulai {tgl(bahan.awalPeriode)}
              {bahan.akhirPeriode ? `, angka terisi sampai ${tgl(bahan.akhirPeriode)}` : ""}. {bahan.baris.length} pekerjaan berisi
              angka.
            </p>
            {bahan.tersembunyi.length > 0 ? (
              <Banner
                tone="warning"
                title="Ada angka di kolom tanggal yang disembunyikan – tidak dibaca"
                description={bahan.tersembunyi.map((t) => `${tgl(t.tanggal)} (${t.sel} sel)`).join(", ")}
              />
            ) : null}
            {bahan.barisTersembunyi.length > 0 ? (
              <Banner
                tone="warning"
                title="Ada baris tersembunyi yang berisi angka – tidak dibaca"
                description={`Baris ${bahan.barisTersembunyi.join(", ")}`}
              />
            ) : null}
            {bahan.teksDiSelTanggal.length > 0 ? (
              <Banner
                tone="warning"
                title="Ada tulisan (bukan angka) di kolom tanggal – tidak dibaca"
                description={bahan.teksDiSelTanggal.map((t) => `${t.kolom}${t.excelRow}: "${t.isi}"`).join(", ")}
              />
            ) : null}

            {perluDipilih.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-ink">Perlu dipilih ({perluDipilih.length})</h3>
                <p className="text-xs text-ink-muted">Baris ini tidak ditebak supaya volumenya tidak masuk ke pekerjaan yang salah.</p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {perluDipilih.map((b) => {
                    const c = bahan.cocok[b.excelRow];
                    return (
                      <li key={b.excelRow} className="space-y-1.5 px-3 py-3 text-[13px]">
                        <p className="font-medium text-ink">
                          Baris {b.excelRow}: {b.nama}
                          {b.satuan ? ` (${b.satuan})` : ""}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {b.sel.map((s) => `${tgl(s.tanggal)} ${formatNumber(s.volume)}`).join(" · ")}
                        </p>
                        {c && c.lineageKey === null ? <p className="text-xs text-warning">{c.sebab}</p> : null}
                        <Combobox
                          id={`tujuan-rekap-${b.excelRow}`}
                          value={tujuan[b.excelRow] ?? ""}
                          onChange={(v) => setTujuan((t) => ({ ...t, [b.excelRow]: v }))}
                          options={opsiItem}
                          placeholder="Pilih item RAB aktif…"
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {bentrok.length > 0 ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-ink">Bentrok ({bentrok.length})</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setPilihan((p) => ({
                          ...p,
                          ...Object.fromEntries(bentrok.filter((i) => i.pilihanTersedia.includes("excel")).map((i) => [i.lineageKey, "excel"])),
                        }))
                      }
                    >
                      Semua: ikuti Excel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setPilihan((p) => ({ ...p, ...Object.fromEntries(bentrok.map((i) => [i.lineageKey, "lewati"])) }))}
                    >
                      Semua: lewati
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-ink-muted">Tidak diputuskan sendiri. Bawaannya dilewati sampai Anda memilih.</p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {bentrok.map((it) => (
                    <KartuItem
                      key={it.lineageKey}
                      it={it}
                      nilai={it.pilihan}
                      pilih={(v) => setPilihan((p) => ({ ...p, [it.lineageKey]: v }))}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {berubah.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-ink">Akan berubah ({berubah.length} pekerjaan)</h3>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {berubah.map((it) => (
                    <KartuItem key={it.lineageKey} it={it} nilai={null} pilih={() => {}} />
                  ))}
                </ul>
              </section>
            ) : null}
            {sama > 0 ? <p className="text-xs text-ink-muted">{sama} pekerjaan sudah sama dengan Excel.</p> : null}

            <div className="space-y-2 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-[13px]">
              <p className="text-ink">
                {rencana.ringkas.tambah} ditambah · {rencana.ringkas.ubah} disesuaikan · {rencana.ringkas.nolkan} dinolkan
                {rencana.ringkas.ditahan > 0 ? ` · ${rencana.ringkas.ditahan} ditahan` : ""}
                {rencana.ringkas.itemDilewati > 0 ? ` · ${rencana.ringkas.itemDilewati} baris Excel dilewati` : ""}
              </p>
              {rencana.ringkas.laporanBaru.length > 0 ? (
                <p className="text-xs text-ink-muted">
                  Laporan baru dibuat dan dikirim untuk verifikasi: {rencana.ringkas.laporanBaru.map(tgl).join(", ")}.
                </p>
              ) : null}
              <p className="text-xs text-ink-muted">
                {rencana.ringkas.fotoDipindah > 0
                  ? `${rencana.ringkas.fotoDipindah} foto dipindah ke tanggal Excel, cap tanggalnya tetap. Foto lain tidak disentuh.`
                  : "Foto yang sudah ada tidak disentuh."}{" "}
                Baris laporan tidak ada yang dihapus.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = formDasar();
                  fd.set("mode", mode);
                  fd.set("tujuan", JSON.stringify(tujuan));
                  fd.set("pilihan", JSON.stringify(pilihan));
                  fd.set("sidik", rencana.sidik);
                  if (pindahFoto) fd.set("pindahFoto", "1");
                  aksiSimpan(fd);
                }}
              >
                {jumlahTulis > 0 ? (
                  <ConfirmSubmit
                    label={`Simpan ${jumlahTulis} perubahan`}
                    title={`Simpan ${jumlahTulis} perubahan ke laporan harian?`}
                    description={
                      `${rencana.ringkas.tambah} ditambah, ${rencana.ringkas.ubah} disesuaikan, ${rencana.ringkas.nolkan} dinolkan` +
                      (rencana.ringkas.laporanBaru.length > 0 ? `, ${rencana.ringkas.laporanBaru.length} laporan baru` : "") +
                      `. Progres ikut berubah. ` +
                      (rencana.ringkas.fotoDipindah > 0
                        ? `${rencana.ringkas.fotoDipindah} foto dipindah ke tanggal Excel.`
                        : "Foto tidak disentuh.")
                    }
                    variant="primary"
                    loading={menyimpan}
                  />
                ) : (
                  <p className="text-xs text-ink-muted">Tidak ada yang akan disimpan.</p>
                )}
              </form>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
