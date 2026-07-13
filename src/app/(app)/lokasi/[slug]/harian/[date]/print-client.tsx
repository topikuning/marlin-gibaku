"use client";

export function PrintClient() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-[#1e3a8a] px-4 py-2 text-sm font-semibold text-[#1e3a8a] transition hover:bg-[#F1F5F9]"
    >
      Cetak / PDF
    </button>
  );
}
