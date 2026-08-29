/**
 * Menyiapkan berkas RAB seed dari SALINAN basis data lapangan.
 *
 * Kenapa ada: seed demo lama hanya punya 7 lokasi dengan paket maksimal DUA
 * lokasi, nilai kontrak seragam, dan tiga provinsi. Bentuk itu tidak pernah
 * menyentuh jalur yang paling mudah salah — alokasi proporsional "belum
 * tertagih" untuk kontrak multi-lokasi (`finance/calc.ts`), kartu portofolio
 * dengan rentang nilai lebar, dan RAB berlebar wajar. Data lapangan punya
 * semua bentuk itu; yang tidak boleh ikut adalah IDENTITASNYA.
 *
 * Maka pembagiannya tegas:
 *
 *   IKUT   — struktur RAB apa adanya: kategori, sub, grup, item, volume,
 *            satuan, harga satuan, nilai. Inilah yang tak mungkin dikarang
 *            meyakinkan, dan isinya memang item konstruksi baku.
 *   TIDAK  — nama paket, desa, kabupaten, vendor, nomor kontrak, tanggal,
 *            orang, foto, dokumen, pesan WhatsApp, jejak audit, sesi, dan
 *            SELURUH `app_settings` (di sana ada kunci API dalam bentuk
 *            telanjang — jangan pernah menyalinnya ke mana pun).
 *
 * Identitas pengganti ditulis LENGKAP di `PETA` di bawah supaya bisa diperiksa
 * mata: tidak ada satu pun nama yang diturunkan otomatis dari sumbernya.
 *
 * Pemakaian (butuh salinan lapangan yang sudah direstore ke Postgres lokal):
 *
 *   pnpm rab:siapkan "postgresql://user:pass@127.0.0.1:5432/salinan"
 *
 * Keluarannya `seed-data/<slug>.json`, bentuk sama persis dengan berkas seed
 * yang sudah ada (`ParsedRab` + `meta` + `total`), jadi `src/lib/seed/demo.ts`
 * membacanya tanpa perlu tahu dari mana asalnya.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import type { ParsedRab, ParsedRabCategory, ParsedRabItem, ParsedRabSubcategory } from "../src/lib/rab/parsed.ts";

type Peta = {
  /** Slug lokasi DI SALINAN LAPANGAN — hanya dipakai saat mengambil, tidak ditulis. */
  sumber: string;
  slug: string;
  village: string;
  regency: string;
  province: string;
  gps_lat: number;
  gps_lng: number;
  contractor: string;
  contract_number: string;
  start_date: string;
  end_date: string;
};

/*
 * Sembilan RAB, dipilih supaya seed punya bentuk yang selama ini tidak ada:
 * satu paket EMPAT lokasi, rentang nilai 1,2–5,9 miliar (sebelumnya nyaris
 * seragam), dan empat provinsi baru — Bali, NTB, Banten, DIY.
 *
 * Desa penggantinya nyata sebagai wilayah administratif tetapi BUKAN lokasi
 * KNMP; kabupaten sengaja tidak selalu sama dengan sumber RAB-nya, karena item
 * pekerjaannya memang baku dan tidak terikat tempat. Titik GPS-nya kira-kira
 * di pesisir kabupaten bersangkutan — cukup untuk peta demo, dan memang tidak
 * dipakai sebagai bukti apa pun.
 */
