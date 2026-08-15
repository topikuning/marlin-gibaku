"use client";

import { useActionState, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Banner, Button, Input, Label, Combobox, StatusPill } from "@/components/ui";
import { ROLE_LABEL, creatableRoles } from "@/lib/authz";
import { formatTanggalWaktu } from "@/lib/format";
import {
  createUser,
  resetUserPassword,
  setAssignments,
  setUserActive,
  setUserRole,
  updateUserProfile,
  type UserActionState,
} from "@/lib/users/actions";
import type { UserRole } from "@/generated/prisma/enums";

type LocationOption = { id: string; name: string; company?: string | null };

/**
 * Daftar lokasi dengan pencarian (nama lokasi ATAU nama perusahaan) + centang.
 * Dipakai di form buat pengguna dan editor penugasan. Saat lokasi banyak,
 * mencari satu-satu terlalu ribet — kotak cari menyaring daftar seketika.
 */
function LocationPicker({
  locations,
  isChecked,
  columns = false,
}: {
  locations: LocationOption[];
  isChecked?: (id: string) => boolean;
  columns?: boolean;
}) {
  const [q, setQ] = useState("");
  // Cocokkan per-lokasi (bukan memfilter array) supaya SEMUA checkbox tetap
  // ter-mount — yang tak cocok cuma disembunyikan (CSS). Kalau di-unmount,
  // centang-nya hilang dari FormData saat submit.
  const needle = q.trim().toLowerCase();
  const matches = (l: LocationOption) =>
    !needle ||
    l.name.toLowerCase().includes(needle) ||
    (l.company ? l.company.toLowerCase().includes(needle) : false);
  const matchCount = useMemo(
    () => (needle ? locations.filter(matches).length : locations.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locations, needle],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nama lokasi atau perusahaan…"
          className="pl-8"
          aria-label="Cari lokasi"
        />
      </div>
      <div className="max-h-52 overflow-y-auto rounded-md border border-border p-2">
        {matchCount === 0 ? (
          <p className="px-1 py-2 text-sm text-ink-muted">Tidak ada lokasi yang cocok.</p>
        ) : null}
        <div className={columns ? "grid gap-1 sm:grid-cols-2" : "space-y-1"}>
          {locations.map((l) => (
            <label
              key={l.id}
              className={`flex items-start gap-2 text-sm ${matches(l) ? "" : "hidden"}`}
            >
              <input
                type="checkbox"
                name="locationIds"
                value={l.id}
                defaultChecked={isChecked ? isChecked(l.id) : false}
                className="mt-0.5 rounded border-border"
              />
              <span className="min-w-0">
                {l.name}
                {l.company ? <span className="block text-xs text-ink-muted">{l.company}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        {needle ? `${matchCount} dari ${locations.length} lokasi` : `${locations.length} lokasi`}
        {" · centang tetap tersimpan walau daftar difilter"}
      </p>
    </div>
  );
}
type UserRow = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  waNumber: string | null;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdByName: string | null;
  assignments: { id: string; name: string }[];
};

export function UserForm({ locations, roles }: { locations: LocationOption[]; roles: UserRole[] }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(createUser, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div>
        <Label htmlFor="u-username" required>Username</Label>
        <Input id="u-username" name="username" required autoComplete="off" />
      </div>
      <div>
        <Label htmlFor="u-fullname" required>Nama lengkap</Label>
        <Input id="u-fullname" name="fullName" required />
      </div>
      <div>
        <Label htmlFor="u-email">Email (opsional)</Label>
        <Input id="u-email" name="email" type="email" />
      </div>
      <div>
        <Label htmlFor="u-wa">Nomor WhatsApp (opsional)</Label>
        <Input id="u-wa" name="waNumber" inputMode="tel" placeholder="0812xxxxxxx / 62812xxxxxxx" />
        {/* Tanpa nomor, orang ini TIDAK dikirimi pengingat apa pun — dikatakan
            terus terang supaya "kok saya tidak dapat WA" tidak jadi misteri
            (DECISIONS 202). */}
        <p className="mt-1 text-[11px] text-ink-faint">
          Dipakai pengingat laporan harian. Dikosongkan = tidak menerima pengingat.
        </p>
      </div>
      <div>
        <Label htmlFor="u-role" required>Peran</Label>
        <Combobox id="u-role" name="role" required defaultValue={roles[0]}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="u-password" required>Password awal (min 8)</Label>
        <Input id="u-password" name="password" type="text" required minLength={8} autoComplete="off" />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Penugasan lokasi</legend>
        <LocationPicker locations={locations} />
      </fieldset>
      <Button type="submit" loading={pending}>Buat pengguna</Button>
    </form>
  );
}

function AssignmentEditor({ user, locations, onClose }: { user: UserRow; locations: LocationOption[]; onClose: () => void }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(setAssignments, undefined);
  return (
    <form action={action} className="mt-2 space-y-2 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="userId" value={user.id} />
      <LocationPicker
        locations={locations}
        columns
        isChecked={(id) => user.assignments.some((a) => a.id === id)}
      />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={pending}>Simpan penugasan</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>Tutup</Button>
      </div>
    </form>
  );
}

function EditProfile({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(updateUserProfile, undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <div className="w-full"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="w-full"><Banner tone="success" title={state.success} /></div> : null}
      <input type="hidden" name="userId" value={user.id} />
      <div>
        <Label htmlFor={`ep-name-${user.id}`}>Nama lengkap</Label>
        <Input id={`ep-name-${user.id}`} name="fullName" defaultValue={user.fullName} minLength={2} maxLength={120} required className="w-56" />
      </div>
      <div>
        <Label htmlFor={`ep-email-${user.id}`}>Email (opsional)</Label>
        <Input id={`ep-email-${user.id}`} name="email" type="email" defaultValue={user.email ?? ""} className="w-56" />
      </div>
      <div>
        <Label htmlFor={`ep-wa-${user.id}`}>Nomor WhatsApp</Label>
        <Input
          id={`ep-wa-${user.id}`}
          name="waNumber"
          inputMode="tel"
          defaultValue={user.waNumber ?? ""}
          placeholder="0812xxxxxxx"
          className="w-56"
        />
      </div>
      <Button size="sm" type="submit" loading={pending}>Simpan</Button>
      <Button size="sm" type="button" variant="ghost" onClick={onClose}>Tutup</Button>
    </form>
  );
}

function ResetPassword({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(resetUserPassword, undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="userId" value={userId} />
      <div>
        <Label htmlFor={`rp-${userId}`}>Password baru</Label>
        <Input id={`rp-${userId}`} name="password" type="text" minLength={8} required className="w-48" />
      </div>
      <Button size="sm" type="submit" loading={pending}>Reset</Button>
      <Button size="sm" type="button" variant="ghost" onClick={onClose}>Tutup</Button>
    </form>
  );
}

/**
 * Ganti peran akun (DECISIONS 200). Pilihan peran DIBATASI ke peran yang boleh
 * dibuat aktor — sama seperti form pembuatan user, supaya tidak ada jalur
 * "ganti peran" yang lebih longgar daripada "buat user". Server tetap
 * memeriksa ulang; daftar ini hanya supaya yang tidak mungkin tidak ditawarkan.
 */
function RoleEditor({
  user,
  allowedRoles,
  onClose,
}: {
  user: UserRow;
  allowedRoles: UserRole[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(setUserRole, undefined);
  return (
    <form action={action} className="mt-2 space-y-2 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="userId" value={user.id} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`role-${user.id}`}>Peran baru</Label>
          <Combobox id={`role-${user.id}`} name="role" defaultValue={user.role} className="w-56">
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Combobox>
        </div>
        <Button size="sm" type="submit" loading={pending}>
          Ganti peran
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        Peran menentukan APA yang boleh dilakukan; penugasan lokasi menentukan DI MANA — penugasan
        tidak ikut berubah. Sesi lama akun ini akan dicabut, jadi ia harus masuk ulang.
      </p>
    </form>
  );
}

export function UsersTable({
  users,
  locations,
  canManage,
  actorRole,
}: {
  users: UserRow[];
  locations: LocationOption[];
  canManage: boolean;
  actorRole: UserRole;
}) {
  const [open, setOpen] = useState<{ id: string; panel: "assign" | "reset" | "profile" | "role" } | null>(null);
  const allowedRoles = useMemo(() => creatableRoles(actorRole), [actorRole]);
  // Hasil "Nonaktifkan/Aktifkan" per BARIS. Aksi ini tidak punya formulir
  // sendiri, jadi tanpa ini penolakannya tidak punya tempat untuk muncul —
  // dan sebelumnya memang tidak muncul sama sekali: ia jatuh ke error boundary
  // sebagai layar putih (laporan produksi 2026-08-15).
  const [aktifMsg, setAktifMsg] = useState<{ id: string; tone: "success" | "error"; text: string } | null>(
    null,
  );
  if (users.length === 0) {
    return <p className="text-sm text-ink-muted">Belum ada pengguna.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {users.map((u) => (
        <div key={u.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* min-w-0: tanpa ini blok identitas memakai lebar max-content —
                "Lokasi: A, B, C…" + "Login terakhir …" berjejer jadi 470px dan
                MELEBARKAN HALAMAN di 375px, walau baris di dalamnya sudah
                flex-wrap. Wrap baru bekerja setelah induknya boleh menyempit.
                DECISIONS 217. */}
            <div className="min-w-0">
              <div className="font-medium text-ink">
                {u.fullName} <span className="ml-1 text-sm text-ink-muted">@{u.username}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <StatusPill tone="info" label={ROLE_LABEL[u.role]} />
                {!u.isActive && <StatusPill tone="danger" label="Nonaktif" />}
                {u.mustChangePassword && <StatusPill tone="warning" label="Wajib ganti password" />}
                <span>
                  {u.assignments.length > 0
                    ? `Lokasi: ${u.assignments.map((a) => a.name).join(", ")}`
                    : "Tanpa penugasan"}
                </span>
                <span>Dibuat oleh: {u.createdByName ?? "—"}</span>
                {u.lastLoginAt && <span>Login terakhir {formatTanggalWaktu(new Date(u.lastLoginAt))}</span>}
              </div>
            </div>
            {canManage && (
              // flex-wrap: lima tombol aksi berjejer = 527px, jauh di atas
              // layar 375px. Tanpa wrap, barisnya melebarkan halaman.
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setOpen(open?.id === u.id && open.panel === "profile" ? null : { id: u.id, panel: "profile" })}
                >
                  Edit nama
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setOpen(open?.id === u.id && open.panel === "assign" ? null : { id: u.id, panel: "assign" })}
                >
                  Penugasan
                </Button>
                {allowedRoles.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setOpen(open?.id === u.id && open.panel === "role" ? null : { id: u.id, panel: "role" })}
                  >
                    Ganti peran
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setOpen(open?.id === u.id && open.panel === "reset" ? null : { id: u.id, panel: "reset" })}
                >
                  Reset password
                </Button>
                <form
                  action={async () => {
                    setAktifMsg(null);
                    const r = await setUserActive(u.id, !u.isActive);
                    if (r?.error) setAktifMsg({ id: u.id, tone: "error", text: r.error });
                    else if (r?.success) setAktifMsg({ id: u.id, tone: "success", text: r.success });
                  }}
                >
                  <Button size="sm" variant={u.isActive ? "danger" : "primary"} type="submit">
                    {u.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </form>
              </div>
            )}
          </div>
          {aktifMsg?.id === u.id && (
            <div className="mt-2">
              <Banner tone={aktifMsg.tone} title={aktifMsg.text} />
            </div>
          )}
          {canManage && open?.id === u.id && open.panel === "profile" && (
            <EditProfile user={u} onClose={() => setOpen(null)} />
          )}
          {canManage && open?.id === u.id && open.panel === "assign" && (
            <AssignmentEditor user={u} locations={locations} onClose={() => setOpen(null)} />
          )}
          {canManage && open?.id === u.id && open.panel === "role" && (
            <RoleEditor user={u} allowedRoles={allowedRoles} onClose={() => setOpen(null)} />
          )}
          {canManage && open?.id === u.id && open.panel === "reset" && (
            <ResetPassword userId={u.id} onClose={() => setOpen(null)} />
          )}
        </div>
      ))}
    </div>
  );
}
