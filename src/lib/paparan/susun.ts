import { numericClaimsValid } from "@/lib/ai-hub/schemas";
import {
  paparanNarasiSchema,
  type CapaianPaparan,
  type FotoKandidatPaparan,
  type KegiatanPaparan,
  type KendalaPaparan,
  type PaparanContent,
  type PaparanHumanEdits,
  type PaparanNarasi,
  type PaparanSnapshot,
  type PemulihanPaparan,
  type ProgresLokasiPaparan,
} from "./jenis";

/**
 * LOGIKA MURNI PAPARAN (DECISIONS 416): grounding narasi, fallback
 * deterministik, pemilihan foto awal, dan perakitan slide. Tanpa DB, tanpa
 * provider — seluruhnya unit-testable.
 */

/* ── Format angka (tampilan Indonesia, konsisten dgn pesan mingguan) ────── */

export function pctID(v: number | null): string {
  if (v == null) return "–";
  return `${v.toFixed(1).replace(".", ",")}%`;
}

export function ppID(v: number | null): string {
  if (v == null) return "–";
  const s = v.toFixed(1).replace(".", ",");
  return `${v > 0 ? "+" : ""}${s} pp`;
}

/* ── Grounding narasi AI ────────────────────────────────────────────────── */

export type HasilSaring = { narasi: PaparanNarasi; dibuang: string[] };

/**
 * Saring keluaran AI terhadap snapshot — butir yang gagal DIBUANG dan dicatat,
 * tidak pernah tampil sebagai "siap review" (pola AI Hub, DECISIONS 133).
 *
 * Validasi angkanya PER LOKASI: butir ber-`locationId` hanya boleh menyebut
 * angka persen milik lokasi itu (plus angka paket) — angka lokasi A tidak
 * lolos hanya karena kebetulan sama dengan angka resmi lokasi B (pola klaim
 * terikat DECISIONS 378). `numericClaimsValid` hanya menangkap klaim "%"/"pp";
 * klaim hitungan bebas di teks tidak tervalidasi — karena itu angka utama
 * slide SELALU ditempatkan renderer dari snapshot, bukan dari teks AI.
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

  const dibuang: string[] = [];
  const saring = <T extends { text: string; sourceRefIds: string[]; locationId?: string | null }>(
    arr: T[],
    bagian: string,
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
        b.locationId != null ? [...(angkaLokasi.get(b.locationId) ?? []), ...angkaPaket] : angkaPaket;
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
    limitations: n.limitations,
  };
  // Judul: angka tanpa sumber pada judul tidak membuang seluruh narasi —
  // cukup diganti judul deterministik.
  if (!numericClaimsValid(hasil.title, angkaPaket)) {
    hasil.title = judulDeterministik(snapshot);
    dibuang.push("Judul diganti – memuat angka tanpa sumber.");
  }
  // Seluruh ringkasan gugur = narasi tidak berguna; jatuh ke deterministik
  // supaya deck tetap bisa dibuat (spec: AI gagal ≠ run tidak terpakai).
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
  return { narasi: hasil, dibuang };
}

/* ── Fallback deterministik (tanpa AI) ──────────────────────────────────── */

function judulDeterministik(s: PaparanSnapshot): string {
  return `Paparan Mingguan – ${s.paket.name} – Minggu ke-${s.periode.mingguKe}`;
}

/** Ref id pertama yang tersedia — butir deterministik tetap bersumber. */
function refPaket(s: PaparanSnapshot): string[] {
  const rekap = s.sourceRefs.find((r) => r.id === "paket:rekap");
  return [rekap?.id ?? s.sourceRefs[0]?.id ?? "paket:rekap"];
}

/**
 * Narasi TANPA AI: kalimat faktual sederhana dari angka snapshot. Dipakai bila
 * provider belum dikonfigurasi, kill switch mati, timeout, gagal skema, atau
 * seluruh narasi gugur grounding — deck tetap terbentuk (spec §9).
 */
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
    limitations: ["Narasi AI tidak tersedia; deck disusun dari data terstruktur MARLIN."],
  };
}

/* ── Pemilihan foto awal (deterministik, disebar antar lokasi) ──────────── */

/**
 * Round-robin antar lokasi supaya satu lokasi tidak mendominasi dokumentasi
 * tanpa alasan (spec §13). Manusia menggantinya di layar review sebelum beku.
 */
