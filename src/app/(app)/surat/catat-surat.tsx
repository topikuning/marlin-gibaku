"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState, useTransition } from "react";
import { Badge, Banner, Button, Card, CardBody, Combobox, FileInput, Input, Label, Textarea } from "@/components/ui";
import { Plus, Sparkles } from "lucide-react";
import { bacaBerkasSuratAction, catatSuratAction, type BacaSuratState, type SuratState } from "@/lib/surat/actions";

const PIHAK = [
  { value: "penyedia", label: "Penyedia" },
  { value: "wakil_ppk", label: "Wakil PPK" },
  { value: "ppk", label: "PPK" },
  { value: "konsultan", label: "Konsultan pengawas" },
  { value: "dinas", label: "Dinas/instansi" },
  { value: "internal", label: "Internal" },
  { value: "lainnya", label: "Lainnya" },
];

const KATEGORI = [
  { value: "administrasi", label: "Administrasi" },
  { value: "mutu", label: "Mutu" },
  { value: "jadwal", label: "Jadwal" },
  { value: "pembayaran", label: "Pembayaran" },
  { value: "koordinasi", label: "Koordinasi" },
  { value: "k3", label: "K3" },
  { value: "lainnya", label: "Lainnya" },
];

type Isian = {
  direction: string;
  party: string;
  partyName: string;
  subject: string;
  letterNumber: string;
  letterDate: string;
  category: string;
  needsReply: string;
  replyDueDate: string;
  summary: string;
  packageId: string;
  locationId: string;
};

const KOSONG: Isian = {
  direction: "masuk",
  party: "penyedia",
  partyName: "",
  subject: "",
  letterNumber: "",
  letterDate: "",
  category: "administrasi",
  needsReply: "tidak",
  replyDueDate: "",
  summary: "",
  packageId: "",
  locationId: "",
};

/**
 * Catat surat di register (DECISIONS 432/434).
 *
 * Dua jalan, dipilih di depan: **isi sendiri** atau **dibantu AI**. Yang
 * dibantu AI mengunggah berkasnya lalu SATU permintaan memetakan seluruh
 * isian — ketetapan user 2026-08-26: *"sekali kirim... sekali request saja"*.
 *
 * Hasil AI mengisi formulir yang SAMA, tidak menyimpan apa pun sendiri: orang
 * membaca, membetulkan, lalu menekan simpan. Itu sebabnya isian tetap satu
 * bentuk untuk kedua jalan — tidak ada jalur "AI" yang melewati pemeriksaan.
 */
