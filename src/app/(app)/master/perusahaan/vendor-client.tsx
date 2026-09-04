"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useMemo, useState } from "react";
import { GitMerge, Trash2, Pencil } from "lucide-react";
import { Badge, Banner, Button, Combobox, FileInput, Input, KpiCard, Label } from "@/components/ui";
import { BilahSaring } from "@/components/master/bilah-saring";
import { Laci } from "@/components/master/laci";
import { PerluPerhatian, type TemuanMaster } from "@/components/master/perlu-perhatian";
import { KartuBaris, SelNama } from "@/components/master/sel-nama";
import { kelengkapanVendor, ringkasKurang } from "@/lib/vendor/kelengkapan";
import {
  deleteVendorAction,
  mergeVendorsAction,
  updateVendorAction,
  type VendorActionState,
} from "@/lib/vendor/actions";

/**
 * DAFTAR PERUSAHAAN — tata letak master data (DECISIONS 359).
 *
 * Rancangan user 2026-08-18: ringkasan angka di atas, bilah "perlu perhatian",
 * lalu daftar dengan saringan sendiri; tambah/edit lewat LACI supaya daftarnya
 * tidak melompat setiap kali sebuah baris dibuka.
 *
 * Yang TIDAK ikut diadopsi dari rancangan itu, dan sengaja:
 *
 *  - **Sidebar sendiri** — diminta diabaikan; navigasi master data sudah ada
 *    sebagai tab, dan menaruh nav kedua berarti dua tempat yang harus setuju.
 *  - **`<select>` native** di toolbar → `Combobox` (aturan proyek 094/115/174).
 *  - **Warna hex mentah** → token tema, supaya mode gelap & kontras ikut benar.
 */

type V = {
  id: string;
  name: string;
  npwp: string | null;
  contact: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  kopUrl: string | null;
  stempelUrl: string | null;
  contractCount: number;
  commitmentCount: number;
  normKey: string;
};

type Saring = "" | "perlu_lengkap" | "duplikat" | "lengkap" | "tanpa_pemakaian";

