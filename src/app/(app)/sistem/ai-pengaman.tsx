"use client";

import { Banner, Button, Combobox, HelpText, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { simpanPengamanAiAction, type AiActionState } from "@/lib/ai/actions";

/**
 * Pengaman AI (DECISIONS 635): provider cadangan + penerima alarm kegagalan.
 * Keduanya kosong secara bawaan – mengisinya adalah keputusan sadar admin.
 */
export function AiPengamanPanel({
  providers,
  activeProvider,
  fallbackProvider,
  alertChatId,
}: {
  providers: { id: string; label: string; hasApiKey: boolean }[];
  activeProvider: string | null;
  fallbackProvider: string | null;
  alertChatId: string;
}) {
  const [state, action, pending] = useAksi<AiActionState>(simpanPengamanAiAction, undefined);
  const pilihan = providers.filter((p) => p.hasApiKey && p.id !== activeProvider);
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ai-cadangan">Provider cadangan</Label>
          <Combobox id="ai-cadangan" name="fallbackProvider" defaultValue={fallbackProvider ?? ""}>
            <option value="">– tidak ada –</option>
            {pilihan.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Combobox>
          <HelpText>
            Dipakai sekali kalau provider utama menolak karena kuota, saldo, API key, nama model, atau gangguan
            sementara. Saat itu data proyek, termasuk teks grup WhatsApp, ikut terkirim ke vendor ini.
            {providers.length - pilihan.length > 1
              ? ` Hanya provider yang API key-nya sudah disimpan dan bukan provider aktif yang bisa dipilih.`
              : ""}
          </HelpText>
        </div>
        <div>
          <Label htmlFor="ai-alarm">Grup WhatsApp penerima alarm</Label>
          <Input id="ai-alarm" name="alertChatId" defaultValue={alertChatId} placeholder="1203630…@g.us" />
          <HelpText>
            Menerima pesan bila 5 permintaan AI beruntun gagal atau lebih dari 20% gagal dalam 60 menit. Kalau
            dikosongkan, peringatannya hanya berupa spanduk merah di layar dan catatan audit.
          </HelpText>
        </div>
      </div>
      <Button type="submit" size="sm" loading={pending}>
        Simpan pengaman
      </Button>
    </form>
  );
}
