import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

/**
 * TOMBOL DI LAYAR SENTUH MINIMAL 44 PX (DECISIONS 731).
 *
 * Pilihan user 2026-11-01: *"naikkan tombol ke 44 px di layar sentuh"*, sesudah
 * keluhan tombol foto yang terlalu kecil (730). Tombol `sm` 32 px dan `md` 36 px
 * dipakai di seluruh aplikasi – di bawah pedoman sentuh 44 px.
 *
 * Hanya di perangkat yang alat tunjuk utamanya jari (`pointer: coarse`); di
 * desktop ukurannya tetap, supaya tabel dan baris aksi tidak membengkak.
 */
describe("tombol: sasaran sentuh", () => {
  it.each(["sm", "md"] as const)("ukuran %s: minimal 44 px di layar sentuh, tetap di desktop", (size) => {
    const kelas = buttonClass("primary", size).split(/\s+/);
    expect(kelas).toContain("pointer-coarse:min-h-11");
    expect(kelas.some((k) => /^h-(8|9)$/.test(k))).toBe(true);
  });

  it("className pemanggil tidak menghapus batas minimal di layar sentuh", () => {
    expect(buttonClass("secondary", "sm", "h-7 px-2").split(/\s+/)).toContain("pointer-coarse:min-h-11");
  });

  it("kotak isian, pilihan, dan Combobox ikut minimal 44 px di layar sentuh", () => {
    expect(renderToStaticMarkup(<Input name="a" />)).toContain("pointer-coarse:min-h-11");
    expect(renderToStaticMarkup(<Select name="b"><option>x</option></Select>)).toContain("pointer-coarse:min-h-11");
    expect(readFileSync("src/components/ui/combobox.tsx", "utf8")).toMatch(/flex h-9 w-full[^"]*pointer-coarse:min-h-11/);
  });
});
