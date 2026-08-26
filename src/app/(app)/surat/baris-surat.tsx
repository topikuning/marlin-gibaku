"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Paperclip } from "lucide-react";
import { Badge, Button, Combobox, Input, Label, type BadgeTone } from "@/components/ui";
import {
  batalkanSuratAction,
  petakanSuratAction,
  pulihkanSuratAction,
  ubahStatusSuratAction,
  type SuratState,
} from "@/lib/surat/actions";

export type BarisSuratProps = {
  id: string;
  agenda: string;
  arahLabel: string;
  arah: "masuk" | "keluar";
  pihak: string;
  subject: string;
  nomor: string | null;
  tanggalSurat: string | null;
  tanggalTangani: string;
  kategoriLabel: string;
  statusLabel: string;
  statusTone: BadgeTone;
  status: string;
  paketNama: string | null;
  lokasiNama: string | null;
  lokasiSlug: string | null;
  /** Berkas surat terarsip di R2 – dibuka lewat /api/surat/[id]/berkas. */
  punyaBerkas: boolean;
  namaBerkas: string | null;
  /** Sisa hari menuju tenggat; negatif = lewat. null = tidak menuntut jawaban. */
  sisaHari: number | null;
  jumlahKendala: number;
  jumlahTemuan: number;
  bolehKelola: boolean;
  /** Boleh membatalkan/memulihkan surat (capability `letter.void`). */
  bolehBatalkan: boolean;
  dibatalkan: boolean;
  alasanBatal: string | null;
  lokasi: { id: string; name: string }[];
};

/**
 * Satu baris register surat. Tenggat jawaban ditulis sebagai KALIMAT, bukan
 * tanggal saja — "lewat 3 hari" langsung terbaca, "12 Agu 2026" menuntut orang
 * menghitung sendiri.
 */
