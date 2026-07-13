"use client";

import dynamic from "next/dynamic";
import type { PetaMarker } from "@/lib/peta";

// Leaflet butuh window → render hanya di client (ssr:false).
const PetaMap = dynamic(() => import("./peta-map").then((m) => m.PetaMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-130px)] items-center justify-center rounded-xl border border-[#E2E8F0] text-sm text-slate-400">
      Memuat peta…
    </div>
  ),
});

export function PetaClient({ markers }: { markers: PetaMarker[] }) {
  return <PetaMap markers={markers} />;
}
