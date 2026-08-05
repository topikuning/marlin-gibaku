import Link from "next/link";
import { CheckCircle2, ChevronRight, Filter } from "lucide-react";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatTanggal } from "@/lib/format";
import {
  getAntreanTindakan,
  LABEL_JENIS,
  ringkasPerJenis,
  type ItemTindakan,
  type JenisTindakan,
  type Keparahan,
} from "@/lib/tindakan";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

/**
 * PERLU TINDAKAN — satu antrean untuk semua yang menunggu keputusan.
 *
 * Menggantikan kebiasaan lama "cek Beranda, lalu cek Pusat Laporan, lalu cek
 * hub AI" dengan satu daftar yang sudah terurut menurut keparahan dan
 * keterlambatan. Setiap baris menuju DATA PEMBENTUKNYA — editor laporan,
 * halaman progress lokasi, berkas dokumen — bukan ke ringkasan lain
 * (PRD §5.1: "Kartu tindakan harus membuka data pembentuk").
 */
export default async function TindakanPage({
  searchParams,
}: {
  searchParams: Promise<{ jenis?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");

  const { jenis } = await searchParams;
  const items = await getAntreanTindakan(user);
  const jumlah = ringkasPerJenis(items);

  // Filter hanya menyaring TAMPILAN; jumlah pada chip tetap dihitung dari
  // seluruh antrean, supaya menyaring tidak pernah terbaca "sisanya hilang".
  const jenisAktif = isJenis(jenis) ? jenis : null;
  const tampil = jenisAktif ? items.filter((i) => i.jenis === jenisAktif) : items;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Perlu Tindakan"
        description={
          items.length > 0
            ? `${items.length} hal menunggu keputusan Anda — diurutkan dari yang paling mendesak.`
            : "Tidak ada yang menunggu tindakan."
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Antrean kosong"
          description="Tidak ada laporan menunggu verifikasi, kendala terbuka, recovery lewat tenggat, dokumen kedaluwarsa, atau pengajuan keuangan pada lokasi yang Anda pegang."
        />
      ) : (
        <>
          <FilterJenis jumlah={jumlah} aktif={jenisAktif} total={items.length} />

          {tampil.length === 0 ? (
            <EmptyState
              icon={Filter}
              title={`Tidak ada item "${LABEL_JENIS[jenisAktif!]}"`}
              description="Jenis lain masih berisi — hapus penyaring untuk melihat seluruh antrean."
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {tampil.map((item) => (
                <BarisTindakan key={item.key} item={item} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const SEMUA_JENIS: JenisTindakan[] = [
  "verifikasi",
  "koreksi",
  "deviasi",
  "kendala",
  "recovery",
  "dokumen",
  "keuangan",
];

function isJenis(v: string | undefined): v is JenisTindakan {
  return !!v && (SEMUA_JENIS as string[]).includes(v);
}

/**
 * Penyaring jenis. Jenis yang JUMLAHNYA NOL tetap tidak ditampilkan — chip
 * kosong hanya menambah pilihan yang tidak menghasilkan apa-apa. Jumlah yang
 * disembunyikan tak perlu disebut di sini karena nol memang berarti tidak ada.
 */
function FilterJenis({
  jumlah,
  aktif,
  total,
}: {
  jumlah: Record<JenisTindakan, number>;
  aktif: JenisTindakan | null;
  total: number;
}) {
  const berisi = SEMUA_JENIS.filter((j) => jumlah[j] > 0);
  if (berisi.length <= 1) return null;

  return (
    <nav aria-label="Saring menurut jenis" className="flex flex-wrap gap-2">
      <ChipFilter href="/tindakan" label="Semua" jumlah={total} aktif={aktif === null} />
      {berisi.map((j) => (
        <ChipFilter
          key={j}
          href={`/tindakan?jenis=${j}`}
          label={LABEL_JENIS[j]}
          jumlah={jumlah[j]}
          aktif={aktif === j}
        />
      ))}
    </nav>
  );
}

function ChipFilter({
  href,
  label,
  jumlah,
  aktif,
}: {
  href: string;
  label: string;
  jumlah: number;
  aktif: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={aktif ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors",
        aktif
          ? "border-primary bg-primary text-white"
          : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
      )}
    >
      {label}
      <span className={cn("tabular", aktif ? "text-primary-200" : "text-ink-faint")}>{jumlah}</span>
    </Link>
  );
}

const TONE_KEPARAHAN: Record<Keparahan, "danger" | "warning" | "info"> = {
  kritis: "danger",
  perhatian: "warning",
  info: "info",
};

const GARIS_KEPARAHAN: Record<Keparahan, string> = {
  kritis: "bg-danger",
  perhatian: "bg-warning",
  info: "bg-primary-300",
};

function BarisTindakan({ item }: { item: ItemTindakan }) {
  return (
    <li className="relative">
      <Link
        href={item.href}
        className="flex items-center gap-3 py-3 pr-3 pl-4 transition-colors hover:bg-surface-muted"
      >
        {/* Keparahan ditandai garis DAN chip berteks — status tidak pernah
            disampaikan lewat warna saja (Design System §5). */}
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-1", GARIS_KEPARAHAN[item.keparahan])}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill tone={TONE_KEPARAHAN[item.keparahan]} label={LABEL_JENIS[item.jenis]} />
            <span className="truncate text-sm font-semibold text-ink">{item.judul}</span>
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">{item.detail}</span>
        </span>
        {item.jatuhTempo ? (
          <span className="hidden shrink-0 text-right text-[11.5px] text-ink-muted sm:block">
            <span className="block">{formatTanggal(item.jatuhTempo)}</span>
            {item.telatHari !== null && item.telatHari > 0 ? (
              <span className="block font-semibold text-danger">telat {item.telatHari} hari</span>
            ) : null}
          </span>
        ) : null}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
      </Link>
    </li>
  );
}
