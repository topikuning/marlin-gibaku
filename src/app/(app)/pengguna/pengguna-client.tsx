"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Input, Label, Select, StatusPill } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/authz";
import { formatTanggalWaktu } from "@/lib/format";
import {
  createUser,
  resetUserPassword,
  setAssignments,
  setUserActive,
  type UserActionState,
} from "@/lib/users/actions";
import type { UserRole } from "@/generated/prisma/enums";

type LocationOption = { id: string; name: string };
type UserRow = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
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
        <Label htmlFor="u-role" required>Peran</Label>
        <Select id="u-role" name="role" required defaultValue={roles[0]}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="u-password" required>Password awal (min 8)</Label>
        <Input id="u-password" name="password" type="text" required minLength={8} autoComplete="off" />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Penugasan lokasi</legend>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {locations.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="locationIds" value={l.id} className="rounded border-border" />
              {l.name}
            </label>
          ))}
        </div>
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
      <div className="grid gap-1 sm:grid-cols-2">
        {locations.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="locationIds"
              value={l.id}
              defaultChecked={user.assignments.some((a) => a.id === l.id)}
              className="rounded border-border"
            />
            {l.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={pending}>Simpan penugasan</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>Tutup</Button>
      </div>
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

export function UsersTable({
  users,
  locations,
  canManage,
}: {
  users: UserRow[];
  locations: LocationOption[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState<{ id: string; panel: "assign" | "reset" } | null>(null);
  if (users.length === 0) {
    return <p className="text-sm text-ink-muted">Belum ada pengguna.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {users.map((u) => (
        <div key={u.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
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
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setOpen(open?.id === u.id && open.panel === "assign" ? null : { id: u.id, panel: "assign" })}
                >
                  Penugasan
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setOpen(open?.id === u.id && open.panel === "reset" ? null : { id: u.id, panel: "reset" })}
                >
                  Reset password
                </Button>
                <form
                  action={async () => {
                    await setUserActive(u.id, !u.isActive);
                  }}
                >
                  <Button size="sm" variant={u.isActive ? "danger" : "primary"} type="submit">
                    {u.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </form>
              </div>
            )}
          </div>
          {canManage && open?.id === u.id && open.panel === "assign" && (
            <AssignmentEditor user={u} locations={locations} onClose={() => setOpen(null)} />
          )}
          {canManage && open?.id === u.id && open.panel === "reset" && (
            <ResetPassword userId={u.id} onClose={() => setOpen(null)} />
          )}
        </div>
      ))}
    </div>
  );
}
