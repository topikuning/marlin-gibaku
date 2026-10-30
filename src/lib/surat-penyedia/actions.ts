"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import {
  JENIS_SURAT_TERSEDIA,
  LABEL_JENIS_SURAT,
  kekuranganData,
  polaNomorSah,
  susunNomor,
} from "./aturan";
import { dataDariKontrak, kunciNomorPerusahaan, muatKontrakSurat, nomorUrutBerikut, terminAda } from "./data";
import { barisTeks, type ProgresLokasi } from "./skema";

/**
 * Aksi SURAT BERKOP PENYEDIA (DECISIONS 716/717). Kapabilitas
 * `contract.manage`, sama dengan data kontrak & penanda tangannya. Semua
 * mutasi di-audit.
 */

export type SuratPenyediaState = { error?: string; success?: string } | undefined;

function gagal(err: unknown): SuratPenyediaState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const teksOpsional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length > 0 ? s : null));

/** Kontrak milik organisasi pengguna, beserta paket & perusahaannya. */
async function kontrakMilik(contractId: string, orgId: string) {
  const c = await db.contract.findFirst({
    where: { id: contractId, package: { orgId } },
    select: { id: true, packageId: true, vendorId: true },
  });
  if (!c) throw new ForbiddenError("Kontrak tidak ditemukan.");
  return c;
}

/* ── Data surat: rekening (per kontrak) + pola nomor & kota (per perusahaan) ── */

const dataSchema = z.object({
  contractId: z.uuid(),
  bankNama: teksOpsional(120),
  bankRekening: teksOpsional(40),
  bankAtasNama: teksOpsional(120),
  polaNomorSurat: teksOpsional(120),
  kotaSurat: teksOpsional(60),
});

