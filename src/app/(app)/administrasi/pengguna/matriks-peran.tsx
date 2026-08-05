import { Card, CardBody, CardHeader } from "@/components/ui";
import { ALL_ROLES, CROSS_LOCATION_ROLES, ROLE_LABEL, creatableRoles } from "@/lib/authz";
import {
  KELOMPOK_KEMAMPUAN,
  KEMAMPUAN_LABEL,
  selKemampuan,
  type TingkatKemampuan,
} from "@/lib/authz-ringkas";
import { cn } from "@/lib/cn";

/**
 * MATRIKS PERAN → KEMAMPUAN INTI.
 *
 * Membuat akun berarti memilih peran, dan sampai sekarang pemilihnya harus
 * menebak: nama peran tidak memberi tahu apa pun tentang apa yang akan bisa
 * dilakukan akun itu besok. Tabel ini menjawabnya di tempat keputusannya
 * diambil.
 *
 * Angkanya DIHITUNG dari `ROLE_CAPABILITIES`, bukan ditulis tangan. Matriks
 * peran yang diketik manual adalah dokumen yang paling cepat berbohong —
 * capability berpindah peran lewat satu baris di `authz.ts` dan tidak ada yang
 * ingat memperbarui tabelnya. Di sini tidak ada yang perlu diingat.
 */

const TINGKAT_KELAS: Record<TingkatKemampuan, string> = {
  penuh: "bg-success-soft text-success border-success-border",
  sebagian: "bg-warning-soft text-warning border-warning-border",
  tidak: "bg-surface-inset text-ink-faint border-border",
};

const TINGKAT_TANDA: Record<TingkatKemampuan, string> = {
  penuh: "penuh",
  sebagian: "sebagian",
  tidak: "—",
};

