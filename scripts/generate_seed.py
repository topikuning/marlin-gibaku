"""
Generate seed JSON for all 7 HPS locations.
Reads /mnt/project/*.xlsx → outputs seed-data/*.json
"""
import json
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from parse_hps import parse_hps

SEED_DIR = os.path.join(os.path.dirname(__file__), '..', 'seed-data')
os.makedirs(SEED_DIR, exist_ok=True)

# Location metadata (name → slug + regency + province + contract details)
# Extracted from HPS files
LOCATIONS_META = {
    'HPS_Kedungmutih': {
        'slug': 'kedungmutih',
        'village': 'Kedung Mutih',
        'regency': 'Demak',
        'province': 'Jawa Tengah',
        'gps_lat': -6.7423,  # approx
        'gps_lng': 110.6591,
        'contract_number': 'SPK-KNMP-2026-KDM-001',
        'contractor': 'PT Contoh Konstruksi Nusantara',
        'start_date': '2026-03-01',
        'end_date': '2026-07-28',  # 150 days
    },
    'HPS_Purworejo': {
        'slug': 'purworejo',
        'village': 'Purworejo',
        'regency': 'Demak',
        'province': 'Jawa Tengah',
        'gps_lat': -6.7856,
        'gps_lng': 110.6123,
        'contract_number': 'SPK-KNMP-2026-PWJ-002',
        'contractor': 'PT Contoh Konstruksi Nusantara',
        'start_date': '2026-03-15',
        'end_date': '2026-08-12',
    },
    '07_HPS_UjungwatuJeparaJawa_Tengah_PenyanggaR1': {
        'slug': 'ujungwatu',
        'village': 'Ujungwatu',
        'regency': 'Jepara',
        'province': 'Jawa Tengah',
        'gps_lat': -6.4523,
        'gps_lng': 110.7891,
        'contract_number': 'SPK-KNMP-2026-JPR-003',
        'contractor': 'PT Bahari Jaya Mandiri',
        'start_date': '2026-04-01',
        'end_date': '2026-08-29',
    },
    '07_HPS_KaranggondangJeparaJawa_Tengah_Penyangga': {
        'slug': 'karanggondang',
        'village': 'Karanggondang',
        'regency': 'Jepara',
        'province': 'Jawa Tengah',
        'gps_lat': -6.5234,
        'gps_lng': 110.7412,
        'contract_number': 'SPK-KNMP-2026-JPR-004',
        'contractor': 'PT Bahari Jaya Mandiri',
        'start_date': '2026-04-01',
        'end_date': '2026-08-29',
    },
    '07_HPS_Batah_TimurBangkalanJawa_Timur_Penyangga': {
        'slug': 'batah-timur',
        'village': 'Batah Timur',
        'regency': 'Bangkalan',
        'province': 'Jawa Timur',
        'gps_lat': -7.0342,
        'gps_lng': 112.7845,
        'contract_number': 'SPK-KNMP-2026-BGK-005',
        'contractor': 'PT Nusantara Bahari Utama',
        'start_date': '2026-04-15',
        'end_date': '2026-09-12',
    },
    '07_HPS_TengketBangkalanJawa_Timur_HUB': {
        'slug': 'tengket',
        'village': 'Tengket',
        'regency': 'Bangkalan',
        'province': 'Jawa Timur',
        'gps_lat': -7.0512,
        'gps_lng': 112.8123,
        'contract_number': 'SPK-KNMP-2026-BGK-006',
        'contractor': 'PT Nusantara Bahari Utama',
        'start_date': '2026-04-15',
        'end_date': '2026-09-12',
    },
    '07_HPS_KemantrenLamonganJawa_Timur_HUBR1': {
        'slug': 'kemantren',
        'village': 'Kemantren',
        'regency': 'Lamongan',
        'province': 'Jawa Timur',
        'gps_lat': -6.8934,
        'gps_lng': 112.4523,
        'contract_number': 'SPK-KNMP-2026-LMG-007',
        'contractor': 'PT Nusantara Bahari Utama',
        'start_date': '2026-05-01',
        'end_date': '2026-09-28',
    },
}


def main():
    project_dir = '/mnt/project'
    if not os.path.exists(project_dir):
        print(f"❌ Project dir tidak ada: {project_dir}")
        print("   Jalankan ini di container yang punya /mnt/project/")
        return

    files = sorted([f for f in os.listdir(project_dir) if f.endswith('.xlsx')])
    print(f"Ditemukan {len(files)} file HPS:")
    for f in files:
        print(f"  · {f}")
    print()

    generated = []
    for f in files:
        stem = f.replace('.xlsx', '')
        meta_key = stem
        # Some files have long names — match by keyword
        meta = None
        for key, m in LOCATIONS_META.items():
            if key in stem or stem in key:
                meta = m
                break

        if not meta:
            print(f"⚠  Skipping {f} — no metadata mapping")
            continue

        print(f"Parsing {f}...")
        try:
            rab = parse_hps(os.path.join(project_dir, f))
            payload = {
                'meta': meta,
                'project': rab.project,
                'location_name_raw': rab.location,
                'province_raw': rab.province,
                'year': rab.year,
                'total': rab.total,
                'categories': rab.to_dict()['categories'],
            }
            out_path = os.path.join(SEED_DIR, f"{meta['slug']}.json")
            with open(out_path, 'w') as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
            print(f"  → {out_path} (Rp {rab.total:,.0f})")
            generated.append(meta['slug'])
        except Exception as e:
            print(f"  ❌ Error: {e}")

    # Manifest
    manifest = {
        'generated_at': '2026-07-10',
        'total_locations': len(generated),
        'slugs': generated,
        'summary': {
            'PT Contoh Konstruksi Nusantara': ['kedungmutih', 'purworejo'],
            'PT Bahari Jaya Mandiri': ['ujungwatu', 'karanggondang'],
            'PT Nusantara Bahari Utama': ['batah-timur', 'tengket', 'kemantren'],
        }
    }
    with open(os.path.join(SEED_DIR, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print(f"\n✓ Generated {len(generated)} seed files + manifest.json")


if __name__ == "__main__":
    main()
