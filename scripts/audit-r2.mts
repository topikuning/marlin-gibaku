/**
 * AUDIT R2: mana yang berkas hidup, mana yang sampah.
 *
 * Pertanyaan user 2026-09-09: *"saat ini di cloudflare sudah mencapai 10GB,
 * bagaimana mengecek itu memang file-file efektif, atau ada beberapa sampah?"*
 *
 * Sampah di object storage tidak pernah mengumumkan diri. Ia lahir dari
 * hal-hal yang justru dirancang supaya tidak berisik: `r2Delete(...)` yang
 * ditulis `.catch(() => {})` supaya penghapusan gagal tidak menggagalkan
 * pekerjaan orang, unggahan yang berhasil lalu transaksinya batal, kunci ber-
 * `Date.now()` yang tidak pernah menimpa pendahulunya, dan sisa `healthcheck/`
 * dari diagnostik R2. Semuanya benar sebagai keputusan; semuanya menumpuk.
 *
 * ### Aturannya: obyek YATIM = tidak dirujuk satu kolom pun di DB
 *
 * Daftar kolom TIDAK ditulis tangan di sini. Kalau ditulis tangan, satu kolom
 * baru yang lupa didaftarkan langsung membuat ribuan berkas HIDUP terbaca
 * "sampah" — dan itu kesalahan yang paling mahal di alat semacam ini. Jadi
 * himpunan rujukan dipungut dari `information_schema`: SETIAP kolom teks yang
 * namanya mengandung "key", di setiap tabel, plus nilai `app_settings` (logo
 * pemilik disimpan sebagai setelan, bukan kolom). Jaringnya sengaja lebar —
 * salah baca "masih dipakai" cuma menyisakan sampah, salah baca "yatim" bisa
 * membuat orang menghapus bukti lapangan.
 *
 * ### Yang TIDAK dilakukan skrip ini
 *
 * Menghapus. Sama sekali. Keluarannya daftar untuk diperiksa manusia, sama
 * seperti `audit:ahsp`. Penghapusan obyek storage tidak bisa dibatalkan, dan
 * satu-satunya salinan foto lapangan ber-GPS ada di sana.
 *
 * Pakai:
 *   pnpm audit:r2                 # ringkasan + daftar sampah → AUDIT_R2.csv
 *   pnpm audit:r2 --prefix photos/   # batasi satu prefix
 *   pnpm audit:r2 --tanpa-csv     # ringkasan saja
 *
 * Butuh env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * DATABASE_URL. Di Railway: `railway run pnpm audit:r2`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";

type Obyek = { key: string; bytes: number; diubah: Date | null };

const argv = process.argv.slice(2);
const ambilArg = (nama: string): string | null => {
  const i = argv.indexOf(nama);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const PREFIX = ambilArg("--prefix");
const TULIS_CSV = !argv.includes("--tanpa-csv");
const KELUARAN = join(process.cwd(), "AUDIT_R2.csv");

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const mb = (b: number) => `${(b / 1024 ** 2).toFixed(1)} MB`;
const ukuran = (b: number) => (b >= 1024 ** 3 ? gb(b) : mb(b));
const umurHari = (d: Date | null) =>
  d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null;

/** Prefix = segmen pertama kunci; itulah satuan yang bisa dinalar orang. */
const prefixDari = (key: string) => key.split("/")[0] || "(akar)";

function wajibEnv(nama: string): string {
  const v = process.env[nama];
  if (!v) {
    console.error(`✗ ${nama} belum diisi. Jalankan lewat 'railway run' atau isi .env.`);
    process.exit(1);
  }
  return v;
}

