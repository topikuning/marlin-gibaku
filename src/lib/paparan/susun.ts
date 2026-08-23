import { numericClaimsValid } from "@/lib/ai-hub/schemas";
import {
  paparanNarasiSchema,
  type CapaianPaparan,
  type DurasiPaparan,
  type FotoKandidatPaparan,
  type KategoriLokasiPaparan,
  type KegiatanPaparan,
  type KendalaPaparan,
  type KurvaPaparan,
  type PaparanContent,
  type PaparanHumanEdits,
  type PaparanNarasi,
  type PaparanSnapshot,
  type PemulihanPaparan,
  type ProgresLokasiPaparan,
} from "./jenis";

/**
 * LOGIKA MURNI PAPARAN (DECISIONS 416/417): grounding narasi, fallback
 * deterministik + ACTION PLAN yang digenerate dari data minggu terakhir,
 * pemilihan foto awal, dan perakitan slide bergaya contoh Mataram — sampul
 * gelap, kurva-S, durasi, status pekerjaan per kategori, foto per pekerjaan,
 * Action Plan bernomor, penutup. Tanpa DB, tanpa provider — unit-testable.
 */

/* ── Format angka (tampilan Indonesia) ──────────────────────────────────── */

export function pctID(v: number | null): string {
  if (v == null) return "–";
  return `${v.toFixed(1).replace(".", ",")}%`;
}

export function ppID(v: number | null): string {
  if (v == null) return "–";
  const s = v.toFixed(1).replace(".", ",");
  return `${v > 0 ? "+" : ""}${s} pp`;
}

/** Band warna bar status pekerjaan (pola contoh Mataram). */
export type BandStatus = "tuntas" | "maju" | "sedang" | "kritis";
export function bandStatus(pct: number): BandStatus {
  if (pct >= 70) return "tuntas";
  if (pct >= 40) return "maju";
  if (pct >= 20) return "sedang";
  return "kritis";
}

/* ── Grounding narasi AI ────────────────────────────────────────────────── */

export type HasilSaring = { narasi: PaparanNarasi; dibuang: string[] };

/**
 * Saring keluaran AI terhadap snapshot — butir yang gagal DIBUANG dan dicatat.
 * Validasi angka PER LOKASI (pola klaim terikat DECISIONS 378); angka utama
 * slide selalu ditempatkan renderer dari snapshot, bukan dari teks AI.
 */
