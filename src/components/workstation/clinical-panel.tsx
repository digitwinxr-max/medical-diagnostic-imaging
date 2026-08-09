"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useWorkstation, type ReportRow } from "./workstation-context";
import { cn } from "@/lib/utils";
import {
  User,
  History,
  ScanSearch,
  Ruler,
  FileText,
  Check,
  X,
  Sparkles,
  ShieldCheck,
  Stethoscope,
  Building2,
  CalendarDays,
  FlaskConical,
  Layers,
  Loader2,
} from "lucide-react";
import { ReportEditor } from "./report-editor";

const TABS = [
  { id: "patient", label: "Patient", icon: User },
  { id: "history", label: "History", icon: History },
  { id: "ai", label: "AI Review", icon: ScanSearch },
  { id: "measure", label: "Measure", icon: Ruler },
  { id: "report", label: "Report", icon: FileText },
] as const;

export function ClinicalPanel() {
  const { layout, updateLayout } = useWorkstation();
  const [tab, setTab] = useState<string>(layout.rightTab || "patient");

  const selectTab = (id: string) => {
    setTab(id);
    updateLayout({ rightTab: id });
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      {/* Tab bar */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 border-b-2 px-1 py-2 text-[10px] font-medium transition-colors",
              tab === t.id
                ? "border-brand text-brand"
                : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            )}
          >
            <t.icon className="h-3 w-3" /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "patient" && <PatientTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "ai" && <AiTab />}
        {tab === "measure" && <MeasureTab />}
        {tab === "report" && <ReportTab />}
      </div>
    </div>
  );
}

