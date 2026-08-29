"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, auditIn } from "@/lib/audit";
import { ForbiddenError, requestIp, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { BATAS_HARGA_RUPIAH, bacaRupiah } from "./hsd-price";
import { kunciSumberDaya } from "./rapl-calc";

/**
 * Aksi Harga Satuan Dasar (DECISIONS 327).
 *
 * Capability `finance.input`: ini memasukkan ANGKA UANG yang dipakai
 * membandingkan biaya pelaksanaan dengan nilai RAB aktif — bobotnya sama dengan
 * memasukkan transaksi keuangan, bukan sekadar mengelola RAB.
 */

export type HargaActionState = { error?: string; success?: string } | undefined;

const skema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1),
  kategori: z.string().min(1),
  nama: z.string().min(1),
  satuan: z.string(),
  /** "" = kosongkan harganya (hapus barisnya), bukan simpan nol. */
  harga: z.string(),
});

async function simpanHargaDenganAudit(args: {
  locationId: string;
  kategori: string;
  nama: string;
  satuan: string;
  harga: bigint | null;
  sumber: string | null;
  userId: string;
  lewat?: string;
}): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    if (args.harga === null) {
      await tx.hargaSatuanDasar.deleteMany({
        where: {
          locationId: args.locationId,
          kategori: args.kategori,
          nama: args.nama,
          satuan: args.satuan,
        },
      });
    } else {
      await tx.hargaSatuanDasar.upsert({
        where: {
          locationId_kategori_nama_satuan: {
            locationId: args.locationId,
            kategori: args.kategori,
            nama: args.nama,
            satuan: args.satuan,
          },
        },
        create: {
          locationId: args.locationId,
          kategori: args.kategori,
          nama: args.nama,
          satuan: args.satuan,
          harga: args.harga,
          sumber: args.sumber,
          updatedById: args.userId,
        },
        update: {
          harga: args.harga,
          sumber: args.sumber,
          updatedById: args.userId,
        },
      });
    }
    await auditIn(
      tx,
      args.userId,
      args.harga === null ? "hsd.hapus" : "hsd.simpan",
      "location",
      args.locationId,
      {
        kategori: args.kategori,
        nama: args.nama,
        satuan: args.satuan,
        harga: args.harga?.toString() ?? null,
        sumber: args.sumber,
        ...(args.lewat ? { lewat: args.lewat } : {}),
      },
      ip,
    );
  });
}