export function saringNarasiPaparan(raw: unknown, snapshot: PaparanSnapshot): HasilSaring {
  const parsed = paparanNarasiSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      narasi: narasiDeterministik(snapshot),
      dibuang: ["Keluaran AI tidak lolos skema – narasi disusun deterministik."],
    };
  }
  const n = parsed.data;
  const refIds = new Set(snapshot.sourceRefs.map((r) => r.id));
  const lokasiIds = new Set(snapshot.progres.lokasi.map((l) => l.locationId));

  const angkaPaket = [
    snapshot.progres.paket.targetPct,
    snapshot.progres.paket.realisasiPct,
    snapshot.progres.paket.deviasiPp,
    snapshot.progres.paket.kenaikanPp,
  ].filter((v): v is number => v != null);
  const angkaLokasi = new Map<string, number[]>();
  for (const l of snapshot.progres.lokasi) {
    angkaLokasi.set(
      l.locationId,
      [l.targetPct, l.realisasiPct, l.deviasiPp, l.kenaikanPp].filter((v): v is number => v != null),
    );
  }
  // Angka kategori ikut jadi kolam sah lokasi itu — Action Plan wajar menyebut
  // "Jalan Lingkungan 5,4%", dan itu angka resmi kategori, bukan karangan.
  for (const k of snapshot.kategori ?? []) {
    const pool = angkaLokasi.get(k.locationId) ?? [];
    for (const g of k.kelompok) pool.push(Math.round(g.realisasiPct * 10) / 10);
    angkaLokasi.set(k.locationId, pool);
  }
  const angkaSemuaKategori = (snapshot.kategori ?? []).flatMap((k) =>
    k.kelompok.flatMap((g) => {
      const bobot = g.bobotPct ?? 0;
      return [
        Math.round(g.realisasiPct * 10) / 10,
        // Bobot & sisa bobot ikut jadi angka sah — Action Plan wajar menyebut
        // "sisa bobot 4,2%", dan itu turunan dua angka resmi.
        Math.round(bobot * 10) / 10,
        Math.round(bobot * (1 - g.realisasiPct / 100) * 10) / 10,
      ];
    }),
  );
  // Rencana kumulatif minggu depan + kebutuhan kenaikannya — angka resmi dari
  // deret kurva yang boleh disebut Action Plan (kejar bobot minggu berikutnya).
  {
    const berikut = rencanaMingguBerikut(snapshot);
    if (berikut != null) {
      angkaSemuaKategori.push(
        Math.round(berikut * 10) / 10,
        Math.round((berikut - snapshot.progres.paket.realisasiPct) * 10) / 10,
      );
    }
  }

  const dibuang: string[] = [];
  const saring = <T extends { text: string; sourceRefIds: string[]; locationId?: string | null }>(
    arr: T[],
    bagian: string,
    poolTanpaLokasi: number[] = angkaPaket,
  ): T[] =>
    arr.filter((b) => {
      if (!b.sourceRefIds.every((id) => refIds.has(id))) {
        dibuang.push(`${bagian}: butir dibuang – sumber tidak dikenal.`);
        return false;
      }
      if (b.locationId != null && !lokasiIds.has(b.locationId)) {
        dibuang.push(`${bagian}: butir dibuang – lokasi di luar paket.`);
        return false;
      }
      const pool =
        b.locationId != null ? [...(angkaLokasi.get(b.locationId) ?? []), ...angkaPaket] : poolTanpaLokasi;
      if (!numericClaimsValid(b.text, pool)) {
        dibuang.push(`${bagian}: butir dibuang – memuat angka tanpa sumber.`);
        return false;
      }
      return true;
    });

  const hasil: PaparanNarasi = {
    title: n.title,
    ringkasanEksekutif: saring(n.ringkasanEksekutif, "Ringkasan eksekutif"),
    capaianNaratif: saring(n.capaianNaratif, "Capaian"),
    kegiatanNaratif: saring(n.kegiatanNaratif, "Kegiatan"),
    sintesisKendala: saring(n.sintesisKendala, "Kendala"),
    rencanaNaratif: saring(n.rencanaNaratif, "Rencana"),
    dukunganDibutuhkan: saring(n.dukunganDibutuhkan, "Dukungan"),
    // Action Plan menyebut pekerjaan lintas lokasi — kolam tanpa-lokasinya
    // mencakup angka kategori seluruh paket, bukan hanya empat angka paket.
    actionPlan: saring(n.actionPlan, "Action Plan", [...angkaPaket, ...angkaSemuaKategori]),
    limitations: n.limitations,
  };
  if (!numericClaimsValid(hasil.title, angkaPaket)) {
    hasil.title = judulDeterministik(snapshot);
    dibuang.push("Judul diganti – memuat angka tanpa sumber.");
  }
  if (
    hasil.ringkasanEksekutif.length === 0 &&
    hasil.capaianNaratif.length === 0 &&
    hasil.sintesisKendala.length === 0
  ) {
    return {
      narasi: narasiDeterministik(snapshot),
      dibuang: [...dibuang, "Seluruh narasi AI gugur grounding – narasi disusun deterministik."],
    };
  }
  // Action Plan tidak boleh kosong hanya karena AI gugur — jatuh ke saran
  // deterministik dari data minggu terakhir.
  if (hasil.actionPlan.length === 0) {
    hasil.actionPlan = actionPlanDeterministik(snapshot);
    dibuang.push("Action Plan AI gugur/kosong – disusun deterministik dari data minggu ini.");
  }
  return { narasi: hasil, dibuang };
}

/* ── Fallback deterministik ─────────────────────────────────────────────── */

