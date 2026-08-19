"use client";

import { useActionState, useMemo, useState } from "react";
import { FileSpreadsheet, Plus } from "lucide-react";
import { Banner, Button, Combobox, Input, KpiCard, Label, StatusPill } from "@/components/ui";
import { BilahSaring } from "@/components/master/bilah-saring";
import { Laci } from "@/components/master/laci";
import { PerluPerhatian, type TemuanMaster } from "@/components/master/perlu-perhatian";
import { KartuBaris, SelNama } from "@/components/master/sel-nama";
import type { StatusKatalog } from "@/lib/master-location/queries";
import { tambahLokasiMasterAction, type TambahLokasiState } from "@/lib/master-location/actions";
import { MasterImportForm } from "./import-form";

/**
 * KATALOG LOKASI (Master Data) — dua jalur input yang tidak bercampur
 * (DECISIONS 368).
 *
 * Diadopsi dari rancangan user 2026-08-19, dengan bahasa rupa yang sama seperti
 * master data lain (359): ringkasan angka, bilah "perlu perhatian", lalu daftar
 * yang punya saringan sendiri; tambah & impor lewat LACI supaya daftarnya tidak
 * melompat.
 *
 * ### Kenapa dua jalur, bukan satu formulir pintar
 *
 * Sebelumnya satu-satunya jalan masuk adalah impor Excel — untuk menambahkan
 * SATU desa pun orang harus membuat berkas. Sekarang keduanya berdiri sendiri
 * dan berdampingan: **Tambah Lokasi** untuk satu-satu, **Impor Excel** untuk
 * puluhan. Yang tidak diadopsi dari rancangan: `<select>` native (aturan proyek
 * 094/115/174 → `Combobox`), warna hex mentah (→ token tema), dan sidebar
 * tersendiri (navigasi master data sudah berupa tab).
 */

export type BarisKatalog = {
  id: string;
  province: string;
  regency: string;
  district: string | null;
  village: string;
  /** Decimal diserialisasi string dari server; halaman ini hanya menampilkan. */
  latitude: string | null;
  longitude: string | null;
  candidateVendor: string | null;
  status: StatusKatalog;
};

const LABEL_STATUS: Record<StatusKatalog, string> = {
  tersedia: "Tersedia",
  terpakai: "Terpakai",
  sudah_ada: "Sudah ada",
  perlu_verifikasi: "Perlu verifikasi",
};

const NADA_STATUS: Record<StatusKatalog, "success" | "neutral" | "warning" | "danger"> = {
  tersedia: "success",
  terpakai: "neutral",
  sudah_ada: "warning",
  perlu_verifikasi: "danger",
};

type Saring = "" | StatusKatalog;

const wilayah = (r: BarisKatalog) =>
  [r.district, r.regency, r.province].filter(Boolean).join(" · ");

/**
 * Koordinat untuk DIBACA — dibulatkan 5 desimal (±1 m).
 *
 * Nilai simpanannya tetap utuh; yang dipendekkan hanya tampilannya, dan nilai
 * persisnya ada di `title`. Tujuh desimal membuat satu sel melipat jadi dua
 * baris di seluruh tabel demi ketelitian sepersepuluh milimeter yang tidak
 * dipakai siapa pun saat memindai daftar.
 */
function koordinat(r: BarisKatalog): { singkat: string; persis: string } | null {
  if (!r.latitude || !r.longitude) return null;
  const bulat = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) ? n.toFixed(5) : s;
  };
  return {
    singkat: `${bulat(r.latitude)}, ${bulat(r.longitude)}`,
    persis: `${r.latitude}, ${r.longitude}`,
  };
}