export function pilihFotoAwal(kandidat: FotoKandidatPaparan[], maks = 6): string[] {
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

/* ── Perakitan slide ────────────────────────────────────────────────────── */

export type Slide =
  | {
      jenis: "sampul";
      judulKerja: string;
      nomorKontrak: string;
      pelaksana: string;
      mingguKe: number;
      periodeLabel: string;
      instansi: string;
      berjalan: boolean;
      draf: boolean;
    }
  | {
      jenis: "ringkasan";
      butir: string[];
      angka: { rencana: number | null; realisasi: number; deviasi: number | null; laporanFinal: number; laporanDiharapkan: number };
    }
  | {
      jenis: "progres_paket";
      p: PaparanSnapshot["progres"]["paket"];
      mingguKe: number;
      totalMinggu: number;
      berjalan: boolean;
    }
  | { jenis: "progres_lokasi"; baris: ProgresLokasiPaparan[]; bagian: number; totalBagian: number }
  | { jenis: "capaian"; butir: string[]; rincian: CapaianPaparan[] }
  | { jenis: "kegiatan"; butir: string[]; rincian: KegiatanPaparan[] }
  | { jenis: "dokumentasi"; foto: (FotoKandidatPaparan & { caption: string })[] }
  | {
      jenis: "kendala";
      butir: string[];
      baru: KendalaPaparan[];
      aktif: KendalaPaparan[];
      statusTerkini: boolean;
    }
  | { jenis: "pemulihan"; baris: PemulihanPaparan[]; bagian: number; totalBagian: number }
  | { jenis: "rencana"; butir: string[]; dukungan: string[]; adaRencana: boolean }
  | {
      jenis: "lampiran";
      kelengkapan: PaparanSnapshot["kelengkapan"];
      lokasiTanpaKurva: number;
      dataAsOf: string | null;
      limitations: string[];
    };

/** Bagi baris tabel panjang ke beberapa slide — jangan kecilkan font (spec §8). */
export function pecah<T>(rows: T[], per: number): T[][] {
  if (rows.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

/** Teks butir: suntingan manusia menggantikan narasi bila ada. */
function teksButir(
  edit: string[] | undefined,
  narasi: { text: string }[],
): string[] {
  if (edit && edit.length > 0) return edit.filter((t) => t.trim().length > 0);
  return narasi.map((b) => b.text);
}

export function judulPaparan(content: PaparanContent): string {
  return content.humanEdits?.title?.trim() || content.narasi.title;
}

/**
 * Rakit deck dari konten kanonik. Preview React dan renderer PDF sama-sama
 * memanggil ini — dua tampilan, SATU sumber, tidak ada angka dihitung ulang.
 */
export function susunSlides(content: PaparanContent, opts: { draf: boolean }): Slide[] {
  const s = content.snapshot;
  const n = content.narasi;
  const e: PaparanHumanEdits = content.humanEdits ?? {};
  const slides: Slide[] = [];

  const rentang = `${s.periode.mulaiKey} s.d. ${s.periode.akhirKey}`;
  slides.push({
    jenis: "sampul",
    judulKerja: s.kontrak.workTitle ?? s.paket.name,
    nomorKontrak: s.kontrak.contractNumber,
    pelaksana: s.kontrak.vendorName,
    mingguKe: s.periode.mingguKe,
    periodeLabel: rentang,
    instansi: s.paket.ownerAgency,
    berjalan: s.periode.berjalan,
    draf: opts.draf,
  });

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

  slides.push({
    jenis: "progres_paket",
    p: s.progres.paket,
    mingguKe: s.periode.mingguKe,
    totalMinggu: s.periode.totalMinggu,
    berjalan: s.periode.berjalan,
  });

  /*
   * Exception-first: deviasi negatif terbesar & data tak lengkap di atas
   * (spec §8). Lokasi tanpa kurva dianggap "data tidak lengkap" → paling atas.
   */
  const urut = [...s.progres.lokasi].sort((a, b) => {
    const da = a.deviasiPp ?? Number.NEGATIVE_INFINITY;
    const dbb = b.deviasiPp ?? Number.NEGATIVE_INFINITY;
    return da - dbb;
  });
  const bagianLokasi = pecah(urut, 10);
  bagianLokasi.forEach((baris, i) =>
    slides.push({ jenis: "progres_lokasi", baris, bagian: i + 1, totalBagian: bagianLokasi.length }),
  );

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

  const dipilih = new Set(content.selectedPhotoIds);
  const foto = s.fotoKandidat
    .filter((f) => dipilih.has(f.id))
    .map((f) => ({
      ...f,
      caption:
        e.captionFoto?.[f.id]?.trim() ||
        [f.lokasiNama, f.tanggalKey, f.keterangan].filter(Boolean).join(" · "),
    }));
  if (foto.length > 0) {
    for (const kel of pecah(foto, 8)) slides.push({ jenis: "dokumentasi", foto: kel });
  }

  slides.push({
    jenis: "kendala",
    butir: teksButir(e.sintesisKendala, n.sintesisKendala),
    baru: s.kendala.baruMingguIni.slice(0, 8),
    aktif: s.kendala.terbukaSaatIni.slice(0, 8),
    statusTerkini: s.kendala.statusTerkini,
  });

  // Overdue & tanpa PIC di atas (spec §8 slide 9).
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

  slides.push({
    jenis: "rencana",
    butir: teksButir(e.rencanaNaratif, n.rencanaNaratif),
    dukungan: teksButir(e.dukunganDibutuhkan, n.dukunganDibutuhkan),
    adaRencana: s.rencanaMingguDepan != null && s.rencanaMingguDepan.length > 0,
  });

  slides.push({
    jenis: "lampiran",
    kelengkapan: s.kelengkapan,
    lokasiTanpaKurva: s.progres.paket.lokasiTanpaKurva,
    dataAsOf: s.dataAsOf,
    limitations: [...s.limitations, ...n.limitations].slice(0, 15),
  });

  return slides;
}

/* ── Pembacaan konten kanonik ───────────────────────────────────────────── */

export class PaparanContentError extends Error {}

/** Parse structuredContent artefak paparan; lempar bila bentuknya tidak dikenal. */
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
