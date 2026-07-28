import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  PrototypeApp,
  type PrototypeView,
} from "@/components/prototype/ui-rebuild/prototype-app";

export const metadata: Metadata = {
  title: "Prototype UI Rebuild",
  description: "Prototype interaktif command centre MARLIN dengan data mock.",
};

const PROTOTYPE_VIEWS = new Set<PrototypeView>([
  "command",
  "actions",
  "locations",
  "location",
  "report",
  "progress",
  "ai",
]);

export default async function UiRebuildPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (process.env.ENABLE_UI_PROTOTYPE !== "true") notFound();
  const params = await searchParams;
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialView = requestedView && PROTOTYPE_VIEWS.has(requestedView as PrototypeView)
    ? requestedView as PrototypeView
    : "command";
  return <PrototypeApp initialView={initialView} />;
}
