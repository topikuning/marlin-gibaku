import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { ISSUE_SEVERITY_LABEL, ISSUE_SEVERITY_TONE } from "@/lib/lifecycle";
import type { JenisPeristiwa, KondisiTerkini, Peristiwa } from "@/lib/kronologi/susun";

/**
 * Garis waktu kronologi + kondisi terkini — bentuk DETERMINISTIK-nya.
 *
 * Dipakai halaman `/ai/kronologi` dan halaman detail run. Ia tampil apa pun
 * yang terjadi pada AI: kalau narasinya gagal dibentuk, inilah jawabannya, bukan
 * pelengkapnya. Tidak ada satu angka pun dihitung di sini; semuanya datang dari
 * `susunKronologi`.
 */

const LABEL: Record<JenisPeristiwa, string> = {
  kendala_dibuka: "Kendala muncul",
  kendala_ditutup: "Kendala selesai",
  kegiatan: "Kegiatan",
};

const TONE: Record<JenisPeristiwa, "danger" | "success" | "neutral"> = {
  kendala_dibuka: "danger",
  kendala_ditutup: "success",
  kegiatan: "neutral",
};

export type KronologiView = {
  sejak: string;
  sampai: string;
  peristiwa: Peristiwa[];
  kondisi: KondisiTerkini;
  dipotong: number;
};

export function KronologiGarisWaktu({ k, judul }: { k: KronologiView; judul?: string }) {
  const c = k.kondisi;
  return (
    <Card>
      <CardHeader
        title={judul ?? "Kronologi lokasi"}
        subtitle={`${k.sejak} s.d. ${k.sampai} · kendala dan kegiatan lapangan, terbaru dulu`}
      />
      <CardBody className="space-y-4 text-sm">
        <div className="rounded-lg border border-line bg-surface-inset px-3 py-2">
          <p className="text-[12px] tracking-wide text-ink-muted uppercase">Kondisi terkini</p>
          <ul className="mt-1 space-y-0.5 text-ink">
            <li>
              {c.kendalaTerbuka === 0
                ? "Tidak ada kendala yang masih terbuka."
                : `${c.kendalaTerbuka} kendala masih terbuka` +
                  (c.kendalaKritis > 0 ? `, ${c.kendalaKritis} di antaranya kritis` : "") +
                  (c.kendalaLewatTenggat > 0 ? `, ${c.kendalaLewatTenggat} lewat tenggat` : "") +
                  (c.kendalaTertuaHari !== null ? `; yang tertua sudah ${c.kendalaTertuaHari} hari` : "") +
                  "."}
            </li>
            <li>
              {c.kegiatanTerakhir === null
                ? "Belum ada kegiatan lapangan yang tercatat."
                : `Kegiatan lapangan terakhir ${c.kegiatanTerakhir}` +
                  (c.hariTanpaKegiatan !== null ? ` – ${c.hariTanpaKegiatan} hari lalu` : "") +
                  "."}
            </li>
            <li className="text-ink-muted">
              Dalam rentang ini: {c.kegiatanDalamJendela} kegiatan
              {c.drafKegiatan > 0 ? ` (${c.drafKegiatan} masih draf)` : ""}, {c.kendalaSelesaiDalamJendela}{" "}
              kendala selesai.
            </li>
          </ul>
        </div>

        {k.peristiwa.length === 0 ? (
          <p className="text-ink-muted">
            Belum ada kendala maupun kegiatan lapangan yang tercatat pada rentang ini.
          </p>
        ) : (
          <ol className="space-y-2">
            {k.peristiwa.map((p) => (
              <li key={p.kunci} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-[13px] text-ink-muted">{p.tanggal}</span>
                  <Badge tone={TONE[p.jenis]} label={LABEL[p.jenis]} />
                  {p.tingkat ? (
                    <Badge
                      tone={ISSUE_SEVERITY_TONE[p.tingkat]}
                      label={ISSUE_SEVERITY_LABEL[p.tingkat]}
                    />
                  ) : null}
                  {p.lewatTenggat ? <Badge tone="danger" label="Lewat tenggat" /> : null}
                  {p.jenis === "kegiatan" && p.status === "draft" ? (
                    <Badge tone="warning" label="Draf" />
                  ) : null}
                </div>
                <p className="mt-0.5 font-medium text-ink">{p.judul}</p>
                {p.rincian.map((r, i) => (
                  <p key={i} className="text-[13px] text-ink-muted">
                    {r}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        )}

        {k.dipotong > 0 ? (
          <p className="text-[13px] text-ink-muted">
            {k.dipotong} kejadian lebih lama tidak ditampilkan – rentangnya dibatasi supaya terbaca.
            Yang masih berjalan tidak pernah ikut dipotong.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
