/**
 * Pasangan revisi untuk halaman "Bandingkan revisi" (DECISIONS 637) – MURNI.
 *
 * Bawaan: RAB AKTIF (kanan) dibandingkan dengan revisi TEPAT sebelumnya
 * (kiri) – permintaan user *"perbandingkan RAB aktif saat ini dengan RAB
 * sebelumnya"*. Draft tidak ikut: ia belum pernah berlaku. Pilihan tangan
 * (`?dari=&ke=`) dipakai bila keduanya revisi sah yang berbeda.
 */
type RevisiRingkas = { id: string; revisionNo: number; status: "draft" | "aktif" | "digantikan" };

export function pilihPasanganBawaan(
  revisi: RevisiRingkas[],
  pilihan: { dari?: string; ke?: string },
): { dari: string; ke: string } | null {
  const berlaku = revisi.filter((r) => r.status !== "draft").sort((a, b) => b.revisionNo - a.revisionNo);
  if (berlaku.length < 2) return null;
  const sah = new Set(berlaku.map((r) => r.id));
  if (pilihan.dari && pilihan.ke && pilihan.dari !== pilihan.ke && sah.has(pilihan.dari) && sah.has(pilihan.ke)) {
    return { dari: pilihan.dari, ke: pilihan.ke };
  }
  const ke = berlaku.find((r) => r.status === "aktif") ?? berlaku[0];
  const dari = berlaku.find((r) => r.revisionNo < ke.revisionNo);
  return dari ? { dari: dari.id, ke: ke.id } : null;
}
