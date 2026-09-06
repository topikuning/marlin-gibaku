"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LocationStatus } from "@/generated/prisma/enums";
import type { PetaMarker } from "@/lib/peta";
import {
  LAPIS_SATELIT,
  adaSumber,
  dukungWebGL,
  gayaPeta,
  modeTersedia,
  type ModePeta,
  type SumberPeta,
} from "@/lib/peta/gaya";
import { siapkanPeta } from "@/lib/peta/klien";
import { statusColorToken } from "./status-color";

/**
 * SEBARAN LOKASI — MapLibre GL JS (BSD-3), client-only via next/dynamic.
 *
 * Keluhan user 2026-09-06: *"aku sangat tidak puas dengan leaflet."* Yang
 * dipindahkan bukan cuma pustakanya:
 *
 * - **Ubinnya vektor**, bukan gambar yang dibesarkan. Nama desa tetap tajam di
 *   perbesaran berapa pun, dan sumbernya milik kita sendiri — bukan server
 *   komunitas OSM yang memang melarang pemakaian produksi dan bisa memblokir
 *   peta proyek ini kapan saja.
 * - **Penanda BERKELOMPOK.** Sistem ini menuju 200+ lokasi di 7 provinsi;
 *   pada tampilan nasional, ratusan titik yang saling menimpa bukan informasi,
 *   melainkan noda. Berkelompok, angka di dalam lingkarannya menjawab
 *   "berapa banyak di sini" — dan mengekliknya membuka isinya.
 * - **Lapisan satelit** untuk memeriksa apakah sebuah titik benar-benar berada
 *   di kampung nelayan, bukan di tengah laut atau tengah sawah.
 *
 * Warna penanda tetap mengikuti token tema (dibaca sekali lewat
 * getComputedStyle): MapLibre menulis warna sebagai nilai literal dan tidak
 * memahami `var()`.
 */

/** Dipakai HANYA bila tidak ada satu pun lokasi berkoordinat untuk dirapatkan. */
const PUSAT_KOSONG: [number, number] = [111.5, -6.9];

/**
 * Cara merapatkan pandangan ke kotak lokasi — satu nilai, dipakai saat peta
 * dibuat DAN saat sebaran lokasinya berubah, supaya keduanya tidak bisa
 * melenceng satu sama lain.
 *
 * `maxZoom` menahan kasus satu lokasi: tanpa itu peta melompat ke perbesaran
 * maksimum dan yang terlihat cuma satu blok jalan tanpa konteks apa pun.
 */
const BINGKAI = { padding: 40, maxZoom: 11 } as const;

const MAP_TOKENS = [
  "--color-ink-faint",
  "--color-info",
  "--color-warning",
  "--color-success",
  "--color-danger",
  "--color-primary",
  "--color-surface",
] as const;

const TONE_TOKEN: Record<"success" | "warning" | "danger" | "neutral" | "idle", string> = {
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  neutral: "--color-ink-faint",
  idle: "--color-ink-faint",
};

const SUMBER_LOKASI = "lokasi";
const LAPIS_KELOMPOK = "lokasi-kelompok";
const LAPIS_JUMLAH = "lokasi-jumlah";
const LAPIS_TITIK = "lokasi-titik";
const LAPIS_PILIH = "lokasi-terpilih";

/**
 * Koordinat sebuah fitur titik.
 *
 * Sengaja TIDAK memakai namespace global `GeoJSON`: namespace itu dulu ikut
 * terbawa `@types/leaflet`, dan begitu Leaflet dibuang ia lenyap di pemasangan
 * bersih — lokal masih lolos karena sisa `node_modules`, CI langsung merah.
 * Bentuk yang dibaca di sini cuma `coordinates`, jadi itu saja yang disebut.
 */
function titik(f: { geometry: { coordinates?: unknown } }): [number, number] {
  const c = f.geometry.coordinates as [number, number];
  return [c[0], c[1]];
}


export interface PetaMapProps {
  markers: PetaMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Timpa warna pin per-id dengan tone (dashboard: status submit). */
  toneById?: Record<string, "success" | "warning" | "danger" | "neutral" | "idle">;
  sumber: SumberPeta;
}

