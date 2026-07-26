import { redirect } from "next/navigation";

/** URL lama — pindah ke menu Master Data (DECISIONS 135). */
export default function RedirectPage() {
  redirect("/master/pengguna");
}
