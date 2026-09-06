"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * PETA SATU TITIK — perkiraan letak lokasi katalog, sekaligus alat menaruhnya.
 *
 * Permintaan user 2026-09-06: *"saat katalog lokasi, lokasinya diklik muncul
 * edit itu sekalian perkiraan lokasi mapnya."*
 *
 * Dibuat dua arah, bukan sekadar gambar: mengetik enam desimal dari ingatan
 * adalah cara termudah menaruh kampung nelayan di tengah sawah, sementara
 * menggeser penanda di peta memperlihatkan salahnya seketika. Klik peta atau
 * seret penandanya → kotak lintang/bujur ikut terisi.
 *
 * Tanpa react-leaflet (lisensinya di luar kebijakan repo — lihat `peta-map`);
 * Leaflet sendiri BSD-2-Clause.
 */

/** Pusat awal saat lokasi belum berkoordinat: kira-kira tengah Indonesia. */
const PUSAT_KOSONG: [number, number] = [-2.5, 118];

export function PetaTitik({
  lat,
  lng,
  onPindah,
  tinggi = 220,
}: {
  lat: number | null;
  lng: number | null;
  /** Dipanggil saat peta diklik atau penanda diseret. */
  onPindah?: (lat: number, lng: number) => void;
  tinggi?: number;
}) {
  const wadah = useRef<HTMLDivElement>(null);
  const peta = useRef<L.Map | null>(null);
  const penanda = useRef<L.Marker | null>(null);
  // Callback disimpan di ref: peta dipasang SEKALI, dan menaruh `onPindah` di
  // deps akan membongkar-pasang peta tiap ketikan di kotak koordinat.
  const pindah = useRef(onPindah);
  useEffect(() => {
    pindah.current = onPindah;
  }, [onPindah]);

  useEffect(() => {
    if (!wadah.current || peta.current) return;
    const ada = lat != null && lng != null;
    const m = L.map(wadah.current, { attributionControl: true, scrollWheelZoom: false }).setView(
      ada ? [lat, lng] : PUSAT_KOSONG,
      ada ? 13 : 4,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      pindah.current?.(Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7)));
    });
    peta.current = m;
    return () => {
      m.remove();
      peta.current = null;
      penanda.current = null;
    };
    // Sengaja sekali jalan: pemutakhiran titik ditangani efek di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = peta.current;
    if (!m) return;
    if (lat == null || lng == null) {
      penanda.current?.remove();
      penanda.current = null;
      return;
    }
    if (!penanda.current) {
      penanda.current = L.marker([lat, lng], { draggable: Boolean(onPindah) }).addTo(m);
      penanda.current.on("dragend", () => {
        const p = penanda.current?.getLatLng();
        if (p) pindah.current?.(Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)));
      });
    } else {
      penanda.current.setLatLng([lat, lng]);
    }
    if (m.getZoom() < 10) m.setView([lat, lng], 13);
    else m.panTo([lat, lng]);
  }, [lat, lng, onPindah]);

  return (
    <div
      ref={wadah}
      style={{ height: tinggi }}
      className="w-full overflow-hidden rounded-md border border-border"
      // Peta bukan kendali utama formulir; pembaca layar diberi ringkasannya
      // lewat teks di sebelahnya, bukan lewat kanvas ubin.
      aria-hidden
    />
  );
}
