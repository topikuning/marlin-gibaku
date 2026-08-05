import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, KpiCard, StatusPill } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatTanggalWaktu } from "@/lib/format";
import {
  LABEL_JENIS_IMPOR,
  LABEL_STATUS_IMPOR,
  TONE_STATUS_IMPOR,
  daftarImpor,
  rincianImpor,
  ringkasImpor,
} from "@/lib/import-log/queries";

export const metadata: Metadata = { title: "Impor & Kualitas Data" };
export const dynamic = "force-dynamic";

function ukuran(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * PUSAT IMPOR & KUALITAS DATA (PRD FR-IMP, DECISIONS 254).
 *
 * MARLIN hidup dari berkas Excel: RAB/HPS, jadwal kurva-S, master lokasi.
 * Sampai sekarang hasil setiap impor hanya tampil sekali lalu hilang — parser
 * mengembalikan daftar peringatan, banner menampilkannya, halaman ditutup,
 * selesai. Yang tersisa cuma angkanya, tanpa asal-usulnya.
 *
 * Halaman ini menjawab tiga pertanyaan yang selama ini tidak ada jawabannya:
 * berkas mana yang jadi sumber angka sebuah lokasi, siapa yang mengimpornya,
 * dan apa yang waktu itu ditolak atau diperingatkan.
 *
 * Rincian masalah dibuka lewat `?buka=<id>` di halaman yang sama, bukan halaman
 * terpisah: pembacanya tidak kehilangan tempat di daftar, DAN rinciannya punya
 * URL yang bisa dikirim ke orang lain — cara halaman seperti ini benar-benar
 * dipakai adalah "coba lihat ini".
 */
export default async function ImporPage({
  searchParams,
}: {
  searchParams: Promise<{ buka?: string }>;
}) {
  const user = await requireUser();
  // `rab.manage` = peran yang memang menjalankan impor (PM ke atas). Mandor
  // tidak mengimpor apa pun, jadi halaman ini bukan miliknya.
  requireCapabilityPage(user.role, "rab.manage");

  const locIds = await accessibleLocationIds(user);
  const rows = await daftarImpor(user, locIds);
  const ringkas = ringkasImpor(rows);

  const { buka } = await searchParams;
  const dibuka = buka && rows.some((r) => r.id === buka) ? await rincianImpor(user, buka) : null;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-muted">
        Riwayat unggah berkas: RAB/HPS, jadwal kurva-S, dan master lokasi. Dipakai menjawab “angka
        lokasi ini datang dari berkas mana, diimpor siapa, dan baris mana yang waktu itu ditolak”.
        Berkasnya sendiri tidak disimpan di sini — hanya jejaknya.
      </p>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Impor tercatat" value={ringkas.total} sub="100 terakhir" />
        <KpiCard
          label="Tidak mulus"
          value={ringkas.bermasalah}
          sub="sebagian ditolak atau gagal"
          tone={ringkas.bermasalah > 0 ? "warning" : "default"}
        />
        <KpiCard label="Baris diterima" value={ringkas.barisDiterima.toLocaleString("id-ID")} />
        <KpiCard
          label="Baris ditolak"
          value={ringkas.barisTertolak.toLocaleString("id-ID")}
          tone={ringkas.barisTertolak > 0 ? "danger" : "default"}
        />
      </section>

      <Card>
        <CardHeader
          title="Riwayat impor"
          subtitle="Terbaru di atas. Buka satu baris untuk melihat peringatan dan penolakan per baris berkas."
        />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="Belum ada impor tercatat"
              description="Jejak mulai terkumpul sejak fitur ini menyala — impor yang dilakukan sebelumnya tidak bisa dimunculkan surut, karena datanya memang tidak pernah disimpan."
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const terbuka = buka === r.id;
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            tone={TONE_STATUS_IMPOR[r.status]}
                            label={LABEL_STATUS_IMPOR[r.status]}
                          />
                          <span className="text-sm font-medium text-ink">
                            {LABEL_JENIS_IMPOR[r.kind]}
                          </span>
                          {r.lokasiNama ? (
                            <span className="text-xs text-ink-muted">· {r.lokasiNama}</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-ink-muted" title={r.fileName}>
                          {r.fileName}{" "}
                          <span className="text-xs text-ink-faint">({ukuran(r.fileBytes)})</span>
                        </p>
                        {r.message ? (
                          <p className="mt-0.5 text-xs text-ink-muted">{r.message}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {formatTanggalWaktu(r.startedAt)} · oleh {r.olehNama ?? "sistem"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs text-ink-muted">
                        <p className="tabular">
                          {r.rowsAccepted.toLocaleString("id-ID")} masuk
                          {r.rowsRejected > 0 ? (
                            <span className="text-danger">
                              {" "}
                              · {r.rowsRejected.toLocaleString("id-ID")} ditolak
                            </span>
                          ) : null}
                        </p>
                        <p className="tabular text-ink-faint">
                          dari {r.rowsRead.toLocaleString("id-ID")} baris dibaca
                        </p>
                        {r.jumlahMasalah > 0 ? (
                          // Tautan, bukan tombol: rinciannya jadi URL yang bisa
                          // dikirim ke orang lain — dan itulah cara halaman
                          // seperti ini benar-benar dipakai ("coba lihat ini").
                          <a
                            href={terbuka ? "/administrasi/impor" : `/administrasi/impor?buka=${r.id}`}
                            className="mt-1 inline-block font-medium text-primary-700 hover:underline"
                          >
                            {terbuka ? "Tutup rincian" : `Lihat ${r.jumlahMasalah} catatan`}
                          </a>
                        ) : null}
                      </div>
                    </div>

                    {terbuka && dibuka ? (
                      <div className="mt-2 -mx-1 overflow-x-auto">
                        <table className="w-full min-w-[34rem] text-xs">
                          <thead>
                            <tr className="border-b border-border text-left text-ink-muted">
                              <th className="px-1 py-1.5 font-medium">Jenis</th>
                              <th className="px-1 py-1.5 font-medium">Baris</th>
                              <th className="px-1 py-1.5 font-medium">Kolom</th>
                              <th className="px-1 py-1.5 font-medium">Nilai di berkas</th>
                              <th className="px-1 py-1.5 font-medium">Keterangan</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {dibuka.masalah.map((m) => (
                              <tr key={m.id}>
                                <td className="px-1 py-1.5">
                                  <StatusPill
                                    tone={m.severity === "tolak" ? "danger" : "warning"}
                                    label={m.severity === "tolak" ? "Ditolak" : "Peringatan"}
                                  />
                                </td>
                                <td className="tabular px-1 py-1.5">{m.rowNumber ?? "—"}</td>
                                <td className="px-1 py-1.5 text-ink-muted">{m.column ?? "—"}</td>
                                {/* Nilai apa adanya — DECISIONS 203: yang
                                    ditunjukkan balik harus persis yang ditulis
                                    pengguna, bukan versi yang sudah dirapikan
                                    sistem. */}
                                <td className="px-1 py-1.5 font-mono text-ink">{m.value ?? "—"}</td>
                                <td className="px-1 py-1.5 text-ink-muted">{m.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
