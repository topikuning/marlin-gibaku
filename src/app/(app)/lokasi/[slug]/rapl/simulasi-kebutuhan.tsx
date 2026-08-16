"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge, Banner, Input } from "@/components/ui";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";

/**
 * Simulasi kebutuhan sumber daya dari padanan yang SUDAH DISETUJUI.
 *
 * Dua hal yang sengaja ditaruh di atas tabel, bukan di catatan kaki:
 * berapa persen nilai RAB yang benar-benar masuk hitungan, dan apa saja yang
 * dikeluarkan beserta alasannya. Tabel kebutuhan bahan tanpa keduanya akan
 * dibaca sebagai kebutuhan proyek — padahal ia baru sebagian.
 */

export type BarisKebutuhan = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  dariBaris: number;
  janggal: boolean;
};

export type BarisDilewatRow = {
  code: string;
  uraian: string;
  amount: string;
  alasan: string;
  rinci: string;
};

const KATEGORI = [
  { key: "bahan", label: "Bahan" },
  { key: "upah", label: "Upah" },
  { key: "alat", label: "Alat" },
] as const;

const ALASAN_LABEL: Record<string, string> = {
  belum_disetujui: "Padanan belum disetujui",
  satuan_tidak_sepadan: "Satuan item ≠ satuan analisa",
  tanpa_koefisien: "Analisa belum punya koefisien terstruktur",
  volume_kosong: "Item RAB tidak punya volume",
};

