import { redirect } from "next/navigation";

/** URL lama — kontak WA & nama pengirim kini satu halaman (DECISIONS 150). */
export default function RedirectPage() {
  redirect("/administrasi/kontak");
}
