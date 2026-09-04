"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useMemo, useState } from "react";
import { Plus, Search, Settings2 } from "lucide-react";
import { Badge, Banner, Button, Combobox, Input, KpiCard, Label, TombolKirim } from "@/components/ui";
import { BilahSaring } from "@/components/master/bilah-saring";
import { Laci } from "@/components/master/laci";
import { PerluPerhatian, type TemuanMaster } from "@/components/master/perlu-perhatian";
import { KartuBaris, SelNama } from "@/components/master/sel-nama";
import { ALL_ROLES, ROLE_LABEL, creatableRoles } from "@/lib/authz";
import { formatTanggalWaktu } from "@/lib/format";
import { nomorWaUntukTampil } from "@/lib/contacts/model";
import { LABEL_MASALAH, masalahAkun, type MasalahAkun } from "@/lib/users/kesehatan-akun";
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

/**
 * DAFTAR PENGGUNA — tata letak master data (DECISIONS 359).
 *
 * Bentuknya sama dengan Perusahaan, dan itu disengaja: ringkasan angka, bilah
 * "perlu perhatian", lalu daftar bersaringan, dengan seluruh pengubahan di
 * dalam LACI. Sebelumnya tiap baris punya lima tombol yang membentangkan
 * formulir DI DALAM daftar, sehingga sesudah menyimpan barisnya melompat dan
 * orang kehilangan tempatnya.
 *
 * Yang paling berubah maknanya: "Tanpa penugasan" dulu sekadar tulisan abu-abu
 * di antara tulisan abu-abu lain. Ia sebetulnya berarti akun itu TIDAK BISA
 * MELIHAT APA PUN — jadi sekarang ia dihitung, disebut di atas, dan bisa
 * disaring (`@/lib/users/kesehatan-akun`).
 */

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
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
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

export type UserRow = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  waNumber: string | null;
  waLid: string | null;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdByName: string | null;
  /** Super admin UTAMA — ditetapkan di env, tidak bisa disentuh dari UI (DECISIONS 315). */
  akar: boolean;
  assignments: { id: string; name: string }[];
};

/* ── Daftar ──────────────────────────────────────────────────────────────── */

type Saring = "" | MasalahAkun | "sehat";