export function VendorManager({ vendors, duplicateKeys }: { vendors: V[]; duplicateKeys: string[] }) {
  const [cari, setCari] = useState("");
  const [saring, setSaring] = useState<Saring>("");
  // Yang disimpan ID, bukan barisnya. Sesudah simpan/gabung, `vendors` datang
  // baru dari server; memegang objek lama membuat laci menampilkan data basi
  // persis pada saat orang ingin memastikan simpanannya masuk — dan sesudah
  // "Gabung", laci menutup sendiri karena barisnya memang sudah tidak ada.
  const [idBuka, setIdBuka] = useState<string | null>(null);
  const dibuka = idBuka ? (vendors.find((v) => v.id === idBuka) ?? null) : null;
  const dupSet = useMemo(() => new Set(duplicateKeys), [duplicateKeys]);

  const diperkaya = useMemo(
    () =>
      vendors.map((v) => ({
        v,
        kelengkapan: kelengkapanVendor(v),
        duplikat: dupSet.has(v.normKey),
        dipakai: v.contractCount > 0 || v.commitmentCount > 0,
      })),
    [vendors, dupSet],
  );

  const shown = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return diperkaya.filter((r) => {
      if (q) {
        const hay = [r.v.name, r.v.contact, r.v.npwp, r.v.phone, r.v.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (saring === "perlu_lengkap") return !r.kelengkapan.lengkap;
      if (saring === "lengkap") return r.kelengkapan.lengkap;
      if (saring === "duplikat") return r.duplikat;
      if (saring === "tanpa_pemakaian") return !r.dipakai;
      return true;
    });
  }, [diperkaya, cari, saring]);

  const lengkap = diperkaya.filter((r) => r.kelengkapan.lengkap).length;
  const dipakai = diperkaya.filter((r) => r.dipakai).length;
  const tanpaPakai = diperkaya.length - dipakai;
  const duplikat = diperkaya.filter((r) => r.duplikat).length;

  const temuan: TemuanMaster[] = [];
  if (duplikat > 0) {
    temuan.push({
      judul: `${duplikat} perusahaan terindikasi duplikat`,
      keterangan:
        "Nama serupa setelah CV./PT dan tanda baca diabaikan. Kontrak bisa terpecah ke dua entri yang sebetulnya satu.",
      nada: "peringatan",
      aksi: (
        <Button size="sm" variant="secondary" onClick={() => setSaring("duplikat")}>
          Lihat yang duplikat
        </Button>
      ),
    });
  }
  if (diperkaya.length - lengkap > 0) {
    temuan.push({
      judul: `${diperkaya.length - lengkap} dari ${diperkaya.length} profil belum lengkap`,
      keterangan: "Logo, stempel, kop surat, atau PIC belum ada – dokumen cetak jadi tidak seragam.",
      aksi: (
        <Button size="sm" variant="secondary" onClick={() => setSaring("perlu_lengkap")}>
          Lihat yang belum lengkap
        </Button>
      ),
    });
  }
  if (tanpaPakai > 0) {
    temuan.push({
      judul: `${tanpaPakai} perusahaan tanpa pemakaian`,
      keterangan: "Belum dipakai kontrak maupun komitmen – aman untuk ditinjau atau dibersihkan.",
      aksi: (
        <Button size="sm" variant="secondary" onClick={() => setSaring("tanpa_pemakaian")}>
          Lihat yang tanpa pemakaian
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-3">
      <section aria-label="Ringkasan perusahaan" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total perusahaan" value={String(diperkaya.length)} sub={`${dipakai} dipakai di kontrak`} />
        <KpiCard
          label="Profil lengkap"
          value={`${lengkap}`}
          sub={`${diperkaya.length - lengkap} perlu dilengkapi`}
          tone={lengkap === diperkaya.length ? "success" : "default"}
        />
        <KpiCard
          label="Duplikat potensial"
          value={String(duplikat)}
          sub={duplikat > 0 ? "Perlu keputusan gabung" : "Tidak ada"}
          tone={duplikat > 0 ? "warning" : "default"}
        />
        <KpiCard label="Tanpa pemakaian" value={String(tanpaPakai)} sub="Aman untuk ditinjau" />
      </section>

      <PerluPerhatian temuan={temuan} />

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <BilahSaring
          cari={cari}
          onCari={setCari}
          petunjukCari="Cari perusahaan, PIC, NPWP, telepon…"
          tampil={shown.length}
          total={diperkaya.length}
          satuan="perusahaan"
          saringan={[
            {
              id: "vsaring",
              label: "Semua status",
              nilai: saring,
              onUbah: (v) => setSaring(v as Saring),
              opsi: [
                { nilai: "perlu_lengkap", label: "Perlu dilengkapi" },
                { nilai: "lengkap", label: "Profil lengkap" },
                { nilai: "duplikat", label: "Duplikat potensial" },
                { nilai: "tanpa_pemakaian", label: "Tanpa pemakaian" },
              ],
            },
          ]}
        />

        {shown.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            Tidak ada perusahaan yang cocok dengan saringan ini.
          </p>
        ) : (
          <>
            {/* Tabel untuk layar lebar; kartu untuk ponsel. Tabel yang dipaksa
                menyempit membuat kolom penjelasnya yang pertama hilang. */}
            <div className="max-sm:hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase text-ink-muted">
                    <th className="px-3 py-2">Perusahaan</th>
                    <th className="px-3 py-2 text-right">Profil</th>
                    <th className="px-3 py-2 text-right">Kontrak</th>
                    <th className="px-3 py-2 text-right">Komitmen</th>
                    <th className="px-3 py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => (
                    <tr key={r.v.id} className="align-top hover:bg-surface-muted">
                      <td className="px-3 py-2">
                        <SelNama
                          nama={r.v.name}
                          keterangan={ringkasKurang(r.kelengkapan.kurang)}
                          lencana={<Lencana r={r} />}
                        />
                      </td>
                      <td className="tabular px-3 py-2 text-right">{r.kelengkapan.persen}%</td>
                      <td className="tabular px-3 py-2 text-right">{r.v.contractCount}</td>
                      <td className="tabular px-3 py-2 text-right">{r.v.commitmentCount}</td>
                      <td className="px-3 py-2">
                        <TombolDetail onKlik={() => setIdBuka(r.v.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-2 sm:hidden">
              {shown.map((r) => (
                <KartuBaris
                  key={r.v.id}
                  aksi={<TombolDetail onKlik={() => setIdBuka(r.v.id)} />}
                >
                  <SelNama
                    nama={r.v.name}
                    keterangan={ringkasKurang(r.kelengkapan.kurang)}
                    lencana={<Lencana r={r} />}
                  />
                  <p className="mt-1.5 text-[11px] text-ink-muted">
                    Profil {r.kelengkapan.persen}% · {r.v.contractCount} kontrak · {r.v.commitmentCount} komitmen
                  </p>
                </KartuBaris>
              ))}
            </div>
          </>
        )}

        {/* Dua aksi ini tidak bisa dibatalkan otomatis, jadi akibatnya disebut
            di daftar — bukan hanya di dialog konfirmasi yang keburu diklik. */}
        <p className="border-t border-border px-3 py-2 text-[11px] text-ink-muted">
          <strong className="font-semibold text-ink">Gabung</strong>{" "}
          mengalihkan seluruh kontrak &amp; komitmen ke perusahaan tujuan lalu menghapus entri
          asalnya. <strong className="font-semibold text-ink">Hapus</strong>{" "}
          hanya untuk perusahaan tanpa pemakaian. Keduanya ada di dalam{" "}
          <strong className="font-semibold text-ink">Detail</strong>.
        </p>
      </section>

      <Laci
        buka={dibuka !== null}
        onTutup={() => setIdBuka(null)}
        judul={dibuka ? dibuka.name : "Perusahaan"}
        keterangan="Identitas, aset dokumen, dan kelengkapan profil"
      >
        {dibuka ? (
          <div className="space-y-4">
            <VendorEditForm vendor={dibuka} onDone={() => setIdBuka(null)} />
            {/* Gabung & Hapus TIDAK di baris daftar. Keduanya jarang dipakai dan
                tak bisa dibatalkan; menaruh satu Combobox "Gabung ke…" di setiap
                baris berarti belasan kendali berat untuk aksi yang mungkin
                dipakai sekali setahun — dan tepat di sebelah tombol yang ditekan
                setiap hari. Di sini mereka duduk bersama penjelasan akibatnya. */}
            <AksiBerbahaya
              vendor={dibuka}
              all={vendors}
              dipakai={dibuka.contractCount > 0 || dibuka.commitmentCount > 0}
            />
          </div>
        ) : null}
      </Laci>
    </div>
  );
}

function Lencana({ r }: { r: { kelengkapan: { lengkap: boolean }; duplikat: boolean; dipakai: boolean; v: V } }) {
  return (
    <>
      {r.duplikat ? <Badge tone="warning" label="Duplikat potensial" /> : null}
      {r.kelengkapan.lengkap ? (
        <Badge tone="success" label="Profil lengkap" />
      ) : (
        <Badge tone="warning" label="Perlu dilengkapi" />
      )}
      {/* Sebut yang BENAR-BENAR ada. "0 kontrak" pernah muncul di sini untuk
          perusahaan yang cuma punya komitmen — angka nol yang justru menyangkal
          alasan barisnya ditandai terpakai. */}
      {r.v.contractCount > 0 ? (
        <Badge tone="info" label={`${r.v.contractCount} kontrak`} />
      ) : r.v.commitmentCount > 0 ? (
        <Badge tone="info" label={`${r.v.commitmentCount} komitmen`} />
      ) : (
        <Badge tone="neutral" label="Tanpa pemakaian" />
      )}
    </>
  );
}

function TombolDetail({ onKlik }: { onKlik: () => void }) {
  return (
    <Button type="button" size="sm" variant="secondary" onClick={onKlik}>
      <Pencil aria-hidden className="size-3.5" />
      Detail
    </Button>
  );
}

/** Gabung & Hapus — di dalam laci, bukan di baris daftar. */
function AksiBerbahaya({ vendor, all, dipakai }: { vendor: V; all: V[]; dipakai: boolean }) {
  const [mergeState, mergeAction, merging] = useAksi<VendorActionState>(mergeVendorsAction, undefined);
  const [delState, delAction, deleting] = useAksi<VendorActionState>(deleteVendorAction, undefined);
  const [target, setTarget] = useState("");
  const others = all.filter((v) => v.id !== vendor.id);
  const err = mergeState?.error ?? delState?.error;
  const targetName = others.find((o) => o.id === target)?.name ?? "";

  function confirmMerge(e: React.FormEvent) {
    const msg = `Gabungkan "${vendor.name}" ke "${targetName}"? ${vendor.contractCount} kontrak & ${vendor.commitmentCount} komitmen dialihkan, lalu "${vendor.name}" dihapus. Tidak bisa dibatalkan otomatis.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) e.preventDefault();
  }

  return (
    <div className="space-y-3 rounded-md border border-danger-border bg-danger-soft p-3">
      <div>
        <p className="text-[13px] font-semibold text-ink">Gabung &amp; hapus</p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          Tidak bisa dibatalkan otomatis. Gabung memindahkan {vendor.contractCount} kontrak &amp;{" "}
          {vendor.commitmentCount} komitmen ke perusahaan tujuan, lalu menghapus{" "}
          <span className="font-semibold">{vendor.name}</span>.
        </p>
      </div>

      {err ? <Banner tone="error" title={err} /> : null}

      <form action={mergeAction} onSubmit={confirmMerge} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="fromId" value={vendor.id} />
        <input type="hidden" name="toId" value={target} />
        <div className="min-w-0 flex-1">
          <Label htmlFor={`gab-${vendor.id}`}>Gabungkan ke</Label>
          <Combobox
            id={`gab-${vendor.id}`}
            value={target}
            onChange={(value) => setTarget(value)}
            placeholder="Pilih perusahaan tujuan…"
          >
            <option value="">Pilih perusahaan tujuan…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Combobox>
        </div>
        <Button type="submit" size="sm" variant="secondary" loading={merging} disabled={!target}>
          <GitMerge aria-hidden className="size-3.5" />
          Gabung
        </Button>
      </form>

      {dipakai ? (
        // Alasannya DITULIS. Tombol yang sekadar hilang membuat orang mencari
        // di tempat lain, lalu menyimpulkan menunya rusak.
        <p className="text-[11px] text-ink-muted">
          Hapus tidak tersedia: perusahaan ini masih dipakai kontrak/komitmen. Gabungkan ke
          perusahaan lain kalau ini entri kembar.
        </p>
      ) : (
        <form action={delAction}>
          <input type="hidden" name="vendorId" value={vendor.id} />
          <Button type="submit" size="sm" variant="danger" loading={deleting}>
            <Trash2 aria-hidden className="size-3.5" />
            Hapus perusahaan ini
          </Button>
        </form>
      )}
    </div>
  );
}

/** Form master data perusahaan (profil kop surat + logo). */
function VendorEditForm({ vendor, onDone }: { vendor: V; onDone: () => void }) {
  const [state, action, saving] = useAksi<VendorActionState>(updateVendorAction, undefined);
  const k = kelengkapanVendor(vendor);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={vendor.id} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {!k.lengkap ? (
        <Banner
          tone="warning"
          title={`Profil ${k.persen}% lengkap`}
          description={`Belum terisi: ${k.kurang.join(", ")}.`}
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`v-name-${vendor.id}`}>Nama perusahaan</Label>
          <Input id={`v-name-${vendor.id}`} name="name" defaultValue={vendor.name} />
        </div>
        <div>
          <Label htmlFor={`v-npwp-${vendor.id}`}>NPWP</Label>
          <Input id={`v-npwp-${vendor.id}`} name="npwp" defaultValue={vendor.npwp ?? ""} />
        </div>
        <div>
          <Label htmlFor={`v-contact-${vendor.id}`}>Narahubung</Label>
          <Input id={`v-contact-${vendor.id}`} name="contact" defaultValue={vendor.contact ?? ""} placeholder="nama PIC" />
        </div>
        <div>
          <Label htmlFor={`v-phone-${vendor.id}`}>Telepon</Label>
          <Input id={`v-phone-${vendor.id}`} name="phone" defaultValue={vendor.phone ?? ""} placeholder="0812…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`v-email-${vendor.id}`}>Email</Label>
          <Input id={`v-email-${vendor.id}`} name="email" type="email" defaultValue={vendor.email ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`v-addr-${vendor.id}`}>Alamat (untuk kop surat)</Label>
          <Input id={`v-addr-${vendor.id}`} name="address" defaultValue={vendor.address ?? ""} placeholder="Jl. … , Kab/Kota, Provinsi" />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[13px] font-semibold text-ink">Aset dokumen</p>
        <div>
          <Label htmlFor={`v-logo-${vendor.id}`}>Logo (PNG/JPG/WebP ≤ 2 MB)</Label>
          <FileInput
            id={`v-logo-${vendor.id}`}
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            maxBytes={2 * 1024 * 1024}
          />
        </div>
        <div>
          <Label htmlFor={`v-stempel-${vendor.id}`}>Stempel perusahaan (PNG/JPG/WebP ≤ 2 MB)</Label>
          {vendor.stempelUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
            <img
              src={vendor.stempelUrl}
              alt="Stempel perusahaan saat ini"
              className="mb-1.5 size-16 rounded border border-border bg-white object-contain"
            />
          ) : null}
          <FileInput
            id={`v-stempel-${vendor.id}`}
            name="stempel"
            accept="image/png,image/jpeg,image/webp"
            maxBytes={2 * 1024 * 1024}
          />
          <p className="mt-0.5 text-xs text-ink-faint">
            Dipakai di blok tanda tangan laporan harian, mingguan &amp; periodik yang dicetak. Pindai
            stempel di kertas putih polos; latar putihnya tidak akan menutupi tanda tangan.
          </p>
        </div>
        <div>
          <Label htmlFor={`v-kop-${vendor.id}`}>Kop surat (gambar desain jadi ≤ 2 MB, lebar penuh)</Label>
          {vendor.kopUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
            <img src={vendor.kopUrl} alt="Kop surat saat ini" className="mb-1.5 max-h-28 w-full rounded border border-border bg-white object-contain object-left" />
          ) : null}
          {/* `FileInput`, bukan `<input type="file">` telanjang: yang telanjang
              menampilkan "Choose File / No file chosen" bawaan peramban —
              bahasa Inggris di tengah formulir Indonesia, dan satu-satunya
              kolom di laci ini yang berbeda dari dua kolom di atasnya. */}
          <FileInput
            id={`v-kop-${vendor.id}`}
            name="kop"
            accept="image/png,image/jpeg,image/webp"
            maxBytes={2 * 1024 * 1024}
          />
          <p className="mt-0.5 text-xs text-ink-faint">Unggah desain kop yang sudah jadi; penempatan otomatis di header laporan cetak menyusul.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="submit" size="sm" loading={saving}>
          Simpan master data
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Tutup
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        {vendor.logoUrl ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="removeLogo" value="1" /> Hapus logo
          </label>
        ) : null}
        {vendor.kopUrl ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="removeKop" value="1" /> Hapus kop
          </label>
        ) : null}
        {vendor.stempelUrl ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="removeStempel" value="1" /> Hapus stempel
          </label>
        ) : null}
      </div>
    </form>
  );
}
