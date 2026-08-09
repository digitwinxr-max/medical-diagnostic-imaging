import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Image, FileText, Users, ScanSearch, Cpu, Monitor, ShieldCheck, ArrowRight } from "lucide-react";

export default function ClinicalPortalPage() {
  const tiles = [
    {
      title: "Worklist",
      description: "Radiologist worklist — priority triage and study assignment",
      href: "/workstation",
      cta: "Open Radiologist Workstation",
      icon: Activity,
      accent: "text-brand bg-brand-soft",
    },
    {
      title: "Imaging",
      description: "PACS browser — Orthanc studies, directly embedded OHIF viewer",
      href: "/imaging",
      cta: "PACS / OHIF",
      icon: Image,
      accent: "text-brand bg-brand-soft",
    },
    {
      title: "Reporting",
      description: "Structured reporting — templates, draft, sign, release",
      href: "/reporting",
      cta: "Reports",
      icon: FileText,
      accent: "text-premium bg-premium-soft",
    },
    {
      title: "Patients",
      description: "Patient registry — demographics, history, referrals",
      href: "/reception",
      cta: "Patient Registry",
      icon: Users,
      accent: "text-operational bg-operational-soft",
    },
    {
      title: "AI Review",
      description: "Assistive AI observations — decision support, not autonomous diagnosis",
      href: "/review",
      cta: "AI Review",
      icon: ScanSearch,
      accent: "text-ai bg-ai-soft",
    },
    {
      title: "Operations",
      description: "Command Centre — KPIs, flow, queue, utilisation, risks",
      href: "/",
      cta: "Command Centre",
      icon: Cpu,
      accent: "text-brand bg-brand-soft",
    },
    {
      title: "System Health",
      description: "Live infrastructure — database, PACS, viewer, agents, storage",
      href: "/system/health",
      cta: "Service Health",
      icon: Monitor,
      accent: "text-operational bg-operational-soft",
    },
    {
      title: "One-Click CT Demo",
      description: "CT Brain · GH-100001 · 1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809 — real DICOM pixels via Orthanc→DICOMweb→OHIF",
      href: "/workstation/demo",
      cta: "Open Demo Study",
      icon: ShieldCheck,
      accent: "bg-amber-400 text-slate-900",
      highlight: true,
    },
  ];

  return (
    <Shell title="GeraldOS Clinical Platform" description="Single entry point — every clinical capability behind localhost:3000">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-xl border border-[var(--color-gerald-border)] bg-white p-5 dark:border-[var(--color-gerald-border)] dark:bg-[var(--color-gerald-surface)]">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-gerald-text)]">GeraldOS Clinical Intelligence Platform</h2>
          <p className="mt-1 text-sm text-[var(--color-gerald-muted)]">
            Premium private healthcare infrastructure — one URL, one workstation, real DICOM pixels. All infrastructure services run behind{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs dark:bg-slate-800">localhost:3000</code>.
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Developer service ports are internal only — see System Health for live status. Do not open :3001 / :8042 / :8180 directly for normal clinical workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.title} className={t.highlight ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : ""}>
              <CardHeader className="pb-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.accent}`}>
                  <t.icon className="h-5 w-5" />
                </div>
                <CardTitle className="mt-3">{t.title}</CardTitle>
                <CardDescription className="line-clamp-2">{t.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href={t.href}>
                  <Button variant={t.highlight ? "default" : "outline"} size="sm" className="w-full gap-1">
                    {t.cta} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <p className="font-semibold text-slate-700 dark:text-slate-200">One-command local launch</p>
          <code className="mt-1 block rounded bg-white p-2 font-mono text-xs dark:bg-slate-800">powershell -ExecutionPolicy Bypass -File .\scripts\start-clinical-preview.ps1</code>
          <p className="mt-1">Then open <a href="http://localhost:3000" className="font-medium text-brand-text underline">http://localhost:3000</a> → Clinical → Workstation → Demo CT.</p>
        </div>
      </div>
    </Shell>
  );
}
