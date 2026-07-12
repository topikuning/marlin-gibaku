"use client";

import { useActionState } from "react";
import { runR2Test } from "./actions";

export function DiagnostikClient() {
  const [result, action, pending] = useActionState(runR2Test, undefined);

  return (
    <div>
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#0F766E] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#115E59] disabled:opacity-60"
        >
          {pending ? "Menguji koneksi…" : "Jalankan tes koneksi R2"}
        </button>
      </form>

      {result && (
        <div className="mt-5">
          <div
            className={`mb-4 rounded-xl border-l-4 px-4 py-3 text-sm font-semibold ${
              result.ok
                ? "border-[#16A34A] bg-[#DCFCE7] text-[#15803D]"
                : "border-[#DC2626] bg-[#FEE2E2] text-[#DC2626]"
            }`}
          >
            {result.ok
              ? "✓ Cloudflare R2 tersambung dan berfungsi. Foto akan tampil."
              : "✗ R2 belum berfungsi — foto tidak akan tampil. Lihat detail di bawah."}
          </div>

          <dl className="mb-4 grid gap-2 rounded-xl border border-[#E2E8F0] bg-white p-4 text-sm sm:grid-cols-2">
            <Info label="Endpoint (host)" value={result.endpointHost ?? "—"} />
            <Info label="Bucket" value={result.bucket ?? "—"} />
            <Info label="R2_ENDPOINT" ok={result.env.endpoint} />
            <Info label="R2_BUCKET" ok={result.env.bucket} />
            <Info label="R2_ACCESS_KEY_ID" ok={result.env.accessKey} />
            <Info label="R2_SECRET_ACCESS_KEY" ok={result.env.secretKey} />
          </dl>

          {result.steps.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
              {result.steps.map((s, i) => (
                <div key={i} className="flex items-start justify-between gap-3 border-b border-[#F1F5F9] px-4 py-2.5 last:border-0">
                  <span className="text-sm text-[#0F172A]">{s.name}</span>
                  <span className="text-right">
                    <span className={`text-sm font-semibold ${s.ok ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                      {s.ok ? "✓ OK" : "✗ Gagal"}
                    </span>
                    {s.detail && <div className="mt-0.5 max-w-[320px] text-xs text-[#DC2626]">{s.detail}</div>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {result.error && !result.steps.length && (
            <p className="mt-3 text-sm text-[#DC2626]">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ label, value, ok }: { label: string; value?: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#64748B]">{label}</dt>
      <dd className="font-medium text-[#0F172A]">
        {value !== undefined ? (
          value
        ) : ok ? (
          <span className="text-[#16A34A]">terisi ✓</span>
        ) : (
          <span className="text-[#DC2626]">kosong ✗</span>
        )}
      </dd>
    </div>
  );
}