/**
 * Nama lokasi bila deck ini berlingkup lokasi (DECISIONS 420); null utk paket.
 * Artefak lama tidak punya `lingkup` → dibaca sebagai paket, sebagaimana dulu.
 */
export function namaLingkupLokasi(s: PaparanSnapshot): string | null {
  return s.lingkup?.jenis === "lokasi" ? s.lingkup.nama : null;
}

function judulDeterministik(s: PaparanSnapshot): string {
  const lok = namaLingkupLokasi(s);
  return lok
    ? `Progres Pekerjaan ${lok} – ${s.paket.name}`
    : `Progres Pekerjaan ${s.paket.name}`;
}

function refPaket(s: PaparanSnapshot): string[] {
  const rekap = s.sourceRefs.find((r) => r.id === "paket:rekap");
  return [rekap?.id ?? s.sourceRefs[0]?.id ?? "paket:rekap"];
}

/** Bulatkan 1 desimal — bentuk angka yang sama dengan yang tercetak di slide. */
function b1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Rencana kumulatif paket pada minggu N+1 dari deret kurva (null bila kurva
 * tidak ada). Minggu melewati akhir kurva memakai titik terakhirnya (100%).
 */
export function rencanaMingguBerikut(s: PaparanSnapshot): number | null {
  const kurva = s.kurva;
  if (!kurva || kurva.planPct.length === 0) return null;
  const idx = Math.min(s.periode.mingguKe, kurva.planPct.length - 1);
  return kurva.planPct[idx];
}

/**
 * ACTION PLAN DETERMINISTIK — saran NYATA minggu depan dari data minggu
 * terakhir (permintaan user 2026-08-22, pola contoh Mataram). Bukan kalimat
 * pajangan: setiap butir menunjuk pekerjaan/kendala yang benar-benar ada di
 * snapshot, dan dipakai juga sebagai jaring bila Action Plan AI gugur.
 *
 * URUTANNYA keputusan user 2026-08-22 (susulan): rencana mingguan yang SUDAH
 * dicatat didahulukan; bila belum ada, MARLIN menyodorkan rekomendasinya
 * sendiri — rencana kerja untuk MENGEJAR bobot rencana minggu berikutnya
 * sekaligus menutup deviasi, dengan prioritas pekerjaan bersisa bobot
 * terbesar (bukan sekadar yang persentasenya terendah: kategori Rp 3 M yang
 * 10% lebih menggerakkan angka paket daripada kategori kecil yang 0%).
 */
