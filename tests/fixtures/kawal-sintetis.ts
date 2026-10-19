/**
 * Baris Kawal SINTETIS (DECISIONS 690) – tipe tiap field meniru uji sambungan
 * ke Kawal sungguhan 2026-10-18, isinya karangan. Tidak ada nama orang, nomor
 * HP, atau nomor kontrak sungguhan.
 *
 * Field pribadi ikut dimasukkan dengan nilai penanda (`RAHASIA_*`) supaya uji
 * bisa membuktikan nilainya tidak pernah tersimpan.
 */

export const RAHASIA = {
  hp: "081299990001",
  nama: "Nama Personel Contoh",
  token: "token-rahasia-xyz",
  cctv: "rtsp://cctv.contoh/1",
} as const;

export type OpsiBaris = {
  id: number;
  nama?: string;
  desa?: string;
  kabupaten?: string;
  kontrak?: string;
  mulai?: string;
  actual?: number;
  pelaksana?: number;
  target?: number;
  lat?: string;
  lng?: string;
};

export function barisKawal(o: OpsiBaris): Record<string, unknown> {
  const actual = o.actual ?? 12.5;
  const target = o.target ?? 20;
  return {
    id: o.id,
    nama_knmp: o.nama ?? `KNMP Contoh ${o.id}`,
    desa_kelurahan: o.desa ?? `Contohsari ${o.id}`,
    kecamatan: "Kecamatan Contoh",
    nama_kabupaten: o.kabupaten ?? "Kabupaten Contoh",
    nama_provinsi: "Provinsi Contoh",
    tahap: 3,
    kategori_knmp: 1,
    penyedia: "PT Penyedia Contoh",
    no_kontrak_penyedia: o.kontrak ?? `KONTRAK/CONTOH/${o.id}`,
    tgl_kontrak_penyedia: "2026-07-20",
    no_spmk_penyedia: `SPMK/CONTOH/${o.id}`,
    start_date_penyedia: o.mulai ?? "2026-08-01",
    end_date_penyedia: "2026-12-20",
    adendum_date_penyedia: "2026-09-01",
    estimasi_pengerjaan: 150,
    nilai_kontrak_penyedia: 9_000_000_000,
    nilai_lokasi: 4_500_000_000,
    nilai_add1_kontrak_penyedia: "0",
    nilai_add2_kontrak_penyedia: "0",
    nilai_add3_kontrak_penyedia: "0",
    nilai_kontrak_pengawas: "250000000",
    status_kontrak: "",
    latitude: o.lat ?? "-6.9000000",
    longitude: o.lng ?? "110.4000000",
    progres_final: actual,
    progres_pelaksana: o.pelaksana ?? 14.1,
    target_fisik: target,
    deviasi: Number((actual - target).toFixed(3)),
    realisasi_pengawas: actual,
    realisasi_pelaksana: o.pelaksana ?? 14.1,
    current_week: 12,
    max_weeks: 21,
    last_realisasi_m: 11,
    last_pelaksana_m: 12,
    kurva_rencana_kumulatif: [0, 1.2, 3.4, 6.8],
    kurva_realisasi_kumulatif: [0, 1.0, 2.9, null],
    kurva_pelaksana_kumulatif: [0, 1.1, 3.0, null],
    kurva_rencana_mingguan: [1.2, 2.2, 3.4],
    kurva_realisasi_mingguan: [1.0, 1.9],
    kurva_pelaksana_mingguan: [1.1, 1.9],
    kurva_k_json: "[0,1.2,3.4,6.8]",
    kurva_r_json: "[0,1.0,2.9]",
    kurva_a1_json: "[]",
    kurva_a2_json: "[]",
    kurva_a3_json: "[]",
    kurva_pelaksana_json: "[0,1.1,3.0]",
    remark_kondisi_umum: "Pekerjaan pondasi berjalan",
    remark_hambatan: null,
    remark_saran_instruksi: "",
    remark_personil: "Tenaga cukup",
    sarpras: [
      {
        id: o.id * 100 + 1,
        sarpras_id: 1,
        nama_sarpras: "Dermaga",
        jenis_sarpras: "Utama",
        nilai: "1500000000",
        status: 1,
        bobot: 30.5,
        progres: 40,
        realisasi_kumulatif: 12.2,
        kategori: null,
        images_sarpras: "foto/rahasia.jpg",
      },
      {
        id: o.id * 100 + 2,
        sarpras_id: 2,
        nama_sarpras: "Gudang Beku",
        jenis_sarpras: "Pendukung",
        nilai: "800000000",
        status: 0,
        bobot: 12,
        progres: 0,
        realisasi_kumulatif: 0,
        kategori: null,
        images_sarpras: "",
      },
    ],
    // Field pribadi – TIDAK BOLEH tersimpan.
    no_hp_pengawas: RAHASIA.hp,
    no_hp_ppk: RAHASIA.hp,
    pelaksana_no_hp: RAHASIA.hp,
    nama_pengawas: RAHASIA.nama,
    ppk: RAHASIA.nama,
    wakil_sah: RAHASIA.nama,
    nama_penyuluh: RAHASIA.nama,
    direktur_nama: RAHASIA.nama,
    pengawas_user_id: 4242,
    token_id: RAHASIA.token,
    cctv_01: RAHASIA.cctv,
    banner: "banner/rahasia.png",
  };
}

export function responsKawal(baris: Record<string, unknown>[]): Record<string, unknown> {
  return { status: "success", count: baris.length, data: baris };
}
