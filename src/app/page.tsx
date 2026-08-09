"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  Calendar,
  Activity,
  AlertTriangle,
  FileText,
  TrendingUp,
  Clock,
  Monitor,
  Wrench,
  Package,
  Radio,
  ArrowRight,
  ScanSearch,
  GitBranch,
  Cpu,
  Stethoscope,
  Zap,
  RefreshCw,
} from "lucide-react";
import { cn, formatPula } from "@/lib/utils";

interface Snapshot {
  ok: boolean;
  generatedAt: string;
  kpis: {
    patientsToday: number;
    appointmentsToday: number;
    checkedIn: number;
    activeStudies: number;
    pendingReports: number;
    emergencyCases: number;
    revenueToday: number;
    lowStockAlerts: number;
    maintenanceOpen: number;
    equipmentOperational: number;
    equipmentTotal: number;
  };
  patientFlow: { stage: string; count: number }[];
  queue: { equipmentName: string; modality: string; waiting: number; inProgress: number; status: string }[];
  machineUtilisation: { equipmentName: string; modality: string; utilisation: number; status: string }[];
  radiologistWorkload: { name: string; assigned: number; signedToday: number }[];
  referralSources: { physician: string; count: number }[];
  appointmentDelays: { id: string; patientName: string; scheduledTime: string; delayMinutes: number; status: string }[];
  inventoryAlerts: { name: string; currentStock: number; minimumStock: number }[];
  maintenanceAlerts: { equipmentName: string | null; type: string; status: string }[];
  liveAIRecommendations: { id: string; agent: string; recommendation: string; priority: string; status: string }[];
  operationalRisks: { severity: "critical" | "high" | "medium" | "low"; title: string; detail: string }[];
}

interface EventItem {
  id: number;
  eventType: string;
  aggregate: string;
  aggregateId: string | null;
  payload: Record<string, unknown> | null;
  occurredAt: string;
}

const FLOW_STAGES = [
  { key: "referral", label: "Referral", color: "bg-slate-400" },
  { key: "appointment", label: "Appointment", color: "bg-brand" },
  { key: "arrival", label: "Arrival", color: "bg-cyan-400" },
  { key: "study_created", label: "Study Created", color: "bg-brand" },
  { key: "sent_to_orthanc", label: "To Orthanc", color: "bg-brand-hover" },
  { key: "assigned", label: "Assigned", color: "bg-ai" },
  { key: "opened", label: "Opened", color: "bg-ai-hover" },
  { key: "review", label: "AI Review", color: "bg-ai" },
  { key: "report_draft", label: "Report Draft", color: "bg-premium" },
  { key: "signed", label: "Signed", color: "bg-operational-hover" },
  { key: "released", label: "Released", color: "bg-operational" },
  { key: "archived", label: "Archived", color: "bg-slate-400" },
];

const RISK_STYLES: Record<string, string> = {
  critical: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  high: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
  medium: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  low: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
};

const EVENT_LABELS: Record<string, string> = {
  "patient.registered": "Patient registered",
  "appointment.created": "Appointment created",
  "appointment.checked_in": "Patient checked in",
  "study.uploaded": "Study uploaded",
  "study.created": "Study created",
  "study.sent_to_orthanc": "Study sent to Orthanc",
  "study.assigned": "Study assigned",
  "study.opened": "Study opened",
  "study.started": "Study started",
  "study.completed": "Study completed",
  "study.archived": "Study archived",
  "worklist.updated": "Worklist updated",
  "report.started": "Report started",
  "report.approved": "Report approved",
  "report.signed": "Report signed",
  "ai.observation_accepted": "AI observation accepted",
  "decision.proposed": "AI decision proposed",
  "decision.executed": "Decision executed",
  "equipment.offline": "Machine offline",
  "inventory.low_stock": "Low stock alert",
  "knowledge.published": "Document published",
};