export function actionPlanDeterministik(s: PaparanSnapshot): { text: string; sourceRefIds: string[] }[] {
  const ref = refPaket(s);
  const out: { text: string; sourceRefIds: string[] }[] = [];
  const kelompok = (s.kategori ?? []).flatMap((k) =>
    k.kelompok.map((g) => ({ ...g, lokasiNama: k.lokasiNama, banyakLokasi: (s.kategori ?? []).length > 1 })),
  );

  // 1. Rencana mingguan yang SUDAH dicatat di MARLIN → eksekusi apa adanya.
  const adaRencana = s.rencanaMingguDepan != null && s.rencanaMingguDepan.length > 0;
  if (adaRencana) {
    const contoh = s.rencanaMingguDepan!
      .flatMap((r) => r.item.map((i) => i.nama))
      .slice(0, 3)
      .join(", ");
    out.push({
      text: `Melaksanakan rencana minggu ke-${s.periode.mingguKe + 1} yang tercatat: ${contoh}.`,
      sourceRefIds: ref,
    });
  } else {
    /*
     * 2. Rencana mingguan KOSONG → rekomendasi MARLIN: kejar bobot rencana
     * minggu berikutnya / tutup deviasi. Kebutuhan kenaikan dihitung dari
     * POSISI REALISASI ke rencana minggu depan — satu angka yang sekaligus
     * menutup deviasi dan memenuhi kenaikan mingguan.
     */
    const rencanaBerikut = rencanaMingguBerikut(s);
    const realisasi = s.progres.paket.realisasiPct;
    if (rencanaBerikut != null) {
      const kejar = b1(rencanaBerikut - realisasi);
      const prioritas = kelompok
        .filter((g) => g.realisasiPct < 100 && (g.bobotPct ?? 0) > 0)
        .map((g) => ({ ...g, sisaBobot: b1((g.bobotPct ?? 0) * (1 - g.realisasiPct / 100)) }))
        .sort((a, b) => b.sisaBobot - a.sisaBobot)
        .slice(0, 3);
      const daftar = prioritas
        .map(
          (g) =>
            `${g.nama} (sisa bobot ${pctID(g.sisaBobot)}${g.banyakLokasi ? `, ${g.lokasiNama}` : ""})`,
        )
        .join(", ");
      out.push({
        text:
          kejar > 0
            ? `Rencana mingguan minggu ke-${s.periode.mingguKe + 1} belum diisi – rekomendasi: kejar rencana kumulatif ${pctID(b1(rencanaBerikut))} (butuh kenaikan ${pctID(kejar).replace("%", " pp")} dari realisasi ${pctID(b1(realisasi))})${daftar ? ` dengan memprioritaskan ${daftar}` : ""}.`
            : `Rencana mingguan minggu ke-${s.periode.mingguKe + 1} belum diisi – posisi sudah di atas rencana; rekomendasi: pertahankan laju${daftar ? ` dan lanjutkan ${daftar}` : ""}.`,
        sourceRefIds: ref,
      });
    } else {
      const dev = s.progres.paket.deviasiPp;
      if (dev != null && dev < -1) {
        out.push({
          text: `Mengejar ketertinggalan ${ppID(dev).replace("+", "")} terhadap rencana dengan menambah jam kerja pada pekerjaan bernilai besar.`,
          sourceRefIds: ref,
        });
      }
    }
  }

  // 3. Pekerjaan yang hampir tuntas → dorong diselesaikan (quick win nyata).
  const hampir = kelompok
    .filter((g) => g.realisasiPct >= 70 && g.realisasiPct < 100)
    .sort((a, b) => b.realisasiPct - a.realisasiPct)
    .slice(0, 3);
  if (hampir.length > 0) {
    out.push({
      text: `Menyelesaikan pekerjaan yang mendekati tuntas: ${hampir
        .map((g) => `${g.nama} (${pctID(g.realisasiPct)}${g.banyakLokasi ? `, ${g.lokasiNama}` : ""})`)
        .join(", ")}.`,
      sourceRefIds: ref,
    });
  }

  // 4. Pekerjaan yang masih rendah → tambah atensi/tenaga.
  const tertinggal = kelompok
    .filter((g) => g.realisasiPct < 30)
    .sort((a, b) => a.realisasiPct - b.realisasiPct)
    .slice(0, 3);
  if (tertinggal.length > 0) {
    out.push({
      text: `Menambah atensi & tenaga pada pekerjaan yang masih rendah: ${tertinggal
        .map((g) => `${g.nama} (${pctID(g.realisasiPct)}${g.banyakLokasi ? `, ${g.lokasiNama}` : ""})`)
        .join(", ")}.`,
      sourceRefIds: ref,
    });
  }

  // 5. Recovery lewat target → tagih tuntas, sebut kendalanya.
  const lewat = s.pemulihan.filter((p) => p.overdue).slice(0, 3);
  if (lewat.length > 0) {
    out.push({
      text: `Menuntaskan aksi pemulihan yang lewat target: ${lewat.map((p) => p.judulKendala).join(", ")}.`,
      sourceRefIds: ref,
    });
  }

  // 6. Disiplin pelaporan bila ada lokasi bolong.
  if (s.kelengkapan.lokasiTanpaLaporan.length > 0) {
    out.push({
      text: `Menertibkan laporan harian di ${s.kelengkapan.lokasiTanpaLaporan.join(", ")} – tanpa laporan, progresnya tidak terhitung resmi.`,
      sourceRefIds: ref,
    });
  }
  return out.slice(0, 6);
}