export function CatatSurat({
  paket,
  lokasi,
}: {
  paket: { id: string; name: string }[];
  lokasi: { id: string; name: string }[];
}) {
  const [state, action, pending] = useAksi<SuratState>(catatSuratAction, undefined);
  const [bacaState, bacaAction, bacaPending] = useAksi<BacaSuratState>(
    bacaBerkasSuratAction,
    undefined,
  );
  const [buka, setBuka] = useState(false);
  const [mode, setMode] = useState<"pilih" | "manual" | "ai">("pilih");
  const [isi, setIsi] = useState<Isian>(KOSONG);
  const [potensi, setPotensi] = useState<{ jenis: string; alasan: string | null } | null>(null);
  const hariIni = new Date().toISOString().slice(0, 10);

  /*
   * Berkasnya ditahan di state, BUKAN di dalam form baca.
   *
   * Bug DECISIONS 436: dulu input berkas berada di dalam form "baca dengan AI",
   * sehingga saat tombol simpan ditekan berkas itu tidak ikut terkirim —
   * suratnya tercatat, berkasnya lenyap. Satu berkas kini dipegang di sini dan
   * dipakai dua-duanya: dikirim ke AI untuk dibaca, dan ikut disimpan.
   */
  const [berkas, setBerkas] = useState<File | null>(null);
  const [membaca, mulaiBaca] = useTransition();

  // Hasil AI mengisi formulir sekali, lalu bebas disunting orang.
  const hasil = bacaState && "hasil" in bacaState ? bacaState.hasil : undefined;
  const [sudahTerisi, setSudahTerisi] = useState(false);
  if (hasil && !sudahTerisi) {
    setSudahTerisi(true);
    setIsi({
      direction: hasil.arah,
      party: hasil.pihak,
      partyName: hasil.namaPihak ?? "",
      subject: hasil.perihal ?? "",
      letterNumber: hasil.nomor ?? "",
      letterDate: hasil.tanggal ?? "",
      category: hasil.kategori,
      needsReply: hasil.butuhJawaban ? "ya" : "tidak",
      replyDueDate: hasil.tenggat ?? "",
      summary: hasil.ringkasan ?? "",
      packageId: hasil.packageId ?? "",
      locationId: hasil.locationId ?? "",
    });
    setPotensi(hasil.potensi !== "tidak" ? { jenis: hasil.potensi, alasan: hasil.alasanPotensi } : null);
  }

  const tutup = () => {
    setBuka(false);
    setMode("pilih");
    setIsi(KOSONG);
    setPotensi(null);
    setSudahTerisi(false);
    setBerkas(null);
  };

  /*
   * Setelah tersimpan, formulirnya DITUTUP (DECISIONS 436).
   *
   * Laporan user 2026-08-26: form tetap aktif setelah "Surat tercatat", jadi
   * menekan simpan sekali lagi membuat baris kedua yang bisa ditindaklanjuti
   * sendiri-sendiri. Pagar servernya sudah ada, tapi layar yang membiarkan
   * orang menekan tombol yang pasti gagal tetap salah.
   */
  const [suksesTerakhir, setSuksesTerakhir] = useState<string | null>(null);
  if (state?.success && state.success !== suksesTerakhir) {
    setSuksesTerakhir(state.success);
    tutup();
  }

  const bacaBerkas = () => {
    if (!berkas) return;
    const fd = new FormData();
    fd.set("file", berkas);
    mulaiBaca(() => bacaAction(fd));
  };

  /** Berkas yang dipegang state ikut dititipkan ke FormData saat menyimpan. */
  const simpan = (fd: FormData) => {
    if (berkas) fd.set("file", berkas);
    else fd.delete("file");
    action(fd);
  };

  if (!buka) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => setBuka(true)}>
          <Plus aria-hidden className="size-4" />
          Catat surat
        </Button>
        {state?.success ? <span className="text-sm text-success">{state.success}</span> : null}
      </div>
    );
  }

  // Langkah 1: pilih cara mengisi.
  if (mode === "pilih") {
    return (
      <Card>
        <CardBody className="space-y-3">
          <p className="text-sm font-medium text-ink">Bagaimana surat ini dicatat?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("ai")}
              className="rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-surface-muted"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <Sparkles aria-hidden className="size-4 text-primary" />
                Unggah berkas, dibantu AI
              </span>
              <span className="mt-1 block text-[13px] text-ink-muted">
                Unggah PDF atau foto suratnya. Sekali baca, AI mengisi nomor, tanggal, pihak, perihal,
                maksud surat, sampai lokasi &amp; paket yang disebut. Anda tinggal memeriksa.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-surface-muted"
            >
              <span className="text-sm font-medium text-ink">Isi sendiri</span>
              <span className="mt-1 block text-[13px] text-ink-muted">
                Ketik langsung. Berkas tetap boleh dilampirkan, tapi tidak dibaca AI.
              </span>
            </button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={tutup}>
            Batal
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        {/*
          Satu kotak berkas untuk dua-duanya: dibaca AI DAN ikut tersimpan pada
          suratnya. Sengaja di LUAR kedua form supaya tidak lagi terjadi berkas
          yang hanya sampai ke AI lalu hilang saat disimpan (DECISIONS 436).
        */}
        <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <Label htmlFor="cs-file" required={mode === "ai"}>
            {mode === "ai" ? "Berkas surat (PDF atau foto)" : "Berkas surat (opsional)"}
          </Label>
          <FileInput
            key={`berkas-${mode}-${suksesTerakhir ?? "0"}`}
            id="cs-file"
            name="fileTampilan"
            accept={mode === "ai" ? "application/pdf,image/*" : undefined}
            onPilih={(f) => setBerkas(f[0] ?? null)}
            petunjuk="Berkas ini diarsipkan bersama suratnya dan bisa dibuka lagi dari register."
          />
          {mode === "ai" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={bacaBerkas}
                disabled={!berkas || bacaPending || membaca}
                loading={bacaPending || membaca}
              >
                <Sparkles aria-hidden className="size-3.5" />
                {bacaPending || membaca ? "Membaca surat…" : "Baca & petakan dengan AI"}
              </Button>
              <span className="text-[13px] text-ink-muted">
                {berkas
                  ? "Satu permintaan – semua isian di bawah terisi sekaligus."
                  : "Pilih berkasnya dulu."}
              </span>
            </div>
          ) : null}
          {bacaState?.error ? <p className="text-sm text-danger">{bacaState.error}</p> : null}
          {bacaState && "catatan" in bacaState && bacaState.catatan ? (
            <p className="text-[13px] text-warning">{bacaState.catatan}</p>
          ) : null}
        </div>

        {hasil ? (
          <Banner
            tone="info"
            title="Isian di bawah diusulkan AI – periksa dulu"
            description="Terutama nomor, tanggal, dan pihaknya. Medan yang tidak tertulis di surat sengaja dibiarkan kosong, bukan ditebak."
          />
        ) : null}

        {potensi ? (
          <Banner
            tone="warning"
            title={`AI menduga surat ini berpotensi jadi ${potensi.jenis}`}
            description={`${potensi.alasan ?? ""} Setelah surat tersimpan, gunakan tombol "Jadikan kendala/temuan" pada barisnya bila memang perlu.`}
          />
        ) : null}

        <form action={simpan} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="cs-arah" required>
                Arah
              </Label>
              <Combobox
                id="cs-arah"
                name="direction"
                value={isi.direction}
                onChange={(v) => setIsi({ ...isi, direction: v })}
                options={[
                  { value: "masuk", label: "Surat masuk" },
                  { value: "keluar", label: "Surat keluar" },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="cs-pihak" required>
                Pihak
              </Label>
              <Combobox
                id="cs-pihak"
                name="party"
                value={isi.party}
                onChange={(v) => setIsi({ ...isi, party: v })}
                options={PIHAK}
              />
            </div>
            <div>
              <Label htmlFor="cs-nama">Nama pihak</Label>
              <Input
                id="cs-nama"
                name="partyName"
                value={isi.partyName}
                onChange={(e) => setIsi({ ...isi, partyName: e.target.value })}
                placeholder="mis. CV SAKHA"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="cs-perihal" required>
              Perihal
            </Label>
            <Input
              id="cs-perihal"
              name="subject"
              required
              value={isi.subject}
              onChange={(e) => setIsi({ ...isi, subject: e.target.value })}
              placeholder="mis. Permohonan perpanjangan waktu"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="cs-nomor">Nomor surat</Label>
              <Input
                id="cs-nomor"
                name="letterNumber"
                value={isi.letterNumber}
                onChange={(e) => setIsi({ ...isi, letterNumber: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cs-tglsurat">Tanggal surat</Label>
              <Input
                id="cs-tglsurat"
                name="letterDate"
                type="date"
                value={isi.letterDate}
                onChange={(e) => setIsi({ ...isi, letterDate: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cs-tgltangani" required>
                Diterima/dikirim
              </Label>
              <Input id="cs-tgltangani" name="handledDate" type="date" defaultValue={hariIni} required />
            </div>
            <div>
              <Label htmlFor="cs-kategori" required>
                Perihal soal
              </Label>
              <Combobox
                id="cs-kategori"
                name="category"
                value={isi.category}
                onChange={(v) => setIsi({ ...isi, category: v })}
                options={KATEGORI}
              />
            </div>
          </div>

          {/*
            Paket dan lokasi BERDIRI SENDIRI (ketetapan user 2026-08-26): surat
            bisa menunjuk satu lokasi saja, satu paket saja, keduanya, atau
            tidak sama sekali. Menurunkan lokasi dari paket akan memaksa
            kaitan yang tidak dinyatakan suratnya.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cs-paket">Paket terkait (opsional)</Label>
              <Combobox
                id="cs-paket"
                name="packageId"
                value={isi.packageId}
                onChange={(v) => setIsi({ ...isi, packageId: v })}
                options={[
                  { value: "", label: "– tidak menunjuk paket –" },
                  ...paket.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            <div>
              <Label htmlFor="cs-lokasi">Lokasi terkait (opsional)</Label>
              <Combobox
                id="cs-lokasi"
                name="locationId"
                value={isi.locationId}
                onChange={(v) => setIsi({ ...isi, locationId: v })}
                options={[
                  { value: "", label: "– tidak menunjuk lokasi –" },
                  ...lokasi.map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cs-jawab">Menuntut jawaban?</Label>
              <Combobox
                id="cs-jawab"
                name="needsReply"
                value={isi.needsReply}
                onChange={(v) => setIsi({ ...isi, needsReply: v })}
                options={[
                  { value: "tidak", label: "Tidak" },
                  { value: "ya", label: "Ya – pasang tenggat" },
                ]}
              />
            </div>
            {isi.needsReply === "ya" ? (
              <div>
                <Label htmlFor="cs-tenggat">Tenggat jawaban</Label>
                <Input
                  id="cs-tenggat"
                  name="replyDueDate"
                  type="date"
                  value={isi.replyDueDate}
                  onChange={(e) => setIsi({ ...isi, replyDueDate: e.target.value })}
                />
              </div>
            ) : null}
          </div>

          <div>
            <Label htmlFor="cs-ringkas">
              Ringkasan isi &amp; maksud surat {hasil ? <Badge tone="info" label="usulan AI" /> : null}
            </Label>
            <Textarea
              id="cs-ringkas"
              name="summary"
              rows={3}
              value={isi.summary}
              onChange={(e) => setIsi({ ...isi, summary: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending} loading={pending}>
              Simpan surat
            </Button>
            <Button type="button" variant="ghost" onClick={tutup}>
              Batal
            </Button>
            {state?.error ? <span className="text-sm text-danger">{state.error}</span> : null}
            {state?.success ? <span className="text-sm text-success">{state.success}</span> : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
