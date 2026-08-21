"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import { createIssue, type IssueActionState } from "@/lib/issues";
import { setHariNihilAction, type DailyActionState } from "@/lib/daily-report/actions";
import { ALASAN_NIHIL, LABEL_ALASAN_NIHIL } from "@/lib/daily-report/nihil";
import { CalendarOff } from "lucide-react";
import type { NoActivityReason } from "@/generated/prisma/enums";

/**
 * "HARI INI TIDAK ADA KEGIATAN" (DECISIONS 396).
 *
 * Kebutuhan user 2026-08-20: *"dalam satu hari di laporan harian itu, dalam
 * hari ini tidak ada kegiatan. jadi item pekerjaan tidak harus diisi."*
 *
 * Yang dibangun bukan pelonggaran pagar melainkan PERNYATAAN: laporan yang lupa
 * diisi tetap ditolak, dan justru itu yang membuat hari nihil bisa dipercaya.
 *
 * Panel ini hanya muncul saat laporan MASIH KOSONG. Menawarkannya di samping
 * pekerjaan yang sudah tercatat cuma mengundang orang mencentang dua pernyataan
 * yang saling menyangkal – dan penjaganya di server memang akan menolak.
 */
export function HariNihilPanel({
  locationId,
  dateKey,
  nihil,
  alasan,
  catatan,
}: {
  locationId: string;
  dateKey: string;
  nihil: boolean;
  alasan: NoActivityReason | null;
  catatan: string | null;
}) {
  const [state, action, pending] = useActionState<DailyActionState, FormData>(
    setHariNihilAction,
    undefined,
  );
  const [buka, setBuka] = useState(nihil);

  // Keadaan tersimpan MENANG atas keadaan terakhir yang dikirim: sesudah
  // revalidate, prop-nya yang benar.
  const sedangNihil = state?.success ? !state.error && buka : nihil;

  if (nihil || sedangNihil) {
    return (
      <div className="space-y-2 rounded-md border border-warning bg-warning-soft p-3">
        <p className="text-sm font-medium text-ink">Hari ini dinyatakan TIDAK ADA KEGIATAN</p>
        <p className="text-[13px] text-ink-muted">
          {alasan ? LABEL_ALASAN_NIHIL[alasan] : "–"}
          {catatan ? ` – ${catatan}` : ""}
        </p>
        {state?.usulKendala ? (
          <UsulKendala judul={state.usulKendala} locationId={state.usulLokasiId ?? locationId} />
        ) : null}
        <form action={action}>
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="dateKey" value={dateKey} />
          <input type="hidden" name="nihil" value="0" />
          <Button size="sm" variant="secondary" type="submit" loading={pending}>
            Batalkan – ternyata ada kegiatan
          </Button>
        </form>
        {state?.error ? <Banner tone="error" title={state.error} /> : null}
      </div>
    );
  }

  if (!buka) {
    /*
     * KARTU, bukan tombol sekunder kecil.
     *
     * Keluhan user 2026-08-20: *"tombol hari ini tidak ada kegiatan kurang
     * standout/menonjol"*. Versi pertamanya adalah tombol abu-abu seukuran
     * "Tambah material" dan "Tambah alat" — jadi jalan keluar SATU-SATUNYA
     * untuk hari kosong tampak setara dengan pelengkap opsional, dan orang
     * lapangan yang tidak menemukannya akan memilih jalan yang sudah ia tahu:
     * tidak melapor sama sekali.
     *
     * Garis putus-putus dipilih dengan sengaja: ia menandai JALUR ALTERNATIF,
     * bukan tindakan utama. Formulir item tetap yang menonjol karena hari
     * berkegiatan memang jauh lebih sering — yang salah bukan urutannya,
     * melainkan bahwa pilihan keduanya nyaris tak terlihat.
     */
    return (
      <div className="rounded-lg border-2 border-dashed border-border bg-surface-muted p-4">
        <div className="flex items-start gap-3">
          <CalendarOff aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">Hari ini tidak ada kegiatan?</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
              Hujan, libur, atau menunggu material/lahan – tetap harus dilaporkan. Sebabnya dicatat
              supaya hari hujan bisa dihitung untuk klaim perpanjangan waktu.
            </p>
            <Button className="mt-3 w-full sm:w-auto" onClick={() => setBuka(true)}>
              Nyatakan tidak ada kegiatan
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="dateKey" value={dateKey} />
      <input type="hidden" name="nihil" value="1" />
      <p className="text-sm font-medium text-ink">Hari ini tidak ada kegiatan</p>
      <div>
        <Label htmlFor="nihil-alasan" required>
          Sebabnya
        </Label>
        <Combobox id="nihil-alasan" name="alasan" required defaultValue={alasan ?? ""}>
          {ALASAN_NIHIL.map((a) => (
            <option key={a} value={a}>
              {LABEL_ALASAN_NIHIL[a]}
            </option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="nihil-catatan">Keterangan (opsional)</Label>
        <Input
          id="nihil-catatan"
          name="catatan"
          maxLength={500}
          defaultValue={catatan ?? ""}
          placeholder="mis. hujan deras sejak subuh, lokasi tergenang"
        />
      </div>
      {/*
        Sebabnya bukan formalitas: di kurva-S hujan, libur, dan menunggu
        sama-sama 0%, tapi hujan adalah dasar klaim perpanjangan waktu dan
        "menunggu" adalah kendala yang harus ditagih. Orang berhak tahu kenapa
        ditanya.
      */}
      <p className="text-[12px] text-ink-muted">
        Sebabnya dicatat supaya bisa dihitung – hari hujan menjadi dasar klaim perpanjangan waktu,
        dan hari &quot;menunggu&quot; bisa ditagih lewat papan kendala.
      </p>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={pending}>
          Simpan
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => setBuka(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}

/**
 * Tawaran mencatat hambatan sebagai kendala – MENAWARKAN, tidak memaksa.
 *
 * Memaksa akan memenuhi papan dengan baris dari hari-hari yang sebenarnya satu
 * masalah berlarut; tidak menawarkan sama sekali mengulang cacat yang baru saja
 * diperbaiki (DECISIONS 392): hambatan tercatat lalu tidak ditagih siapa pun.
 */
function UsulKendala({ judul, locationId }: { judul: string; locationId: string }) {
  const [state, action, pending] = useActionState<IssueActionState, FormData>(
    createIssue,
    undefined,
  );
  if (state?.success) return <Banner tone="success" title={state.success} />;
  if (state?.duplikat?.length) {
    // Penjaga duplikat sudah menahannya – hari kedua menunggu hal yang sama
    // tidak melahirkan kendala kembar.
    return (
      <Banner
        tone="info"
        title={`Sudah ada kendala serupa yang terbuka: "${state.duplikat[0].title}" – tidak dicatat dua kali.`}
      />
    );
  }
  return (
    <form action={action} className="rounded-md border border-border bg-surface p-2">
      <p className="text-[13px] text-ink">
        Pekerjaan tertahan menunggu. Catat sebagai kendala supaya ada yang menagihnya?
      </p>
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="title" value={judul} />
      <input type="hidden" name="severity" value="sedang" />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <Button size="sm" variant="secondary" type="submit" loading={pending} className="mt-2">
        Catat sebagai kendala
      </Button>
    </form>
  );
}
