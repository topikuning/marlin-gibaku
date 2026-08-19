"use client";

import Link from "next/link";
import { Pencil, Plus, UserRoundSearch } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Badge, Banner, Button, EmptyState, Input, KpiCard, Label } from "@/components/ui";
import { BilahSaring } from "@/components/master/bilah-saring";
import { Laci } from "@/components/master/laci";
import { PerluPerhatian, type TemuanMaster } from "@/components/master/perlu-perhatian";
import { KartuBaris, SelNama } from "@/components/master/sel-nama";
import {
  addContactAction,
  deleteAliasAction,
  deleteContactAction,
  updateAliasAction,
  updateContactAction,
  type ContactState,
} from "@/lib/contacts/actions";
import {
  SENDER_KEY_LABEL,
  formatSenderKey,
  matchesQuery,
  senderKeyKind,
  tujuanGanda,
} from "@/lib/contacts/model";

/**
 * MANAJEMEN KONTAK — tata letak master data (DECISIONS 359).
 *
 * SATU halaman untuk dua jenis kontak yang selama ini tertukar (DECISIONS 150):
 *   • Kontak tujuan kirim — milik akun sendiri; super admin melihat semuanya.
 *   • Nama pengirim grup — milik organisasi, dipakai bersama.
 *
 * Bentuknya disamakan dengan Perusahaan & Pengguna: ringkasan angka, bilah
 * "perlu perhatian", lalu daftar bersaringan dengan pengubahan di dalam laci.
 * Yang baru maknanya di sini adalah **tujuan ganda**: dua entri dengan alamat
 * WhatsApp yang sama berarti laporan terkirim dua kali ke orang yang sama, dan
 * sebelumnya itu hanya terlihat kalau seseorang membandingkan sendiri kolom
 * nomornya baris demi baris.
 */

export type ContactItem = {
  id: string;
  name: string;
  chatId: string;
  note: string | null;
  ownerName: string;
  ownerRole: string;
  mine: boolean;
};

