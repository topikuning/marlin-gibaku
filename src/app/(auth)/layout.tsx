import { PitaLingkungan } from "@/components/shell/penanda-lingkungan";
import { env } from "@/lib/env";
import { labelLingkungan } from "@/lib/lingkungan";

/**
 * Halaman masuk/ganti sandi tidak memakai kerangka aplikasi, jadi penanda
 * server uji dipasang di sini (DECISIONS 640) – justru di halaman masuk orang
 * paling mudah tertukar: sandinya sama, tampilannya sama.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const penanda = labelLingkungan(env);
  return (
    <>
      {penanda ? <PitaLingkungan label={penanda} /> : null}
      {children}
    </>
  );
}
