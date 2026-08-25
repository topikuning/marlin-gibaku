/*
 * MENU BERKAS — penanda sibuk & satu-klik (DECISIONS 360).
 *
 * Laporan user 2026-08-18: *"saat menu upload ke drive atau kirim ke wa diklik,
 * tidak ada penanda sedang proses atau apa … masalah klik berkali-kali akhirnya
 * jadi spam di whatsapp terjadi … masalah sudah pernah terjadi, terulang lagi."*
 *
 * Penyebabnya bukan aksinya lambat, melainkan menunya MENUTUP DIRI begitu
 * sebuah pilihan ditekan — sehingga penanda `loading` pada pilihan itu tidak
 * pernah punya tempat untuk terlihat. Dari kursi pemakai: klik → menu hilang →
 * layar diam → klik lagi → pesan terkirim dua kali.
 *
 * Yang diuji di sini karena itu bukan "apakah spinner-nya muncul", melainkan
 * hal yang sebenarnya merugikan: **selagi sebuah aksi berjalan, tidak boleh ada
 * SATU pun kendali yang masih bisa diklik.**
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuBerkas, type PilihanBerkas } from "@/components/ui/menu-berkas";

const UNDUH: PilihanBerkas = {
  label: "Unduh PDF",
  href: "/api/x.pdf",
  jenis: "berkas",
  labelSibuk: "Menyiapkan PDF…",
};

function kirim(loading: boolean): PilihanBerkas {
  return {
    label: "Kirim ke WhatsApp",
    onSelect: () => {},
    loading,
    labelSibuk: "Mengirim ke WhatsApp…",
  };
}

function render(el: React.ReactElement): string {
  return renderToStaticMarkup(el);
}

describe("MenuBerkas – selagi aksi berjalan", () => {
  const sibuk = render(
    <MenuBerkas label="Laporan Harian" utama={UNDUH} pilihan={[UNDUH, kirim(true)]} />,
  );

  it("TIDAK menyisakan kendali yang bisa diklik", () => {
    // Inti pencegah spam-nya. Kalau salah satu dari ini muncul lagi, klik kedua
    // kembali mungkin dan pesan ganda ikut kembali.
    expect(sibuk).not.toContain("<button");
    expect(sibuk).not.toContain("<summary");
    expect(sibuk).not.toContain("<a ");
  });

  it("mengatakan APA yang sedang berjalan, bukan sekadar berputar", () => {
    expect(sibuk).toContain("Mengirim ke WhatsApp…");
  });

  it("ditandai sibuk untuk pembaca layar juga", () => {
    // Penanda yang hanya berupa animasi tidak ada artinya bagi yang tidak
    // melihat layar — dan merekalah yang paling mungkin menekan dua kali.
    expect(sibuk).toContain('aria-busy="true"');
    expect(sibuk).toContain('aria-live="polite"');
  });

  it("satu aksi mematikan SELURUH menu, termasuk pilihan lain", () => {
    // "Kirim WA" dan "Upload Drive" pada berkas yang sama tidak dimaksudkan
    // jalan bersamaan; menyisakan satu pintu hanya memindahkan kiriman gandanya.
    const dua = render(
      <MenuBerkas
        label="Laporan Harian"
        pilihan={[
          kirim(true),
          { label: "Upload ke Drive", onSelect: () => {}, loading: false, labelSibuk: "Mengunggah…" },
        ]}
      />,
    );
    expect(dua).not.toContain("Upload ke Drive");
    expect(dua).not.toContain("<button");
  });
});

describe("MenuBerkas – keadaan biasa", () => {
  it("menunya utuh saat tidak ada yang berjalan", () => {
    const m = render(<MenuBerkas label="Laporan Harian" pilihan={[UNDUH, kirim(false)]} />);
    expect(m).toContain("<summary");
    expect(m).toContain("Kirim ke WhatsApp");
    expect(m).not.toContain("aria-busy");
  });

  it("`utama` memberi aksi SATU klik di badan tombol, sebelum panelnya", () => {
    // Keluhan kedua user yang sama: "laporan seharusnya aku tinggal klik, ini
    // malah banyak klik". Tautan utama harus ada di badan tombol — yaitu lebih
    // dulu daripada panel menunya, bukan cuma sebagai salah satu isi panel.
    const m = render(<MenuBerkas label="Laporan Harian" utama={UNDUH} pilihan={[UNDUH]} />);
    const tautanPertama = m.indexOf('href="/api/x.pdf"');
    const panel = m.indexOf('role="menu"');
    expect(tautanPertama).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(-1);
    expect(tautanPertama).toBeLessThan(panel);
  });

  it("alasan pilihan mati DITULIS, bukan sekadar diredupkan", () => {
    const m = render(
      <MenuBerkas
        label="Laporan Harian"
        pilihan={[{ label: "Kirim ke WhatsApp", onSelect: () => {}, loading: false, labelSibuk: "Mengirim…", disabledReason: "Paket belum punya grup WA" }]}
      />,
    );
    expect(m).toContain("Paket belum punya grup WA");
    expect(m).toContain("aria-disabled");
  });
});

describe("MenuBerkas – penjaga tipe", () => {
  it("pilihan beraksi TIDAK BISA ditulis tanpa penanda sibuk", () => {
    /*
     * Penjaga yang sebenarnya ada di kompiler, bukan di sini: `PilihanAksi`
     * mewajibkan `loading` + `labelSibuk`. Baris di bawah gagal dikompilasi,
     * dan `@ts-expect-error` membuat `pnpm typecheck` MERAH kalau suatu saat
     * kewajiban itu dilonggarkan — yaitu tepat saat cacat lamanya bisa kembali.
     */
    // @ts-expect-error — aksi tanpa `loading`/`labelSibuk` harus ditolak.
    const tanpaSibuk: PilihanBerkas = { label: "Kirim ke WhatsApp", onSelect: () => {} };
    expect(tanpaSibuk.label).toBe("Kirim ke WhatsApp");
  });

  it("TAUTAN pun tidak bisa ditulis tanpa menyatakan jenisnya", () => {
    /*
     * Ini pagar yang HILANG pada DECISIONS 360, dan karena itu keluhan yang
     * sama datang lagi 2026-08-21 (DECISIONS 400). Tipe lama membolehkan
     * `{ label, href }` polos — dan menuliskan `labelSibuk?: never`, yaitu
     * MELARANG tautan punya penanda sibuk. Yang diukur kemudian: unduh PDF
     * mingguan 4,1 detik dengan layar diam sepenuhnya.
     */
    // @ts-expect-error — tautan tanpa `jenis` harus ditolak.
    const tanpaJenis: PilihanBerkas = { label: "Unduh", href: "/api/x.pdf" };
    expect(tanpaJenis.label).toBe("Unduh");
  });

  it("tautan berkas tidak bisa ditulis tanpa `labelSibuk`", () => {
    // @ts-expect-error — `jenis: "berkas"` mewajibkan kata kerja selagi sibuk.
    const tanpaLabel: PilihanBerkas = { label: "Unduh", href: "/api/x.pdf", jenis: "berkas" };
    expect(tanpaLabel.label).toBe("Unduh");
  });
});

describe("MenuBerkas – tautan berkas vs tautan halaman", () => {
  const BUKA: PilihanBerkas = {
    label: "Buka untuk dicetak",
    href: "/cetak/x",
    jenis: "tab",
  };

  it("tautan BERKAS tidak dibuka di tab baru – klik-nya diambil alih", () => {
    /*
     * `target="_blank"` pada berkas adalah sumber "tidak terjadi apa-apa":
     * tab kosong terbuka di belakang, server bekerja empat detik, dan halaman
     * tempat orang menekan tetap diam. Berkasnya sekarang dijemput di halaman
     * ini juga, jadi penanda sibuknya punya tempat untuk terlihat.
     */
    const m = render(<MenuBerkas label="Laporan" pilihan={[UNDUH]} />);
    expect(m).toContain('href="/api/x.pdf"');
    expect(m).not.toContain('target="_blank"');
  });

  it("tautan HALAMAN tetap dibuka di tab baru", () => {
    const m = render(<MenuBerkas label="Laporan" pilihan={[BUKA]} />);
    expect(m).toContain('target="_blank"');
  });
});
