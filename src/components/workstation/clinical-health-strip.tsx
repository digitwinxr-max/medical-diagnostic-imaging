"use client";

import React, { useEffect, useState } from "react";

type HealthItem = {
  key: string;
  name: string;
  status: "connected" | "unreachable" | "not_configured";
  latencyMs: number | null;
};

export function ClinicalHealthStrip({ onOpenDrawer }: { onOpenDrawer?: () => void }) {
  const [items, setItems] = useState<HealthItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/integrations/status", { cache: "no-store" });
      const d = await res.json();
      const list: HealthItem[] = d.integrations ?? [];
      // Filter to clinical stack + optional
      const wanted = ["postgres", "orthanc", "ohif", "redis", "minio", "keycloak", "fhir", "n8n", "dicoogle", "langgraph"];
      // Also include postgres via dbHealth key
      setItems(list.filter((x) => wanted.includes(x.key) || x.key === "postgres"));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 15000);
    return () => clearInterval(t);
  }, []);

  const dot = (s: HealthItem["status"]) =>
    s === "connected"
      ? "bg-emerald-500"
      : s === "unreachable"
        ? "bg-red-500"
        : "bg-slate-400";

  const clinicalKeys = ["postgres", "orthanc", "ohif", "redis"];
  const clinical = items.filter((i) => clinicalKeys.includes(i.key));
  const allConnected = clinical.length > 0 && clinical.every((i) => i.status === "connected");
  const anyUnreachable = clinical.some((i) => i.status === "unreachable");

  return (
    <div
      onClick={onOpenDrawer}
      title="Click for diagnostics"
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
        onOpenDrawer ? "cursor-pointer hover:bg-white/10" : ""
      } ${
        anyUnreachable
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          : allConnected
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      }`}
    >
      <span className="hidden font-semibold uppercase tracking-wide md:inline">GeraldOS Local Clinical Stack</span>
      <span className="font-semibold uppercase tracking-wide md:hidden">Clinical Stack</span>
      <span className="mx-1 hidden h-3 w-px bg-current opacity-20 md:block" />
      <span className="flex items-center gap-1.5">
        {loading
          ? "Checking…"
          : clinical.map((it) => (
              <span key={it.key} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${dot(it.status)}`} />
                {it.key === "postgres" ? "Database" : it.key === "orthanc" ? "Orthanc" : it.key === "ohif" ? "OHIF" : it.key === "redis" ? "Redis" : it.name}
              </span>
            ))}
        {clinical.length === 0 && !loading && <span>Database · Orthanc · DICOMweb · OHIF · Redis</span>}
      </span>
      <span className="hidden text-[9px] opacity-70 md:inline">
        {anyUnreachable ? "· check diagnostics" : allConnected ? "· ready" : ""}
      </span>
    </div>
  );
}