/** Seluruh isi bucket, dihalaman 1000-an (ListObjectsV2 tidak punya "semua"). */
async function daftarObyek(s3: S3Client, bucket: string): Promise<Obyek[]> {
  const out: Obyek[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
        Prefix: PREFIX ?? undefined,
      }),
    );
    for (const o of res.Contents ?? [])
      if (o.Key) out.push({ key: o.Key, bytes: o.Size ?? 0, diubah: o.LastModified ?? null });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    process.stdout.write(`\r  … ${out.length} obyek terbaca`);
  } while (token);
  process.stdout.write("\n");
  return out;
}

/**
 * Himpunan kunci yang MASIH DIRUJUK, dipungut dari skema — bukan dari daftar
 * yang ditulis tangan. Lihat catatan di kepala berkas: jaring lebar disengaja.
 */
async function kunciDirujuk(): Promise<Set<string>> {
  const kolom = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying')
      AND column_name ILIKE '%key%'
    ORDER BY table_name, column_name
  `;
  const set = new Set<string>();
  for (const k of kolom) {
    const rows = await db.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT DISTINCT "${k.column_name}" AS v FROM "${k.table_name}" WHERE "${k.column_name}" IS NOT NULL`,
    );
    for (const r of rows) if (r.v) set.add(r.v);
  }
  // Logo pemilik & kawan-kawan disimpan sebagai SETELAN, bukan kolom.
  const setelan = await db.$queryRaw<{ value: string }[]>`SELECT DISTINCT value FROM app_settings`;
  for (const s of setelan) if (s.value) set.add(s.value);
  console.log(`  ${kolom.length} kolom ber-"key" dipindai → ${set.size} kunci dirujuk\n`);
  return set;
}

/** Berkas yang DIRUJUK DB tapi tidak ada di R2 — bahaya yang berlawanan. */
async function rujukanMenggantung(ada: Set<string>) {
  const cek = [
    { tabel: "photos", kolom: "r2_key", label: "Foto" },
    { tabel: "photos", kolom: "original_key", label: "Foto (asli)" },
    { tabel: "photos", kolom: "thumbnail_key", label: "Foto (thumb)" },
    { tabel: "documents", kolom: "r2_key", label: "Dokumen" },
    { tabel: "field_activity_attachments", kolom: "r2_key", label: "Lampiran aktivitas" },
  ];
  const hasil: { label: string; hilang: number; contoh: string[] }[] = [];
  for (const c of cek) {
    const rows = await db
      .$queryRawUnsafe<{ v: string }[]>(
        `SELECT "${c.kolom}" AS v FROM "${c.tabel}" WHERE "${c.kolom}" IS NOT NULL`,
      )
      .catch(() => [] as { v: string }[]);
    const hilang = rows.filter((r) => !ada.has(r.v));
    if (hilang.length > 0)
      hasil.push({ label: c.label, hilang: hilang.length, contoh: hilang.slice(0, 5).map((h) => h.v) });
  }
  return hasil;
}

