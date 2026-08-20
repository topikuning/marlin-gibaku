import { Camera } from "lucide-react";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getKantong, getPilihanLokasi } from "@/lib/foto-cepat/queries";
import { getPolicy } from "@/lib/policy";
import { FotoCepatWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

/**
 * FOTO CEPAT — jepret dulu, itemnya belakangan (DECISIONS 253).
 *
 * Menu berdiri sendiri, sengaja TIDAK bersarang di workspace lokasi: seluruh
 * gunanya adalah bisa memotret tanpa lebih dulu menyusuri paket → lokasi →
 * laporan → item. Setiap langkah yang dipaksakan sebelum rana ditekan adalah
 * satu alasan lagi bagi mandor untuk memakai aplikasi kamera HP — dan foto dari
 * sana datang tanpa koordinat.
 */
export default async function FotoCepatPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "photo.quick");
  const locIds = await accessibleLocationIds(user);

  const [lokasi, kantong, policy] = await Promise.all([
    getPilihanLokasi(user, locIds),
    getKantong(user, locIds),
    getPolicy(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Foto Cepat"
        description="Jepret sekarang, pilih itemnya belakangan. Koordinat & jam direkam saat foto diambil – bukan saat diunggah."
      />

      {lokasi.length === 0 ? (
        <Card>
          <EmptyState
            icon={Camera}
            title="Belum ada lokasi yang bisa dipakai"
            description="Foto Cepat butuh minimal satu lokasi aktif yang jadi penugasanmu. Hubungi Site Manager atau admin."
          />
        </Card>
      ) : (
        <FotoCepatWorkspace
          lokasi={lokasi}
          kantong={kantong}
          wajibGps={policy.requirePhotoGps}
        />
      )}
    </div>
  );
}
