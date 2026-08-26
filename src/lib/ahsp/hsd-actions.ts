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
  sumber: z.string().max(200).optional(),
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
    sumber: String(formData.get("sumber") ?? "").trim() || undefined,
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
      sumber: d.sumber ?? null,
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
 */
export async function simpanHargaSel(args: {
  locationId: string;
  slug: string;
  kategori: string;
  nama: string;
  satuan: string;
  /** Teks apa adanya dari sel; "" atau nol berarti kosongkan. */
  harga: string;
  sumber?: string | null;
}): Promise<
  | { ok: true; harga: string | null; biaya: string | null; sumber: string | null }
  | { ok: false; error: string }
> {
  const harga = bacaRupiah(args.harga);
  if (harga === "salah") {
    return { ok: false, error: `"${args.harga}" tidak terbaca sebagai angka rupiah.` };
  }
  try {
    const user = await requireCapability("finance.input");
    await requireLocationAccess(user, args.locationId);
    const sumber = harga === null ? null : args.sumber?.trim() || "Input manual";
    await simpanHargaDenganAudit({
      locationId: args.locationId,
      kategori: args.kategori,
      nama: args.nama,
      satuan: args.satuan,
      harga,
      sumber,
      userId: user.id,
      lewat: "grid",
    });
    revalidatePath(`/lokasi/${args.slug}/rapl`);
    const { keadaanHarga } = await import("./hsd");
    const keadaan = await keadaanHarga(args.locationId);
    const baris = keadaan.baris.find(
      (b) =>
        kunciSumberDaya(b.kategori, b.nama, b.satuan) ===
        kunciSumberDaya(args.kategori, args.nama, args.satuan),
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

export async function mintaUsulanHargaAiAction(args: {
  locationId: string;
  slug: string;
}): Promise<
  | { ok: true; model: string; usulan: import("./hsd-ai").UsulanHargaAi[] }
  | { ok: false; error: string }
> {
  try {
    const user = await requireCapability("ai.generate");
    await requireCapability("finance.input");
    await requireLocationAccess(user, args.locationId);
    const { usulkanHargaDenganAi } = await import("./hsd-ai");
    const hasil = await usulkanHargaDenganAi(user, args.locationId);
    await audit(user.id, "rapl.harga_ai.minta", "location", args.locationId, {
      berhasil: hasil.ok,
      jumlah: hasil.ok ? hasil.usulan.length : 0,
      model: hasil.ok ? hasil.model : null,
    });
    return hasil;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal meminta usulan harga AI." };
  }
}

const usulanSchema = z
  .array(
    z.object({
      kategori: z.string().min(1).max(80),
      nama: z.string().min(1).max(500),
      satuan: z.string().max(80),
      harga: z
        .string()
        .regex(/^\d+$/)
        .refine((value) => {
          const harga = BigInt(value);
          return harga > 0n && harga <= BATAS_HARGA_RUPIAH;
        }, "Harga usulan harus antara Rp1 dan Rp1 triliun."),
    }),
  )
  .min(1)
  .max(25);

export async function terapkanUsulanHargaAiAction(args: {
  locationId: string;
  slug: string;
  usulan: { kategori: string; nama: string; satuan: string; harga: string }[];
}): Promise<
  | {
      ok: true;
      tersimpan: { kategori: string; nama: string; satuan: string; harga: string; biaya: string; sumber: string }[];
    }
  | { ok: false; error: string }
> {
  const parsed = usulanSchema.safeParse(args.usulan);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    const user = await requireCapability("finance.input");
    await requireLocationAccess(user, args.locationId);
    const { keadaanHarga } = await import("./hsd");
    const sebelum = await keadaanHarga(args.locationId);
    const belum = new Set(
      sebelum.baris
        .filter((b) => b.harga === null)
        .map((b) => kunciSumberDaya(b.kategori, b.nama, b.satuan)),
    );
    const diterima = Array.from(
      new Map(
        parsed.data
          .filter((u) => belum.has(kunciSumberDaya(u.kategori, u.nama, u.satuan)))
          .map((u) => [kunciSumberDaya(u.kategori, u.nama, u.satuan), u]),
      ).values(),
    );
    if (diterima.length === 0) {
      return { ok: false, error: "Usulan tidak diterapkan karena itemnya sudah berharga atau tidak lagi ada." };
    }
    const ip = await requestIp();
    await db.$transaction(async (tx) => {
      await tx.hargaSatuanDasar.createMany({
        data: diterima.map((u) => ({
          locationId: args.locationId,
          kategori: u.kategori,
          nama: u.nama,
          satuan: u.satuan,
          harga: BigInt(u.harga),
          sumber: "Usulan AI – disetujui pengguna",
          updatedById: user.id,
        })),
      });
      await auditIn(tx, user.id, "rapl.harga_ai.terapkan", "location", args.locationId, {
        jumlah: diterima.length,
        kunci: diterima.map((u) => kunciSumberDaya(u.kategori, u.nama, u.satuan)),
      }, ip);
    });
    revalidatePath(`/lokasi/${args.slug}/rapl`);

    const sesudah = await keadaanHarga(args.locationId);
    const diterimaSet = new Set(
      diterima.map((u) => kunciSumberDaya(u.kategori, u.nama, u.satuan)),
    );
    return {
      ok: true,
      tersimpan: sesudah.baris
        .filter((b) => diterimaSet.has(kunciSumberDaya(b.kategori, b.nama, b.satuan)))
        .flatMap((b) =>
          b.harga !== null && b.biaya !== null
            ? [{
                kategori: b.kategori,
                nama: b.nama,
                satuan: b.satuan,
                harga: b.harga.toString(),
                biaya: b.biaya.toString(),
                sumber: b.sumber ?? "Usulan AI – disetujui pengguna",
              }]
            : [],
        ),
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menerapkan usulan harga AI." };
  }
}