export type AliasItem = {
  id: string;
  senderKey: string;
  displayName: string;
  role: string | null;
  note: string | null;
  createdByName: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  program_director: "Direktur Program",
  regional_manager: "Manajer Wilayah",
  project_manager: "Project Manager",
  site_manager: "Site Manager",
  pelaksana: "Pelaksana",
  admin: "Admin",
  viewer: "Viewer",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

/** Grup atau perorangan — dua hal yang berbeda akibatnya saat salah kirim. */
function jenisTujuan(chatId: string): "grup" | "pribadi" {
  return senderKeyKind(chatId) === "grup" ? "grup" : "pribadi";
}

export function KontakClient({
  mine,
  others,
  aliases,
  canViewAll,
}: {
  mine: ContactItem[];
  others: ContactItem[];
  aliases: AliasItem[];
  canViewAll: boolean;
}) {
  const ganda = useMemo(() => tujuanGanda(mine), [mine]);
  const grup = mine.filter((c) => jenisTujuan(c.chatId) === "grup").length;
  const kenaGanda = mine.filter((c) => ganda.has(c.chatId.trim().toLowerCase())).length;
  const [saringTujuan, setSaringTujuan] = useState("");

  const temuan: TemuanMaster[] = [];
  if (kenaGanda > 0) {
    temuan.push({
      judul: `${kenaGanda} kontak menunjuk tujuan yang sama`,
      keterangan:
        "Nama boleh berbeda, tapi alamat WhatsApp-nya sama – laporan terkirim dua kali ke penerima yang sama.",
      nada: "peringatan",
      aksi: (
        <Button size="sm" variant="secondary" onClick={() => setSaringTujuan("ganda")}>
          Lihat yang ganda
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-3">
      <section aria-label="Ringkasan kontak" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Kontak tujuan" value={String(mine.length)} sub="Milik akun Anda sendiri" />
        <KpiCard label="Grup WhatsApp" value={String(grup)} sub={`${mine.length - grup} nomor perorangan`} />
        <KpiCard
          label="Tujuan ganda"
          value={String(kenaGanda)}
          sub={kenaGanda > 0 ? "Kiriman bisa dobel" : "Tidak ada"}
          tone={kenaGanda > 0 ? "warning" : "default"}
        />
        <KpiCard label="Pengirim dikenali" value={String(aliases.length)} sub="Nomor grup yang sudah dinamai" />
      </section>

      <PerluPerhatian temuan={temuan} />

      <ContactSection
        mine={mine}
        others={others}
        canViewAll={canViewAll}
        ganda={ganda}
        saring={saringTujuan}
        onSaring={setSaringTujuan}
      />
      <AliasSection aliases={aliases} />
    </div>
  );
}

/* ── Kontak tujuan ───────────────────────────────────────────────────────── */

function ContactSection({
  mine,
  others,
  canViewAll,
  ganda,
  saring,
  onSaring,
}: {
  mine: ContactItem[];
  others: ContactItem[];
  canViewAll: boolean;
  ganda: Set<string>;
  saring: string;
  onSaring: (v: string) => void;
}) {
  const [addState, add, adding] = useActionState<ContactState, FormData>(addContactAction, undefined);
  const [editState, edit, editing] = useActionState<ContactState, FormData>(updateContactAction, undefined);
  const [delState, del] = useActionState<ContactState, FormData>(deleteContactAction, undefined);
  const [idBuka, setIdBuka] = useState<string | null>(null);
  const [tambah, setTambah] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [q, setQ] = useState("");

  const banner = addState ?? editState ?? delState;
  const semua = useMemo(() => [...mine, ...others], [mine, others]);
  const dibuka = idBuka ? (semua.find((c) => c.id === idBuka) ?? null) : null;

  const lolos = (c: ContactItem) => {
    if (!matchesQuery({ name: c.name, detail: c.chatId, note: c.note, owner: c.ownerName }, q)) return false;
    if (saring === "grup") return jenisTujuan(c.chatId) === "grup";
    if (saring === "pribadi") return jenisTujuan(c.chatId) === "pribadi";
    if (saring === "ganda") return ganda.has(c.chatId.trim().toLowerCase());
    return true;
  };

  const mineShown = useMemo(() => mine.filter(lolos), [mine, q, saring, ganda]); // eslint-disable-line react-hooks/exhaustive-deps
  const othersShown = useMemo(() => others.filter(lolos), [others, q, saring, ganda]); // eslint-disable-line react-hooks/exhaustive-deps

  const baris = (c: ContactItem) => (
    <BarisKontak key={c.id} c={c} ganda={ganda} onEdit={() => setIdBuka(c.id)} delAction={del} />
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-3 pt-3">
        <p className="text-[13px] font-semibold text-ink">Kontak tujuan kirim</p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          Ke mana laporan dikirim lewat WhatsApp. Daftar ini milik akun Anda sendiri – akun lain
          tidak melihatnya.
        </p>
      </div>

      {banner?.error ? <div className="p-3 pb-0"><Banner tone="error" title={banner.error} /></div> : null}
      {banner?.success ? <div className="p-3 pb-0"><Banner tone="success" title={banner.success} /></div> : null}

      <BilahSaring
        cari={q}
        onCari={setQ}
        petunjukCari="Cari nama, nomor, atau catatan…"
        tampil={mineShown.length}
        total={mine.length}
        satuan="kontak"
        saringan={[
          {
            id: "kt-saring",
            label: "Semua jenis",
            nilai: saring,
            onUbah: onSaring,
            opsi: [
              { nilai: "grup", label: "Grup WhatsApp" },
              { nilai: "pribadi", label: "Nomor perorangan" },
              { nilai: "ganda", label: "Tujuan ganda" },
            ],
          },
        ]}
        aksi={
          <Button size="sm" onClick={() => setTambah(true)}>
            <Plus aria-hidden className="size-3.5" />
            Kontak baru
          </Button>
        }
      />

      {mineShown.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">
          {mine.length === 0
            ? "Belum ada kontak – tambahkan lewat “Kontak baru”."
            : "Tidak ada kontak yang cocok dengan saringan ini."}
        </p>
      ) : (
        <div className="space-y-2 p-2">{mineShown.map(baris)}</div>
      )}

      {canViewAll ? (
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="text-sm text-primary hover:underline"
          >
            {showOthers ? "Sembunyikan" : "Tampilkan"} kontak akun lain ({others.length}) – khusus
            super admin
          </button>
          {showOthers ? (
            others.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Akun lain belum menyimpan kontak.</p>
            ) : othersShown.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Tidak ada kontak akun lain yang cocok.</p>
            ) : (
              <div className="mt-2 space-y-2">{othersShown.map(baris)}</div>
            )
          ) : null}
        </div>
      ) : null}

      <Laci
        buka={dibuka !== null}
        onTutup={() => setIdBuka(null)}
        judul={dibuka?.name ?? "Kontak"}
        keterangan={dibuka && !dibuka.mine ? `Milik ${dibuka.ownerName} – perubahan tercatat di jejak audit.` : "Tujuan kirim laporan WhatsApp"}
      >
        {dibuka ? <FormKontak c={dibuka} action={edit} pending={editing} /> : null}
      </Laci>

      <Laci
        buka={tambah}
        onTutup={() => setTambah(false)}
        judul="Kontak baru"
        keterangan="Nomor perorangan atau ID grup WhatsApp."
      >
        <FormKontak action={add} pending={adding} />
      </Laci>
    </section>
  );
}

function BarisKontak({
  c,
  ganda,
  onEdit,
  delAction,
}: {
  c: ContactItem;
  ganda: Set<string>;
  onEdit: () => void;
  delAction: (fd: FormData) => void;
}) {
  const jenis = jenisTujuan(c.chatId);
  const kembar = ganda.has(c.chatId.trim().toLowerCase());
  return (
    <KartuBaris
      aksi={
        <>
          <Button type="button" size="sm" variant="secondary" onClick={onEdit}>
            <Pencil aria-hidden className="size-3.5" />
            Ubah
          </Button>
          <form action={delAction}>
            <input type="hidden" name="id" value={c.id} />
            <Button type="submit" size="sm" variant="ghost">
              Hapus
            </Button>
          </form>
        </>
      }
    >
      <SelNama
        nama={c.name}
        keterangan={c.note}
        lencana={
          <>
            <Badge tone={jenis === "grup" ? "info" : "neutral"} label={jenis === "grup" ? "Grup" : "Perorangan"} />
            {kembar ? <Badge tone="warning" label="Tujuan ganda" /> : null}
            {!c.mine ? <Badge tone="neutral" label={`${c.ownerName} · ${roleLabel(c.ownerRole)}`} /> : null}
          </>
        }
      />
      <p className="mt-1.5 truncate font-mono text-[11px] text-ink-muted">{c.chatId}</p>
    </KartuBaris>
  );
}

function FormKontak({
  c,
  action,
  pending,
}: {
  c?: ContactItem;
  action: (fd: FormData) => void;
  pending: boolean;
}) {
  const id = c?.id ?? "baru";
  return (
    <form action={action} className="space-y-3">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <div>
        <Label htmlFor={`n-${id}`} required>Nama</Label>
        <Input id={`n-${id}`} name="name" defaultValue={c?.name ?? ""} placeholder="mis. Direksi / Grup PPK" />
      </div>
      <div>
        <Label htmlFor={`c-${id}`} required>Nomor WA / ID grup</Label>
        <Input id={`c-${id}`} name="chatId" defaultValue={c?.chatId ?? ""} placeholder="628123… atau 12036…@g.us" />
        <p className="mt-1 text-[11px] text-ink-faint">
          ID grup bisa diambil dari halaman paket (pengaturan Grup WA / daftar grup WAHA) atau dari
          tautan undangan grup.
        </p>
      </div>
      <div>
        <Label htmlFor={`t-${id}`}>Catatan (opsional)</Label>
        <Input id={`t-${id}`} name="note" defaultValue={c?.note ?? ""} placeholder="mis. laporan mingguan" />
      </div>
      <Button type="submit" size="sm" loading={pending}>
        {c ? "Simpan kontak" : "Tambah kontak"}
      </Button>
    </form>
  );
}

/* ── Nama pengirim grup ──────────────────────────────────────────────────── */

function AliasSection({ aliases }: { aliases: AliasItem[] }) {
  const [editState, edit, editing] = useActionState<ContactState, FormData>(updateAliasAction, undefined);
  const [delState, del] = useActionState<ContactState, FormData>(deleteAliasAction, undefined);
  const [idBuka, setIdBuka] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [saring, setSaring] = useState("");

  const banner = editState ?? delState;
  const shown = useMemo(
    () =>
      aliases.filter((a) => {
        if (
          !matchesQuery(
            { name: a.displayName, detail: a.senderKey, note: `${a.role ?? ""} ${a.note ?? ""}` },
            q,
          )
        )
          return false;
        if (saring === "tanpa_peran") return !a.role;
        if (saring) return senderKeyKind(a.senderKey) === saring;
        return true;
      }),
    [aliases, q, saring],
  );
  const dibuka = idBuka ? (aliases.find((a) => a.id === idBuka) ?? null) : null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-3 pt-3">
        <p className="text-[13px] font-semibold text-ink">Nama pengirim grup</p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          Siapa pemilik nomor yang muncul di grup WhatsApp. Dipakai bersama satu perusahaan – sekali
          dinamai, semua ringkasan menyebut nama itu.
        </p>
      </div>

      {banner?.error ? <div className="p-3 pb-0"><Banner tone="error" title={banner.error} /></div> : null}
      {banner?.success ? <div className="p-3 pb-0"><Banner tone="success" title={banner.success} /></div> : null}

      {aliases.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={UserRoundSearch}
            title="Belum ada pengirim yang dinamai"
            description="Buka Chat Grup, lalu klik “Beri nama pengirim ini” pada pesan dari nomor yang belum dikenali. Namanya akan muncul di sini dan bisa diperbaiki kapan saja."
            action={
              <Link href="/chat-grup" className="text-sm text-primary hover:underline">
                Buka Chat Grup →
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <BilahSaring
            cari={q}
            onCari={setQ}
            petunjukCari="Cari nama, peran, atau nomor…"
            tampil={shown.length}
            total={aliases.length}
            satuan="pengirim"
            saringan={[
              {
                id: "al-saring",
                label: "Semua bentuk",
                nilai: saring,
                onUbah: setSaring,
                opsi: [
                  { nilai: "lid", label: SENDER_KEY_LABEL.lid },
                  { nilai: "kontak", label: SENDER_KEY_LABEL.kontak },
                  { nilai: "nomor", label: SENDER_KEY_LABEL.nomor },
                  { nilai: "tanpa_peran", label: "Belum diberi peran" },
                ],
              },
            ]}
          />
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">Tidak ada yang cocok dengan saringan ini.</p>
          ) : (
            <div className="space-y-2 p-2">
              {shown.map((a) => (
                <BarisAlias key={a.id} a={a} onEdit={() => setIdBuka(a.id)} delAction={del} />
              ))}
            </div>
          )}
        </>
      )}

      <Laci
        buka={dibuka !== null}
        onTutup={() => setIdBuka(null)}
        judul={dibuka?.displayName ?? "Pengirim"}
        keterangan={dibuka ? formatSenderKey(dibuka.senderKey) : undefined}
      >
        {dibuka ? (
          <form action={edit} className="space-y-3">
            <input type="hidden" name="id" value={dibuka.id} />
            <p className="rounded-md border border-border bg-surface-muted p-2 font-mono text-[11px] break-all text-ink-muted">
              {dibuka.senderKey}
            </p>
            <div>
              <Label htmlFor={`an-${dibuka.id}`} required>Nama</Label>
              <Input id={`an-${dibuka.id}`} name="displayName" defaultValue={dibuka.displayName} />
            </div>
            <div>
              <Label htmlFor={`ar-${dibuka.id}`}>Peran (opsional)</Label>
              <Input id={`ar-${dibuka.id}`} name="role" defaultValue={dibuka.role ?? ""} placeholder="mis. Mandor" />
            </div>
            <div>
              <Label htmlFor={`at-${dibuka.id}`}>Catatan (opsional)</Label>
              <Input id={`at-${dibuka.id}`} name="note" defaultValue={dibuka.note ?? ""} />
            </div>
            <Button type="submit" size="sm" loading={editing}>
              Simpan nama
            </Button>
          </form>
        ) : null}
      </Laci>
    </section>
  );
}

