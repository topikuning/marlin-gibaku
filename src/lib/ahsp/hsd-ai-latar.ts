import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { jalankanDiLatar } from "@/lib/auth/latar";
import { muatLokasiHarga, usulanDariKatalog } from "@/lib/harga-wilayah/katalog";
import type { SumberHarga } from "@/lib/harga-wilayah/aturan";
import { siapkanTargetHarga, type TargetSiap } from "./hsd-ai";
import { kunciTarget } from "./usulan-target";

/**
 * Meminta draf harga kepada AI DI LATAR (RAPL-01, DECISIONS 475).
 *
 * Sebelumnya seluruh panggilan provider ditahan di dalam server action yang
 * ditunggu peramban. Anggarannya sah sampai ±4 menit — `aiStructured` boleh
 * memanggil dua kali dan tiap panggilan punya satu retry 60 detik — sementara
 * peramban menyerah jauh lebih awal. Polanya sama persis dengan yang sudah
 * ditinggalkan Ask MARLIN di DECISIONS 455, lengkap dengan akibatnya: token
 * terbayar, layar tidak menerima apa pun.
 *
 * MODUL INI TIDAK BOLEH MELEMPAR KE PEMANGGIL: ia sengaja dipanggil tanpa
 * `await`. Setiap jalur keluar wajib menutup `pendingSince` run-nya — run yang
 * menggantung membuat layar menunggu sesuatu yang tidak akan datang.
 */

export type UsulanLatarInput = {
  runId: string;
  /**
   * PENANDA PEKERJAAN — nilai `pendingSince` yang dipasang pemanggil tepat
   * sebelum pekerjaan ini dimulai. Setiap tulisan dijaga `updateMany`
   * bersyarat penanda yang sama, jadi pekerja basi menulis NOL baris dan diam.
   * Pola dan alasannya sama dengan `ai-hub/tanya-latar.ts`.
   */
  penanda: Date;
  locationId: string;
  /** Kunci sumber daya yang dicentang pengguna; kosong = biarkan mesin memilih. */
  dipilih?: string[];
  /**
   * ESTIMASI SEMUA HARGA (DECISIONS 805): berputar per 25 sumber daya sampai
   * seluruh yang belum berharga punya usulan, dalam SATU run. Tiap putaran
   * menyimpan drafnya dan memperbarui penanda, jadi layar melihat kemajuan dan
   * batas tunggu dihitung per putaran, bukan untuk seluruh perputaran.
   */
  semua?: boolean;
};

/** Batas putaran: 20 × 25 = 500 sumber daya – di atas lokasi terbesar sekarang. */
export const MAKS_PUTARAN_USULAN = 20;

type UsulanJadi = {
  kategori: string;
  nama: string;
  satuan: string;
  harga: string;
  keyakinan: string;
  alasan: string;
  metode?: string;
  sumber?: SumberHarga[];
};

type HasilPutaran = { ok: true; model: string; usulan: UsulanJadi[]; catatan: string | null } | { ok: false; error: string };

/**
 * Usulan untuk satu putaran (DECISIONS 806): harga lapangan sekabupaten →
 * katalog wilayah → riset (web, atau estimasi). Bukan lagi satu panggilan AI
 * per lokasi: lokasi sekabupaten memakai riset yang sama.
 */
async function usulkan(user: SessionUser, locationId: string, siap: TargetSiap): Promise<HasilPutaran> {
  const lokasi = await muatLokasiHarga(locationId);
  if (!lokasi) return { ok: false, error: "Lokasi tidak ditemukan." };
  const r = await usulanDariKatalog(user, lokasi, siap.target);
  if (!r.ok) return r;
  if (r.usulan.length === 0) return { ok: false, error: r.catatan ?? "Tidak ada harga yang bisa diusulkan untuk sumber daya ini." };
  return { ok: true, model: r.model, usulan: r.usulan, catatan: r.catatan };
}

