"use client";

import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Input, Label, PasswordInput, StatusPill } from "@/components/ui";
import { kawalAkunAction, type KawalAkunState, type LaporanUjiKawal } from "@/lib/kawal/actions";
import type { BentukField } from "@/lib/kawal/bentuk";

/**
 * Akun Kawal KNMP + uji sambungan (DECISIONS 689). Hasil uji hanya BENTUK data
 * Kawal (nama field, tipe, hitungan) – bukti sebelum parser sinkron ditulis.
 */
export function KawalPanel({ akunKawal }: { akunKawal: { alamat: string; akun: string; adaSandi: boolean } }) {
  const [state, aksi, sibuk] = useAksi<KawalAkunState>(kawalAkunAction, undefined);
  const terisi = !!(akunKawal.alamat && akunKawal.akun && akunKawal.adaSandi);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-ink">Akun Kawal</p>
        <StatusPill tone={terisi ? "success" : "neutral"} label={terisi ? "Terisi" : "Belum diisi"} />
      </div>
      <p className="text-[13px] text-ink-muted">
        Data Kawal dipakai sebagai pembanding progres, bukan angka resmi. Sandinya disimpan tersandi dan tidak pernah
        ditampilkan lagi; kosongkan kolom sandi bila tidak ingin menggantinya. Uji sambungan masuk ke Kawal sekali dan
        hanya melaporkan bentuk datanya – tidak ada yang disimpan.
      </p>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <form action={aksi} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="kawal-alamat">Alamat Kawal</Label>
            <Input
              id="kawal-alamat"
              name="alamat"
              defaultValue={akunKawal.alamat}
              placeholder="https://…"
              autoComplete="off"
              inputMode="url"
            />
          </div>
          <div>
            <Label htmlFor="kawal-akun">Nama akun</Label>
            <Input id="kawal-akun" name="akun" defaultValue={akunKawal.akun} autoComplete="off" className="w-56" />
          </div>
          <div>
            <Label htmlFor="kawal-sandi">Sandi</Label>
            <PasswordInput
              id="kawal-sandi"
              name="sandi"
              autoComplete="new-password"
              placeholder={akunKawal.adaSandi ? "•••••• tersimpan" : ""}
              className="w-56"
            />
          </div>
        </div>
        {/* Tombol di baris sendiri: di layar sempit "Simpan" sempat menempel di
            baris kolom isian sementara dua tombol lain turun ke bawah. */}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="aksi" value="simpan" variant="primary" loading={sibuk}>
            Simpan
          </Button>
          <Button type="submit" name="aksi" value="uji" variant="secondary" loading={sibuk}>
            Uji sambungan
          </Button>
          {akunKawal.alamat || akunKawal.akun || akunKawal.adaSandi ? (
            <Button type="submit" name="aksi" value="hapus" variant="secondary" loading={sibuk}>
              Hapus akun
            </Button>
          ) : null}
        </div>
      </form>

      {state?.laporan ? <LaporanUji laporan={state.laporan} /> : null}
    </div>
  );
}