export async function simpanDataSuratAction(_prev: SuratPenyediaState, formData: FormData): Promise<SuratPenyediaState> {
  try {
    const user = await requireCapability("contract.manage");
    const parsed = dataSchema.safeParse({
      contractId: formData.get("contractId"),
      bankNama: formData.get("bankNama") ?? "",
      bankRekening: formData.get("bankRekening") ?? "",
      bankAtasNama: formData.get("bankAtasNama") ?? "",
      polaNomorSurat: formData.get("polaNomorSurat") ?? "",
      kotaSurat: formData.get("kotaSurat") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.polaNomorSurat) {
      const salah = polaNomorSah(d.polaNomorSurat);
      if (salah) return { error: salah };
    }
    const bankTerisi = [d.bankNama, d.bankRekening, d.bankAtasNama].filter(Boolean).length;
    if (bankTerisi > 0 && bankTerisi < 3)
      return { error: "Rekening diisi lengkap: nama bank, nomor rekening, dan atas nama. Atau kosongkan ketiganya." };

    const c = await kontrakMilik(d.contractId, user.orgId);
    await db.$transaction([
      db.contract.update({
        where: { id: c.id },
        data: { bankNama: d.bankNama, bankRekening: d.bankRekening, bankAtasNama: d.bankAtasNama },
      }),
      db.vendor.update({ where: { id: c.vendorId }, data: { polaNomorSurat: d.polaNomorSurat, kotaSurat: d.kotaSurat } }),
    ]);
    await audit(user.id, "surat_penyedia.data", "contract", c.id, {
      rekeningDiisi: bankTerisi === 3,
      polaNomorSurat: d.polaNomorSurat,
      kotaSurat: d.kotaSurat,
    });
    revalidatePath(`/paket/${c.packageId}/termin`);
    return { success: "Data surat disimpan." };
  } catch (err) {
    return gagal(err);
  }
}

/* ── Jadwal termin (SSKK) ──────────────────────────────────────────────── */

const MAKS_TERMIN = 6;
const persen = z.coerce.number().gt(0, "Persen harus lebih dari 0.").max(100, "Persen paling besar 100.");
const persenRetensi = z.coerce.number().min(0).max(100);
const angkaForm = (v: FormDataEntryValue | null) => String(v ?? "").trim().replace(",", ".");

export async function simpanJadwalTerminAction(_prev: SuratPenyediaState, formData: FormData): Promise<SuratPenyediaState> {
  try {
    const user = await requireCapability("contract.manage");
    const contractId = z.uuid().safeParse(formData.get("contractId"));
    if (!contractId.success) return { error: "Kontrak tidak valid." };

    const baris: { terminKe: number; ambangPct: number; bayarPct: number; retensiPct: number }[] = [];
    for (let ke = 1; ke <= MAKS_TERMIN; ke++) {
      const ambang = angkaForm(formData.get(`ambang${ke}`));
      const bayar = angkaForm(formData.get(`bayar${ke}`));
      const retensi = angkaForm(formData.get(`retensi${ke}`));
      if (!ambang && !bayar && !retensi) continue;
      const a = persen.safeParse(ambang);
      const b = persen.safeParse(bayar);
      if (!a.success || !b.success)
        return { error: `Termin ${ke}: isi ambang progres dan persen bayar, keduanya lebih dari 0 dan paling besar 100.` };
      const r = persenRetensi.safeParse(retensi || "0");
      if (!r.success || r.data > b.data)
        return { error: `Termin ${ke}: retensi paling besar sama dengan persen bayarnya (${b.data}%).` };
      baris.push({ terminKe: ke, ambangPct: a.data, bayarPct: b.data, retensiPct: r.data });
    }
    for (let i = 1; i < baris.length; i++) {
      if (baris[i].terminKe !== baris[i - 1].terminKe + 1)
        return { error: `Termin ${baris[i - 1].terminKe + 1} kosong padahal termin sesudahnya terisi.` };
      if (baris[i].ambangPct <= baris[i - 1].ambangPct)
        return { error: `Ambang progres termin ${baris[i].terminKe} harus lebih besar dari termin ${baris[i - 1].terminKe}.` };
    }
    if (baris.length > 0 && baris[0].terminKe !== 1) return { error: "Jadwal termin dimulai dari termin 1." };
    const totalBayar = baris.reduce((s, b) => s + Math.round(b.bayarPct * 100), 0) / 100;
    if (totalBayar > 100) return { error: `Jumlah persen bayar ${totalBayar}% melebihi 100%.` };

    const c = await kontrakMilik(contractId.data, user.orgId);
    await db.$transaction([
      db.contractTermin.deleteMany({ where: { contractId: c.id } }),
      db.contractTermin.createMany({ data: baris.map((b) => ({ ...b, contractId: c.id })) }),
    ]);
    await audit(user.id, "surat_penyedia.jadwal_termin", "contract", c.id, { termin: baris, totalBayar });
    revalidatePath(`/paket/${c.packageId}/termin`);
    return {
      success:
        baris.length === 0
          ? "Jadwal termin dikembalikan ke jadwal bawaan KKP."
          : `Jadwal ${baris.length} termin disimpan. Jumlah persen bayar ${totalBayar.toLocaleString("id-ID")}%.`,
    };
  } catch (err) {
    return gagal(err);
  }
}

/* ── Surat ─────────────────────────────────────────────────────────────── */

const buatSchema = z.object({
  contractId: z.uuid(),
  jenis: z.enum(JENIS_SURAT_TERSEDIA as [string, ...string[]]),
  terminKe: z.coerce.number().int().min(1).max(MAKS_TERMIN),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal surat tidak valid."),
  kota: z.string().trim().min(1, "Kota penulisan surat wajib diisi.").max(60),
  nomor: z.string().trim().max(120),
});

export async function buatSuratAction(_prev: SuratPenyediaState, formData: FormData): Promise<SuratPenyediaState> {
  try {
    const user = await requireCapability("contract.manage");
    const parsed = buatSchema.safeParse({
      contractId: formData.get("contractId"),
      jenis: formData.get("jenis"),
      terminKe: formData.get("terminKe"),
      tanggal: formData.get("tanggal"),
      kota: formData.get("kota") ?? "",
      nomor: formData.get("nomor") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const jenis = d.jenis as (typeof JENIS_SURAT_TERSEDIA)[number];
    const tanggal = parseDateKey(d.tanggal)!;

    const c = await kontrakMilik(d.contractId, user.orgId);
    const kontrak = await muatKontrakSurat(c.id, user.orgId);
    if (!kontrak) return { error: "Kontrak tidak ditemukan." };
    if (!terminAda(kontrak, d.terminKe)) return { error: `Termin ${d.terminKe} tidak ada di jadwal termin kontrak ini.` };

    const isian =
      jenis === "ba_pembahasan_kemajuan"
        ? {
            kepada: [],
            lampiran: [],
            pimpinan: String(formData.get("pimpinan") ?? "").trim().slice(0, 200),
            peserta: barisTeks(formData.get("peserta")),
            cara: String(formData.get("cara") ?? "").trim().slice(0, 200),
          }
        : { kepada: barisTeks(formData.get("kepada")), lampiran: barisTeks(formData.get("lampiran")) };

    // Nomor kosong = otomatis dari pola perusahaan; diketik = dipakai apa adanya.
    const pola = kontrak.vendor.polaNomorSurat;
    if (!d.nomor && !pola)
      return { error: "Isi nomor surat, atau atur pola nomor perusahaan di Data surat supaya nomornya otomatis." };

    // Yang belum lengkap DISEBUT sekarang, bukan baru ketahuan saat diunduh.
    const kurang = kekuranganData(
      dataDariKontrak(kontrak, { jenis, terminKe: d.terminKe, nomor: d.nomor, tanggal, kota: d.kota, isian }),
    );
    if (kurang.length > 0)
      return { error: `${LABEL_JENIS_SURAT[jenis]} belum bisa disusun. Lengkapi dulu: ${kurang.join("; ")}.` };

    const { s, nomor, nomorUrut } = await db.$transaction(async (tx) => {
      let nomor = d.nomor;
      let nomorUrut: number | null = null;
      if (!nomor) {
        await kunciNomorPerusahaan(tx, c.vendorId);
        nomorUrut = await nomorUrutBerikut(c.vendorId, tanggal, tx);
        nomor = susunNomor(pola!, nomorUrut, tanggal);
      }
      const s = await tx.suratPenyedia.create({
        data: { contractId: c.id, jenis, terminKe: d.terminKe, nomor, nomorUrut, tanggal, kota: d.kota, isian, dibuatOlehId: user.id },
        select: { id: true },
      });
      return { s, nomor, nomorUrut };
    });

    await audit(user.id, "surat_penyedia.buat", "surat_penyedia", s.id, {
      contractId: c.id,
      jenis,
      terminKe: d.terminKe,
      nomor,
      otomatis: nomorUrut !== null,
    });
    revalidatePath(`/paket/${c.packageId}/termin`);
    return { success: `${LABEL_JENIS_SURAT[jenis]} termin ${d.terminKe} dibuat dengan nomor ${nomor}.` };
  } catch (err) {
    return gagal(err);
  }
}

/* ── Progres dari laporan kemajuan konsultan (DECISIONS 717) ─────────────── */

const progresSchema = z.object({
  contractId: z.uuid(),
  terminKe: z.coerce.number().int().min(1).max(MAKS_TERMIN),
  progresPct: z.coerce.number().min(0, "Progres keseluruhan 0–100%.").max(100, "Progres keseluruhan 0–100%."),
  mingguKe: z.coerce.number().int("Minggu ke- harus bilangan bulat.").min(1, "Minggu ke- diisi.").max(260),
});

/**
 * Simpan progres menurut laporan konsultan untuk satu termin: angka
 * keseluruhan + satu baris per lokasi aktif paket. Angka dipakai APA ADANYA
 * (DECISIONS 203); ini rujukan surat, bukan progres resmi MARLIN.
 */
export async function simpanProgresKonsultanAction(
  _prev: SuratPenyediaState,
  formData: FormData,
): Promise<SuratPenyediaState> {
  try {
    const user = await requireCapability("contract.manage");
    const parsed = progresSchema.safeParse({
      contractId: formData.get("contractId"),
      terminKe: formData.get("terminKe"),
      progresPct: angkaForm(formData.get("progresPct")),
      mingguKe: angkaForm(formData.get("mingguKe")),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const c = await kontrakMilik(d.contractId, user.orgId);
    const kontrak = await muatKontrakSurat(c.id, user.orgId);
    if (!kontrak) return { error: "Kontrak tidak ditemukan." };
    if (!terminAda(kontrak, d.terminKe)) return { error: `Termin ${d.terminKe} tidak ada di jadwal termin kontrak ini.` };

    const lokasi: ProgresLokasi[] = [];
    for (const l of kontrak.package.locations.filter((x) => x.isActive)) {
      const persenTeks = angkaForm(formData.get(`persen_${l.id}`));
      const tanggal = String(formData.get(`tanggal_${l.id}`) ?? "").trim();
      const mingguTeks = angkaForm(formData.get(`minggu_${l.id}`));
      const p = z.coerce.number().min(0).max(100).safeParse(persenTeks);
      if (!persenTeks || !p.success) return { error: `${l.name}: isi progres 0–100% sesuai laporan konsultan.` };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || !parseDateKey(tanggal))
        return { error: `${l.name}: isi tanggal laporan konsultan.` };
      if (tanggal > jakartaDateKey(new Date())) return { error: `${l.name}: tanggal laporan tidak boleh sesudah hari ini.` };
      const m = z.coerce.number().int().min(1).max(260).safeParse(mingguTeks || String(d.mingguKe));
      if (!m.success) return { error: `${l.name}: minggu ke- harus bilangan bulat 1 ke atas.` };
      lokasi.push({
        locationId: l.id,
        nomor: String(formData.get(`nomor_${l.id}`) ?? "").trim().slice(0, 120),
        tanggal,
        mingguKe: m.data,
        persen: p.data,
      });
    }
    if (lokasi.length === 0) return { error: "Paket ini belum punya lokasi aktif." };

    const data = { progresPct: d.progresPct, mingguKe: d.mingguKe, lokasi, diubahOlehId: user.id };
    await db.terminProgresKonsultan.upsert({
      where: { contractId_terminKe: { contractId: c.id, terminKe: d.terminKe } },
      create: { contractId: c.id, terminKe: d.terminKe, ...data },
      update: data,
    });
    await audit(user.id, "surat_penyedia.progres_konsultan", "contract", c.id, {
      terminKe: d.terminKe,
      progresPct: d.progresPct,
      mingguKe: d.mingguKe,
      lokasi: lokasi.map((l) => ({ locationId: l.locationId, persen: l.persen, tanggal: l.tanggal })),
    });
    revalidatePath(`/paket/${c.packageId}/termin`);
    return { success: `Progres laporan konsultan termin ${d.terminKe} disimpan: ${d.progresPct.toLocaleString("id-ID")}%.` };
  } catch (err) {
    return gagal(err);
  }
}

export async function hapusSuratAction(_prev: SuratPenyediaState, formData: FormData): Promise<SuratPenyediaState> {
  try {
    const user = await requireCapability("contract.manage");
    const id = z.uuid().safeParse(formData.get("suratId"));
    if (!id.success) return { error: "Surat tidak valid." };
    const s = await db.suratPenyedia.findFirst({
      where: { id: id.data, contract: { package: { orgId: user.orgId } } },
      select: { id: true, jenis: true, nomor: true, terminKe: true, contractId: true, contract: { select: { packageId: true } } },
    });
    if (!s) return { error: "Surat tidak ditemukan." };
    await db.suratPenyedia.delete({ where: { id: s.id } });
    await audit(user.id, "surat_penyedia.hapus", "surat_penyedia", s.id, {
      contractId: s.contractId,
      jenis: s.jenis,
      nomor: s.nomor,
      terminKe: s.terminKe,
    });
    revalidatePath(`/paket/${s.contract.packageId}/termin`);
    return { success: `${LABEL_JENIS_SURAT[s.jenis]} nomor ${s.nomor} dihapus.` };
  } catch (err) {
    return gagal(err);
  }
}