export default function CommandCentrePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const initialized = useRef(false);

  const fetchAll = useCallback(() => {
    fetch("/api/command-centre")
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setSnap(d); setLastUpdated(new Date()); } })
      .catch(() => {});
    fetch("/api/events?limit=40")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setEvents(d.events ?? []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      fetchAll();
    }
    const timer = setInterval(fetchAll, 10000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const seedDatabase = async () => {
    setSeeding(true);
    try {
      await fetch("/api/seed", { method: "POST" });
      setSeeded(true);
      fetchAll();
    } catch { /* ignore */ }
    setSeeding(false);
  };

  const isEmpty = snap !== null && snap.kpis.patientsToday === 0 && snap.kpis.appointmentsToday === 0 && snap.kpis.activeStudies === 0;

  // Semantic KPI tones: azure=core ops, violet=AI/reporting, green=health, gold=executive/finance.
  const kpis = snap ? [
    { label: "Patients Today", value: snap.kpis.patientsToday, icon: Users, tone: "text-brand bg-brand-soft", live: true },
    { label: "Appointments Today", value: snap.kpis.appointmentsToday, icon: Calendar, tone: "text-operational bg-operational-soft", live: true },
    { label: "Checked In", value: snap.kpis.checkedIn, icon: Radio, tone: "text-brand bg-brand-soft", live: true },
    { label: "Active Studies", value: snap.kpis.activeStudies, icon: Activity, tone: "text-brand bg-brand-soft", live: true },
    { label: "Pending Reports", value: snap.kpis.pendingReports, icon: FileText, tone: "text-ai bg-ai-soft", live: true },
    { label: "Emergency Cases", value: snap.kpis.emergencyCases, icon: AlertTriangle, tone: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400", live: true },
    { label: "Revenue Today", value: formatPula(snap.kpis.revenueToday), icon: TrendingUp, tone: "text-premium bg-premium-soft", live: true },
    { label: "Machines Up", value: `${snap.kpis.equipmentOperational}/${snap.kpis.equipmentTotal}`, icon: Monitor, tone: "text-operational bg-operational-soft", live: true },
  ] : [];

  const maxFlow = Math.max(1, ...(snap?.patientFlow.map((f) => f.count) ?? [1]));

  return (
    <Shell title="Operations Command Centre" description="Real-time diagnostic imaging operations — refreshed every 10 seconds">
      {/* Canonical clinical entry — single localhost gateway */}
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link href="/workstation" className="group flex items-center justify-between rounded-xl border border-[var(--color-gerald-teal)] bg-[var(--color-gerald-teal)] px-5 py-4 text-white shadow-sm transition-all hover:bg-[var(--color-gerald-teal-deep)] hover:shadow-md">
          <div>
            <p className="text-sm font-bold tracking-tight">OPEN RADIOLOGY WORKSTATION</p>
            <p className="text-xs text-white/80">Worklist → OHIF → Reporting</p>
          </div>
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </Link>
        <Link href="/workstation/demo" className="group flex items-center justify-between rounded-xl border border-amber-300 bg-amber-400 px-5 py-4 text-slate-900 shadow-sm transition-all hover:bg-amber-300">
          <div>
            <p className="text-sm font-bold tracking-tight">OPEN CT BRAIN DEMO</p>
            <p className="text-xs text-slate-700">GH-100001 · Real DICOM · One click</p>
          </div>
          <ScanSearch className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </Link>
        <Link href="/system/health" className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-all hover:border-brand/40 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">SYSTEM HEALTH</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Postgres · Orthanc · OHIF · Redis</p>
          </div>
          <Monitor className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Quick links — patients / worklist / reporting */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/reception"><Button variant="outline" size="sm" className="gap-1"><Users className="h-3.5 w-3.5" /> Patients / Worklist</Button></Link>
        <Link href="/reporting"><Button variant="outline" size="sm" className="gap-1"><FileText className="h-3.5 w-3.5" /> Reporting</Button></Link>
        <Link href="/review"><Button variant="outline" size="sm" className="gap-1"><ScanSearch className="h-3.5 w-3.5" /> AI Review</Button></Link>
        <Link href="/clinical"><Button variant="outline" size="sm" className="gap-1"><Activity className="h-3.5 w-3.5" /> Clinical Portal</Button></Link>
      </div>

      {/* Empty state + live indicator row */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {isEmpty && !seeded ? (
          <Card className="w-full border-brand/40 bg-brand-soft/50">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <h3 className="text-sm font-semibold text-brand-text">Database is empty</h3>
                <p className="text-xs text-brand-text/80">Seed demo data to populate the command centre.</p>
              </div>
              <Button onClick={seedDatabase} disabled={seeding} size="sm">{seeding ? "Seeding…" : "Seed Database"}</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 pulse-dot" />
              Live
            </span>
            <span>·</span>
            <span>Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "…"}</span>
            <button onClick={fetchAll} className="ml-1 flex items-center gap-1 font-medium text-brand-text hover:text-brand-active">
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
        )}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-8">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="overflow-hidden">
            <CardContent className="p-4">
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", kpi.tone.split(" ").slice(1).join(" "))}>
                <kpi.icon className={cn("h-4 w-4", kpi.tone.split(" ")[0])} />
              </div>
              <p className="mt-3 truncate text-xl font-bold text-slate-900 dark:text-slate-100">{kpi.value}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Operational risks + patient flow */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-brand" />
              Patient Flow Pipeline
            </CardTitle>
            <CardDescription>Live studies by workflow stage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 overflow-x-auto pb-1">
              {FLOW_STAGES.map((s, i) => {
                const count = snap?.patientFlow.find((f) => f.stage === s.key)?.count ?? 0;
                return (
                  <React.Fragment key={s.key}>
                    <div className="flex flex-1 flex-col items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{count}</span>
                      <div className="h-28 w-full overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                        <div
                          className={cn("w-full rounded-md transition-all duration-700", s.color)}
                          style={{ height: `${Math.max(6, (count / maxFlow) * 100)}%`, marginTop: "auto" }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-[10px] font-medium text-slate-500 dark:text-slate-400">{s.label}</span>
                    </div>
                    {i < FLOW_STAGES.length - 1 && <ArrowRight className="mb-8 h-3 w-3 flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                  </React.Fragment>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Operational Risks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snap?.operationalRisks ?? []).map((risk) => (
              <div key={risk.title} className={cn("rounded-lg border p-3", RISK_STYLES[risk.severity] ?? RISK_STYLES.low)}>
                <p className="text-sm font-semibold">{risk.title}</p>
                <p className="mt-0.5 text-xs opacity-80">{risk.detail}</p>
              </div>
            ))}
            {snap && snap.operationalRisks.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">No risks detected</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Queue + utilisation */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-brand" />
              Queue Status
            </CardTitle>
            <CardDescription>Waiting and in-progress per modality</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snap?.queue ?? []).map((q) => (
              <div key={q.equipmentName} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2.5 dark:border-slate-800">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{q.equipmentName}</p>
                  <p className="text-xs text-slate-400">{q.modality}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{q.waiting}</p>
                    <p className="text-[10px] text-slate-400">Waiting</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-cyan-600 dark:text-cyan-400">{q.inProgress}</p>
                    <p className="text-[10px] text-slate-400">In Progress</p>
                  </div>
                  <Badge variant={q.status === "operational" ? "success" : q.status === "maintenance" ? "warning" : "destructive"}>
                    {q.status}
                  </Badge>
                </div>
              </div>
            ))}
            {snap && snap.queue.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No imaging queues</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-ai" />
              Machine Utilisation
            </CardTitle>
            <CardDescription>Live capacity utilisation per unit</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snap?.machineUtilisation ?? []).map((m) => (
              <div key={m.equipmentName}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{m.equipmentName}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{m.utilisation.toFixed(1)}% · {m.status}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", m.utilisation > 80 ? "bg-red-500" : m.utilisation > 60 ? "bg-amber-500" : "bg-emerald-500")}
                    style={{ width: `${Math.min(100, m.utilisation)}%` }}
                  />
                </div>
              </div>
            ))}
            {snap && snap.machineUtilisation.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No equipment registered</p>}
          </CardContent>
        </Card>
      </div>

      {/* Workload, referrals, alerts */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-brand" />
              Radiologist Workload
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snap?.radiologistWorkload ?? []).map((r) => (
              <div key={r.name} className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{r.name}</span>
                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>{r.assigned} assigned</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{r.signedToday} signed</span>
                </div>
              </div>
            ))}
            {snap && snap.radiologistWorkload.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No radiologists registered</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-brand" />
              Referral Sources
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(snap?.referralSources ?? []).map((r) => (
              <div key={r.physician} className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">{r.physician}</span>
                <Badge variant="outline">{r.count}</Badge>
              </div>
            ))}
            {snap && snap.referralSources.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No referrals yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-premium" />
              Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snap?.inventoryAlerts ?? []).map((a) => (
              <div key={a.name} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{a.name}</span>
                <span className="text-xs text-amber-700 dark:text-amber-400">{a.currentStock}/{a.minimumStock} min</span>
              </div>
            ))}
            {(snap?.maintenanceAlerts ?? []).map((m) => (
              <div key={`${m.equipmentName}-${m.type}`} className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2 dark:border-orange-900 dark:bg-orange-950/30">
                <span className="flex items-center gap-2 text-sm font-medium text-orange-800 dark:text-orange-300">
                  <Wrench className="h-3.5 w-3.5" />
                  {m.equipmentName ?? "Equipment"}
                </span>
                <Badge variant="warning">{m.status}</Badge>
              </div>
            ))}
            {(snap?.appointmentDelays ?? []).slice(0, 3).map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="text-sm text-slate-700 dark:text-slate-300">{d.patientName}</span>
                <span className="text-xs font-medium text-red-600 dark:text-red-400">+{d.delayMinutes} min</span>
              </div>
            ))}
            {snap && snap.inventoryAlerts.length === 0 && snap.maintenanceAlerts.length === 0 && snap.appointmentDelays.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">No active alerts</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI recommendations + activity feed */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-ai" />
                  Live AI Recommendations
                </CardTitle>
                <CardDescription>Proposed by agents — routed through the Decision Engine for approval</CardDescription>
              </div>
              <Link href="/agents">
                <Button variant="outline" size="sm" className="gap-1">
                  Agents <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snap?.liveAIRecommendations ?? []).map((rec) => (
              <div key={rec.id} className="rounded-lg border border-ai/30 bg-ai-soft/40 p-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px] uppercase">{rec.agent}</Badge>
                  <Badge variant={rec.priority === "stat" ? "destructive" : rec.priority === "urgent" ? "warning" : "secondary"}>
                    {rec.priority}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{rec.recommendation}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Status: {rec.status}</p>
              </div>
            ))}
            {snap && snap.liveAIRecommendations.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">No AI recommendations awaiting attention</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-brand" />
              Activity Feed
            </CardTitle>
            <CardDescription>Every major event from the platform event bus</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[24rem] space-y-0 overflow-y-auto">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-3 border-b border-slate-50 py-2.5 last:border-0 dark:border-slate-800">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {EVENT_LABELS[e.eventType] ?? e.eventType.replace(/\./g, " ")}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(e.occurredAt).toLocaleString()} · {e.aggregate}
                    {e.aggregateId ? ` · ${e.aggregateId.slice(0, 8)}` : ""}
                  </p>
                </div>
              </div>
            ))}
            {events.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">No events yet — activity will appear as modules generate them</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Integration health strip */}
      <div className="mt-6">
        <Link href="/settings" className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 transition-colors hover:border-brand/60 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-800">
              <ScanSearch className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Integration Health</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Full stack status: Orthanc, OHIF, Keycloak, FHIR, n8n, LangGraph, MinIO, Redis</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </Shell>
  );
}
