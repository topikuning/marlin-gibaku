import { formatRupiah } from "@/lib/format";
import type { ImportPreview } from "./actions";

type Baris = ImportPreview["categories"][number];

/**
 * Ringkasan berjenjang berkas yang diimpor — DENGAN pembandingnya.
 *
 * **Permintaan user 2026-09-21**: *"yang kuminta ada perbandingan itu di bagian
 * ini, kenapa ini malah tidak ada!"* — sambil menunjuk tabel ini.
 *
 * Tabel banding per ITEM sudah ada sejak DECISIONS 599, tetapi ia berdiri di
 * blok lain di atas. Yang dibaca orang lebih dulu saat memeriksa adendum justru
 * ringkasan kategori ini, dan sampai sekarang isinya cuma angka berkas baru:
 * cukup untuk menjawab "berapa totalnya", tidak cukup untuk menjawab "apa yang
 * bergeser" — padahal itu satu-satunya pertanyaan yang dibawa orang ke layar
 * impor adendum.
 *
 * Kolom pembanding hanya muncul kalau ADA yang dibandingkan. Kalau lokasinya
 * belum punya RAB aktif, tabelnya kembali ke empat kolom DAN mengatakan
 * alasannya — "tidak ada" tanpa sebab persis keadaan yang dikeluhkan.
 */
export function TabelKategori({
  baris,
  grandTotal,
  totalKontrak,
}: {
  baris: Baris[];
  grandTotal: string;
  totalKontrak: string | null;
}) {
  const adaBanding = totalKontrak !== null && baris.some((b) => b.status !== null);

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="py-1.5 pr-3">Kode</th>
              <th className="py-1.5 pr-3">Kategori &amp; sub-kategori</th>
              <th className="py-1.5 pr-3 text-right">Item</th>
              {adaBanding ? <th className="py-1.5 pr-3 text-right">Total kontrak</th> : null}
              <th className="py-1.5 pr-3 text-right">{adaBanding ? "Total berkas ini" : "Total"}</th>
              {adaBanding ? <th className="py-1.5 text-right">Selisih</th> : null}
            </tr>
          </thead>
          {/* Sub-kategori ikut tampil dan DITAKIK (DECISIONS 599). Satu baris
              kategori bernilai miliaran cukup untuk memastikan grand total
              cocok, tidak cukup untuk melihat pekerjaan mana yang bergeser.
              Kategori dicetak tebal supaya jenjangnya terbaca tanpa garis
              bantu. Kunci baris = `lineageKey`: kode kategori/sub berulang
              antar cabang, dan kunci kembar membuat React boleh MENGHILANGKAN
              baris – tabel periksa yang diam-diam kehilangan isi. */}
          <tbody className="divide-y divide-border">
            {baris.map((c) => (
              <tr key={c.lineageKey} className={c.level === 0 ? "font-medium" : ""}>
                <td className="py-1.5 pr-3 text-ink-muted">
                  <span style={{ paddingLeft: c.level * 14 }}>{c.code}</span>
                </td>
                <td className="py-1.5 pr-3">{c.name}</td>
                <td className="tabular py-1.5 pr-3 text-right text-ink-muted">{c.jumlahItem}</td>
                {/*
                  KOSONG ditulis "–", bukan "Rp 0". Nol berarti "ada, bernilai
                  nol"; kosong berarti "tidak ada di sisi itu". Menyamakan
                  keduanya membuat kategori tambah terbaca sebagai kategori yang
                  dinolkan – dua keadaan yang tindak lanjutnya berbeda.
                */}
                {adaBanding ? (
                  <td className="tabular py-1.5 pr-3 text-right text-ink-muted">
                    {c.kontrak == null ? (
                      <span title="Belum ada di kontrak">–</span>
                    ) : (
                      formatRupiah(Number(c.kontrak))
                    )}
                  </td>
                ) : null}
                <td className="tabular py-1.5 pr-3 text-right">
                  {c.total == null ? (
                    <span title="Hilang dari berkas ini">–</span>
                  ) : (
                    formatRupiah(Number(c.total))
                  )}
                </td>
                {adaBanding ? (
                  <td
                    className={`tabular py-1.5 text-right ${
                      c.status === "hilang"
                        ? "font-medium text-danger"
                        : c.status === "baru"
                          ? "text-success"
                          : Number(c.selisih) < 0
                            ? "text-danger"
                            : Number(c.selisih) > 0
                              ? "text-success"
                              : "text-ink-faint"
                    }`}
                  >
                    {c.status === "tetap" || c.selisih == null
                      ? "–"
                      : `${Number(c.selisih) > 0 ? "+" : ""}${formatRupiah(Number(c.selisih))}`}
                    <span className="block text-[11px] font-normal text-ink-faint">
                      {c.status === "baru"
                        ? "baru"
                        : c.status === "hilang"
                          ? "hilang dari berkas"
                          : ""}
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={3} className="py-1.5 pr-3 text-right font-semibold">
                Grand total (pra-PPN)
              </td>
              {adaBanding ? (
                <td className="tabular py-1.5 pr-3 text-right font-semibold text-ink-muted">
                  {formatRupiah(Number(totalKontrak))}
                </td>
              ) : null}
              <td className="tabular py-1.5 pr-3 text-right font-semibold">
                {formatRupiah(Number(grandTotal))}
              </td>
              {adaBanding ? (
                <td className="tabular py-1.5 text-right font-semibold">
                  {(() => {
                    const d = BigInt(grandTotal) - BigInt(totalKontrak!);
                    return d === 0n ? "–" : `${d > 0n ? "+" : ""}${formatRupiah(Number(d))}`;
                  })()}
                </td>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </div>
      {adaBanding ? null : (
        <p className="text-[11px] text-ink-faint">
          Belum ada RAB aktif di lokasi ini, jadi tidak ada angka kontrak untuk diadu – kolom
          pembanding baru muncul saat mengimpor adendum.
        </p>
      )}
    </div>
  );
}