export function KatalogLokasiManager({
  rows,
  vendors,
}: {
  rows: BarisKatalog[];
  vendors: string[];
}) {
  const [cari, setCari] = useState("");
  const [saring, setSaring] = useState<Saring>("");
  const [laci, setLaci] = useState<"tambah" | "impor" | null>(null);

  const hitung = useMemo(() => {
    const per = (s: StatusKatalog) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      tersedia: per("tersedia"),
      terpakai: per("terpakai"),
      sudahAda: per("sudah_ada"),
      perluVerifikasi: per("perlu_verifikasi"),
    };
  }, [rows]);

  const provinsi = useMemo(
    () => [...new Set(rows.map((r) => r.province))].sort((a, b) => a.localeCompare(b, "id")),
    [rows],
  );
  const [prov, setProv] = useState("");

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return rows.filter((r) => {
      if (saring && r.status !== saring) return false;
      if (prov && r.province !== prov) return false;
      if (!q) return true;
      return [r.village, r.district, r.regency, r.province, r.candidateVendor]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, cari, saring, prov]);

  const temuan: TemuanMaster[] = [];
  if (hitung.perluVerifikasi > 0) {
    temuan.push({
      judul: `${hitung.perluVerifikasi} dari ${hitung.total} lokasi belum berkoordinat`,
      keterangan:
        "Tersimpan dan boleh dipakai, tapi tidak muncul di peta dan tidak bisa jadi cadangan titik cap foto.",
      nada: "peringatan",
      aksi: (
        <Button size="sm" variant="secondary" onClick={() => { setSaring("perlu_verifikasi"); setProv(""); setCari(""); }}>
          Lihat yang perlu verifikasi
        </Button>
      ),
    });
  }
  if (hitung.sudahAda > 0) {
    temuan.push({
      judul: `${hitung.sudahAda} dari ${hitung.total} sudah ada sebagai lokasi proyek`,
      keterangan:
        "Baris katalognya tidak lagi bisa dipakai membuat proyek baru – lokasinya sudah berjalan.",
      aksi: (
        <Button size="sm" variant="secondary" onClick={() => { setSaring("sudah_ada"); setProv(""); setCari(""); }}>
          Lihat daftarnya
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Total katalog" value={String(hitung.total)} sub="semua lokasi master" />
        <KpiCard
          label="Tersedia"
          value={String(hitung.tersedia)}
          sub="siap dipakai paket"
          tone="success"
        />
        <KpiCard
          label="Perlu verifikasi"
          value={String(hitung.perluVerifikasi)}
          sub="koordinat belum diisi"
          tone={hitung.perluVerifikasi > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Terpakai / sudah ada"
          value={String(hitung.terpakai + hitung.sudahAda)}
          sub={`${hitung.terpakai} terpakai · ${hitung.sudahAda} sudah ada`}
        />
      </section>

      <PerluPerhatian temuan={temuan} />

      {/* Bernama supaya pembaca layar bisa melompat langsung ke daftarnya,
          alih-alih menyusuri ulang KPI dan bilah perhatian tiap kali. */}
      <section
        aria-label="Daftar lokasi"
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        <BilahSaring
          cari={cari}
          onCari={setCari}
          petunjukCari="Cari desa, kecamatan, kabupaten, provinsi, calon penyedia…"
          tampil={tampil.length}
          total={rows.length}
          satuan="lokasi"
          aksi={
            <>
              <Button size="sm" variant="secondary" onClick={() => setLaci("impor")}>
                <FileSpreadsheet aria-hidden className="size-3.5" />
                Impor Excel
              </Button>
              <Button size="sm" onClick={() => setLaci("tambah")}>
                <Plus aria-hidden className="size-3.5" />
                Tambah Lokasi
              </Button>
            </>
          }
          saringan={[
            {
              id: "kl-status",
              label: "Semua status",
              nilai: saring,
              onUbah: (v) => setSaring(v as Saring),
              opsi: (Object.keys(LABEL_STATUS) as StatusKatalog[]).map((s) => ({
                nilai: s,
                label: LABEL_STATUS[s],
              })),
            },
            {
              id: "kl-prov",
              label: "Semua provinsi",
              nilai: prov,
              onUbah: setProv,
              opsi: provinsi.map((p) => ({ nilai: p, label: p })),
            },
          ]}
        />

        {tampil.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            {rows.length === 0
              ? "Katalog masih kosong. Tambahkan satu lokasi, atau impor dari Excel."
              : "Tidak ada lokasi yang cocok dengan saringan ini."}
          </p>
        ) : (
          <>
            <div className="max-sm:hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase text-ink-muted">
                    <th className="px-3 py-2">Lokasi</th>
                    <th className="px-3 py-2">Kabupaten / Kota</th>
                    <th className="px-3 py-2">Kecamatan</th>
                    <th className="px-3 py-2">Koordinat</th>
                    <th className="px-3 py-2">Calon penyedia</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tampil.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-surface-muted">
                      <td className="px-3 py-2">
                        <SelNama nama={r.village} keterangan={r.province} />
                      </td>
                      <td className="px-3 py-2">{r.regency}</td>
                      <td className="px-3 py-2 text-ink-muted">{r.district || "–"}</td>
                      <td className="tabular px-3 py-2 whitespace-nowrap text-ink-muted">
                        {(() => {
                          const k = koordinat(r);
                          return k ? (
                            <span title={k.persis}>{k.singkat}</span>
                          ) : (
                            <span className="text-warning">belum diisi</span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{r.candidateVendor || "–"}</td>
                      <td className="px-3 py-2">
                        <StatusPill tone={NADA_STATUS[r.status]} label={LABEL_STATUS[r.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-2 sm:hidden">
              {tampil.map((r) => (
                <KartuBaris key={r.id}>
                  <SelNama
                    nama={r.village}
                    keterangan={wilayah(r)}
                    lencana={
                      <StatusPill tone={NADA_STATUS[r.status]} label={LABEL_STATUS[r.status]} />
                    }
                  />
                  <p className="mt-1.5 text-[11px] text-ink-muted">
                    {koordinat(r)?.singkat ?? "Koordinat belum diisi"}
                    {r.candidateVendor ? ` · ${r.candidateVendor}` : ""}
                  </p>
                </KartuBaris>
              ))}
            </div>
          </>
        )}
      </section>

      <Laci
        buka={laci === "tambah"}
        onTutup={() => setLaci(null)}
        judul="Tambah Lokasi"
        keterangan="Satu lokasi baru. Tidak perlu membuat berkas Excel hanya untuk menambah satu desa."
      >
        <FormTambahLokasi vendors={vendors} onSelesai={() => setLaci(null)} />
      </Laci>

      <Laci
        buka={laci === "impor"}
        onTutup={() => setLaci(null)}
        judul="Impor Excel"
        keterangan="Untuk banyak lokasi sekaligus. Selalu dipratinjau dulu – tidak ada baris yang masuk sebelum Anda melihat ringkasannya."
      >
        <MasterImportForm />
      </Laci>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FormTambahLokasi({
  vendors,
  onSelesai,
}: {
  vendors: string[];
  onSelesai: () => void;
}) {
  const [state, formAction, pending] = useActionState<TambahLokasiState, FormData>(
    tambahLokasiMasterAction,
    undefined,
  );

  const kandidat = state?.kandidat ?? [];
  const adaPersis = kandidat.some((k) => k.kemiripan === "persis");
  const isian = state?.isian ?? {};

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? (
        <Banner
          tone="success"
          title={state.success}
          description={
            <button type="button" onClick={onSelesai} className="font-medium text-primary hover:underline">
              Tutup
            </button>
          }
        />
      ) : null}

      {kandidat.length > 0 ? (
        <Banner
          tone={adaPersis ? "error" : "warning"}
          title={
            adaPersis
              ? "Lokasi ini sudah ada – tidak dibuat ganda."
              : `${kandidat.length} lokasi mirip sudah terdaftar. Periksa dulu sebelum menyimpan.`
          }
          description={
            <div className="space-y-1.5">
              <ul className="space-y-1">
                {kandidat.map((k) => (
                  <li key={`${k.sumber}-${k.id}`} className="text-[12px]">
                    <span className="font-semibold text-ink">{k.nama}</span>{" "}
                    <span className="text-ink-muted">
                      – {[k.district, k.regency, k.province].filter(Boolean).join(" · ")}
                    </span>{" "}
                    <span className="text-ink-faint">
                      ({k.sumber === "katalog" ? "katalog" : "sudah jadi proyek"}
                      {k.kemiripan === "persis" ? ", sama persis" : ", ejaan berbeda"})
                    </span>
                  </li>
                ))}
              </ul>
              {adaPersis ? (
                <p className="text-[12px]">
                  Ubah wilayahnya kalau memang lokasi yang berbeda.
                </p>
              ) : (
                <p className="text-[12px]">
                  Kalau ini memang desa yang berbeda – nama desa yang sama di kecamatan lain itu
                  lazim – tekan <strong className="font-semibold">Tetap simpan sebagai baru</strong>.
                </p>
              )}
            </div>
          }
        />
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-[12px] font-semibold text-ink">Wilayah administratif</legend>
        <div>
          <Label htmlFor="tl-prov">Provinsi *</Label>
          <Input id="tl-prov" name="province" required defaultValue={isian.province ?? ""} placeholder="mis. Jawa Tengah" />
        </div>
        <div>
          <Label htmlFor="tl-kab">Kabupaten / Kota *</Label>
          <Input id="tl-kab" name="regency" required defaultValue={isian.regency ?? ""} placeholder="mis. Demak" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="tl-kec">Kecamatan</Label>
            <Input id="tl-kec" name="district" defaultValue={isian.district ?? ""} placeholder="mis. Bonang" />
          </div>
          <div>
            <Label htmlFor="tl-desa">Desa / Kelurahan *</Label>
            <Input id="tl-desa" name="village" required defaultValue={isian.village ?? ""} placeholder="mis. Betahwalang" />
          </div>
        </div>
        <p className="text-[11px] text-ink-muted">
          Kombinasi provinsi + kabupaten + kecamatan + desa dipakai memeriksa lokasi ganda sebelum
          disimpan.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[12px] font-semibold text-ink">Koordinat</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="tl-lat">Lintang (latitude)</Label>
            <Input id="tl-lat" name="latitude" inputMode="decimal" placeholder="-6.8150" />
          </div>
          <div>
            <Label htmlFor="tl-lng">Bujur (longitude)</Label>
            <Input id="tl-lng" name="longitude" inputMode="decimal" placeholder="110.6270" />
          </div>
        </div>
        <p className="text-[11px] text-ink-muted">
          Boleh dikosongkan – lokasinya tetap tersimpan, tapi diberi status{" "}
          <strong className="font-semibold text-ink">Perlu verifikasi</strong> sampai koordinatnya
          diisi. Isi keduanya atau kosongkan keduanya.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[12px] font-semibold text-ink">Relasi operasional</legend>
        <div>
          <Label htmlFor="tl-vendor">Calon penyedia</Label>
          <Combobox
            id="tl-vendor"
            name="candidateVendor"
            defaultValue={isian.candidateVendor ?? ""}
            placeholder="Belum ditentukan"
          >
            <option value="">Belum ditentukan</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Combobox>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button type="submit" loading={pending}>
          Simpan Lokasi
        </Button>
        {kandidat.length > 0 && !adaPersis ? (
          /* Tombol paksa hanya ada SESUDAH kandidatnya terlihat, dan tidak
             pernah untuk yang sama persis — indeks unik basis data akan
             menolaknya, jadi menjanjikannya berakhir dengan galat mentah. */
          <Button type="submit" name="konfirmasi" value="ya" variant="secondary" loading={pending}>
            Tetap simpan sebagai baru
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onSelesai}>
          Tutup
        </Button>
      </div>
    </form>
  );
}
