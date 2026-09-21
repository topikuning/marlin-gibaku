"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";

/**
 * Kotak cari yang MENULIS KE URL, bukan ke state lokal.
 *
 * Halaman ini dipakai untuk melacak angka yang dipersoalkan orang lain, jadi
 * hasilnya harus bisa dikirim apa adanya — `?q=pembesian` dan
 * `?item=II%232.b` cukup ditempel di chat. Pencarian yang hidup hanya di state
 * komponen tidak bisa ditautkan dari mana pun, termasuk dari daftar peringatan
 * di pratinjau impor yang justru jadi asal-usul fitur ini.
 */
export function FormCari({ slug, q }: { slug: string; q: string }) {
  const router = useRouter();
  const [teks, setTeks] = useState(q);
  /*
   * Pencarian ini NAVIGASI, bukan mutasi — tetapi tombolnya tetap harus
   * menyatakan keadaan sibuknya (DECISIONS 352 / pagar `penanda-sibuk`).
   * Render server halaman ini memang butuh waktu pada lokasi dengan ribuan
   * baris laporan, dan tombol yang diam di situ membuat orang menekannya
   * berkali-kali.
   */
  const [menunggu, mulai] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const s = teks.trim();
        mulai(() => {
          router.push(`/lokasi/${slug}/rab/riwayat${s ? `?q=${encodeURIComponent(s)}` : ""}`);
        });
      }}
    >
      <div className="min-w-64 flex-1">
        <Label htmlFor="cari-item">Cari item pekerjaan</Label>
        <Input
          id="cari-item"
          type="search"
          value={teks}
          onChange={(e) => setTeks(e.target.value)}
          placeholder="mis. pembesian, 2.b, bekisting…"
          autoComplete="off"
        />
      </div>
      <Button type="submit" size="sm" className="h-9" loading={menunggu}>
        <Search aria-hidden className="size-3.5" />
        Cari
      </Button>
    </form>
  );
}