export async function simpanHargaAction(
  _prev: HargaActionState,
  formData: FormData,
): Promise<HargaActionState> {
  const parsed = skema.safeParse({
    locationId: formData.get("locationId"),
    slug: formData.get("slug"),
    kategori: formData.get("kategori"),
    nama: formData.get("nama"),
    satuan: String(formData.get("satuan") ?? ""),
    harga: String(formData.get("harga") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const harga = bacaRupiah(d.harga);
  if (harga === "salah") return { error: `Harga "${d.harga}" tidak terbaca sebagai angka rupiah.` };

  try {
    const user = await requireCapability("finance.input");
    await requireLocationAccess(user, d.locationId);
    await simpanHargaDenganAudit({
      locationId: d.locationId,
      kategori: d.kategori,
      nama: d.nama,
      satuan: d.satuan,
      harga,
      // Asal-usul ditetapkan SERVER (RAPL-06) — lihat catatan di `simpanHargaSel`.
      sumber: harga === null ? null : SUMBER_MANUAL,
      userId: user.id,
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return {
      success:
        harga === null
          ? `Harga "${d.nama}" dikosongkan.`
          : `Harga "${d.nama}" disimpan: Rp${harga.toLocaleString("id-ID")} / ${d.satuan || "satuan"}.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan harga." };
  }
}

/**
 * Simpan harga dari GRID (edit sel gaya Excel) — DECISIONS 328.
 *
 * Dipisah dari jalur FormData karena bentuk masukannya memang beda: grid
 * mengirim satu sel yang baru diubah, bukan satu formulir. Pemeriksaan
 * izinnya sama persis; yang berbeda hanya cara datanya sampai.
 *
 * `sumber` DITETAPKAN SERVER, tidak diterima dari klien (RAPL-06, DECISIONS
 * 473). Asal-usul harga adalah keterangan yang dipertahankan saat diperiksa;
 * membiarkan peramban menuliskannya berarti siapa pun yang boleh mengisi harga
 * juga boleh mengarang dari mana harga itu datang — termasuk mengaku "Usulan
 * AI – disetujui pengguna" atas angka yang diketik tangan.
 */
const selSkema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1).max(200),
  kategori: z.string().min(1).max(80),
  nama: z.string().min(1).max(500),
  satuan: z.string().max(80),
  harga: z.string().max(40),
});

export async function simpanHargaSel(args: {
  locationId: string;
  slug: string;
  kategori: string;
  nama: string;
  satuan: string;
  /** Teks apa adanya dari sel; "" atau nol berarti kosongkan. */
  harga: string;
}): Promise<
  | { ok: true; harga: string | null; biaya: string | null; sumber: string | null }
  | { ok: false; error: string }
> {
  const parsed = selSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const harga = bacaRupiah(d.harga);
  if (harga === "salah") {
    return { ok: false, error: `"${d.harga}" tidak terbaca sebagai angka rupiah.` };
  }
  try {
    const user = await requireCapability("finance.input");
    await requireLocationAccess(user, d.locationId);
    await simpanHargaDenganAudit({
      locationId: d.locationId,
      kategori: d.kategori,
      nama: d.nama,
      satuan: d.satuan,
      harga,
      sumber: harga === null ? null : SUMBER_MANUAL,
      userId: user.id,
      lewat: "grid",
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    const { keadaanHarga } = await import("./hsd");
    const keadaan = await keadaanHarga(d.locationId);
    const baris = keadaan.baris.find(
      (b) =>
        kunciSumberDaya(b.kategori, b.nama, b.satuan) ===
        kunciSumberDaya(d.kategori, d.nama, d.satuan),
    );
    return {
      ok: true,
      harga: baris?.harga?.toString() ?? null,
      biaya: baris?.biaya?.toString() ?? null,
      sumber: baris?.sumber ?? null,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan harga." };
  }
}

/* ------------------------------------------------------- DRAF HARGA DARI AI */

const SUMBER_MANUAL = "Input manual";
const SUMBER_AI = "Usulan AI – disetujui pengguna";

const mintaSkema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1).max(200),
  /** Kunci sumber daya yang dicentang pengguna; kosong = mesin yang memilih. */
  dipilih: z.array(z.string().max(700)).max(500).optional(),
});

/**
 * MINTA draf harga kepada AI — request hanya MENCATAT (RAPL-01, DECISIONS 475).
 *
 * Yang tetap dikerjakan sinkron: kapabilitas, akses lokasi, penyiapan target,
 * dan `checkAiGuard`. Penolakan yang bisa dijawab tanpa provider harus sampai
 * seketika; yang tidak bisa dijawab tanpa provider dilepas ke latar.
 */
export async function mintaUsulanHargaAiAction(args: {
  locationId: string;
  slug: string;
  dipilih?: string[];
}): Promise<{ ok: true; runId: string; diminta: number; totalKosong: number } | { ok: false; error: string }> {
  const parsed = mintaSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("ai.generate");
    await requireCapability("finance.input");
    await requireLocationAccess(user, d.locationId);

    // Satu permintaan per lokasi pada satu waktu. Yang sudah lewat batas
    // dianggap mati dan boleh digantikan — pola yang sama dengan Ask MARLIN.
    const { getAiGuardConfig } = await import("@/lib/ai-hub/guard");
    const { batasJawabanMs } = await import("@/lib/ai-hub/guard-rules");
    const cfg = await getAiGuardConfig();
    const ambang = new Date(Date.now() - batasJawabanMs(cfg));
    const berjalan = await db.hsdUsulanRun.findFirst({
      where: { locationId: d.locationId, pendingSince: { not: null, gt: ambang } },
      select: { id: true },
    });
    if (berjalan) {
      return { ok: false, error: "Permintaan draf harga untuk lokasi ini masih berjalan." };
    }

    const { siapkanTargetHarga } = await import("./hsd-ai");
    const dipilih = d.dipilih && d.dipilih.length > 0 ? new Set(d.dipilih) : undefined;
    const siap = await siapkanTargetHarga(d.locationId, dipilih);
    if ("error" in siap) return { ok: false, error: siap.error };

    // Pagar AI diperiksa SEKARANG supaya kill switch & kuota menolak seketika.
    // Ia dipanggil sekali lagi di latar; fungsinya murni baca, jadi kuota tidak
    // terhitung dua kali (alasan yang sama dengan DECISIONS 455 butir 2).
    const { checkAiGuard, AiGuardError } = await import("@/lib/ai-hub/guard");
    try {
      await checkAiGuard(user, {
        kind: "rapl.usulan_harga",
        locationCount: 1,
        inputChars: JSON.stringify(siap.target).length,
      });
    } catch (err) {
      if (err instanceof AiGuardError) return { ok: false, error: err.message };
      throw err;
    }

    const penanda = new Date();
    const run = await db.hsdUsulanRun.create({
      data: {
        locationId: d.locationId,
        status: "menunggu",
        pendingSince: penanda,
        diminta: siap.target.length,
        totalKosong: siap.totalKosong,
        requestedById: user.id,
      },
      select: { id: true },
    });
    await audit(user.id, "rapl.harga_ai.minta", "location", d.locationId, {
      runId: run.id,
      diminta: siap.target.length,
      totalKosong: siap.totalKosong,
      dicentangPengguna: dipilih ? dipilih.size : 0,
    });

    const { mulaiUsulanHargaLatar } = await import("./hsd-ai-latar");
    mulaiUsulanHargaLatar(user, {
      runId: run.id,
      penanda,
      locationId: d.locationId,
      dipilih: d.dipilih,
    });

    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, runId: run.id, diminta: siap.target.length, totalKosong: siap.totalKosong };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal meminta usulan harga AI." };
  }
}

const putusanSkema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1).max(200),
  /** ID baris `HsdUsulanAi` — BUKAN angka harganya. */
  ids: z.array(z.uuid()).min(1).max(200),
});

/**
 * TERAPKAN draf yang dipilih orang (RAPL-05/RAPL-06, DECISIONS 475).
 *
 * Dua hal yang berubah dari versi pertama, dan keduanya penting:
 *
 * 1. **Yang dikirim peramban adalah ID, bukan harga.** Harganya dibaca ulang
 *    dari baris draf milik lokasi ini. Versi pertama menerima angka dari klien
 *    lalu menyimpannya bersumber "Usulan AI – disetujui pengguna" — jejak audit
 *    yang menyatakan sesuatu yang tidak pernah diperiksa server.
 * 2. **Kedua kapabilitas dituntut.** DECISIONS 441 mensyaratkan pengguna
 *    berhak `ai.generate` DAN `finance.input`; versi pertama hanya menuntut
 *    yang kedua, sehingga role yang sengaja tidak diberi akses AI tetap bisa
 *    membubuhkan cap AI pada harga.
 */
export async function terapkanUsulanHargaAiAction(args: {
  locationId: string;
  slug: string;
  ids: string[];
}): Promise<
  | { ok: true; tersimpan: { kategori: string; nama: string; satuan: string; harga: string; biaya: string; sumber: string }[]; dilewat: number }
  | { ok: false; error: string }
> {
  const parsed = putusanSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("ai.generate");
    await requireCapability("finance.input");
    await requireLocationAccess(user, d.locationId);

    const draf = await db.hsdUsulanAi.findMany({
      where: { id: { in: d.ids }, status: "draf", run: { locationId: d.locationId } },
      select: { id: true, kategori: true, nama: true, satuan: true, harga: true },
    });
    if (draf.length === 0) {
      return { ok: false, error: "Tidak ada draf yang bisa diterapkan – mungkin sudah diputuskan sebelumnya." };
    }

    const { keadaanHarga } = await import("./hsd");
    const sebelum = await keadaanHarga(d.locationId);
    const belum = new Set(
      sebelum.baris
        .filter((b) => b.harga === null)
        .map((b) => kunciSumberDaya(b.kategori, b.nama, b.satuan)),
    );
    const diterima = draf.filter((u) => belum.has(kunciSumberDaya(u.kategori, u.nama, u.satuan)));
    if (diterima.length === 0) {
      return { ok: false, error: "Usulan tidak diterapkan karena itemnya sudah berharga atau tidak lagi ada." };
    }

    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      for (const u of diterima) {
        await tx.hargaSatuanDasar.upsert({
          where: {
            locationId_kategori_nama_satuan: {
              locationId: d.locationId,
              kategori: u.kategori,
              nama: u.nama,
              satuan: u.satuan,
            },
          },
          create: {
            locationId: d.locationId,
            kategori: u.kategori,
            nama: u.nama,
            satuan: u.satuan,
            harga: u.harga,
            sumber: SUMBER_AI,
            updatedById: user.id,
          },
          update: { harga: u.harga, sumber: SUMBER_AI, updatedById: user.id },
        });
      }
      await tx.hsdUsulanAi.updateMany({
        where: { id: { in: diterima.map((u) => u.id) } },
        data: { status: "diterima" },
      });
      await auditIn(
        tx,
        user.id,
        "rapl.harga_ai.terapkan",
        "location",
        d.locationId,
        {
          jumlah: diterima.length,
          usulanId: diterima.map((u) => u.id),
          kunci: diterima.map((u) => kunciSumberDaya(u.kategori, u.nama, u.satuan)),
        },
        ip,
      );
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);

    const sesudah = await keadaanHarga(d.locationId);
    const diterimaSet = new Set(
      diterima.map((u) => kunciSumberDaya(u.kategori, u.nama, u.satuan)),
    );
    return {
      ok: true,
      dilewat: draf.length - diterima.length,
      tersimpan: sesudah.baris
        .filter((b) => diterimaSet.has(kunciSumberDaya(b.kategori, b.nama, b.satuan)))
        .flatMap((b) =>
          b.harga !== null && b.biaya !== null
            ? [
                {
                  kategori: b.kategori,
                  nama: b.nama,
                  satuan: b.satuan,
                  harga: b.harga.toString(),
                  biaya: b.biaya.toString(),
                  sumber: b.sumber ?? SUMBER_AI,
                },
              ]
            : [],
        ),
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menerapkan usulan harga AI." };
  }
}

/**
 * TOLAK draf (RAPL-05). Penolakan dicatat, bukan sekadar dibuang dari layar:
 * persetujuan yang tidak bisa sebagian bukan persetujuan, dan yang ditolak pun
 * bagian dari jejak keputusan.
 */
export async function tolakUsulanHargaAiAction(args: {
  locationId: string;
  slug: string;
  ids: string[];
}): Promise<{ ok: true; ditolak: number } | { ok: false; error: string }> {
  const parsed = putusanSkema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("finance.input");
    await requireLocationAccess(user, d.locationId);
    const ip = await requestIp();
    const hasil = await db.$transaction(async (tx) => {
      const n = await tx.hsdUsulanAi.updateMany({
        where: { id: { in: d.ids }, status: "draf", run: { locationId: d.locationId } },
        data: { status: "ditolak" },
      });
      if (n.count > 0) {
        await auditIn(tx, user.id, "rapl.harga_ai.tolak", "location", d.locationId, {
          jumlah: n.count,
          usulanId: d.ids,
        }, ip);
      }
      return n.count;
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return { ok: true, ditolak: hasil };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menolak usulan harga AI." };
  }
}