function LaporanUji({ laporan }: { laporan: LaporanUjiKawal }) {
  const { langkah, formulir, bentuk, minggu, parser, hubungan } = laporan;
  return (
    <div className="space-y-4 border-t border-border pt-4 text-[13px]">
      <section className="space-y-1.5">
        <p className="font-medium text-ink">Langkah yang dijalankan</p>
        <ol className="space-y-0.5">
          {langkah.map((l, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 text-ink-muted">
              <span className="text-ink">{l.langkah}</span>
              <span className="tabular">
                {l.metode} {l.jalur} → {l.status}
              </span>
              {l.jenis ? <span>({l.jenis.split(";")[0]})</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {formulir ? (
        <section className="space-y-1.5">
          <p className="font-medium text-ink">Formulir masuk yang ditemukan</p>
          <p className="text-ink-muted">
            {formulir.metode} ke <span className="text-ink">{formulir.jalurKirim}</span> · kolom akun{" "}
            <span className="text-ink">{formulir.namaKolomAkun ?? "tidak dikenali"}</span> · kolom sandi{" "}
            <span className="text-ink">{formulir.namaKolomSandi}</span> · token CSRF di halaman:{" "}
            {formulir.adaCsrfMeta ? "ada" : "tidak ada"}
          </p>
          <p className="text-ink-muted">Semua kolom: {formulir.kolom.map((k) => `${k.nama} (${k.tipe})`).join(", ")}</p>
        </section>
      ) : null}

      {bentuk ? (
        <section className="space-y-2">
          <p className="font-medium text-ink">Bentuk data lokasi</p>
          <p className="text-ink-muted">
            Kunci tingkat atas: {bentuk.atas.map((a) => `${a.nama} (${a.tipe})`).join(", ")}
          </p>
          {bentuk.jumlahBaris != null ? (
            <p className="text-ink-muted">
              {bentuk.jumlahBaris} baris · {bentuk.field.length} field per baris
            </p>
          ) : null}
          {bentuk.dipakaiHilang.length > 0 ? (
            <Banner
              tone="warning"
              title={`${bentuk.dipakaiHilang.length} field yang akan dipakai sinkron tidak ditemukan`}
              description={bentuk.dipakaiHilang.join(", ")}
            />
          ) : bentuk.jumlahBaris != null ? (
            <p className="text-success">Semua field yang akan dipakai sinkron ada.</p>
          ) : null}
          <p className="text-ink-muted">
            Kurva mingguan: {bentuk.kurvaMingguan.length ? bentuk.kurvaMingguan.join(", ") : "tidak ada"} · Calon jalur
            Relatif: {bentuk.kandidatRelatif.length ? bentuk.kandidatRelatif.join(", ") : "tidak ditemukan"}
          </p>
          {minggu ? (
            <p className="text-ink-muted">
              Penanggalan minggu (current_week dibanding “7 hari sejak start_date_penyedia”): {minggu.diperiksa} baris
              diperiksa
              {minggu.selisih.length
                ? ` – ${minggu.selisih
                    .map((s) => `selisih ${s.selisih > 0 ? "+" : ""}${s.selisih} di ${s.jumlah} baris`)
                    .join(", ")}`
                : ""}
              {minggu.tanpaData ? ` · ${minggu.tanpaData} baris tanpa tanggal/minggu yang terbaca` : ""}.
            </p>
          ) : null}
          {parser ? (
            parser.diterima ? (
              <p className="text-success">Parser sinkron menerima seluruh baris.</p>
            ) : (
              <Banner
                tone="warning"
                title="Parser sinkron menolak data ini – sinkron akan gagal sampai parsernya disesuaikan"
                description={parser.masalah.join(" ")}
              />
            )
          ) : null}
          {hubungan && hubungan.hubungan.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-primary">
                Hubungan antar angka ({hubungan.hubungan.length} pasangan yang nilainya sama)
              </summary>
              <p className="mt-2 text-ink-muted">
                Pasangan yang nilainya sama (selisih ≤ 0,01) di sebagian besar baris – bukti makna field dari data,
                bukan dari namanya. Nilainya sendiri tidak ditampilkan.
              </p>
              <ul className="mt-1 space-y-0.5">
                {hubungan.hubungan.map((h) => (
                  <li key={`${h.a}|${h.b}`} className="text-ink-muted">
                    <span className="text-ink">{h.a}</span> = <span className="text-ink">{h.b}</span>{" "}
                    <span className="tabular">
                      ({h.sama}/{h.diperiksa} baris)
                    </span>
                  </li>
                ))}
              </ul>
              {hubungan.kurvaTanpaPadanan.length ? (
                <p className="mt-2 text-ink-muted">
                  Kurva yang nilai terakhirnya tidak sama dengan angka mana pun:{" "}
                  <span className="text-ink">{hubungan.kurvaTanpaPadanan.join(", ")}</span>
                </p>
              ) : null}
            </details>
          ) : null}
          <details>
            <summary className="cursor-pointer text-primary">Semua field ({bentuk.field.length})</summary>
            <TabelField field={bentuk.field} jumlah={bentuk.jumlahBaris ?? 0} />
          </details>
          {Object.entries(bentuk.anak).map(([nama, field]) => (
            <details key={nama}>
              <summary className="cursor-pointer text-primary">
                Isi “{nama}” ({field.length} field)
              </summary>
              <TabelField field={field} jumlah={null} />
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function TabelField({ field, jumlah }: { field: BentukField[]; jumlah: number | null }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-ink-muted">
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Terisi</th>
            <th className="py-1 font-medium">Tipe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {field.map((f) => (
            <tr key={f.nama}>
              <td className="py-1 pr-3 text-ink">{f.nama}</td>
              <td className="tabular py-1 pr-3 text-ink-muted">{jumlah != null ? `${f.diisi}/${jumlah}` : f.diisi}</td>
              <td className="py-1 text-ink-muted">{f.tipe.map((t) => `${t.tipe} ×${t.jumlah}`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
