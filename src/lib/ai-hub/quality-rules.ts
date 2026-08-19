import type { LocationFacts, QualityFinding, QualityStatus } from "./types";

/**
 * Audit Kualitas Data — rule engine MURNI. Status (lulus/periksa/gagal/info)
 * ditentukan RULE, tidak pernah oleh AI. Input = fakta detail per lokasi yang
 * dikumpulkan source builder (bounded ke scope run). DECISIONS 133.
 */

export type QualityDetailFacts = {
  locationId: string;
  locationName: string;
  /** Realisasi kumulatif > volume RAB per item (harusnya dicegah guard input). */
  volumeOverruns: { itemName: string; rabVolume: number; cumVolume: number }[];
  /** Foto laporan yang tanggal EXIF-nya ≠ tanggal laporan. */
  exifDateMismatch: number;
  /** Foto ber-GPS di luar radius wajar dari titik lokasi (m). */
  gpsOutsideRadius: number;
  gpsRadiusM: number;
  /** Laporan FINAL dalam periode tanpa satu pun foto. */
  finalReportsNoPhoto: number;
  /** Invoice yang nilainya melebihi commitment induknya. */
  invoiceOverCommitment: { invoiceNumber: string; invoiceAmount: string; commitmentAmount: string }[];
};

function finding(
  key: string,
  label: string,
  status: QualityStatus,
  detail: string,
  f: { locationId: string; locationName: string },
  count: number,
): QualityFinding {
  return { key, label, status, detail, locationId: f.locationId, locationName: f.locationName, count };
}

/** Jalankan seluruh rule kualitas utk satu lokasi (fakta ringkas + detail). */
export function runQualityRules(facts: LocationFacts, d: QualityDetailFacts): QualityFinding[] {
  const out: QualityFinding[] = [];

  // 1. Volume kumulatif vs RAB.
  out.push(
    d.volumeOverruns.length > 0
      ? finding(
          "volume_overrun",
          "Volume kumulatif melebihi volume RAB",
          "gagal",
          d.volumeOverruns
            .slice(0, 5)
            .map((v) => `${v.itemName}: ${v.cumVolume} > ${v.rabVolume}`)
            .join("; "),
          d,
          d.volumeOverruns.length,
        )
      : finding("volume_overrun", "Volume kumulatif ≤ volume RAB", "lulus", "Tidak ada item melebihi RAB", d, 0),
  );

  // 2. Duplikasi laporan per tanggal — dicegah constraint unik DB (by design).
  out.push(
    finding(
      "laporan_duplikat",
      "Duplikasi laporan per tanggal",
      "info",
      "Dicegah oleh constraint unik (lokasi, tanggal) di database",
      d,
      0,
    ),
  );

  // 3. Duplikasi foto byte-identik — dicegah dedup sha256 saat unggah (by design).
  out.push(
    finding("foto_duplikat", "Duplikasi foto byte-identik", "info", "Dicegah dedup SHA-256 saat unggah", d, 0),
  );

  // 4. EXIF tanggal vs tanggal laporan.
  out.push(
    d.exifDateMismatch > 0
      ? finding(
          "exif_mismatch",
          "Tanggal EXIF foto ≠ tanggal laporan",
          "periksa",
          `${d.exifDateMismatch} foto berbeda tanggal – pastikan foto diambil pada hari kerja tsb`,
          d,
          d.exifDateMismatch,
        )
      : finding("exif_mismatch", "Tanggal EXIF foto selaras", "lulus", "Semua foto ber-EXIF cocok tanggal", d, 0),
  );

  // 5. GPS di luar radius titik lokasi.
  out.push(
    d.gpsOutsideRadius > 0
      ? finding(
          "gps_radius",
          `GPS foto di luar radius ${d.gpsRadiusM} m`,
          "periksa",
          `${d.gpsOutsideRadius} foto ber-GPS jauh dari titik lokasi proyek`,
          d,
          d.gpsOutsideRadius,
        )
      : finding("gps_radius", "GPS foto dalam radius lokasi", "lulus", "Tidak ada anomali koordinat", d, 0),
  );

  // 6. Foto tanpa GPS asli / waktu server (dari fakta ringkas).
  out.push(
    facts.photoCount > 0 && facts.photosNoGps / facts.photoCount > 0.5
      ? finding(
          "foto_tanpa_gps",
          "Mayoritas foto tanpa GPS asli",
          "periksa",
          `${facts.photosNoGps}/${facts.photoCount} foto tanpa koordinat EXIF/perangkat`,
          d,
          facts.photosNoGps,
        )
      : finding("foto_tanpa_gps", "Cakupan GPS foto memadai", "lulus", `${facts.photoCount} foto dalam periode`, d, 0),
  );

  // 7. Laporan final tanpa bukti foto.
  out.push(
    d.finalReportsNoPhoto > 0
      ? finding(
          "final_tanpa_foto",
          "Laporan final tanpa foto",
          "periksa",
          `${d.finalReportsNoPhoto} laporan final dalam periode tidak melampirkan foto`,
          d,
          d.finalReportsNoPhoto,
        )
      : finding("final_tanpa_foto", "Laporan final berfoto", "lulus", "Semua laporan final punya bukti", d, 0),
  );

  // 8. Realisasi 0% dengan bukti aktivitas besar.
  const zeroWithEvidence =
    facts.actualPct <= 0 && facts.startDateKey != null && (facts.photoCount >= 5 || facts.activityCount >= 2);
  out.push(
    zeroWithEvidence
      ? finding(
          "nol_dengan_bukti",
          "Realisasi 0% padahal bukti lapangan ada",
          "gagal",
          `${facts.photoCount} foto & ${facts.activityCount} kegiatan tercatat – laporan harian belum masuk/final`,
          d,
          1,
        )
      : finding("nol_dengan_bukti", "Realisasi selaras bukti lapangan", "lulus", "Tidak ada indikasi under-reporting", d, 0),
  );

  // 9. Invoice melebihi commitment.
  out.push(
    d.invoiceOverCommitment.length > 0
      ? finding(
          "invoice_over",
          "Invoice melebihi nilai commitment",
          "gagal",
          d.invoiceOverCommitment
            .slice(0, 3)
            .map((v) => `${v.invoiceNumber}: ${v.invoiceAmount} > ${v.commitmentAmount}`)
            .join("; "),
          d,
          d.invoiceOverCommitment.length,
        )
      : finding("invoice_over", "Invoice ≤ commitment", "lulus", "Tidak ada invoice melebihi komitmen", d, 0),
  );

  return out;
}

/** Jarak haversine (meter) — utk rule radius GPS. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