export function PenggunaManager({
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
  const [cari, setCari] = useState("");
  const [saring, setSaring] = useState<Saring>("");
  const [saringPeran, setSaringPeran] = useState("");
  // Yang disimpan ID, bukan barisnya. Sesudah sebuah aksi tersimpan, `users`
  // datang baru dari server; menyimpan objek lama membuat laci menampilkan
  // data basi persis pada saat orang ingin memastikan simpanannya masuk.
  const [idBuka, setIdBuka] = useState<string | null>(null);
  const [buatBaru, setBuatBaru] = useState(false);
  const allowedRoles = useMemo(() => creatableRoles(actorRole), [actorRole]);

  const diperkaya = useMemo(
    () =>
      users.map((u) => ({
        u,
        masalah: masalahAkun({
          role: u.role,
          isActive: u.isActive,
          mustChangePassword: u.mustChangePassword,
          waNumber: u.waNumber,
          jumlahPenugasan: u.assignments.length,
          pernahMasuk: u.lastLoginAt !== null,
        }),
      })),
    [users],
  );

  const shown = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return diperkaya.filter((r) => {
      if (q) {
        const hay = [r.u.fullName, r.u.username, r.u.email, r.u.waNumber, ...r.u.assignments.map((a) => a.name)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (saringPeran && r.u.role !== saringPeran) return false;
      if (saring === "sehat") return r.masalah.length === 0;
      if (saring) return r.masalah.includes(saring);
      return true;
    });
  }, [diperkaya, cari, saring, saringPeran]);

  const hitung = (m: MasalahAkun) => diperkaya.filter((r) => r.masalah.includes(m)).length;
  const aktif = diperkaya.filter((r) => r.u.isActive).length;
  const tanpaPenugasan = hitung("tanpa_penugasan");
  const belumDipakai = hitung("belum_dipakai");
  const tanpaWa = hitung("tanpa_wa");

  const temuan: TemuanMaster[] = [];
  if (tanpaPenugasan > 0) {
    temuan.push({
      judul: `${tanpaPenugasan} dari ${aktif} akun aktif tanpa penugasan`,
      keterangan:
        "Perannya terikat lokasi, jadi tanpa penugasan akun ini masuk ke MARLIN dan tidak melihat apa pun.",
      nada: "bahaya",
      aksi: <TombolSaring onKlik={() => setSaring("tanpa_penugasan")} label="Lihat yang tanpa penugasan" />,
    });
  }
  if (belumDipakai > 0) {
    temuan.push({
      judul: `${belumDipakai} akun belum pernah dipakai`,
      keterangan: "Password awalnya masih yang diketik pembuatnya dan belum pernah diganti.",
      nada: "peringatan",
      aksi: <TombolSaring onKlik={() => setSaring("belum_dipakai")} label="Lihat yang belum dipakai" />,
    });
  }
  if (tanpaWa > 0) {
    temuan.push({
      judul: `${tanpaWa} akun tanpa nomor WhatsApp`,
      keterangan: "Tidak menerima pengingat laporan harian maupun balasan chat MARLIN.",
      aksi: <TombolSaring onKlik={() => setSaring("tanpa_wa")} label="Lihat yang tanpa nomor" />,
    });
  }

  const dibuka = idBuka ? (users.find((u) => u.id === idBuka) ?? null) : null;

  return (
    <div className="space-y-3">
      <section aria-label="Ringkasan pengguna" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total akun" value={String(diperkaya.length)} sub={`${aktif} aktif`} />
        <KpiCard
          label="Tanpa penugasan"
          value={String(tanpaPenugasan)}
          sub={tanpaPenugasan > 0 ? "Tidak melihat lokasi apa pun" : "Semua terhubung lokasi"}
          tone={tanpaPenugasan > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="Belum pernah masuk"
          value={String(belumDipakai)}
          sub={belumDipakai > 0 ? "Password awal masih beredar" : "Tidak ada"}
          tone={belumDipakai > 0 ? "warning" : "default"}
        />
        <KpiCard label="Tanpa nomor WA" value={String(tanpaWa)} sub="Tidak dapat pengingat" />
      </section>

      <PerluPerhatian temuan={temuan} />

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <BilahSaring
          cari={cari}
          onCari={setCari}
          petunjukCari="Cari nama, username, email, nomor, lokasi…"
          tampil={shown.length}
          total={diperkaya.length}
          satuan="akun"
          saringan={[
            {
              id: "u-peran",
              label: "Semua peran",
              nilai: saringPeran,
              onUbah: setSaringPeran,
              // Hanya peran yang BENAR-BENAR ada di daftar. Menawarkan peran
              // yang pasti nihil membuat saringan terasa rusak saat dipilih.
              opsi: ALL_ROLES.filter((r) => users.some((u) => u.role === r)).map((r) => ({
                nilai: r,
                label: ROLE_LABEL[r],
              })),
            },
            {
              id: "u-masalah",
              label: "Semua kondisi",
              nilai: saring,
              onUbah: (v) => setSaring(v as Saring),
              opsi: [
                { nilai: "tanpa_penugasan", label: LABEL_MASALAH.tanpa_penugasan },
                { nilai: "belum_dipakai", label: LABEL_MASALAH.belum_dipakai },
                { nilai: "tanpa_wa", label: LABEL_MASALAH.tanpa_wa },
                { nilai: "nonaktif", label: LABEL_MASALAH.nonaktif },
                { nilai: "sehat", label: "Tanpa masalah" },
              ],
            },
          ]}
          aksi={
            allowedRoles.length > 0 ? (
              <Button size="sm" onClick={() => setBuatBaru(true)}>
                <Plus aria-hidden className="size-3.5" />
                Pengguna baru
              </Button>
            ) : null
          }
        />

        {shown.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">
            {diperkaya.length === 0
              ? "Belum ada pengguna."
              : "Tidak ada akun yang cocok dengan saringan ini."}
          </p>
        ) : (
          <>
            <div className="max-sm:hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-[11px] text-ink-muted uppercase">
                    <th className="px-3 py-2">Pengguna</th>
                    <th className="px-3 py-2">Peran</th>
                    <th className="px-3 py-2">Penugasan</th>
                    <th className="px-3 py-2">Login terakhir</th>
                    {canManage ? <th className="px-3 py-2">Aksi</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => (
                    <tr key={r.u.id} className="align-top hover:bg-surface-muted">
                      <td className="px-3 py-2">
                        <SelNama
                          nama={r.u.fullName}
                          keterangan={`@${r.u.username}`}
                          lencana={<Lencana u={r.u} masalah={r.masalah} />}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{ROLE_LABEL[r.u.role]}</td>
                      <td className="px-3 py-2">{ringkasLokasi(r.u.assignments)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                        {r.u.lastLoginAt ? formatTanggalWaktu(new Date(r.u.lastLoginAt)) : "Belum pernah"}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2">
                          <Button size="sm" variant="secondary" onClick={() => setIdBuka(r.u.id)}>
                            <Settings2 aria-hidden className="size-3.5" />
                            Kelola
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-2 sm:hidden">
              {shown.map((r) => (
                <KartuBaris
                  key={r.u.id}
                  aksi={
                    canManage ? (
                      <Button size="sm" variant="secondary" onClick={() => setIdBuka(r.u.id)}>
                        <Settings2 aria-hidden className="size-3.5" />
                        Kelola
                      </Button>
                    ) : null
                  }
                >
                  <SelNama
                    nama={r.u.fullName}
                    keterangan={`@${r.u.username} · ${ROLE_LABEL[r.u.role]}`}
                    lencana={<Lencana u={r.u} masalah={r.masalah} />}
                  />
                  <p className="mt-1.5 text-[11px] text-ink-muted">
                    {ringkasLokasi(r.u.assignments)} ·{" "}
                    {r.u.lastLoginAt
                      ? `login ${formatTanggalWaktu(new Date(r.u.lastLoginAt))}`
                      : "belum pernah masuk"}
                  </p>
                </KartuBaris>
              ))}
            </div>
          </>
        )}
      </section>

      <Laci
        buka={dibuka !== null && canManage}
        onTutup={() => setIdBuka(null)}
        judul={dibuka?.fullName ?? "Pengguna"}
        keterangan={dibuka ? `@${dibuka.username} · ${ROLE_LABEL[dibuka.role]}` : undefined}
      >
        {dibuka ? (
          <PanelKelola user={dibuka} locations={locations} allowedRoles={allowedRoles} />
        ) : null}
      </Laci>

      <Laci
        buka={buatBaru}
        onTutup={() => setBuatBaru(false)}
        judul="Pengguna baru"
        keterangan="Password awal wajib diganti sendiri saat login pertama."
      >
        <UserForm locations={locations} roles={allowedRoles} />
      </Laci>
    </div>
  );
}

function TombolSaring({ onKlik, label }: { onKlik: () => void; label: string }) {
  return (
    <Button size="sm" variant="secondary" onClick={onKlik}>
      {label}
    </Button>
  );
}

function Lencana({ u, masalah }: { u: UserRow; masalah: MasalahAkun[] }) {
  return (
    <>
      {u.akar ? (
        <span title="Ditetapkan lewat SUPER_ADMIN_UTAMA. Akun ini tidak bisa dinonaktifkan, diturunkan, atau direset dari layar mana pun – ubah variabel lingkungannya lebih dulu.">
          <Badge tone="success" label="Super admin utama" />
        </span>
      ) : null}
      {masalah.map((m) => (
        <Badge
          key={m}
          tone={m === "nonaktif" || m === "tanpa_penugasan" ? "danger" : "warning"}
          label={LABEL_MASALAH[m]}
        />
      ))}
    </>
  );
}

/** Sebut dua lokasi lalu "+N lagi" — daftar penuh membuat barisnya setinggi paragraf. */
function ringkasLokasi(assignments: { name: string }[], batas = 2): string {
  if (assignments.length === 0) return "Tanpa penugasan";
  const nama = assignments.map((a) => a.name);
  if (nama.length <= batas) return nama.join(", ");
  return `${nama.slice(0, batas).join(", ")} +${nama.length - batas} lagi`;
}

/* ── Isi laci ────────────────────────────────────────────────────────────── */

function Bagian({ judul, keterangan, children }: { judul: string; keterangan?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <p className="text-[13px] font-semibold text-ink">{judul}</p>
      {keterangan ? <p className="mt-0.5 mb-2 text-[11px] text-ink-muted">{keterangan}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function PanelKelola({
  user,
  locations,
  allowedRoles,
}: {
  user: UserRow;
  locations: LocationOption[];
  allowedRoles: UserRole[];
}) {
  return (
    <div className="space-y-4">
      <Bagian judul="Identitas" keterangan="Nama, email, dan nomor yang dipakai MARLIN untuk menghubunginya.">
        <EditProfile user={user} />
      </Bagian>

      {allowedRoles.length > 0 ? (
        <Bagian
          judul="Peran"
          keterangan="Peran menentukan APA yang boleh dilakukan; penugasan menentukan DI MANA. Sesi lama akun ini dicabut, jadi ia harus masuk ulang."
        >
          <RoleEditor user={user} allowedRoles={allowedRoles} />
        </Bagian>
      ) : null}

      <Bagian judul="Penugasan lokasi" keterangan="Lokasi yang boleh dilihat dan dilaporkan akun ini.">
        <AssignmentEditor user={user} locations={locations} />
      </Bagian>

      <Bagian judul="Password" keterangan="Password baru selalu wajib diganti sendiri saat login berikutnya.">
        <ResetPassword userId={user.id} />
      </Bagian>

      <Bagian judul="Status akun" keterangan="Akun nonaktif tidak bisa masuk; datanya tetap utuh.">
        <TombolAktif user={user} />
      </Bagian>
    </div>
  );
}

export function UserForm({ locations, roles }: { locations: LocationOption[]; roles: UserRole[] }) {
  const [state, action, pending] = useAksi<UserActionState>(createUser, undefined);
  if (roles.length === 0) {
    return <p className="text-sm text-ink-muted">Anda tidak berwenang membuat pengguna.</p>;
  }
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

function AssignmentEditor({ user, locations }: { user: UserRow; locations: LocationOption[] }) {
  const [state, action, pending] = useAksi<UserActionState>(setAssignments, undefined);
  return (
    <form action={action} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="userId" value={user.id} />
      <LocationPicker
        locations={locations}
        isChecked={(id) => user.assignments.some((a) => a.id === id)}
      />
      <Button size="sm" type="submit" loading={pending}>Simpan penugasan</Button>
    </form>
  );
}

function EditProfile({ user }: { user: UserRow }) {
  const [state, action, pending] = useAksi<UserActionState>(updateUserProfile, undefined);
  return (
    <form action={action} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="userId" value={user.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`ep-name-${user.id}`}>Nama lengkap</Label>
          <Input id={`ep-name-${user.id}`} name="fullName" defaultValue={user.fullName} minLength={2} maxLength={120} required />
        </div>
        <div>
          <Label htmlFor={`ep-email-${user.id}`}>Email (opsional)</Label>
          <Input id={`ep-email-${user.id}`} name="email" type="email" defaultValue={user.email ?? ""} />
        </div>
        <div>
          <Label htmlFor={`ep-wa-${user.id}`}>Nomor WhatsApp</Label>
          <Input
            id={`ep-wa-${user.id}`}
            name="waNumber"
            inputMode="tel"
            defaultValue={nomorWaUntukTampil(user.waNumber)}
            placeholder="0812xxxxxxx"
          />
        </div>

      </div>
      <Button size="sm" type="submit" loading={pending}>Simpan identitas</Button>
    </form>
  );
}

function ResetPassword({ userId }: { userId: string }) {
  const [state, action, pending] = useAksi<UserActionState>(resetUserPassword, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {state?.error ? <div className="w-full"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="w-full"><Banner tone="success" title={state.success} /></div> : null}
      <input type="hidden" name="userId" value={userId} />
      <div className="min-w-0 flex-1">
        <Label htmlFor={`rp-${userId}`}>Password baru (min 8)</Label>
        <Input id={`rp-${userId}`} name="password" type="text" minLength={8} required />
      </div>
      <Button size="sm" type="submit" loading={pending}>Reset</Button>
    </form>
  );
}

/**
 * Ganti peran akun (DECISIONS 200). Pilihan peran DIBATASI ke peran yang boleh
 * dibuat aktor — sama seperti form pembuatan user, supaya tidak ada jalur
 * "ganti peran" yang lebih longgar daripada "buat user". Server tetap
 * memeriksa ulang; daftar ini hanya supaya yang tidak mungkin tidak ditawarkan.
 */
function RoleEditor({ user, allowedRoles }: { user: UserRow; allowedRoles: UserRole[] }) {
  const [state, action, pending] = useAksi<UserActionState>(setUserRole, undefined);
  return (
    <form action={action} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="userId" value={user.id} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`role-${user.id}`}>Peran baru</Label>
          <Combobox id={`role-${user.id}`} name="role" defaultValue={user.role}>
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
      </div>
    </form>
  );
}

/**
 * Nonaktifkan/Aktifkan. Hasilnya ditampilkan DI SINI — aksi ini tidak punya
 * formulir sendiri, jadi tanpa tempat ini penolakannya tidak punya tempat untuk
 * muncul, dan sebelumnya memang jatuh ke error boundary sebagai layar putih
 * (laporan produksi 2026-08-15).
 */
function TombolAktif({ user }: { user: UserRow }) {
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <div className="space-y-2">
      {pesan ? <Banner tone={pesan.tone} title={pesan.text} /> : null}
      <form
        action={async () => {
          setPesan(null);
          const r = await setUserActive(user.id, !user.isActive);
          if (r?.error) setPesan({ tone: "error", text: r.error });
          else if (r?.success) setPesan({ tone: "success", text: r.success });
        }}
      >
        <TombolKirim
          size="sm"
          variant={user.isActive ? "danger" : "primary"}
          labelSibuk={user.isActive ? "Menonaktifkan…" : "Mengaktifkan…"}
        >
          {user.isActive ? "Nonaktifkan akun" : "Aktifkan akun"}
        </TombolKirim>
      </form>
    </div>
  );
}