export function MatriksPeran({ highlight }: { highlight?: readonly string[] }) {
  const disorot = new Set(highlight ?? []);

  return (
    <Card>
      <CardHeader
        title="Matriks peran → kemampuan inti"
        subtitle={`${ALL_ROLES.length} peran · ${KELOMPOK_KEMAMPUAN.length} kelompok kemampuan · dihitung langsung dari aturan otorisasi`}
      />
      <CardBody className="space-y-4">
        {/*
         * Kontainer ber-scroll SENDIRI: 11 kolom tidak akan pernah muat di
         * 375px, dan memaksakannya berarti melebarkan seluruh halaman —
         * di Safari iOS seisi halaman ikut diperkecil (DECISIONS 010/217).
         */}
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left font-semibold text-ink-muted"
                >
                  Peran
                </th>
                {KELOMPOK_KEMAMPUAN.map((k) => (
                  <th
                    key={k.key}
                    scope="col"
                    title={k.arti}
                    className="px-1.5 py-2 text-center align-bottom font-semibold text-ink-muted"
                  >
                    {k.nama}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_ROLES.map((role) => {
                const sorot = disorot.has(role);
                return (
                  <tr key={role} className={cn(sorot && "bg-info-soft/40")}>
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 z-10 border-t border-border py-2 pr-3 text-left font-medium whitespace-nowrap",
                        sorot ? "bg-info-soft/40 text-ink" : "bg-surface text-ink",
                      )}
                    >
                      {ROLE_LABEL[role]}
                      {CROSS_LOCATION_ROLES.has(role) ? (
                        <span
                          className="ml-1.5 text-ink-faint"
                          title="Melihat seluruh lokasi organisasinya tanpa perlu penugasan."
                        >
                          lintas lokasi
                        </span>
                      ) : null}
                    </th>
                    {KELOMPOK_KEMAMPUAN.map((k) => {
                      const sel = selKemampuan(role, k);
                      const rinci =
                        sel.dimiliki.length === 0
                          ? `${ROLE_LABEL[role]} tidak punya kemampuan apa pun di kelompok ${k.nama}.`
                          : `${ROLE_LABEL[role]} — ${k.nama} (${sel.dimiliki.length}/${sel.total}):\n· ${sel.dimiliki
                              .map((c) => KEMAMPUAN_LABEL[c])
                              .join("\n· ")}`;
                      return (
                        <td key={k.key} className="border-t border-border px-1 py-1.5 text-center">
                          <span
                            title={rinci}
                            className={cn(
                              "inline-flex min-w-[3.5rem] cursor-help items-center justify-center rounded-full border px-1.5 py-0.5 font-medium",
                              TINGKAT_KELAS[sel.tingkat],
                            )}
                          >
                            {sel.tingkat === "sebagian"
                              ? `${sel.dimiliki.length}/${sel.total}`
                              : TINGKAT_TANDA[sel.tingkat]}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-2.5 rounded-full bg-success" aria-hidden />
            penuh — seluruh kemampuan kelompok itu
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-2.5 rounded-full bg-warning" aria-hidden />
            n/N — sebagian; arahkan kursor untuk daftar tepatnya
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block size-2.5 rounded-full bg-border" aria-hidden />
            — tidak ada
          </span>
        </div>

        {/*
         * Yang membedakan tabel ini dari sekadar hiasan: konsekuensinya
         * dinyatakan. PRD menuntut Administrasi menyebut DAMPAK tiap aksi,
         * bukan hanya menampilkannya.
         */}
        <ul className="space-y-1.5 border-t border-border pt-3 text-xs text-ink-muted">
          <li>
            Peran berjenjang sebagai <strong className="font-medium text-ink">superset</strong>: Area
            Manager bisa semua yang bisa dilakukan Project Manager, dan seterusnya ke bawah. Yang
            khas atasan hanyalah pengesahan — persetujuan pengeluaran dan pembekuan laporan.
          </li>
          <li>
            Kemampuan <strong className="font-medium text-ink">bukan</strong> akses data. Sejauh mana
            data terlihat ditentukan penugasan lokasi/paket; peran tanpa penanda “lintas lokasi”
            hanya melihat lokasi yang ditugaskan — tanpa penugasan berarti nol lokasi, bukan
            semuanya.
          </li>
          <li>
            Menu menyaring diri per peran, tetapi <strong className="font-medium text-ink">server
            tetap menolak</strong> secara terpisah. Menyembunyikan tombol bukan pengamanan.
          </li>
          <li>
            Larangan mengesahkan pekerjaan sendiri dijaga per <em>orang</em>, bukan per peran —
            setelan <code className="text-[11px]">daily_report.approver_must_differ</code> di halaman
            Sistem, bukan di tabel ini.
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}

/**
 * Kebijakan akun — aturan yang berlaku pada SETIAP akun yang dibuat di halaman
 * ini. Ditulis di sebelah formulirnya karena di situlah aturan itu berlaku;
 * di halaman bantuan terpisah ia tidak akan pernah dibaca.
 */
export function KebijakanAkun({ actorRole }: { actorRole: Parameters<typeof creatableRoles>[0] }) {
  const boleh = creatableRoles(actorRole);
  return (
    <Card>
      <CardHeader title="Kebijakan akun" />
      <CardBody>
        <ul className="space-y-2.5 text-sm text-ink-muted">
          <li>
            <strong className="font-medium text-ink">Tidak ada pendaftaran mandiri.</strong> Akun
            hanya dibuat administrator, dan password awalnya wajib diganti saat login pertama.
          </li>
          <li>
            <strong className="font-medium text-ink">Reset password</strong> mengembalikan pengguna
            ke alur ganti password — bukan mengirimkan password lama.
          </li>
          <li>
            <strong className="font-medium text-ink">Nonaktifkan ≠ hapus.</strong> Akun nonaktif
            tidak bisa masuk, tetapi riwayat dan atribusi laporannya tetap utuh. Karena itu akun
            tidak bisa dihapus.
          </li>
          <li>
            <strong className="font-medium text-ink">Penugasan menentukan cakupan data.</strong>{" "}
            Lokasi dan paket yang ditugaskan adalah batas yang dilihat akun itu — memberi peran saja
            tidak membuka data apa pun.
          </li>
          <li>
            <strong className="font-medium text-ink">Anda tidak bisa menyentuh akun setingkat atau
            di atas Anda.</strong>{" "}
            {boleh.length === 0
              ? "Peran Anda tidak berwenang membuat akun."
              : `Peran yang boleh Anda buat: ${boleh.map((r) => ROLE_LABEL[r]).join(", ")}.`}
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}