export function PetaMap({ markers, selectedId, onSelect, toneById, sumber }: PetaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const siap = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const pilihan = modeTersedia(sumber);
  const [mode, setMode] = useState<ModePeta>(pilihan.includes("peta") ? "peta" : "satelit");
  // Dukungan WebGL diperiksa SEBELUM render, bukan lewat setState di dalam
  // efek: kegagalan peta harus jadi keadaan awal komponen, bukan kedipan.
  const [webgl] = useState(dukungWebGL);
  /*
   * KEGAGALAN MAPLIBRE DITAMPILKAN, BUKAN DIDIAMKAN — teguran user 2026-09-06:
   * *"berhasil didownload, tapi malah jadi abu2. apa masalahmu sebenarnya!"*
   *
   * MapLibre memancarkan `error` untuk ubin yang gagal diambil, gaya yang tidak
   * bisa dibaca, dan sumber yang tidak ditemukan — lalu tetap menggambar kanvas
   * kosong. Diam-diam abu-abu adalah cara terburuk menyampaikan kegagalan: yang
   * melihatnya menyangka lokasinya yang tidak ada.
   */
  const [galat, setGalat] = useState<string | null>(null);

  const warna = useMemo(() => {
    if (typeof window === "undefined") return {} as Record<string, string>;
    const style = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const t of MAP_TOKENS) out[t] = style.getPropertyValue(t).trim();
    return out;
  }, []);
  const token = (t: string) => warna[t] ?? "#64748b";

  /** Titik-titik sebagai GeoJSON: satu sumber, dipakai semua lapisan. */
  const data = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: markers.map((m) => {
        const tone = toneById?.[m.id];
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
          properties: {
            id: m.id,
            name: m.name,
            wilayah: `${m.regency} · ${m.province}`,
            warna: tone ? token(TONE_TOKEN[tone]) : token(statusColorToken(m.status as LocationStatus)),
            // "Belum mulai" digambar lebih kecil & pucat: hadir di peta, tapi
            // jelas bukan pekerjaan berjalan yang menunggu laporan hari ini.
            idle: tone === "idle" ? 1 : 0,
          },
        };
      }),
    };
    // `token` stabil karena `warna` dihitung sekali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, toneById, warna]);

  const batas = useMemo(() => {
    if (markers.length === 0) return null;
    const b = new maplibregl.LngLatBounds();
    for (const m of markers) b.extend([m.lng, m.lat]);
    return b;
  }, [markers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !adaSumber(sumber) || !webgl) return;
    siapkanPeta();
    /*
     * PANDANGAN AWAL = KOTAK LOKASI YANG ADA, bukan seluruh Indonesia.
     *
     * Ketetapan user sejak DECISIONS 135 (*"PetaMap tidak lagi hardcode view
     * Jawa — fitBounds otomatis ke seluruh marker"*), ditegaskan lagi
     * 2026-09-06: *"tidak perlu zoom out satu wilayah indonesia, tapi hanya
     * atas yg ada lokasi saja"*.
     *
     * Kepindahan ke MapLibre sempat mengembalikannya secara diam-diam: peta
     * dibuat dengan pusat & zoom tetap (Indonesia), lalu baru dirapatkan pada
     * event `load`. Yang dilihat orang tetap peta se-Indonesia dulu — berkedip,
     * dan pada layar dasbor yang pendek sering berhenti di situ. Sekarang
     * kotaknya diberikan LANGSUNG ke konstruktor, jadi bingkai pertama yang
     * digambar sudah bingkai yang benar.
     *
     * `PUSAT_KOSONG` tinggal untuk satu keadaan: benar-benar tidak ada lokasi
     * berkoordinat. Di situ tidak ada yang bisa dirapatkan.
     */
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: gayaPeta(sumber, mode),
      ...(batas
        ? { bounds: batas, fitBoundsOptions: BINGKAI }
        : { center: PUSAT_KOSONG, zoom: 4.2 }),
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", (e) => {
      const pesan = (e as { error?: { message?: string } }).error?.message;
      if (pesan) setGalat(pesan);
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });

    map.on("load", () => {
      map.addSource(SUMBER_LOKASI, {
        type: "geojson",
        data,
        cluster: true,
        clusterRadius: 46,
        // Di atas zoom ini tiap lokasi berdiri sendiri: yang berdekatan memang
        // benar-benar berdekatan, bukan sekadar bertumpuk karena petanya kecil.
        clusterMaxZoom: 11,
      });
      map.addLayer({
        id: LAPIS_KELOMPOK,
        type: "circle",
        source: SUMBER_LOKASI,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": token("--color-primary"),
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": token("--color-surface"),
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25],
        },
      });
      map.addLayer({
        id: LAPIS_JUMLAH,
        type: "symbol",
        source: SUMBER_LOKASI,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        },
        paint: { "text-color": token("--color-surface") },
      });
      map.addLayer({
        id: LAPIS_TITIK,
        type: "circle",
        source: SUMBER_LOKASI,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "warna"],
          "circle-opacity": ["case", ["==", ["get", "idle"], 1], 0.45, 0.95],
          "circle-radius": ["case", ["==", ["get", "idle"], 1], 5, 7],
          "circle-stroke-width": 1.4,
          "circle-stroke-color": token("--color-surface"),
        },
      });
      map.addLayer({
        id: LAPIS_PILIH,
        type: "circle",
        source: SUMBER_LOKASI,
        filter: ["==", ["get", "id"], "__tidak_ada__"],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 13,
          "circle-stroke-width": 3,
          "circle-stroke-color": token("--color-primary"),
        },
      });
      siap.current = true;
      // Tidak ada perapatan di sini lagi: kotaknya sudah diberikan ke
      // konstruktor, jadi bingkai pertama sudah benar. Merapatkan ulang di
      // `load` hanya mengulang pekerjaan yang sama — dan dulu, karena ia satu-
      // satunya perapatan, orang sempat melihat peta se-Indonesia lebih dulu.
    });

    map.on("click", LAPIS_KELOMPOK, (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: [LAPIS_KELOMPOK] })[0];
      const id = f?.properties?.cluster_id;
      if (id == null) return;
      const src = map.getSource(SUMBER_LOKASI) as maplibregl.GeoJSONSource;
      void src.getClusterExpansionZoom(Number(id)).then((zoom) => {
        map.easeTo({ center: titik(f), zoom });
      });
    });
    map.on("click", LAPIS_TITIK, (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id);
    });
    map.on("mousemove", LAPIS_TITIK, (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      popup
        .setLngLat(titik(f))
        .setHTML(
          `<div style="font-size:12px;font-weight:600">${f.properties?.name ?? ""}</div><div style="font-size:11px">${f.properties?.wilayah ?? ""}</div>`,
        )
        .addTo(map);
    });
    map.on("mouseleave", LAPIS_TITIK, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.on("mouseenter", LAPIS_KELOMPOK, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAPIS_KELOMPOK, () => {
      map.getCanvas().style.cursor = "";
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      siap.current = false;
    };
    // Sengaja sekali jalan; data & seleksi ditangani efek di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data berubah (filter/tambah lokasi) → perbarui sumber, lalu rapatkan
  // pandangan ke sebaran baru bila tidak sedang menyorot satu lokasi.
  const kunci = useMemo(() => markers.map((m) => m.id).sort().join(","), [markers]);
  const kunciSebelumnya = useRef(kunci);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !siap.current) return;
    const src = map.getSource(SUMBER_LOKASI) as maplibregl.GeoJSONSource | undefined;
    src?.setData(data);
    if (kunciSebelumnya.current === kunci) return;
    kunciSebelumnya.current = kunci;
    if (selectedId || !batas) return;
    map.fitBounds(batas, { ...BINGKAI, duration: 600 });
  }, [data, kunci, batas, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !siap.current) return;
    map.setFilter(LAPIS_PILIH, ["==", ["get", "id"], selectedId ?? "__tidak_ada__"]);
    const m = markers.find((x) => x.id === selectedId);
    if (m) map.flyTo({ center: [m.lng, m.lat], zoom: 13, duration: 800 });
  }, [selectedId, markers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const l of map.getStyle().layers ?? []) {
      if (l.id.startsWith("lokasi-")) continue; // penanda selalu tampil
      const satelit = l.id === LAPIS_SATELIT;
      map.setLayoutProperty(l.id, "visibility", (satelit ? mode === "satelit" : mode === "peta") ? "visible" : "none");
    }
  }, [mode]);

  if (!adaSumber(sumber) || !webgl) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-border bg-surface-muted px-6 text-center text-[13px] text-ink-muted">
        {!webgl
          ? "Peta tidak bisa digambar di peramban ini (WebGL tidak tersedia). Daftar lokasi di sebelah tetap lengkap."
          : "Peta dasar belum tersedia di server ini. Daftar lokasi di sebelah tetap lengkap – yang hilang hanya gambarnya."}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {galat ? (
        <div className="absolute right-2 bottom-8 left-2 z-10 rounded-md border border-danger bg-surface/95 px-2.5 py-1.5 text-[11px] text-danger shadow-sm">
          Sebagian peta gagal dimuat – {galat}. Buka Sistem › Kesehatan Layanan untuk keadaan peta
          dasar.
        </div>
      ) : null}
      {pilihan.length > 1 ? (
        <div className="absolute top-2 left-2 z-10 flex overflow-hidden rounded-md border border-border bg-surface shadow-sm">
          {pilihan.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMode(p)}
              aria-pressed={mode === p}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mode === p ? "bg-primary/10 text-primary" : "text-ink-muted hover:bg-surface-muted"
              }`}
            >
              {p === "peta" ? "Peta" : "Satelit"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