const dataDraf = (runId: string, u: UsulanJadi) => ({
  runId,
  kategori: u.kategori,
  nama: u.nama,
  satuan: u.satuan,
  harga: BigInt(u.harga),
  keyakinan: u.keyakinan,
  alasan: u.alasan,
  metode: u.metode ?? null,
  sumber: u.sumber ?? undefined,
});

/** Tutup run HANYA bila pekerjaan ini masih pemiliknya. */
async function tutupBilaMasihMilik(input: UsulanLatarInput, hasil: HasilPutaran): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const klaim = await tx.hsdUsulanRun.updateMany({
      where: { id: input.runId, pendingSince: input.penanda },
      data: {
        pendingSince: null,
        selesaiAt: new Date(),
        status: hasil.ok ? "selesai" : "gagal",
        model: hasil.ok ? hasil.model : null,
        errorMessage: hasil.ok ? hasil.catatan : hasil.error,
        diminta: hasil.ok ? hasil.usulan.length : 0,
      },
    });
    if (klaim.count === 0) return false;
    if (hasil.ok && hasil.usulan.length > 0) {
      await tx.hsdUsulanAi.createMany({ data: hasil.usulan.map((u) => dataDraf(input.runId, u)), skipDuplicates: true });
    }
    return true;
  });
}

/**
 * Simpan draf satu putaran dan SERAHKAN penanda ke putaran berikutnya, dalam
 * satu transaksi. false = pekerjaan ini sudah bukan pemilik run (pengguna
 * memulai permintaan baru): drafnya dibuang dan perputaran berhenti.
 */
async function simpanPutaran(runId: string, penanda: Date, berikut: Date, usulan: UsulanJadi[], model: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const klaim = await tx.hsdUsulanRun.updateMany({
      where: { id: runId, pendingSince: penanda },
      data: { pendingSince: berikut, model },
    });
    if (klaim.count === 0) return false;
    if (usulan.length > 0) {
      await tx.hsdUsulanAi.createMany({ data: usulan.map((u) => dataDraf(runId, u)), skipDuplicates: true });
    }
    return true;
  });
}

/** Tutup run perputaran – status dan jumlah usulan yang benar-benar tersimpan. */
async function tutupPerputaran(
  runId: string,
  penanda: Date,
  hasil: { ok: true; model: string | null; catatan?: string | null } | { ok: false; error: string },
): Promise<void> {
  const tersimpan = await db.hsdUsulanAi.count({ where: { runId } });
  await db.hsdUsulanRun.updateMany({
    where: { id: runId, pendingSince: penanda },
    data: {
      pendingSince: null,
      selesaiAt: new Date(),
      // Gagal di tengah tetap menyimpan draf putaran sebelumnya; galatnya
      // disebut supaya orang tahu masih ada yang belum diestimasi.
      status: hasil.ok || tersimpan > 0 ? "selesai" : "gagal",
      ...(hasil.ok ? { model: hasil.model } : {}),
      errorMessage: hasil.ok ? (hasil.catatan ?? null) : tersimpan > 0 ? `Berhenti setelah ${tersimpan} usulan: ${hasil.error}` : hasil.error,
      diminta: tersimpan,
    },
  });
}

