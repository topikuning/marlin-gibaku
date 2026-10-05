import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { tampilanAkunCadangan } from "./akun";
import { cadanganDbJatuhTempo, kenaliMasalahCadangan } from "./aturan";
import { cadangkanBerkas, ringkasBerkas, type HasilBerkas } from "./berkas";
import { cadangkanDatabase, catatGalatDb, keadaanDb, type CatatanDb } from "./database";

/**
 * SATU PUTARAN CADANGAN (DECISIONS 650): database bila sudah waktunya (sekali
 * sehari), lalu berkas sampai anggaran waktunya habis. Dipicu tiap jam oleh
 * `.github/workflows/cron-cadangan.yml`; putaran berikutnya menyambung.
 */

const ANGGARAN_LATAR_MS = 50 * 60_000;

export type HasilCadangan = {
  dijalankan: boolean;
  alasan: "mati" | "belum-tersambung" | "jalan";
  db: { dibuat: CatatanDb | null; galat: string | null; dilewati: boolean };
  berkas: HasilBerkas | null;
};

export async function jalankanCadangan(opsi: { anggaranMs: number; paksaDb?: boolean }): Promise<HasilCadangan> {
  const mulai = Date.now();
  const akun = await tampilanAkunCadangan();
  const kosong = { db: { dibuat: null, galat: null, dilewati: true }, berkas: null };
  if (!akun.aktif) return { dijalankan: false, alasan: "mati", ...kosong };
  if (!akun.terhubung) return { dijalankan: false, alasan: "belum-tersambung", ...kosong };

  const dbHasil: HasilCadangan["db"] = { dibuat: null, galat: null, dilewati: true };
  const { terakhir } = await keadaanDb();
  if (opsi.paksaDb || cadanganDbJatuhTempo(terakhir ? new Date(terakhir.pada) : null, new Date())) {
    dbHasil.dilewati = false;
    try {
      dbHasil.dibuat = await cadangkanDatabase();
    } catch (err) {
      dbHasil.galat = err instanceof Error ? err.message : "cadangan database gagal";
      await catatGalatDb(dbHasil.galat).catch(() => null);
    }
  }

  const sisa = opsi.anggaranMs - (Date.now() - mulai);
  const berkas = sisa > 30_000 ? await cadangkanBerkas(sisa) : null;
  return { dijalankan: true, alasan: "jalan", db: dbHasil, berkas };
}

/* ── Putaran latar ───────────────────────────────────────────────────────── */

let latar: { mulai: Date } | null = null;
let hasilTerakhir: (HasilCadangan & { selesai: Date }) | null = null;

export function keadaanCadanganLatar() {
  return { berjalanSejak: latar?.mulai ?? null, terakhir: hasilTerakhir };
}

/** Mulai di latar lalu langsung pulang – pola yang sama dengan pemindah berkas. */
export async function mulaiCadanganLatar(opsi: { paksaDb?: boolean } = {}): Promise<
  { dimulai: true; berjalanSejak: Date } | { dimulai: false; berjalanSejak?: Date; alasan?: HasilCadangan["alasan"] }
> {
  if (latar) return { dimulai: false, berjalanSejak: latar.mulai };
  const akun = await tampilanAkunCadangan();
  if (!akun.aktif) return { dimulai: false, alasan: "mati" };
  if (!akun.terhubung) return { dimulai: false, alasan: "belum-tersambung" };
  const mulai = new Date();
  latar = { mulai };
  void (async () => {
    try {
      hasilTerakhir = { ...(await jalankanCadangan({ anggaranMs: ANGGARAN_LATAR_MS, paksaDb: opsi.paksaDb })), selesai: new Date() };
    } catch (err) {
      console.error("[cadangan] putaran latar gagal:", err);
    } finally {
      latar = null;
      await periksaCadanganDanPeringatkan().catch(() => null);
    }
  })();
  return { dimulai: true, berjalanSejak: mulai };
}

/* ── Peringatan WA ───────────────────────────────────────────────────────── */

const AKSI = "system.cadangan_peringatan";
const JEDA_JAM = 24;

/**
 * Peringatan memakai saluran yang SAMA dengan peringatan arsip dingin (sakelar
 * dan nomor tujuan di Sistem → Arsip dingin) – satu tempat mengatur siapa yang
 * dikabari soal penyimpanan. Satu pesan per hari untuk keadaan yang sama.
 *
 * Dipanggil di ujung putaran cadangan DAN dari tugas harian: kalau penjadwal
 * cadangan mati total, putarannya tidak jalan dan tidak ada yang melapor –
 * tugas harian yang menangkapnya.
 */
export async function periksaCadanganDanPeringatkan(sekarang = new Date()): Promise<{ masalah: number; terkirim: boolean }> {
  const akun = await tampilanAkunCadangan();
  // Belum pernah disambungkan sama sekali = fitur belum dipakai, bukan rusak.
  const pernahDipakai = akun.terhubung || (await db.cadanganBerkas.count({ take: 1 })) > 0;
  if (!pernahDipakai) return { masalah: 0, terkirim: false };
  const [{ terakhir, galat }, ringkas] = await Promise.all([keadaanDb(), ringkasBerkas()]);
  const masalah = kenaliMasalahCadangan(
    {
      aktif: akun.aktif,
      terhubung: akun.terhubung,
      adaKunci: akun.adaKunci,
      dbTerakhirBerhasil: terakhir ? new Date(terakhir.pada) : null,
      berkasMenunggu: ringkas.menunggu,
      berkasTerakhirBerhasil: ringkas.terakhirBerhasil,
      galatTerakhir: galat?.galat ?? null,
    },
    sekarang,
  );
  if (masalah.length === 0) return { masalah: 0, terkirim: false };

  const { waArsipAktif, waArsipTujuan } = await import("@/lib/arsip-asli/setelan");
  if (!(await waArsipAktif())) return { masalah: masalah.length, terkirim: false };
  const tujuan = await waArsipTujuan();
  if (!tujuan) return { masalah: masalah.length, terkirim: false };

  const sidik = createHash("sha256").update(masalah.map((m) => m.kode).sort().join("|")).digest("hex").slice(0, 16);
  const lalu = await db.auditLog.findFirst({
    where: { action: AKSI },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  });
  const sama = (lalu?.payload as { sidik?: unknown } | null)?.sidik === sidik;
  if (lalu && sama && (sekarang.getTime() - lalu.createdAt.getTime()) / 3_600_000 < JEDA_JAM) {
    return { masalah: masalah.length, terkirim: false };
  }

  const teks = [
    "*MARLIN – Cadangan ke Google Drive perlu diperiksa*",
    "",
    ...masalah.map((m, i) => `${i + 1}. ${m.teks}`),
    "",
    "Rinciannya di MARLIN – Sistem – Cadangan ke Google Drive.",
  ].join("\n");
  try {
    const { sendText } = await import("@/lib/waha/kirim");
    await sendText(tujuan, teks);
    await audit(null, AKSI, "system", null, { sidik, kode: masalah.map((m) => m.kode) });
    return { masalah: masalah.length, terkirim: true };
  } catch {
    return { masalah: masalah.length, terkirim: false };
  }
}