/** Narasi TANPA AI: kalimat faktual dari angka snapshot (spec §9). */
export function narasiDeterministik(s: PaparanSnapshot): PaparanNarasi {
  const p = s.progres.paket;
  const ref = refPaket(s);
  const ringkasan: { text: string; sourceRefIds: string[] }[] = [];
  ringkasan.push({
    text:
      p.targetPct == null
        ? `Realisasi paket ${pctID(p.realisasiPct)}; target minggu ini belum bisa dihitung (kurva-S belum lengkap).`
        : `Realisasi paket ${pctID(p.realisasiPct)} terhadap rencana ${pctID(p.targetPct)} (deviasi ${ppID(p.deviasiPp)}).`,
    sourceRefIds: ref,
  });
  if (p.kenaikanPp != null) {
    ringkasan.push({
      text: `Kenaikan realisasi selama minggu ini ${ppID(p.kenaikanPp)}.`,
      sourceRefIds: ref,
    });
  }
  const kendalaAktif = s.kendala.terbukaSaatIni;
  if (kendalaAktif.length > 0) {
    const kritis = kendalaAktif.filter((k) => k.severity === "kritis" || k.severity === "tinggi").length;
    ringkasan.push({
      text:
        kritis > 0
          ? `${kendalaAktif.length} kendala masih aktif, ${kritis} di antaranya tinggi/kritis.`
          : `${kendalaAktif.length} kendala masih aktif; tidak ada yang tinggi/kritis.`,
      sourceRefIds: ref,
    });
  }
  const k = s.kelengkapan;
  ringkasan.push({
    text: `Kelengkapan laporan harian: ${k.final} final dari ${k.diharapkan} yang diharapkan.`,
    sourceRefIds: ref,
  });

  const capaian = s.capaian.slice(0, 6).map((c) => ({
    text: `${c.lokasiNama}: ${c.pekerjaan} ${String(c.volume).replace(".", ",")}${c.unit ? ` ${c.unit}` : ""}.`,
    locationId: c.locationId,
    sourceRefIds: c.sourceRefIds,
  }));
  const kegiatan = s.kegiatan.slice(0, 6).map((g) => ({
    text: `${g.judul} (${g.lokasiNama}, ${g.tanggalKey}).`,
    locationId: g.locationId,
    sourceRefIds: ref,
  }));
  const kendala = kendalaAktif.slice(0, 6).map((i) => ({
    text: `${i.judul} – ${i.lokasiNama} (${i.severity}${i.punyaRecovery ? ", sudah ada recovery" : ", belum ada recovery"}).`,
    locationId: i.locationId,
    sourceRefIds: ref,
  }));
  const rencana =
    s.rencanaMingguDepan?.slice(0, 4).map((r) => ({
      text: `${r.lokasiNama}: ${r.item.length} item pekerjaan direncanakan minggu depan.`,
      locationId: r.locationId,
      sourceRefIds: ref,
    })) ?? [];

  return {
    title: judulDeterministik(s),
    ringkasanEksekutif: ringkasan.slice(0, 4),
    capaianNaratif: capaian,
    kegiatanNaratif: kegiatan,
    sintesisKendala: kendala,
    rencanaNaratif: rencana,
    dukunganDibutuhkan: [],
    actionPlan: actionPlanDeterministik(s),
    limitations: ["Narasi AI tidak tersedia; deck disusun dari data terstruktur MARLIN."],
  };
}

/* ── Pemilihan foto awal ────────────────────────────────────────────────── */

/** Round-robin antar lokasi supaya satu lokasi tidak mendominasi (spec §13). */
export function pilihFotoAwal(kandidat: FotoKandidatPaparan[], maks = 8): string[] {
  const perLokasi = new Map<string, FotoKandidatPaparan[]>();
  for (const f of kandidat) {
    const arr = perLokasi.get(f.locationId) ?? [];
    arr.push(f);
    perLokasi.set(f.locationId, arr);
  }
  const antrean = [...perLokasi.values()];
  const hasil: string[] = [];
  let ada = true;
  while (hasil.length < maks && ada) {
    ada = false;
    for (const arr of antrean) {
      const f = arr.shift();
      if (!f) continue;
      hasil.push(f.id);
      ada = true;
      if (hasil.length >= maks) break;
    }
  }
  return hasil;
}

