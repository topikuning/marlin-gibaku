import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { jalankanDiLatar } from "@/lib/auth/latar";
import { siapkanTargetHarga, usulkanHargaDenganAi, type TargetSiap } from "./hsd-ai";

/**
 * Meminta draf harga kepada AI DI LATAR (RAPL-01, DECISIONS 473).
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
};

/** Tutup run HANYA bila pekerjaan ini masih pemiliknya. */
async function tutupBilaMasihMilik(
  input: UsulanLatarInput,
  hasil:
    | { ok: true; model: string; usulan: { kategori: string; nama: string; satuan: string; harga: string; keyakinan: string; alasan: string }[] }
    | { ok: false; error: string },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const klaim = await tx.hsdUsulanRun.updateMany({
      where: { id: input.runId, pendingSince: input.penanda },
      data: {
        pendingSince: null,
        selesaiAt: new Date(),
        status: hasil.ok ? "selesai" : "gagal",
        model: hasil.ok ? hasil.model : null,
        errorMessage: hasil.ok ? null : hasil.error,
        diminta: hasil.ok ? hasil.usulan.length : 0,
      },
    });
    if (klaim.count === 0) return false;
    if (hasil.ok && hasil.usulan.length > 0) {
      await tx.hsdUsulanAi.createMany({
        data: hasil.usulan.map((u) => ({
          runId: input.runId,
          kategori: u.kategori,
          nama: u.nama,
          satuan: u.satuan,
          harga: BigInt(u.harga),
          keyakinan: u.keyakinan,
          alasan: u.alasan,
        })),
        skipDuplicates: true,
      });
    }
    return true;
  });
}

export function mulaiUsulanHargaLatar(user: SessionUser, input: UsulanLatarInput): void {
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
      const hasil = await usulkanHargaDenganAi(user, siap);
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