// ─── Patient demographics + clinical history + referral ───
function PatientTab() {
  const { selected, contextData } = useWorkstation();
  const patient = contextData?.patient as Record<string, unknown> | null;
  const referral = contextData?.referral as Record<string, unknown> | null;

  const rows: { label: string; value: string | null; icon: React.ElementType }[] = [
    { label: "Patient ID / MRN", value: (patient?.mrn as string) ?? selected?.patientMrn ?? null, icon: User },
    { label: "Date of birth", value: (patient?.dob as string) ?? (patient?.birthDate as string) ?? null, icon: CalendarDays },
    { label: "Gender", value: (patient?.gender as string) ?? (patient?.sex as string) ?? null, icon: User },
    { label: "Insurance", value: (patient?.insuranceProvider as string) ?? null, icon: ShieldCheck },
    { label: "Policy", value: (patient?.insurancePolicyNumber as string) ?? null, icon: ShieldCheck },
    { label: "Phone", value: (patient?.phone as string) ?? null, icon: User },
    { label: "Email", value: (patient?.email as string) ?? null, icon: User },
  ];

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          {((patient?.name as string) ?? `${selected?.patientFirstName ?? ""} ${selected?.patientLastName ?? ""}`.trim()) || "Patient"}
        </p>
        <p className="text-[10px] text-slate-400">
          {selected?.modality} · {selected?.procedure}
        </p>
      </div>

      <Section title="Demographics">
        {rows.filter((r) => r.value).map((r) => (
          <InfoRow key={r.label} label={r.label} value={r.value!} icon={r.icon} />
        ))}
        {rows.every((r) => !r.value) && <Empty text="Demographics load from Orthanc / RIS when available." />}
      </Section>

      <Section title="Clinical History">
        {contextData?.history ? (
          <p className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {contextData.history}
          </p>
        ) : (
          <Empty text="No clinical history recorded on this patient." />
        )}
      </Section>

      {referral && (
        <Section title="Referral" icon={Stethoscope}>
          <div className="space-y-1.5">
            <InfoRow label="Referring physician" value={(referral.referringPhysician as string) ?? "—"} icon={Stethoscope} />
            {(referral.referringFacility as string) && <InfoRow label="Facility" value={referral.referringFacility as string} icon={Building2} />}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Clinical indication</p>
              <p className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {(referral.clinicalIndication as string) ?? "—"}
              </p>
            </div>
            {(referral.notes as string) && (
              <p className="text-[10px] text-slate-400">Notes: {referral.notes as string}</p>
            )}
          </div>
        </Section>
      )}

      {contextData?.fhirLabSummary && (
        <Section title="Laboratory (FHIR)" icon={FlaskConical}>
          <p className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {contextData.fhirLabSummary}
          </p>
        </Section>
      )}

      {contextData?.protocols && contextData.protocols.length > 0 && (
        <Section title="Relevant Protocols" icon={Layers}>
          <div className="space-y-1">
            {contextData.protocols.map((p) => (
              <div key={p.id as string} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <p className="text-[11px] font-medium text-slate-800 dark:text-slate-200">{p.title as string}</p>
                <p className="text-[9px] text-slate-400">v{p.version as string} · {p.category as string}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Previous studies + previous reports + similar cases ───
function HistoryTab() {
  const { contextData } = useWorkstation();
  const prev = (contextData?.previousStudies ?? []) as Record<string, unknown>[];
  const reports = (contextData?.previousReports ?? []) as Record<string, unknown>[];
  const similar = (contextData?.similarCases ?? []) as Record<string, unknown>[];

  return (
    <div className="space-y-4 p-3">
      <Section title={`Previous Studies (${prev.length})`} icon={History}>
        {prev.length === 0 && <Empty text="No previous studies on record." />}
        <div className="space-y-1.5">
          {prev.slice(0, 8).map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                  {(s.description as string) ?? (s.procedure as string) ?? "Study"}
                </p>
                <p className="text-[9px] text-slate-400">
                  {(s.modalities as string) ?? (s.modality as string) ?? "—"} · {(s.studyDate as string) ?? (s.createdAt as string)?.slice(0, 10) ?? "—"}
                </p>
              </div>
              {(s as { source?: string }).source === "ris" && (
                <span className="rounded bg-ai-soft px-1 py-px text-[8px] font-medium text-ai-text">RIS</span>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Previous Reports (${reports.length})`} icon={FileText}>
        {reports.length === 0 && <Empty text="No signed reports found for this patient." />}
        <div className="space-y-1.5">
          {reports.slice(0, 5).map((r) => (
            <details key={r.id as string} className="rounded-lg border border-slate-200 dark:border-slate-800">
              <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900">
                {(r.templateName as string) ?? "Report"} · {(r.signedAt as string)?.slice(0, 10) ?? (r.createdAt as string)?.slice(0, 10)}
              </summary>
              <div className="space-y-1 border-t border-slate-100 px-2.5 py-2 text-[10px] dark:border-slate-800">
                {r.impression ? <p className="text-slate-600 dark:text-slate-300"><b>Impression:</b> {r.impression as string}</p> : null}
                {r.findings ? <p className="text-slate-500 dark:text-slate-400">{r.findings as string}</p> : null}
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section title="Similar Historical Cases" icon={Sparkles}>
        {similar.length === 0 && <Empty text="Accepted AI observations will surface similar cases here." />}
        <div className="space-y-1.5">
          {similar.map((s) => (
            <div key={s.id as string} className="rounded-lg border border-ai/40 bg-ai-soft/40 p-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-ai-text">{s.region as string}</p>
                <span className="rounded bg-ai-soft px-1 py-px text-[8px] font-semibold text-ai-text">
                  {(s.confidence as string) ?? "—"}%
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10px] text-ai-text/70">{s.description as string}</p>
            </div>
          ))}
        </div>
      </Section>

      {contextData?.teachingFiles && contextData.teachingFiles.length > 0 && (
        <Section title="Teaching Files" icon={Layers}>
          <div className="space-y-1">
            {contextData.teachingFiles.map((t, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{t.title as string}</p>
                <p className="text-[9px] text-slate-400">v{t.version as string}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── AI visual review (inside the workstation) ───
function AiTab() {
  const { observations, runAiReview, reviewObservation, selected } = useWorkstation();
  const [busy, setBusy] = useState(false);

  const doRun = async () => {
    setBusy(true);
    await runAiReview();
    setBusy(false);
  };

  const pending = observations.filter((o) => o.status === "pending");
  const decided = observations.filter((o) => o.status !== "pending");

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Candidate observations</p>
        <button
          onClick={doRun}
          disabled={busy || !selected}
          className="flex items-center gap-1 rounded-md bg-ai-hover px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-ai-active disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />} Run AI Review
        </button>
      </div>

      <p className="rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5 text-center text-[9px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        SIMULATION / DEVELOPMENT ONLY — NOT CLINICAL INFERENCE
      </p>
      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <ShieldCheck className="mt-0.5 h-3 w-3 flex-shrink-0" />
        Decision support only. Every observation is a candidate — accept or reject it. The AI never makes the diagnosis.
      </p>

      {pending.map((o) => {
        const conf = Number(o.confidence ?? 0);
        return (
          <div key={o.id} className={cn("rounded-lg border p-2.5", o.category === "critical" ? "border-red-300 dark:border-red-900" : "border-slate-200 dark:border-slate-800")}>
            <div className="flex items-center justify-between">
              <span className={cn("rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide",
                o.category === "critical" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : o.category === "technical" ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  : o.category === "normal" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300")}>
                {o.category}
              </span>
              <span className={cn("text-[11px] font-bold", conf >= 80 ? "text-red-600" : conf >= 60 ? "text-amber-600" : "text-slate-500 dark:text-slate-400")}>
                {o.confidence ? `${o.confidence}%` : "—"}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-700 dark:text-slate-200">{o.description}</p>
            {o.suggestedDifferential.length > 0 && (
              <p className="mt-1 text-[9px] text-slate-400">Differentials: {o.suggestedDifferential.join(" · ")}</p>
            )}
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => reviewObservation(o.id, "accepted")} className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-500">
                <Check className="h-3 w-3" /> Accept
              </button>
              <button onClick={() => reviewObservation(o.id, "rejected")} className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <X className="h-3 w-3" /> Reject
              </button>
            </div>
          </div>
        );
      })}
      {pending.length === 0 && !busy && (
        <Empty text={observations.length > 0 ? "All candidates reviewed." : "Run an AI review to generate candidate observations."} />
      )}

      {decided.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">Reviewed ({decided.length})</p>
          <div className="space-y-1">
            {decided.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-md border border-slate-100 px-2 py-1 dark:border-slate-800">
                <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">{o.region} — {o.category}</p>
                <span className={cn("flex items-center gap-0.5 text-[9px] font-medium", o.status === "accepted" ? "text-emerald-600" : "text-red-500")}>
                  {o.status === "accepted" ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />} {o.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Measurements & annotations ───
function MeasureTab() {
  const { annotations, addAnnotation, removeAnnotation } = useWorkstation();
  const [tool, setTool] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const tools = ["length", "angle", "area", "arrow", "text", "ellipse"] as const;

  const save = async () => {
    if (!tool) return;
    await addAnnotation(tool, label || `${tool} measurement`, {});
    setLabel("");
    setTool(null);
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Measurement & annotation tools</p>
      <div className="grid grid-cols-3 gap-1">
        {tools.map((t) => (
          <button
            key={t}
            onClick={() => setTool(tool === t ? null : t)}
            className={cn(
              "rounded-md border px-1.5 py-1.5 text-[10px] font-medium capitalize transition-colors",
              tool === t
                ? "border-brand bg-brand/15 text-brand-text"
                : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900"
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tool && (
        <div className="space-y-1.5 rounded-lg border border-brand/40 bg-brand-soft/60 p-2">
          <p className="text-[10px] text-brand-text">Adding a {tool} annotation</p>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Note (e.g. 12 mm nodule)"
            className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <button onClick={save} className="h-7 w-full rounded-md bg-brand-hover text-[10px] font-medium text-white hover:bg-brand-active">Save</button>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Saved ({annotations.length})</p>
        {annotations.length === 0 && <Empty text="Measurements persist against this study." />}
        {annotations.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-800">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">{a.label}</p>
              <p className="text-[9px] text-slate-400">{a.tool} · {new Date(a.createdAt).toLocaleString()}</p>
            </div>
            <button onClick={() => removeAnnotation(a.id)} className="text-slate-400 transition-colors hover:text-red-500">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Integrated reporting environment ───
function ReportTab() {
  return <ReportEditor />;
}



function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        {Icon && <Icon className="h-3 w-3" />} {title}
      </p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
        <Icon className="h-3 w-3 text-slate-300 dark:text-slate-600" /> {label}
      </span>
      <span className="max-w-[55%] truncate text-right text-[11px] font-medium text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400 dark:border-slate-800">{text}</p>;
}
