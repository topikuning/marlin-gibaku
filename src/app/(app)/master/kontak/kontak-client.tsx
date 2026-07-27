"use client";

import Link from "next/link";
import { UserRoundSearch } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Label,
} from "@/components/ui";
import {
  addContactAction,
  deleteAliasAction,
  deleteContactAction,
  updateAliasAction,
  updateContactAction,
  type ContactState,
} from "@/lib/contacts/actions";
import { SENDER_KEY_LABEL, formatSenderKey, matchesQuery, senderKeyKind } from "@/lib/contacts/model";

/**
 * Manajemen Kontak — SATU halaman untuk dua jenis kontak yang selama ini
 * tersebar (DECISIONS 150):
 *   • Kontak tujuan kirim — milik akun sendiri; super admin melihat semuanya.
 *   • Nama pengirim grup — milik organisasi, dipakai bersama.
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

/* ── Kontak tujuan ───────────────────────────────────────────────────────── */

function ContactRow({
  c,
  onEdit,
  delAction,
}: {
  c: ContactItem;
  onEdit: () => void;
  delAction: (fd: FormData) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
          <span className="truncate">{c.name}</span>
          {!c.mine ? (
            <Badge tone="neutral">
              {c.ownerName} · {roleLabel(c.ownerRole)}
            </Badge>
          ) : null}
        </p>
        <p className="truncate font-mono text-xs text-ink-muted">{c.chatId}</p>
        {c.note ? <p className="truncate text-xs text-ink-faint">{c.note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
          Ubah
        </Button>
        <form action={delAction}>
          <input type="hidden" name="id" value={c.id} />
          <Button type="submit" size="sm" variant="ghost">
            Hapus
          </Button>
        </form>
      </div>
    </li>
  );
}

function ContactEditForm({
  c,
  onClose,
  action,
  pending,
}: {
  c: ContactItem;
  onClose: () => void;
  action: (fd: FormData) => void;
  pending: boolean;
}) {
  return (
    <li className="py-2">
      <form action={action} className="grid gap-2 rounded-md border border-border bg-surface-muted p-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={c.id} />
        <div>
          <Label htmlFor={`n-${c.id}`}>Nama</Label>
          <Input id={`n-${c.id}`} name="name" defaultValue={c.name} />
        </div>
        <div>
          <Label htmlFor={`c-${c.id}`}>Nomor WA / ID grup</Label>
          <Input id={`c-${c.id}`} name="chatId" defaultValue={c.chatId} />
        </div>
        <div>
          <Label htmlFor={`t-${c.id}`}>Catatan (opsional)</Label>
          <Input id={`t-${c.id}`} name="note" defaultValue={c.note ?? ""} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-3">
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Simpan
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          {!c.mine ? (
            <span className="text-xs text-warning">
              Kontak milik {c.ownerName} — perubahan tercatat di jejak audit.
            </span>
          ) : null}
        </div>
      </form>
    </li>
  );
}

function ContactSection({
  mine,
  others,
  canViewAll,
}: {
  mine: ContactItem[];
  others: ContactItem[];
  canViewAll: boolean;
}) {
  const [addState, add, adding] = useActionState<ContactState, FormData>(addContactAction, undefined);
  const [editState, edit, editing] = useActionState<ContactState, FormData>(updateContactAction, undefined);
  const [delState, del] = useActionState<ContactState, FormData>(deleteContactAction, undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [q, setQ] = useState("");

  const banner = addState ?? editState ?? delState;
  const mineShown = useMemo(
    () => mine.filter((c) => matchesQuery({ name: c.name, detail: c.chatId, note: c.note }, q)),
    [mine, q],
  );
  const othersShown = useMemo(
    () =>
      others.filter((c) =>
        matchesQuery({ name: c.name, detail: c.chatId, note: c.note, owner: c.ownerName }, q),
      ),
    [others, q],
  );

  const row = (c: ContactItem) =>
    openId === c.id ? (
      <ContactEditForm key={c.id} c={c} onClose={() => setOpenId(null)} action={edit} pending={editing} />
    ) : (
      <ContactRow key={c.id} c={c} onEdit={() => setOpenId(c.id)} delAction={del} />
    );

  return (
    <Card>
      <CardHeader
        title={`Kontak tujuan kirim (${mine.length})`}
        subtitle="Ke mana laporan dikirim lewat WhatsApp. Daftar ini milik akun Anda sendiri — akun lain tidak melihatnya."
      />
      <CardBody className="space-y-3">
        {banner?.error ? <Banner tone="error" title={banner.error} /> : null}
        {banner?.success ? <Banner tone="success" title={banner.success} /> : null}

        {mine.length + others.length > 6 ? (
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, nomor, atau catatan…"
            aria-label="Cari kontak tujuan"
          />
        ) : null}

        {mineShown.length > 0 ? (
          <ul className="divide-y divide-border">{mineShown.map(row)}</ul>
        ) : (
          <p className="text-sm text-ink-muted">
            {q ? "Tidak ada kontak yang cocok." : "Belum ada kontak — tambahkan di bawah."}
          </p>
        )}

        <form action={add} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <Label htmlFor="kt-name">Nama</Label>
            <Input id="kt-name" name="name" placeholder="mis. Direksi / Grup PPK" />
          </div>
          <div>
            <Label htmlFor="kt-chat">Nomor WA / ID grup</Label>
            <Input id="kt-chat" name="chatId" placeholder="628123… atau 12036…@g.us" />
          </div>
          <div>
            <Label htmlFor="kt-note">Catatan (opsional)</Label>
            <Input id="kt-note" name="note" placeholder="mis. laporan mingguan" />
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" variant="secondary" loading={adding}>
              Tambah kontak
            </Button>
          </div>
        </form>
        <p className="text-xs text-ink-faint">
          ID grup WhatsApp bisa diambil dari menu Laporan → WA (daftar grup WAHA) atau dari tautan undangan grup.
        </p>

        {canViewAll ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowOthers((v) => !v)}
              className="text-sm text-primary hover:underline"
            >
              {showOthers ? "Sembunyikan" : "Tampilkan"} kontak akun lain ({others.length}) — khusus super admin
            </button>
            {showOthers ? (
              others.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">Akun lain belum menyimpan kontak.</p>
              ) : othersShown.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">Tidak ada kontak akun lain yang cocok.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">{othersShown.map(row)}</ul>
              )
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ── Nama pengirim grup ──────────────────────────────────────────────────── */

function AliasRow({
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
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
          <span className="truncate">{a.displayName}</span>
          {a.role ? <Badge tone="info">{a.role}</Badge> : null}
        </p>
        <p className="truncate font-mono text-xs text-ink-muted" title={a.senderKey}>
          {formatSenderKey(a.senderKey)} <span className="font-sans">· {SENDER_KEY_LABEL[kind]}</span>
        </p>
        <p className="truncate text-xs text-ink-faint">
          {a.note ? `${a.note} · ` : ""}
          {a.createdByName ? `dinamai oleh ${a.createdByName}` : "pembuat tidak diketahui"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
          Ubah
        </Button>
        <form action={delAction}>
          <input type="hidden" name="id" value={a.id} />
          <Button type="submit" size="sm" variant="ghost">
            Lepas nama
          </Button>
        </form>
      </div>
    </li>
  );
}

function AliasSection({ aliases }: { aliases: AliasItem[] }) {
  const [editState, edit, editing] = useActionState<ContactState, FormData>(updateAliasAction, undefined);
  const [delState, del] = useActionState<ContactState, FormData>(deleteAliasAction, undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const banner = editState ?? delState;
  const shown = useMemo(
    () =>
      aliases.filter((a) =>
        matchesQuery({ name: a.displayName, detail: a.senderKey, note: `${a.role ?? ""} ${a.note ?? ""}` }, q),
      ),
    [aliases, q],
  );

  return (
    <Card>
      <CardHeader
        title={`Nama pengirim grup (${aliases.length})`}
        subtitle="Siapa pemilik nomor yang muncul di grup WhatsApp. Dipakai bersama satu perusahaan — sekali dinamai, semua ringkasan menyebut nama itu."
      />
      <CardBody className="space-y-3">
        {banner?.error ? <Banner tone="error" title={banner.error} /> : null}
        {banner?.success ? <Banner tone="success" title={banner.success} /> : null}

        {aliases.length === 0 ? (
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
        ) : (
          <>
            {aliases.length > 6 ? (
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari nama, peran, atau nomor…"
                aria-label="Cari nama pengirim"
              />
            ) : null}
            {shown.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada yang cocok.</p>
            ) : (
              <ul className="divide-y divide-border">
                {shown.map((a) =>
                  openId === a.id ? (
                    <li key={a.id} className="py-2">
                      <form
                        action={edit}
                        className="grid gap-2 rounded-md border border-border bg-surface-muted p-3 sm:grid-cols-3"
                      >
                        <input type="hidden" name="id" value={a.id} />
                        <div className="sm:col-span-3">
                          <p className="font-mono text-xs text-ink-muted">{a.senderKey}</p>
                        </div>
                        <div>
                          <Label htmlFor={`an-${a.id}`}>Nama</Label>
                          <Input id={`an-${a.id}`} name="displayName" defaultValue={a.displayName} />
                        </div>
                        <div>
                          <Label htmlFor={`ar-${a.id}`}>Peran (opsional)</Label>
                          <Input id={`ar-${a.id}`} name="role" defaultValue={a.role ?? ""} placeholder="mis. Mandor" />
                        </div>
                        <div>
                          <Label htmlFor={`at-${a.id}`}>Catatan (opsional)</Label>
                          <Input id={`at-${a.id}`} name="note" defaultValue={a.note ?? ""} />
                        </div>
                        <div className="flex items-center gap-2 sm:col-span-3">
                          <Button type="submit" size="sm" variant="secondary" loading={editing}>
                            Simpan
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                            Batal
                          </Button>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <AliasRow key={a.id} a={a} onEdit={() => setOpenId(a.id)} delAction={del} />
                  ),
                )}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
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
  return (
    <div className="space-y-4">
      <ContactSection mine={mine} others={others} canViewAll={canViewAll} />
      <AliasSection aliases={aliases} />
    </div>
  );
}
