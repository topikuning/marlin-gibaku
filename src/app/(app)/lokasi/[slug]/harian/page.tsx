import { redirect } from "next/navigation";
import { parseLogDate } from "@/lib/daily-log";

/** Redirect ke laporan harian tanggal tertentu (?d=YYYY-MM-DD) atau hari ini (WIB). */
export default async function HarianIndex({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { slug } = await params;
  const { d } = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const date = d && parseLogDate(d) ? d : today;
  redirect(`/lokasi/${slug}/harian/${date}`);
}
