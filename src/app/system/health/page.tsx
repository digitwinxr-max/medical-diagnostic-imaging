"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, HardDrive, Image, Monitor, KeyRound, Activity, Search, Workflow, Package, Bot, Cpu, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";

type HealthResp = {
  status: string;
  clinicalReady: boolean;
  generatedAt: string;
  latencyMs: number;
  services: Record<string, { status: string; latencyMs: number | null; detail?: string; name?: string }>;
  ctAvailable: string;
};

const ICON: Record<string, React.ElementType> = {
  postgres: Database,
  redis: HardDrive,
  orthanc: Image,
  ohif: Monitor,
  keycloak: KeyRound,
  fhir: Activity,
  dicoogle: Search,
  n8n: Workflow,
  minio: Package,
  langgraph: Bot,
};

const ORDER = ["postgres", "redis", "orthanc", "ohif", "keycloak", "fhir", "dicoogle", "n8n", "minio", "langgraph"];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    healthy: { label: "HEALTHY", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
    degraded: { label: "DEGRADED", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
    offline: { label: "OFFLINE", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
    not_configured: { label: "NOT CONFIGURED", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
    connected: { label: "HEALTHY", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
    unreachable: { label: "OFFLINE", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  };
  const v = map[status] ?? map.not_configured;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${v.cls}`}>{v.label}</span>;
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthResp | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/system/health", { cache: "no-store" });
      const j = (await r.json()) as HealthResp;
      setData(j);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 10000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  return (
    <Shell title="System Health" description="Live GeraldOS clinical infrastructure — real health checks, not configuration">
      <div className="mx-auto max-w-5xl space-y-6">
        <Card className={data?.clinicalReady ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              {data?.clinicalReady ? <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />}
              <div>
                <p className="text-sm font-semibold">
                  {loading ? "Checking…" : data?.clinicalReady ? "Clinical stack ready" : data ? "Clinical stack degraded" : "Checking…"}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {data ? `PostgreSQL · Orthanc · OHIF · Redis — ${data.clinicalReady ? "all healthy" : "check below"}` : "PostgreSQL · Orthanc · OHIF · Redis"}
                  {data?.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {data?.status ? data.status.toUpperCase() : "UNKNOWN"}
              </Badge>
              <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading} className="gap-1">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ORDER.map((key) => {
            const svc = data?.services[key];
            const Icon = ICON[key] ?? Cpu;
            const status = svc?.status ?? "not_configured";
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                        <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{svc?.name ?? key}</CardTitle>
                        <CardDescription className="text-xs capitalize">{key}</CardDescription>
                      </div>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Clock className="h-3 w-3" /> {svc?.latencyMs != null ? `${svc.latencyMs} ms` : "—"}
                    <span className="truncate" title={svc?.detail ?? ""}>
                      {svc?.detail ? `· ${svc.detail.slice(0, 80)}` : ""}
                    </span>
                  </div>
                  {key === "orthanc" && svc?.status === "healthy" && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">DICOMweb: /api/orthanc/dicom-web/studies — real CT Brain retrievable</p>
                  )}
                  {key === "ohif" && svc?.status === "healthy" && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">Viewer: http://localhost:3001 — app-config.js dicom-web present</p>
                  )}
                  {key === "langgraph" && svc?.status === "not_configured" && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Optional — start with --profile agents</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <XCircle className="h-4 w-4 text-slate-400" /> Developer Service Ports (Internal)
            </CardTitle>
            <CardDescription>Browser should use localhost:3000 — these are infrastructure only</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 font-mono text-xs md:grid-cols-3">
              {[
                ["GeraldOS", "3000"],
                ["OHIF", "3001 (internal)"],
                ["Orthanc", "8042"],
                ["PostgreSQL", "5432"],
                ["Redis", "6379"],
                ["Keycloak", "8180"],
                ["HAPI FHIR", "8090"],
                ["Dicoogle", "8095"],
                ["n8n", "5678"],
                ["MinIO", "9000 / 9001"],
                ["LangGraph", "8123 (profile agents)"],
              ].map(([name, port]) => (
                <div key={name} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                  <span className="font-sans text-xs font-medium">{name}</span>
                  <span className="text-slate-500">{port}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