/* ── Perakitan slide (pola contoh Mataram: gelap/terang berselang) ──────── */

export type Slide =
  | {
      jenis: "sampul";
      judulKerja: string;
      subJudul: string | null;
      nomorKontrak: string;
      pelaksana: string;
      mingguKe: number;
      periodeLabel: string;
      instansi: string;
      berjalan: boolean;
      draf: boolean;
      meta: { realisasiPct: number; rencanaPct: number | null; deviasiPp: number | null };
    }
  | { jenis: "kurva"; kurva: KurvaPaparan; deviasiPp: number | null; mingguKe: number }
  | { jenis: "durasi"; d: DurasiPaparan }
  | {
      jenis: "ringkasan";
      butir: string[];
      angka: {
        rencana: number | null;
        realisasi: number;
        deviasi: number | null;
        laporanFinal: number;
        laporanDiharapkan: number;
      };
    }
  | { jenis: "progres_lokasi"; baris: ProgresLokasiPaparan[]; bagian: number; totalBagian: number }
  | {
      jenis: "status_kategori";
      /** null = paket satu lokasi (judul tanpa nama lokasi). */
      lokasiNama: string | null;
      baris: { nama: string; realisasiPct: number }[];
      bagian: number;
      totalBagian: number;
    }
  | { jenis: "capaian"; butir: string[]; rincian: CapaianPaparan[] }
  | { jenis: "kegiatan"; butir: string[]; rincian: KegiatanPaparan[] }
  | {
      jenis: "foto_pekerjaan";
      judul: string;
      /** Realisasi kategori pekerjaan ini; null bila tidak terpetakan. */
      pct: number | null;
      foto: (FotoKandidatPaparan & { caption: string })[];
    }
  | {
      jenis: "kendala";
      butir: string[];
      baru: KendalaPaparan[];
      aktif: KendalaPaparan[];
      statusTerkini: boolean;
    }
  | { jenis: "pemulihan"; baris: PemulihanPaparan[]; bagian: number; totalBagian: number }
  | { jenis: "action_plan"; butir: string[]; dukungan: string[] }
  | {
      jenis: "lampiran";
      kelengkapan: PaparanSnapshot["kelengkapan"];
      lokasiTanpaKurva: number;
      dataAsOf: string | null;
      limitations: string[];
    }
  | { jenis: "penutup"; paket: string; mingguKe: number; periodeLabel: string };