export function SimulasiKebutuhan({
  kebutuhan,
  dilewat,
  nilaiDipakai,
  barisDipakai,
  nilaiRab,
  barisRab,
}: {
  kebutuhan: BarisKebutuhan[];
  dilewat: BarisDilewatRow[];
  nilaiDipakai: string;
  barisDipakai: number;
  nilaiRab: string;
  barisRab: number;
}) {
  const [tab, setTab] = useState<(typeof KATEGORI)[number]["key"]>("bahan");
  const [cari, setCari] = useState("");
  const [bukaLewat, setBukaLewat] = useState(false);

  const total = BigInt(nilaiRab);
  const dipakai = BigInt(nilaiDipakai);
  const pct = total > 0n ? (Number(dipakai) / Number(total)) * 100 : 0;

  const perKategori = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return kebutuhan.filter(
      (k) => k.kategori === tab && (q === "" || k.nama.toLowerCase().includes(q)),
    );
  }, [kebutuhan, tab, cari]);

  const janggal = useMemo(() => kebutuhan.filter((k) => k.janggal), [kebutuhan]);

  const jumlahPerKategori = useMemo(() => {
    const h: Record<string, number> = { bahan: 0, upah: 0, alat: 0 };
    for (const k of kebutuhan) h[k.kategori] = (h[k.kategori] ?? 0) + 1;
    return h;
  }, [kebutuhan]);

  const ringkasLewat = useMemo(() => {
    const h = new Map<string, { baris: number; nilai: bigint }>();
    for (const d of dilewat) {
      const a = h.get(d.alasan) ?? { baris: 0, nilai: 0n };
      a.baris += 1;
      a.nilai += BigInt(d.amount);
      h.set(d.alasan, a);
    }
    return [...h.entries()].sort((a, b) => Number(b[1].nilai - a[1].nilai));
  }, [dilewat]);

  if (barisDipakai === 0) {
    return (
      <Banner
        tone="info"
        title="Belum ada padanan yang disetujui"
        description={`Simulasi kebutuhan hanya memakai padanan yang sudah disetujui orang — usulan mesin tidak dihitung. Setujui usulan di daftar pemetaan lebih dulu (${barisRab} baris RAB menunggu).`}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Banner
        tone={pct >= 80 ? "success" : pct >= 40 ? "warning" : "info"}
        title={`Simulasi ini menutup ${formatPct(pct, 1)} nilai RAB (${formatRupiah(dipakai)} dari ${formatRupiah(total)})`}
        description={`Dihitung dari ${barisDipakai} dari ${barisRab} baris kerja. Sisanya belum masuk — rinciannya di bawah. Angka di tabel ini BELUM harga; harga satuan dasar per lokasi adalah langkah berikutnya.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {KATEGORI.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setTab(k.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] transition",
              tab === k.key
                ? "border-brand bg-brand-soft font-medium text-brand"
                : "border-line text-ink-muted hover:bg-surface-inset",
            )}
          >
            {k.label} <span className="tabular">({jumlahPerKategori[k.key] ?? 0})</span>
          </button>
        ))}
        <Input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari bahan / upah / alat…"
          className="ms-auto w-56"
        />
      </div>

      {perKategori.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          Tidak ada baris pada kategori ini.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-inset text-[12px] text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Sumber daya</th>
                <th className="px-3 py-2 text-end font-medium">Kebutuhan</th>
                <th className="px-3 py-2 text-start font-medium">Satuan</th>
                <th className="px-3 py-2 text-end font-medium">Dari baris</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perKategori.map((k) => (
                <tr key={`${k.kategori}|${k.nama}|${k.satuan}`}>
                  <td className="px-3 py-1.5 text-ink">
                    {k.nama}
                    {k.janggal ? (
                      <Badge tone="warning" className="ms-2">
                        kategori janggal
                      </Badge>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-1.5 text-end font-medium text-ink">
                    {formatNumber(k.jumlah)}
                  </td>
                  <td className="px-3 py-1.5 text-ink-muted">{k.satuan || "—"}</td>
                  <td className="tabular px-3 py-1.5 text-end text-ink-muted">{k.dariBaris}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {janggal.length > 0 ? (
        <p className="text-[12px] text-warning">
          {janggal.length} baris ditandai <strong>kategori janggal</strong>: berkas SE DJBK
          47/2026 mendaftarkannya sebagai UPAH padahal satuannya satuan bahan (mis. analisa
          &ldquo;Saluran U Pracetak&rdquo; memuat &ldquo;Semen (Kg)&rdquo; sebagai upah). Itu cacat
          di data sumbernya — MARLIN tidak memindahkannya sendiri, karena menebak maksud dokumen
          resmi lalu menyajikannya sebagai fakta justru yang membuat angka tak bisa
          dipertanggungjawabkan. Periksa halaman PDF analisanya, lalu ganti padanannya bila perlu.
        </p>
      ) : null}

      <p className="text-[12px] text-ink-muted">
        Nama sumber daya TIDAK disatukan antar ejaan yang berbeda (mis. &ldquo;Semen PC&rdquo; dan
        &ldquo;Semen Portland&rdquo; tetap dua baris) — menggabungkannya keputusan yang tidak boleh
        diambil diam-diam.
      </p>

      {dilewat.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-soft p-3">
          <p className="text-sm font-medium text-ink">
            {dilewat.length} baris RAB TIDAK masuk simulasi
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-muted">
            {ringkasLewat.map(([alasan, a]) => (
              <li key={alasan} className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">{ALASAN_LABEL[alasan] ?? alasan}</Badge>
                <span className="tabular">
                  {a.baris} baris · {formatRupiah(a.nilai)}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setBukaLewat(!bukaLewat)}
            className="mt-2 text-[13px] text-brand underline"
          >
            {bukaLewat ? "Sembunyikan" : "Lihat barisnya"}
          </button>
          {bukaLewat ? (
            <div className="mt-2 max-h-80 overflow-y-auto rounded-md border border-line bg-surface">
              <table className="w-full text-[13px]">
                <tbody className="divide-y divide-line">
                  {[...dilewat]
                    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))
                    .map((d) => (
                      <tr key={`${d.code}|${d.uraian}`}>
                        <td className="px-2.5 py-1.5">
                          <span className="tabular text-ink-muted">{d.code}</span> {d.uraian}
                          <span className="block text-[12px] text-ink-muted">{d.rinci}</span>
                        </td>
                        <td className="tabular px-2.5 py-1.5 text-end whitespace-nowrap text-ink-muted">
                          {formatRupiah(BigInt(d.amount))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-2 text-[12px] text-ink-muted">
            Nilai yang belum tertutup: {formatRupiah(total - dipakai)}. Selama angka ini besar,
            simulasi di atas belum bisa dipakai membandingkan biaya pelaksanaan dengan nilai
            kontrak.
          </p>
        </div>
      ) : null}
    </div>
  );
}
