import { redirect } from "next/navigation";

/** URL lama — pindah ke Master Data → Kontak (DECISIONS 135, 150). */
export default function RedirectPage() {
  redirect("/master/kontak");
}
