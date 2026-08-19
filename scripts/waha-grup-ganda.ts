/**
 * DIAGNOSA grup WhatsApp yang tertaut ke lebih dari satu paket (DECISIONS 370).
 *
 *   pnpm waha:grup-ganda
 *
 * Dipakai saat migration `20260819120000_wa_group_unik` MENOLAK berjalan. Ia
 * menolak dengan sengaja — memilih diam-diam salah satu paket berarti
 * menyembunyikan cacat isolasi data, bukan memperbaikinya. Tapi menolak saja
 * tidak cukup: yang memutuskan paket mana yang berhak adalah manusia, dan untuk
 * memutuskan ia butuh melihat isinya.
 *
 * Skrip ini TIDAK mengubah apa pun. Ia hanya menampilkan, untuk tiap grup yang
 * bentrok, bukti yang benar-benar menentukan:
 *
 *  - berapa lokasi aktif tiap paket, dan siapa saja;
 *  - tahap paketnya (paket batal hampir pasti bukan pemilik yang benar);
 *  - berapa pesan WhatsApp yang sudah terarsip ke tiap paket dari grup itu, dan
 *    kapan terakhir — INI penunjuk terkuat: grup itu memang dipakai siapa.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL belum diisi.\n");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** Cerminan SQL migrasi — bukan `kanonikGrupId`, supaya yang diperiksa adalah
 *  bentuk yang benar-benar akan dihasilkan migrasi itu. */
function kanonikSepertiMigrasi(raw: string): string {
  const t = raw.trim();
  const at = t.indexOf("@");
  if (at === -1) return `${t.replace(/[:_].*$/, "")}@g.us`;
  const lokal = t.slice(0, at).replace(/[:_].*$/, "");
  const domain = t.slice(at + 1).toLowerCase();
  return `${lokal}@${domain === "s.whatsapp.net" ? "c.us" : domain}`;
}

async function main() {
  const paket = await db.package.findMany({
    where: { waGroupId: { not: null } },
    select: {
      id: true,
      name: true,
      stage: true,
      waGroupId: true,
      createdAt: true,
      organization: { select: { name: true } },
      locations: { where: { isActive: true }, select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const perGrup = new Map<string, typeof paket>();
  for (const p of paket) {
    const k = kanonikSepertiMigrasi(p.waGroupId!);
    perGrup.set(k, [...(perGrup.get(k) ?? []), p]);
  }

  const bentrok = [...perGrup.entries()].filter(([, ps]) => ps.length > 1);
  if (bentrok.length === 0) {
    process.stdout.write("Tidak ada grup yang tertaut ke lebih dari satu paket.\n");
    return;
  }

  process.stdout.write(`${bentrok.length} grup tertaut ke lebih dari satu paket.\n`);
  for (const [grup, ps] of bentrok) {
    process.stdout.write(`\n${"─".repeat(70)}\n${grup}\n${"─".repeat(70)}\n`);
    for (const p of ps) {
      const [jumlahPesan, terakhir] = await Promise.all([
        db.waMessage.count({ where: { packageId: p.id } }),
        db.waMessage.findFirst({
          where: { packageId: p.id },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true },
        }),
      ]);
      process.stdout.write(
        [
          `\n  ${p.name}`,
          `    id           : ${p.id}`,
          `    organisasi   : ${p.organization.name}`,
          `    tahap        : ${p.stage}`,
          `    tersimpan    : ${p.waGroupId}`,
          `    lokasi aktif : ${p.locations.length}${p.locations.length ? ` — ${p.locations.map((l) => l.name).join(", ")}` : ""}`,
          `    pesan WA     : ${jumlahPesan}${terakhir ? ` (terakhir ${terakhir.timestamp.toISOString().slice(0, 16).replace("T", " ")})` : ""}`,
          "",
        ].join("\n"),
      );
    }
    process.stdout.write(
      "\n  → Pertahankan SATU paket. Lepaskan grup dari yang lain lewat\n" +
        "    Paket → buka paketnya → Grup WhatsApp → kosongkan → Simpan.\n" +
        "    Penunjuk terkuat: paket yang benar-benar punya arsip pesan dari grup ini.\n",
    );
  }
  process.stdout.write(
    `\n${"═".repeat(70)}\nSesudah dibereskan, tandai migrasi yang gagal sebagai rolled-back lalu deploy lagi:\n` +
      `  pnpm prisma migrate resolve --rolled-back 20260819120000_wa_group_unik\n`,
  );
}

main()
  .catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