const PETA: Peta[] = [
  // Paket empat lokasi — Rembang.
  {
    sumber: "sugihwaras-sugihwaras",
    slug: "tasikharjo-rembang",
    village: "Tasikharjo",
    regency: "Rembang",
    province: "Jawa Tengah",
    gps_lat: -6.6889,
    gps_lng: 111.4392,
    contractor: "PT Samudra Karya Perkasa",
    contract_number: "SPK-KNMP-2026-RBG-011",
    start_date: "2026-04-06",
    end_date: "2026-09-28",
  },
  {
    sumber: "pasar-banggi-pasar-banggi",
    slug: "pandangan-kulon-rembang",
    village: "Pandangan Kulon",
    regency: "Rembang",
    province: "Jawa Tengah",
    gps_lat: -6.7024,
    gps_lng: 111.5471,
    contractor: "PT Samudra Karya Perkasa",
    contract_number: "SPK-KNMP-2026-RBG-011",
    start_date: "2026-04-06",
    end_date: "2026-09-28",
  },
  {
    sumber: "songbanyu-songbanyu",
    slug: "sendangmulyo-rembang",
    village: "Sendangmulyo",
    regency: "Rembang",
    province: "Jawa Tengah",
    gps_lat: -6.7311,
    gps_lng: 111.4885,
    contractor: "PT Samudra Karya Perkasa",
    contract_number: "SPK-KNMP-2026-RBG-011",
    start_date: "2026-04-06",
    end_date: "2026-09-28",
  },
  {
    sumber: "knmp-karangbolong-kebumen",
    slug: "karangturi-rembang",
    village: "Karangturi",
    regency: "Rembang",
    province: "Jawa Tengah",
    gps_lat: -6.6957,
    gps_lng: 111.3708,
    contractor: "PT Samudra Karya Perkasa",
    contract_number: "SPK-KNMP-2026-RBG-011",
    start_date: "2026-04-06",
    end_date: "2026-09-28",
  },

  // Paket dua lokasi — Nusa Tenggara Barat.
  {
    sumber: "knmp-kuta-lombok-tengah",
    slug: "gili-gede-lombok-barat",
    village: "Gili Gede Indah",
    regency: "Lombok Barat",
    province: "Nusa Tenggara Barat",
    gps_lat: -8.7583,
    gps_lng: 116.0361,
    contractor: "PT Rinjani Bahari Sejahtera",
    contract_number: "SPK-KNMP-2026-NTB-012",
    start_date: "2026-04-20",
    end_date: "2026-10-12",
  },
  {
    sumber: "knmp-buwun-mas-lombok-barat",
    slug: "labuhan-haji-lombok-timur",
    village: "Labuhan Haji",
    regency: "Lombok Timur",
    province: "Nusa Tenggara Barat",
    gps_lat: -8.6489,
    gps_lng: 116.5478,
    contractor: "PT Rinjani Bahari Sejahtera",
    contract_number: "SPK-KNMP-2026-NTB-012",
    start_date: "2026-04-20",
    end_date: "2026-10-12",
  },

  // Paket satu lokasi — Bali.
  {
    sumber: "antiga-kelod-karangasem",
    slug: "kusamba-klungkung",
    village: "Kusamba",
    regency: "Klungkung",
    province: "Bali",
    gps_lat: -8.5636,
    gps_lng: 115.4536,
    contractor: "CV Dewata Bangun Samudra",
    contract_number: "SPK-KNMP-2026-BLI-013",
    start_date: "2026-05-04",
    end_date: "2026-10-26",
  },

  // Paket dua lokasi — Banten.
  {
    sumber: "tanjung-anom-tangerang",
    slug: "kronjo-tangerang",
    village: "Kronjo",
    regency: "Tangerang",
    province: "Banten",
    gps_lat: -6.0453,
    gps_lng: 106.4269,
    contractor: "PT Cilegon Marine Konstruksi",
    contract_number: "SPK-KNMP-2026-BTN-014",
    start_date: "2026-05-18",
    end_date: "2026-11-09",
  },
  {
    sumber: "knmp-krakahan-brebes",
    slug: "lontar-tangerang",
    village: "Lontar",
    regency: "Tangerang",
    province: "Banten",
    gps_lat: -6.0292,
    gps_lng: 106.4711,
    contractor: "PT Cilegon Marine Konstruksi",
    contract_number: "SPK-KNMP-2026-BTN-014",
    start_date: "2026-05-18",
    end_date: "2026-11-09",
  },
];