export function mulaiUsulanHargaLatar(user: SessionUser, input: UsulanLatarInput): void {
  if (input.semua) {
    mulaiUsulanSemuaLatar(user, input);
    return;
  }
  // Ditandai LATAR (DECISIONS 456): `requestIp()` tidak menyentuh `headers()`.
  void jalankanDiLatar(async () => {
    try {
      const siap: TargetSiap | { error: string } = await siapkanTargetHarga(
        input.locationId,
        input.dipilih && input.dipilih.length > 0 ? new Set(input.dipilih) : undefined,
      );
      if ("error" in siap) {
        await tutupBilaMasihMilik(input, { ok: false, error: siap.error });
        return;
      }
      const hasil = await usulkan(user, input.locationId, siap);
      const jadi = await tutupBilaMasihMilik(input, hasil);
      if (!jadi) {
        // Pengguna sudah memulai permintaan lain; draf ini SENGAJA dibuang.
        console.warn(`[ahsp/hsd-ai-latar] hasil run ${input.runId} dibuang – penandanya sudah berganti`);
      }
    } catch (err) {
      console.error("[ahsp/hsd-ai-latar] pekerjaan latar gagal:", err);
      await tutupBilaMasihMilik(input, {
        ok: false,
        error: err instanceof Error ? err.message : "Permintaan draf harga gagal.",
      }).catch(() => {
        /* DB pun tidak bisa ditulis — penjaga di bawah yang menyelamatkan layar. */
      });
    } finally {
      /*
       * Jaring pengaman, SELALU bersyarat penanda: kalau kedua cabang di atas
       * gagal menulis, penantian layar tetap harus berakhir — tetapi penanda
       * milik permintaan BARU tidak boleh ikut terhapus.
       */
      await db.hsdUsulanRun
        .updateMany({
          where: { id: input.runId, pendingSince: input.penanda },
          data: { pendingSince: null, status: "gagal", selesaiAt: new Date() },
        })
        .catch(() => {
          /* Bila ini pun gagal, batas waktu di layar yang menutup penantiannya. */
        });
    }
  });
}

/**
 * Estimasi SEMUA harga lokasi – berputar sampai habis (DECISIONS 805).
 * Aturan "tidak boleh melempar" dan "selalu tutup run" sama dengan di atas;
 * bedanya penanda berpindah tiap putaran, jadi jaring pengamannya memakai
 * penanda TERAKHIR.
 */
function mulaiUsulanSemuaLatar(user: SessionUser, input: UsulanLatarInput): void {
  void jalankanDiLatar(() => jalankanUsulanSemua(user, input));
}

/**
 * Inti perputaran "estimasi semua" – bisa DITUNGGU, supaya estimasi satu
 * paket (DECISIONS 806) mengerjakan lokasinya satu per satu: lokasi kedua
 * sekabupaten sudah menemukan katalog yang diisi lokasi pertama.
 * Tidak pernah melempar.
 */
export async function jalankanUsulanSemua(user: SessionUser, input: UsulanLatarInput): Promise<void> {
  let penanda = input.penanda;
  {
    try {
      const sudah = new Set<string>();
      let model: string | null = null;
      let catatan: string | null = null;
      for (let i = 0; i < MAKS_PUTARAN_USULAN; i++) {
        const siap: TargetSiap | { error: string } = await siapkanTargetHarga(input.locationId, undefined, sudah);
        if ("error" in siap) {
          await tutupPerputaran(input.runId, penanda, i === 0 ? { ok: false, error: siap.error } : { ok: true, model, catatan });
          return;
        }
        const hasil = await usulkan(user, input.locationId, siap);
        if (!hasil.ok) {
          await tutupPerputaran(input.runId, penanda, hasil);
          return;
        }
        for (const t of siap.target) sudah.add(kunciTarget(t));
        model = hasil.model;
        catatan = hasil.catatan ?? catatan;
        const berikut = new Date(Math.max(Date.now(), penanda.getTime() + 1));
        const lanjut = await simpanPutaran(input.runId, penanda, berikut, hasil.usulan, hasil.model);
        if (!lanjut) {
          console.warn(`[ahsp/hsd-ai-latar] run ${input.runId} berhenti – penandanya sudah berganti`);
          return;
        }
        penanda = berikut;
      }
      await tutupPerputaran(input.runId, penanda, { ok: true, model, catatan });
    } catch (err) {
      console.error("[ahsp/hsd-ai-latar] estimasi semua harga gagal:", err);
      await tutupPerputaran(input.runId, penanda, {
        ok: false,
        error: err instanceof Error ? err.message : "Estimasi harga gagal.",
      }).catch(() => {});
    } finally {
      await db.hsdUsulanRun
        .updateMany({
          where: { id: input.runId, pendingSince: penanda },
          data: { pendingSince: null, status: "gagal", selesaiAt: new Date() },
        })
        .catch(() => {});
    }
  }
}
