"use client";

/**
 * GeraldOS Workstation — Local Demonstration Mode
 * Route: /workstation/demo
 * Development-only: auto-selects the known CT Brain test study when available.
 * Guarded by NODE_ENV !== 'production' (and not exposed in production builds).
 *
 * Purpose: `http://localhost:3000/workstation/demo` immediately shows:
 * GeraldOS Workstation + real CT study + embedded OHIF viewer with pixels.
 */

import React, { useEffect, useState } from "react";
import { WorkstationProvider, useWorkstation } from "@/components/workstation/workstation-context";
import { WorklistPanel } from "@/components/workstation/worklist-panel";
import { ViewerPanel } from "@/components/workstation/viewer-panel";
import { ClinicalPanel } from "@/components/workstation/clinical-panel";
import { ActivityPanel } from "@/components/workstation/activity-panel";
import { WorkstationCommandPalette } from "@/components/workstation/workstation-command-palette";
import { ClinicalHealthStrip } from "@/components/workstation/clinical-health-strip";
import Link from "next/link";
import { PanelLeft, PanelRight, PanelBottom, Maximize, Minimize, ChevronLeft, X, Command, Keyboard } from "lucide-react";

// Real test fixture — supplied local CT Brain study (Orthanc Study ID 50d30f69-d241a2b3-3cc18776-506c036f-ab047379)
const DEMO_STUDY_UID = "1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809";
const DEMO_LABEL = "CT Brain · GH-100001";

function DemoWorkstationLayout() {
  const { layout, updateLayout, prevStudy, nextStudy, toggleBookmark, runAiReview, signReport, releaseStudy, fullscreen, toggleFullscreen, entries, selected, openStudy } =
    useWorkstation();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [demoTried, setDemoTried] = useState(false);
  const [demoStatus, setDemoStatus] = useState<string>("Locating demo study…");

  // Auto-select demo study when worklist is populated (dev only)
  useEffect(() => {
    if (demoTried || selected) return;
    if (entries.length === 0) return;
    const isProd = process.env.NODE_ENV === "production";
    // Allow demo in development OR when explicitly enabled via NEXT_PUBLIC_DEMO=true
    const demoEnabled = !isProd || process.env.NEXT_PUBLIC_DEMO === "true";
    if (!demoEnabled) {
      setDemoStatus("Demo auto-select disabled in production");
      setDemoTried(true);
      return;
    }
    const match = entries.find((e) => e.studyInstanceUid === DEMO_STUDY_UID);
    if (match) {
      setDemoStatus(`Opening ${DEMO_LABEL}…`);
      openStudy(match);
      setDemoTried(true);
    } else {
      setDemoStatus(`Demo CT study not yet in worklist — trigger reconciliation or STOW again (looking for ${DEMO_STUDY_UID.slice(0, 20)}…)`);
      // Keep trying for a few seconds (reconciler polls every 5s)
      const t = setTimeout(() => setDemoTried(false), 6000);
      return () => clearTimeout(t);
    }
  }, [entries, selected, demoTried, openStudy]);

  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_DEMO !== "true") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-8 text-center dark:bg-slate-950">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950/30">
          <h1 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Demo not available in production</h1>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            <code>/workstation/demo</code> is development-only. Use <Link href="/workstation" className="underline">/workstation</Link> and select the CT Brain study.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[var(--color-gerald-navy)] px-3">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gh-logo.png" alt="GH" className="h-5 w-5 object-contain" />
          </span>
          <span className="text-[12px] font-semibold tracking-tight text-white">Radiologist Workstation</span>
          <span className="hidden rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-900 md:inline">
            DEMO · {DEMO_LABEL}
          </span>
          <span className="hidden text-[10px] text-white/60 md:inline">{demoStatus}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[9px] text-white/60 md:inline">{DEMO_STUDY_UID.slice(0, 32)}…</span>
          <button onClick={() => setShowPalette(true)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-white/70 hover:bg-white/10 hover:text-white">
            <Command className="h-3.5 w-3.5" /> <kbd className="hidden rounded border border-white/20 bg-white/10 px-1 py-px font-mono text-[9px] lg:inline">⌘K</kbd>
          </button>
          <button onClick={() => setShowShortcuts((s) => !s)} className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
            <Keyboard className="h-4 w-4" />
          </button>
          <button onClick={toggleFullscreen} className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Health strip */}
      <div className="flex shrink-0 items-center justify-center border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
        <ClinicalHealthStrip />
      </div>

      {/* Grid */}
      <div className="flex min-h-0 flex-1">
        {layout.leftWidth > 0 && (
          <div className="relative shrink-0 border-r border-slate-200 dark:border-slate-800" style={{ width: layout.leftWidth }}>
            <WorklistPanel />
          </div>
        )}
        <div className="relative min-w-0 flex-1">
          <ViewerPanel />
        </div>
        {layout.rightWidth > 0 && (
          <div className="relative shrink-0 border-l border-slate-200 dark:border-slate-800" style={{ width: layout.rightWidth }}>
            <ClinicalPanel />
          </div>
        )}
      </div>

      {layout.bottomOpen && (
        <div className="relative shrink-0 border-t border-slate-200 dark:border-slate-800" style={{ height: layout.bottomHeight }}>
          <ActivityPanel />
        </div>
      )}

      <WorkstationCommandPalette open={showPalette} onClose={() => setShowPalette(false)} />

      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setShowShortcuts(false)}>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Demo CT Brain</p>
              <button onClick={() => setShowShortcuts(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              StudyInstanceUID <code className="font-mono text-[10px]">{DEMO_STUDY_UID}</code> — Orthanc 50d30f69… — Patient GH-100001
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DemoPage() {
  return (
    <WorkstationProvider>
      <DemoWorkstationLayout />
    </WorkstationProvider>
  );
}
