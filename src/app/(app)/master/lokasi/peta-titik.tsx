"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  LAPIS_SATELIT,
  adaSumber,
  dukungWebGL,
  gayaPeta,
  modeTersedia,
  type ModePeta,
  type SumberPeta,
} from "@/lib/peta/gaya";

/**
 * PETA SATU TITIK — perkiraan letak lokasi katalog, sekaligus alat menaruhnya.
 *
 * Permintaan user 2026-09-06: *"saat katalog lokasi, lokasinya diklik muncul
 * edit itu sekalian perkiraan lokasi mapnya"*, lalu: *"aku sangat tidak puas
 * dengan leaflet. apa tidak ada yang lebih baik? misal MapLibre GL JS"*.
 *
 * Sekarang MapLibre GL JS (BSD-3): peta vektor, jadi labelnya tetap tajam pada
 * perbesaran berapa pun — bukan gambar yang dibesarkan sampai buram.
 *
 * Dua arah, dan itu intinya: mengetik tujuh desimal dari ingatan adalah cara
 * termudah menaruh kampung nelayan di tengah sawah, sementara menggeser penanda
 * di atas CITRA SATELIT memperlihatkan salahnya seketika. Karena itu tombol
 * ganti lapisan ada di sini, bukan disembunyikan di pengaturan: verifikasi
 * koordinat adalah pekerjaan yang sedang dilakukan orang di layar ini.
 */

/** Pusat awal saat lokasi belum berkoordinat: kira-kira tengah Indonesia. */
const PUSAT_KOSONG: [number, number] = [118, -2.5];

/** Protokol pmtiles didaftarkan SEKALI per halaman, bukan per peta. */
let protokolTerpasang = false;
function pasangProtokol() {
  if (protokolTerpasang) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protokolTerpasang = true;
}

export function PetaTitik({
  lat,
  lng,
  sumber,
  onPindah,
  tinggi = 220,
}: {
  lat: number | null;
  lng: number | null;
  sumber: SumberPeta;
  /** Dipanggil saat peta diklik atau penanda diseret. */
  onPindah?: (lat: number, lng: number) => void;
  tinggi?: number;
}) {
  const wadah = useRef<HTMLDivElement>(null);
  const peta = useRef<maplibregl.Map | null>(null);
  const penanda = useRef<maplibregl.Marker | null>(null);
  // Callback disimpan di ref: peta dipasang SEKALI, dan menaruh `onPindah` di
  // deps akan membongkar-pasang peta tiap ketikan di kotak koordinat.
  const pindah = useRef(onPindah);
  useEffect(() => {
    pindah.current = onPindah;
  }, [onPindah]);

  const pilihan = modeTersedia(sumber);
  const [mode, setMode] = useState<ModePeta>(pilihan.includes("peta") ? "peta" : "satelit");
  // Dukungan WebGL diperiksa SEBELUM render, bukan lewat setState di dalam
  // efek: kegagalan peta harus jadi keadaan awal komponen, bukan kedipan.
  const [webgl] = useState(dukungWebGL);

  useEffect(() => {
    if (!wadah.current || peta.current || !adaSumber(sumber) || !webgl) return;
    pasangProtokol();
    const m = new maplibregl.Map({
      container: wadah.current,
      style: gayaPeta(sumber, mode),
      center: lat != null && lng != null ? [lng, lat] : PUSAT_KOSONG,
      zoom: lat != null && lng != null ? 15 : 4,
      attributionControl: { compact: true },
      // Gulir halaman tidak boleh tersandera peta yang kebetulan dilewati
      // kursor saat orang menggulir formulir.
      scrollZoom: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e: maplibregl.MapMouseEvent) => {
      pindah.current?.(Number(e.lngLat.lat.toFixed(7)), Number(e.lngLat.lng.toFixed(7)));
    });
    peta.current = m;
    return () => {
      m.remove();
      peta.current = null;
      penanda.current = null;
    };
    // Sengaja sekali jalan: titik & mode ditangani efek di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ganti lapisan tanpa memuat ulang peta: kedua lapisan sudah ada di gaya yang
  // sama, jadi yang berubah cuma yang terlihat — posisi & zoom tidak melompat.
  useEffect(() => {
    const m = peta.current;
    if (!m || !m.isStyleLoaded()) return;
    for (const l of m.getStyle().layers ?? []) {
      const satelit = l.id === LAPIS_SATELIT;
      const tampil = satelit ? mode === "satelit" : mode === "peta";
      m.setLayoutProperty(l.id, "visibility", tampil ? "visible" : "none");
    }
  }, [mode]);

  useEffect(() => {
    const m = peta.current;
    if (!m) return;
    if (lat == null || lng == null) {
      penanda.current?.remove();
      penanda.current = null;
      return;
    }
    if (!penanda.current) {
      penanda.current = new maplibregl.Marker({ draggable: Boolean(onPindah), color: "#1d4ed8" })
        .setLngLat([lng, lat])
        .addTo(m);
      penanda.current.on("dragend", () => {
        const p = penanda.current?.getLngLat();
        if (p) pindah.current?.(Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)));
      });
    } else {
      penanda.current.setLngLat([lng, lat]);
    }
    if (m.getZoom() < 12) m.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
    else m.panTo([lng, lat], { duration: 400 });
  }, [lat, lng, onPindah]);

  if (!adaSumber(sumber) || !webgl) {
    return (
      <div
        style={{ height: tinggi }}
        className="flex w-full items-center justify-center rounded-md border border-dashed border-border bg-surface-muted px-4 text-center text-[12px] text-ink-muted"
      >
        {/* Layar ini tetap berguna tanpa peta: kotak koordinat tetap bisa diisi,
            dan tautan Google Maps di bawahnya tetap membuka letaknya. */}
        {!webgl
          ? "Peta tidak bisa digambar di peramban ini (WebGL tidak tersedia) – koordinat tetap bisa diisi manual."
          : "Peta dasar belum tersedia di server ini – koordinat tetap bisa diisi manual, dan tautan Google Maps di bawah tetap membuka letaknya."}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div ref={wadah} style={{ height: tinggi }} className="w-full overflow-hidden rounded-md border border-border" />
      {pilihan.length > 1 ? (
        <div className="flex gap-1">
          {pilihan.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMode(p)}
              aria-pressed={mode === p}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                mode === p
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-ink-muted hover:bg-surface-muted"
              }`}
            >
              {p === "peta" ? "Peta" : "Satelit"}
            </button>
          ))}
          <span className="self-center pl-1 text-[11px] text-ink-faint">
            Satelit memperlihatkan apakah titiknya benar-benar di kampung itu.
          </span>
        </div>
      ) : null}
    </div>
  );
}