async function main() {
  const endpoint = wajibEnv("R2_ENDPOINT");
  const bucket = wajibEnv("R2_BUCKET");
  wajibEnv("DATABASE_URL");
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: wajibEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: wajibEnv("R2_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });

  console.log(`\nAUDIT R2 · bucket "${bucket}"${PREFIX ? ` · prefix "${PREFIX}"` : ""}\n`);
  const obyek = await daftarObyek(s3, bucket);
  const dirujuk = await kunciDirujuk();

  const totalBytes = obyek.reduce((t, o) => t + o.bytes, 0);
  const yatim = obyek.filter((o) => !dirujuk.has(o.key));
  const yatimBytes = yatim.reduce((t, o) => t + o.bytes, 0);

  // ── Ringkasan per prefix ────────────────────────────────────────────────
  type Baris = { obyek: number; bytes: number; yatim: number; yatimBytes: number };
  const perPrefix = new Map<string, Baris>();
  for (const o of obyek) {
    const p = prefixDari(o.key);
    const b = perPrefix.get(p) ?? { obyek: 0, bytes: 0, yatim: 0, yatimBytes: 0 };
    b.obyek++;
    b.bytes += o.bytes;
    if (!dirujuk.has(o.key)) {
      b.yatim++;
      b.yatimBytes += o.bytes;
    }
    perPrefix.set(p, b);
  }
  console.log("PREFIX                        OBYEK        UKURAN     YATIM   UKURAN YATIM");
  for (const [p, b] of [...perPrefix].sort((a, c) => c[1].bytes - a[1].bytes))
    console.log(
      `${p.padEnd(28)} ${String(b.obyek).padStart(7)} ${ukuran(b.bytes).padStart(11)} ` +
        `${String(b.yatim).padStart(9)} ${(b.yatimBytes ? ukuran(b.yatimBytes) : "–").padStart(14)}`,
    );
  console.log(
    `${"TOTAL".padEnd(28)} ${String(obyek.length).padStart(7)} ${ukuran(totalBytes).padStart(11)} ` +
      `${String(yatim.length).padStart(9)} ${(yatimBytes ? ukuran(yatimBytes) : "–").padStart(14)}`,
  );
  const persen = totalBytes > 0 ? ((yatimBytes / totalBytes) * 100).toFixed(1) : "0.0";
  console.log(`\n→ ${persen}% dari isi bucket tidak dirujuk satu baris pun di DB.\n`);

  // ── Sisa healthcheck: selalu sampah, tanpa perlu ditimbang ──────────────
  const hc = obyek.filter((o) => o.key.startsWith("healthcheck/"));
  if (hc.length > 0)
    console.log(
      `⚠ ${hc.length} sisa "healthcheck/" (${ukuran(hc.reduce((t, o) => t + o.bytes, 0))}) – ` +
        `diagnostik R2 yang gagal membersihkan dirinya. Aman dihapus.\n`,
    );

  // ── Yatim TERBESAR: yang sepadan diperiksa lebih dulu ───────────────────
  if (yatim.length > 0) {
    console.log("YATIM TERBESAR (20 teratas):");
    for (const o of [...yatim].sort((a, b) => b.bytes - a.bytes).slice(0, 20)) {
      const u = umurHari(o.diubah);
      console.log(`  ${ukuran(o.bytes).padStart(10)}  ${u == null ? "?" : `${u}h`.padStart(5)}  ${o.key}`);
    }
    console.log();
  }

  // ── Rujukan menggantung: berkas HILANG, bukan sampah ────────────────────
  const ada = new Set(obyek.map((o) => o.key));
  const gantung = PREFIX ? [] : await rujukanMenggantung(ada);
  if (gantung.length > 0) {
    console.log("⚠ RUJUKAN MENGGANTUNG – baris DB menunjuk berkas yang TIDAK ADA di R2:");
    for (const g of gantung) console.log(`  ${g.label}: ${g.hilang} – contoh: ${g.contoh.join(", ")}`);
    console.log(
      "  Ini bukan sampah, ini kehilangan: layar akan menampilkan foto/dokumen yang gagal dimuat.\n",
    );
  } else if (!PREFIX) {
    console.log("✓ Tidak ada rujukan menggantung – setiap baris DB menunjuk berkas yang benar ada.\n");
  }

  if (TULIS_CSV && yatim.length > 0) {
    const baris = ["key,bytes,umur_hari,prefix"];
    for (const o of [...yatim].sort((a, b) => b.bytes - a.bytes))
      baris.push(`"${o.key}",${o.bytes},${umurHari(o.diubah) ?? ""},${prefixDari(o.key)}`);
    writeFileSync(KELUARAN, baris.join("\n"), "utf8");
    console.log(`Daftar lengkap ${yatim.length} obyek yatim → ${KELUARAN}`);
  }
  console.log(
    "\nSkrip ini TIDAK menghapus apa pun. Periksa daftarnya dulu – penghapusan obyek\n" +
      "storage tidak bisa dibatalkan, dan satu-satunya salinan foto lapangan ada di sana.\n",
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