function BarisAlias({
  a,
  onEdit,
  delAction,
}: {
  a: AliasItem;
  onEdit: () => void;
  delAction: (fd: FormData) => void;
}) {
  const kind = senderKeyKind(a.senderKey);
  return (
    <KartuBaris
      aksi={
        <>
          <Button type="button" size="sm" variant="secondary" onClick={onEdit}>
            <Pencil aria-hidden className="size-3.5" />
            Ubah
          </Button>
          <form action={delAction}>
            <input type="hidden" name="id" value={a.id} />
            <Button type="submit" size="sm" variant="ghost">
              Lepas nama
            </Button>
          </form>
        </>
      }
    >
      <SelNama
        nama={a.displayName}
        keterangan={
          a.note
            ? `${a.note} · ${a.createdByName ? `dinamai oleh ${a.createdByName}` : "pembuat tidak diketahui"}`
            : a.createdByName
              ? `Dinamai oleh ${a.createdByName}`
              : "Pembuat tidak diketahui"
        }
        lencana={
          <>
            {a.role ? <Badge tone="info" label={a.role} /> : <Badge tone="neutral" label="Tanpa peran" />}
            <Badge tone="neutral" label={SENDER_KEY_LABEL[kind]} />
          </>
        }
      />
      <p className="mt-1.5 truncate font-mono text-[11px] text-ink-muted" title={a.senderKey}>
        {formatSenderKey(a.senderKey)}
      </p>
    </KartuBaris>
  );
}