type Baris = {
  id: string;
  parent_id: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  volume: string | null;
  unit: string | null;
  unit_price: string | null;
  amount: string;
  sort_order: number;
};

const angka = (v: string | null): number | null => (v == null ? null : Number(v));

/** Pohon `grup`/`item` — `grup` jadi item ber-anak, persis bentuk seed lama. */
function bangunItem(n: Baris, anakOf: Map<string | null, Baris[]>, indukCode: string | null): ParsedRabItem {
  const anak = (anakOf.get(n.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
  return {
    code: n.code,
    name: n.name,
    volume: angka(n.volume),
    unit: n.unit,
    unit_price: angka(n.unit_price),
    total_price: Number(n.amount),
    tkdn_ratio: null,
    parent_code: indukCode,
    children: anak.map((a) => bangunItem(a, anakOf, n.code)),
  };
}

async function ambil(client: Client, p: Peta): Promise<ParsedRab> {
  const { rows } = await client.query<Baris>(
    `select n.id, n.parent_id, n.kind, n.code, n.name, n.volume, n.unit, n.unit_price, n.amount, n.sort_order
       from rab_nodes n
       join rab_revisions r on r.id = n.revision_id
       join locations l on l.id = r.location_id
      where l.slug = $1 and r.status = 'aktif'
      order by n.sort_order`,
    [p.sumber],
  );
  if (rows.length === 0) throw new Error(`RAB aktif untuk "${p.sumber}" tidak ditemukan di salinan.`);

  const anakOf = new Map<string | null, Baris[]>();
  for (const r of rows) {
    const arr = anakOf.get(r.parent_id) ?? [];
    arr.push(r);
    anakOf.set(r.parent_id, arr);
  }

  const kategori = rows.filter((r) => r.kind === "kategori").sort((a, b) => a.sort_order - b.sort_order);
  const categories: ParsedRabCategory[] = kategori.map((k) => {
    const anak = (anakOf.get(k.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const subcategories: ParsedRabSubcategory[] = anak
      .filter((a) => a.kind === "sub")
      .map((s) => ({
        code: s.code,
        name: s.name,
        total_value: Number(s.amount),
        items: (anakOf.get(s.id) ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((it) => bangunItem(it, anakOf, null)),
      }));
    const direct_items = anak.filter((a) => a.kind !== "sub").map((it) => bangunItem(it, anakOf, null));
    return { roman: k.code, name: k.name, total_value: Number(k.amount), subcategories, direct_items };
  });

  const total = categories.reduce((s, c) => s + c.total_value, 0);
  return {
    meta: {
      slug: p.slug,
      village: p.village,
      regency: p.regency,
      province: p.province,
      gps_lat: p.gps_lat,
      gps_lng: p.gps_lng,
      contract_number: p.contract_number,
      contractor: p.contractor,
      start_date: p.start_date,
      end_date: p.end_date,
    },
    project: "KAMPUNG NELAYAN MERAH PUTIH",
    location_name_raw: `${p.village.toUpperCase()}, ${p.regency.toUpperCase()}`,
    province_raw: p.province.toUpperCase(),
    year: 2026,
    total,
    categories,
  };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Pakai: pnpm rab:siapkan <DATABASE_URL salinan lapangan>");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const out = join(process.cwd(), "seed-data");
  for (const p of PETA) {
    const parsed = await ambil(client, p);
    const berkas = join(out, `${p.slug}.json`);
    writeFileSync(berkas, `${JSON.stringify(parsed, null, 2)}\n`);
    const miliar = (parsed.total / 1e9).toFixed(2);
    console.log(`  ${p.slug}: ${parsed.categories.length} kategori · Rp ${miliar} M`);
  }
  await client.end();
  console.log(`Selesai — ${PETA.length} berkas ditulis ke seed-data/.`);
}

await main();