export function BarisSurat(p: BarisSuratProps) {
  const [statusState, statusAction, statusPending] = useActionState<SuratState, FormData>(
    ubahStatusSuratAction,
    undefined,
  );
  const [petakanState, petakanAction, petakanPending] = useActionState<SuratState, FormData>(
    petakanSuratAction,
    undefined,
  );
  const [batalState, batalAction, batalPending] = useActionState<SuratState, FormData>(
    batalkanSuratAction,
    undefined,
  );
  const [pulihState, pulihAction, pulihPending] = useActionState<SuratState, FormData>(
    pulihkanSuratAction,
    undefined,
  );
  const [formPetakan, setFormPetakan] = useState(false);
  const [formBatal, setFormBatal] = useState(false);
  const pesan = statusState ?? petakanState ?? batalState ?? pulihState;

  const tenggat =
    p.sisaHari == null
      ? null
      : p.sisaHari < 0
        ? { teks: `Lewat tenggat ${Math.abs(p.sisaHari)} hari`, tone: "danger" as BadgeTone }
        : p.sisaHari === 0
          ? { teks: "Jatuh tempo hari ini", tone: "warning" as BadgeTone }
          : { teks: `Sisa ${p.sisaHari} hari`, tone: "warning" as BadgeTone };

  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="tabular shrink-0 text-xs text-ink-faint">#{p.agenda}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{p.subject}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {[
              p.arahLabel,
              p.pihak,
              p.nomor ? `No. ${p.nomor}` : null,
              p.tanggalSurat ? `Surat ${p.tanggalSurat}` : null,
              `Ditangani ${p.tanggalTangani}`,
              p.paketNama,
              p.lokasiNama,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {/*
            Berkas & lokasi diberi PINTU, bukan sekadar disebut (DECISIONS 436).
            Arsip yang tidak bisa dibuka sama saja dengan tidak diarsipkan.
          */}
          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              {p.punyaBerkas ? (
                <a
                  href={`/api/surat/${p.id}/berkas`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Paperclip aria-hidden className="size-3.5" />
                  {p.namaBerkas || "Buka berkas surat"}
                </a>
              ) : (
                <span className="text-ink-faint">Tanpa berkas terarsip</span>
              )}
              {p.lokasiSlug ? (
                <Link href={`/lokasi/${p.lokasiSlug}`} className="text-primary hover:underline">
                  Buka lokasi
                </Link>
            ) : null}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone="neutral" label={p.kategoriLabel} />
          <Badge tone={p.statusTone} label={p.statusLabel} />
          {tenggat ? <Badge tone={tenggat.tone} label={tenggat.teks} /> : null}
          {p.jumlahKendala > 0 ? <Badge tone="warning" label={`${p.jumlahKendala} kendala`} /> : null}
          {p.jumlahTemuan > 0 ? <Badge tone="warning" label={`${p.jumlahTemuan} temuan`} /> : null}
        </span>
      </div>

      {/*
        Surat yang dibatalkan tidak menawarkan tindak lanjut apa pun
        (DECISIONS 437): sebabnya dibaca dulu, lalu dipulihkan bila keliru.
      */}
      {p.dibatalkan ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-danger">
            Dibatalkan{p.alasanBatal ? ` – ${p.alasanBatal}` : ""}.
          </p>
          {p.bolehBatalkan ? (
            <form action={pulihAction}>
              <input type="hidden" name="letterId" value={p.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={pulihPending}>
                Pulihkan surat
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {p.bolehKelola && !p.dibatalkan ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <form action={statusAction} className="flex gap-1.5">
            <input type="hidden" name="letterId" value={p.id} />
            {p.status === "perlu_jawaban" || p.status === "baru" ? (
              <Button type="submit" name="status" value="dijawab" size="sm" variant="secondary" disabled={statusPending}>
                Tandai sudah dijawab
              </Button>
            ) : null}
            {p.status !== "selesai" && p.status !== "arsip" ? (
              <Button type="submit" name="status" value="selesai" size="sm" variant="ghost" disabled={statusPending}>
                Selesai
              </Button>
            ) : null}
          </form>
          <Button size="sm" variant="ghost" onClick={() => setFormPetakan((v) => !v)}>
            {formPetakan ? "Batal" : "Jadikan kendala/temuan"}
          </Button>
          {p.bolehBatalkan ? (
            <Button size="sm" variant="ghost" onClick={() => setFormBatal((v) => !v)}>
              {formBatal ? "Urung" : "Batalkan surat"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/*
        Sebab pembatalan WAJIB ditulis. Baris yang hilang tanpa alasan
        meninggalkan pertanyaan yang tak bisa dijawab siapa pun kelak.
      */}
      {formBatal && !p.dibatalkan ? (
        <form action={batalAction} className="mt-2 space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <input type="hidden" name="letterId" value={p.id} />
          <Label htmlFor={`alasan-${p.id}`} required>
            Sebab pembatalan
          </Label>
          <Input
            id={`alasan-${p.id}`}
            name="alasan"
            required
            minLength={5}
            placeholder="mis. salah ketik nomor, atau surat ini duplikat agenda 3/2026"
          />
          <Button type="submit" size="sm" variant="danger" disabled={batalPending} loading={batalPending}>
            Batalkan surat ini
          </Button>
          <p className="text-[11px] text-ink-faint">
            Surat tidak dihapus: ia hilang dari daftar &amp; hitungan, tapi tetap bisa dibuka lewat saringan
            &quot;Dibatalkan&quot; dan dipulihkan. Nomor agendanya tidak dipakai ulang.
          </p>
        </form>
      ) : null}

      {formPetakan ? (
        <form action={petakanAction} className="mt-2 space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <input type="hidden" name="letterId" value={p.id} />
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label htmlFor={`jadi-${p.id}`} required>
                Dicatat sebagai
              </Label>
              <Combobox
                id={`jadi-${p.id}`}
                name="jadi"
                defaultValue="kendala"
                options={[
                  { value: "kendala", label: "Kendala (menghambat pelaksanaan)" },
                  { value: "temuan", label: "Temuan (hasil pemeriksaan)" },
                ]}
              />
            </div>
            <div>
              <Label htmlFor={`lok-${p.id}`} required>
                Lokasi
              </Label>
              <Combobox
                id={`lok-${p.id}`}
                name="locationId"
                defaultValue={p.lokasi[0]?.id ?? ""}
                options={p.lokasi.map((l) => ({ value: l.id, label: l.name }))}
              />
            </div>
            <div>
              <Label htmlFor={`bobot-${p.id}`}>Bobot</Label>
              <Combobox
                id={`bobot-${p.id}`}
                name="severity"
                defaultValue="sedang"
                options={[
                  { value: "rendah", label: "Rendah" },
                  { value: "sedang", label: "Sedang" },
                  { value: "tinggi", label: "Tinggi" },
                ]}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`judul-${p.id}`} required>
              Judul
            </Label>
            <Input id={`judul-${p.id}`} name="judul" defaultValue={p.subject} required />
          </div>
          <Button type="submit" size="sm" disabled={petakanPending} loading={petakanPending}>
            Buat dari surat ini
          </Button>
          <p className="text-[11px] text-ink-faint">
            Sumbernya dicatat sebagai &quot;surat&quot; dan surat ini tetap tertaut, jadi asal-usulnya bisa
            dibuka lagi dari papan kendala/temuan.
          </p>
        </form>
      ) : null}

      {pesan?.error ? <p className="mt-1 text-xs text-danger">{pesan.error}</p> : null}
      {pesan?.success ? <p className="mt-1 text-xs text-success">{pesan.success}</p> : null}
    </li>
  );
}
