"use client";

import { useActionState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Input, Label } from "@/components/ui";
import {
  addWaContactAction,
  deleteWaContactAction,
  type ContactState,
} from "@/lib/exec-report/actions";

type Contact = { id: string; name: string; chatId: string; note: string | null };

/** Kelola kontak WA: daftar + tambah + hapus. Nomor polos dinormalisasi server. */
export function KontakWaClient({ contacts }: { contacts: Contact[] }) {
  const [addState, addAction, adding] = useActionState<ContactState, FormData>(addWaContactAction, undefined);
  const [delState, delAction] = useActionState<ContactState, FormData>(deleteWaContactAction, undefined);
  const banner = addState ?? delState;

  return (
    <Card>
      <CardHeader
        title={`Kontak tersimpan (${contacts.length})`}
        subtitle="Nomor WA pribadi (628…), kontak (…@c.us), atau grup (…@g.us)."
      />
      <CardBody className="space-y-3">
        {banner?.error ? <Banner tone="error" title={banner.error} /> : null}
        {banner?.success ? <Banner tone="success" title={banner.success} /> : null}

        {contacts.length > 0 ? (
          <ul className="divide-y divide-border">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                  <p className="truncate font-mono text-xs text-ink-muted">{c.chatId}</p>
                  {c.note ? <p className="truncate text-xs text-ink-faint">{c.note}</p> : null}
                </div>
                <form action={delAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Hapus
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Belum ada kontak — tambahkan di bawah.</p>
        )}

        <form action={addAction} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <Label htmlFor="kw-name">Nama</Label>
            <Input id="kw-name" name="name" placeholder="mis. Direksi / Grup PPK" />
          </div>
          <div>
            <Label htmlFor="kw-chat">Nomor WA / ID grup</Label>
            <Input id="kw-chat" name="chatId" placeholder="628123… atau 12036…@g.us" />
          </div>
          <div>
            <Label htmlFor="kw-note">Catatan (opsional)</Label>
            <Input id="kw-note" name="note" placeholder="mis. laporan mingguan" />
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
      </CardBody>
    </Card>
  );
}