/** Bagi baris tabel panjang ke beberapa slide (spec §8). */
export function pecah<T>(rows: T[], per: number): T[][] {
  if (rows.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

function teksButir(edit: string[] | undefined, narasi: { text: string }[]): string[] {
  if (edit && edit.length > 0) return edit.filter((t) => t.trim().length > 0);
  return narasi.map((b) => b.text);
}

export function judulPaparan(content: PaparanContent): string {
  return content.humanEdits?.title?.trim() || content.narasi.title;
}

/** Akar lineage ("I#1#2" → "I") — kategori RAB pemilik item. */
function akarLineage(lk: string | null | undefined): string | null {
  if (!lk) return null;
  const i = lk.indexOf("#");
  return i === -1 ? lk : lk.slice(0, i);
}

/**
 * Rakit deck dari konten kanonik — preview React dan renderer PDF memanggil
 * fungsi yang SAMA; tidak ada angka dihitung ulang di keduanya.
 */
export function susunSlides(content: PaparanContent, opts: { draf: boolean }): Slide[] {
  const s = content.snapshot;
  const n = content.narasi;
  const e: PaparanHumanEdits = content.humanEdits ?? {};
  const slides: Slide[] = [];
  const periodeLabel = `${s.periode.mulaiKey} s.d. ${s.periode.akhirKey}`;
  const lokasiLingkup = namaLingkupLokasi(s);

  slides.push({
    jenis: "sampul",
    /*
     * Deck LOKASI menaruh nama lokasi sebagai judul besar dan judul kerja
     * kontrak di bawahnya. Kebalikannya (judul kontrak besar, lokasi kecil)
     * membuat deck satu lokasi terbaca sebagai deck seluruh kontrak — persis
     * yang harus dicegah lingkup ini. DECISIONS 420.
     */
    judulKerja: lokasiLingkup ?? s.kontrak.workTitle ?? s.paket.name,
    subJudul: lokasiLingkup
      ? [s.kontrak.workTitle, s.paket.name].filter(Boolean).join(" – ")
      : s.kontrak.workTitle
        ? s.paket.name
        : null,
    nomorKontrak: s.kontrak.contractNumber,
    pelaksana: s.kontrak.vendorName,
    mingguKe: s.periode.mingguKe,
    periodeLabel,
    instansi: s.paket.ownerAgency,
    berjalan: s.periode.berjalan,
    draf: opts.draf,
    meta: {
      realisasiPct: s.progres.paket.realisasiPct,
      rencanaPct: s.progres.paket.targetPct,
      deviasiPp: s.progres.paket.deviasiPp,
    },
  });

  if (s.kurva && s.kurva.planPct.length > 0) {
    slides.push({
      jenis: "kurva",
      kurva: s.kurva,
      deviasiPp: s.progres.paket.deviasiPp,
      mingguKe: s.periode.mingguKe,
    });
  }

  if (s.durasi) slides.push({ jenis: "durasi", d: s.durasi });

  slides.push({
    jenis: "ringkasan",
    butir: teksButir(e.ringkasanEksekutif, n.ringkasanEksekutif).slice(0, 4),
    angka: {
      rencana: s.progres.paket.targetPct,
      realisasi: s.progres.paket.realisasiPct,
      deviasi: s.progres.paket.deviasiPp,
      laporanFinal: s.kelengkapan.final,
      laporanDiharapkan: s.kelengkapan.diharapkan,
    },
  });

  // Exception-first (spec §8): deviasi terburuk & tanpa kurva di atas.
  if (s.progres.lokasi.length > 1) {
    const urut = [...s.progres.lokasi].sort((a, b) => {
      const da = a.deviasiPp ?? Number.NEGATIVE_INFINITY;
      const dbb = b.deviasiPp ?? Number.NEGATIVE_INFINITY;
      return da - dbb;
    });
    const bagianLokasi = pecah(urut, 10);
    bagianLokasi.forEach((baris, i) =>
      slides.push({ jenis: "progres_lokasi", baris, bagian: i + 1, totalBagian: bagianLokasi.length }),
    );
  }

  // Status pekerjaan per kategori (bar berwarna) — per lokasi, pecah 16 baris.
  const satuLokasi = (s.kategori ?? []).length <= 1;
  for (const kat of s.kategori ?? []) {
    const bagian = pecah(kat.kelompok, 16);
    bagian.forEach((baris, i) =>
      slides.push({
        jenis: "status_kategori",
        lokasiNama: satuLokasi ? null : kat.lokasiNama,
        baris: baris.map((g) => ({ nama: g.nama, realisasiPct: g.realisasiPct })),
        bagian: i + 1,
        totalBagian: bagian.length,
      }),
    );
  }

  slides.push({
    jenis: "capaian",
    butir: teksButir(e.capaianNaratif, n.capaianNaratif),
    rincian: s.capaian.slice(0, 8),
  });
  slides.push({
    jenis: "kegiatan",
    butir: teksButir(e.kegiatanNaratif, n.kegiatanNaratif),
    rincian: s.kegiatan.slice(0, 8),
  });

  /*
   * FOTO PER PEKERJAAN (pola contoh Mataram): foto terpilih dikelompokkan per
   * kategori RAB (akar lineage) / judul kegiatan, satu slide per kelompok,
   * kepala slide memuat nama pekerjaan + realisasinya. Maksimal 2 foto per
   * slide seperti contohnya; kelompok besar pecah ke slide lanjutan.
   */
  const dipilih = new Set(content.selectedPhotoIds);
  const pctKategori = new Map<string, { nama: string; pct: number }>();
  for (const k of s.kategori ?? []) {
    for (const g of k.kelompok) {
      pctKategori.set(`${k.locationId}|${g.lineageKey}`, { nama: g.nama, pct: g.realisasiPct });
    }
  }
  const fotoTerpilih = s.fotoKandidat
    .filter((f) => dipilih.has(f.id))
    .map((f) => ({
      ...f,
      caption:
        e.captionFoto?.[f.id]?.trim() ||
        [f.lokasiNama, f.tanggalKey, f.keterangan].filter(Boolean).join(" · "),
    }));
  const perPekerjaan = new Map<string, { judul: string; pct: number | null; foto: typeof fotoTerpilih }>();
  for (const f of fotoTerpilih) {
    const akar = akarLineage(f.lineageKey);
    const kat = akar ? pctKategori.get(`${f.locationId}|${akar}`) : undefined;
    const judul = kat?.nama ?? f.keterangan ?? f.lokasiNama ?? "Dokumentasi";
    const kunci = `${f.locationId}|${judul}`;
    const ada = perPekerjaan.get(kunci);
    if (ada) ada.foto.push(f);
    else perPekerjaan.set(kunci, { judul, pct: kat?.pct ?? null, foto: [f] });
  }
  for (const grup of perPekerjaan.values()) {
    for (const kel of pecah(grup.foto, 2)) {
      if (kel.length === 0) continue;
      slides.push({ jenis: "foto_pekerjaan", judul: grup.judul, pct: grup.pct, foto: kel });
    }
  }

  slides.push({
    jenis: "kendala",
    butir: teksButir(e.sintesisKendala, n.sintesisKendala),
    baru: s.kendala.baruMingguIni.slice(0, 8),
    aktif: s.kendala.terbukaSaatIni.slice(0, 8),
    statusTerkini: s.kendala.statusTerkini,
  });

  const pemulihanUrut = [...s.pemulihan].sort((a, b) => {
    const skorA = (a.overdue ? -2 : 0) + (a.pic ? 0 : -1);
    const skorB = (b.overdue ? -2 : 0) + (b.pic ? 0 : -1);
    return skorA - skorB;
  });
  if (pemulihanUrut.length > 0) {
    const bag = pecah(pemulihanUrut, 8);
    bag.forEach((baris, i) =>
      slides.push({ jenis: "pemulihan", baris, bagian: i + 1, totalBagian: bag.length }),
    );
  }

  // ACTION PLAN — saran nyata minggu depan; suntingan manusia menang, lalu
  // narasi (AI tergrounding / deterministik). Tidak pernah kosong: perakit
  // menjamin fallback deterministik saat narasinya tidak membawa apa-apa.
  const actionButir = teksButir(e.actionPlan, n.actionPlan ?? []);
  slides.push({
    jenis: "action_plan",
    butir: (actionButir.length > 0
      ? actionButir
      : actionPlanDeterministik(s).map((b) => b.text)
    ).slice(0, 6),
    dukungan: teksButir(e.dukunganDibutuhkan, n.dukunganDibutuhkan).slice(0, 4),
  });

  slides.push({
    jenis: "lampiran",
    kelengkapan: s.kelengkapan,
    lokasiTanpaKurva: s.progres.paket.lokasiTanpaKurva,
    dataAsOf: s.dataAsOf,
    limitations: [...s.limitations, ...n.limitations].slice(0, 15),
  });

  slides.push({
    jenis: "penutup",
    paket: s.paket.name,
    mingguKe: s.periode.mingguKe,
    periodeLabel,
  });

  return slides;
}

/* ── Pembacaan konten kanonik ───────────────────────────────────────────── */

export class PaparanContentError extends Error {}

export function parsePaparanContent(raw: unknown): PaparanContent {
  const c = raw as PaparanContent | null;
  if (
    !c ||
    typeof c !== "object" ||
    c.templateKey !== "paparan_mingguan_kkp" ||
    !c.snapshot ||
    c.snapshot.version !== 1 ||
    !c.narasi ||
    !Array.isArray(c.selectedPhotoIds)
  ) {
    throw new PaparanContentError("Konten artefak paparan tidak valid.");
  }
  return c;
}
